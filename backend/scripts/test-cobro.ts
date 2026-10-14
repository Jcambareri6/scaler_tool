// Test de punta a punta del cobro por video, la aprobacion de cuentas y el
// cierre de la base (ver informe-cambios.md).
//
//   npx tsx scripts/test-cobro.ts
//
// Que hace:
// - Crea 2 usuarios temporales (un "admin" y un "alumno") con la service key.
// - Levanta una API propia en el puerto 3099 con login real, MOCK_PROVIDERS
//   y EXECUTION_MODE=inline (nada llega a la cola del worker de produccion),
//   con el admin temporal en ADMIN_USER_IDS.
// - Corre las pruebas contra esa API y contra Supabase directo.
// - Al final borra los 2 usuarios: todo lo que crearon (cuenta, saldo,
//   movimientos, proyectos, jobs, workspace) se borra en cascada.
//
// OJO: corre contra la base de backend/.env (hoy, la de produccion). Solo
// toca filas de los usuarios temporales.

import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const PORT = 3099;
const API = `http://localhost:${PORT}`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = readFileSync(path.join(ROOT, "frontend_v1/.env"), "utf8").match(/^VITE_SUPABASE_ANON_KEY=(.+)$/m)?.[1]?.trim();
if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (backend/.env) o VITE_SUPABASE_ANON_KEY (frontend_v1/.env)");
  process.exit(1);
}

// Node 20 no trae WebSocket: mismo shim que lib/supabase.ts.
const CLIENT_OPTS = { auth: { persistSession: false }, realtime: { transport: ws as any } };
const admin = createClient(SUPABASE_URL, SERVICE_KEY, CLIENT_OPTS);
const anon = createClient(SUPABASE_URL, ANON_KEY, CLIENT_OPTS);

// --- mini runner -----------------------------------------------------------

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ❌ ${name}${detail !== undefined ? `  ->  ${JSON.stringify(detail)}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

async function api(method: string, url: string, token?: string, body?: unknown) {
  const res = await fetch(API + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json, headers: res.headers };
}

// Espera a que el job llegue a alguno de los estados pedidos.
async function waitJob(jobId: string, statuses: string[], timeoutMs = 120_000) {
  const start = Date.now();
  let last: any = null;
  while (Date.now() - start < timeoutMs) {
    const { data } = await admin.from("jobs").select("status, error").eq("id", jobId).single();
    last = data;
    if (data && statuses.includes(data.status)) return data;
    await sleep(1000);
  }
  return last;
}

const words = (n: number, word = "palabra") => Array.from({ length: n }, () => word).join(" ");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- usuarios temporales ---------------------------------------------------

const stamp = Date.now();
const PASSWORD = `Test-${stamp}-pass!`;
const createdUserIds: string[] = [];

async function createUser(label: string) {
  const email = `skaler-test-${label}-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`No se pudo crear ${label}: ${error?.message}`);
  createdUserIds.push(data.user.id);
  const login = createClient(SUPABASE_URL, ANON_KEY!, CLIENT_OPTS);
  const { data: session, error: loginError } = await login.auth.signInWithPassword({ email, password: PASSWORD });
  if (loginError || !session.session) throw new Error(`No se pudo loguear ${label}: ${loginError?.message}`);
  return { id: data.user.id, email, token: session.session.access_token };
}

async function balanceOf(userId: string) {
  const { data } = await admin.from("video_credits").select("balance, used").eq("user_id", userId).single();
  return data as { balance: number; used: number };
}

async function setBalance(userId: string, balance: number) {
  await admin.from("video_credits").update({ balance }).eq("user_id", userId);
}

// --- API propia ------------------------------------------------------------

let server: ChildProcess | null = null;

async function startApi(adminId: string) {
  server = spawn("npx", ["tsx", "src/server.ts"], {
    cwd: ROOT,
    shell: true,
    env: {
      ...process.env,
      PORT: String(PORT),
      DISABLE_AUTH: "false",
      MOCK_PROVIDERS: "true",
      // Ignora los providers de la base: nada le pega a ai33, Whisper ni a
      // los LLMs con las keys reales (ver lib/providers.ts).
      OFFLINE_PROVIDERS: "true",
      EXECUTION_MODE: "inline",
      ADMIN_USER_IDS: adminId,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout?.on("data", (d) => (log += d));
  server.stderr?.on("data", (d) => (log += d));
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${API}/auth/me`);
      if (res.status === 401) return;
    } catch {
      /* todavia arrancando */
    }
    await sleep(500);
  }
  throw new Error(`La API de prueba no arranco en el puerto ${PORT}:\n${log}`);
}

function stopApi() {
  if (!server?.pid) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore" });
  else server.kill("SIGTERM");
}

// --- pruebas ---------------------------------------------------------------

async function run() {
  console.log("Preparando usuarios temporales y API de prueba...");
  const boss = await createUser("admin");
  const student = await createUser("alumno");
  await startApi(boss.id);

  section("1. Aprobacion de cuentas");
  let me = await api("GET", "/auth/me", student.token);
  check("cuenta nueva queda pendiente", me.status === 200 && me.body.status === "pending", me.body);
  check("cuenta nueva no es admin y tiene 0 videos", me.body.is_admin === false && me.body.videos_available === 0, me.body);

  let r = await api("GET", "/projects", student.token);
  check("pendiente: GET /projects da 403 ACCOUNT_PENDING", r.status === 403 && r.body.code === "ACCOUNT_PENDING", r);

  r = await api("GET", "/admin/users", student.token);
  check("alumno no puede entrar al panel de admin", r.status === 403, r.status);

  r = await api("GET", "/admin/users", boss.token);
  const listed = Array.isArray(r.body) && r.body.find((u: any) => u.id === student.id);
  check("admin ve al alumno pendiente en la lista", r.status === 200 && listed?.status === "pending", listed ?? r);

  r = await api("POST", `/admin/users/${student.id}/approve`, boss.token);
  me = await api("GET", "/auth/me", student.token);
  check("al aprobar recibe 5 videos", me.body.status === "approved" && me.body.videos_available === 5, me.body);

  r = await api("POST", `/admin/users/${student.id}/approve`, boss.token);
  me = await api("GET", "/auth/me", student.token);
  check("aprobar de nuevo no repite la bienvenida", me.body.videos_available === 5, me.body);

  r = await api("GET", "/projects", student.token);
  check("aprobado: GET /projects responde 200", r.status === 200, r.status);

  section("2. Limites y herramientas");
  r = await api("POST", "/tools/transcribe_audio/execute", student.token, { input: {} });
  check("tool interna (transcribe_audio) da 404", r.status === 404, r);

  r = await api("POST", "/projects", student.token, { title: "Test cobro A", target_duration: 60 });
  const projectA = r.body?.id as string;
  check("crear proyecto", r.status === 201 || r.status === 200, r);

  r = await api("POST", `/projects/${projectA}/script`, student.token, { content: { text: "x".repeat(35_001) } });
  check("guion de 35.001 caracteres da 400", r.status === 400, r);
  r = await api("POST", `/projects/${projectA}/script`, student.token, { content: { text: "Hola mundo." } });
  check("guion corto se guarda", r.status === 200 || r.status === 201, r);

  r = await api("PATCH", `/jobs/00000000-0000-0000-0000-000000000000`, student.token, { status: "COMPLETED" });
  check("PATCH /jobs/:id ya no existe", r.status === 404, r.status);

  section("3. Contador de videos (funciones de la base)");
  let c = await admin.rpc("charge_render", { p_project_id: projectA });
  check("primer render cobra", c.data === "charged", c);
  check("saldo baja a 4", (await balanceOf(student.id)).balance === 4);

  c = await admin.rpc("charge_render", { p_project_id: projectA });
  check("re-render no cobra (already_charged)", c.data === "already_charged", c);
  check("saldo sigue en 4", (await balanceOf(student.id)).balance === 4);

  const refund = await admin.rpc("refund_render", { p_project_id: projectA });
  check("render fallido devuelve el video", refund.data === true, refund);
  check("saldo vuelve a 5", (await balanceOf(student.id)).balance === 5);

  const refund2 = await admin.rpc("refund_render", { p_project_id: projectA });
  check("devolver dos veces no devuelve de mas", refund2.data === false && (await balanceOf(student.id)).balance === 5, refund2);

  // Con un render final ya hecho, un fallo posterior no devuelve.
  await admin.rpc("charge_render", { p_project_id: projectA });
  await admin.from("assets").insert({
    video_project_id: projectA,
    type: "VIDEO",
    storage_key: `test/${stamp}.mp4`,
    metadata: { kind: "final_render" },
  });
  const refund3 = await admin.rpc("refund_render", { p_project_id: projectA });
  check("con video final ya hecho, no se devuelve", refund3.data === false && (await balanceOf(student.id)).balance === 4, refund3);

  section("4. Carreras (clicks simultaneos)");
  const extra: string[] = [];
  for (let i = 0; i < 6; i++) {
    const p = await api("POST", "/projects", student.token, { title: `Test cobro paralelo ${i}`, target_duration: 60 });
    extra.push(p.body.id);
  }
  await setBalance(student.id, 1);
  const parallel = await Promise.all(extra.map((id) => admin.rpc("charge_render", { p_project_id: id })));
  const charged = parallel.filter((x) => x.data === "charged").length;
  check("6 proyectos a la vez con 1 video: cobra solo 1", charged === 1, parallel.map((x) => x.data ?? x.error?.message));
  check("saldo queda en 0, nunca negativo", (await balanceOf(student.id)).balance === 0);

  const fresh = await api("POST", "/projects", student.token, { title: "Test cobro mismo proyecto", target_duration: 60 });
  await setBalance(student.id, 3);
  const sameFresh = await Promise.all(Array.from({ length: 5 }, () => admin.rpc("charge_render", { p_project_id: fresh.body.id })));
  check(
    "5 clicks a la vez en el mismo proyecto: cobra 1 vez",
    sameFresh.filter((x) => x.data === "charged").length === 1 && (await balanceOf(student.id)).balance === 2,
    sameFresh.map((x) => x.data ?? x.error?.message)
  );

  section("5. Boton Renderizar sin saldo (endpoint)");
  await setBalance(student.id, 0);
  const noCredit = await api("POST", "/projects", student.token, { title: "Test cobro sin saldo", target_duration: 60 });
  const { data: job } = await admin
    .from("jobs")
    .insert({ video_project_id: noCredit.body.id, type: "FULL_PIPELINE", status: "AWAITING_STOCK_REVIEW" })
    .select("id")
    .single();
  r = await api("POST", `/jobs/${job!.id}/approve-stock-review`, student.token);
  check("sin videos: Renderizar da 402 NO_VIDEO_CREDITS", r.status === 402 && r.body.code === "NO_VIDEO_CREDITS", r);
  const { data: jobAfter } = await admin.from("jobs").select("status").eq("id", job!.id).single();
  check("el job no arranca a renderizar", jobAfter?.status === "AWAITING_STOCK_REVIEW", jobAfter);

  section("6. Panel de admin: cargar y sacar videos");
  r = await api("POST", `/admin/users/${student.id}/credits`, boss.token, { amount: 20, note: "test: pago" });
  check("cargar 20 videos", r.status === 200 && (await balanceOf(student.id)).balance === 20, r);
  r = await api("POST", `/admin/users/${student.id}/credits`, boss.token, { amount: -100, note: "test: de mas" });
  check("sacar mas de lo que tiene da 400", r.status === 400 && (await balanceOf(student.id)).balance === 20, r);
  r = await api("GET", `/admin/users/${student.id}/movements`, boss.token);
  check("historial muestra la carga con su nota", r.status === 200 && JSON.stringify(r.body).includes("test: pago"), r.status);

  section("7. IA desactivada y rutas borradas");
  for (const tool of ["generate_video", "generate_image", "generate_video_prompt", "render_video", "search_stock"]) {
    r = await api("POST", `/tools/${tool}/execute`, student.token, { input: {} });
    check(`/tools/${tool} da 404`, r.status === 404, r.status);
  }
  r = await api("GET", "/tools", student.token);
  const toolNames = Array.isArray(r.body) ? r.body.map((t: any) => t.name).sort() : r.body;
  check(
    "GET /tools lista solo las 4 permitidas",
    JSON.stringify(toolNames) === JSON.stringify(["generate_script", "generate_voice", "list_voices", "preview_voice"]),
    toolNames
  );
  r = await api("POST", "/auth/test", undefined, {});
  check("POST /auth/test ya no existe", r.status === 404, r.status);

  section("8. Voz (generate_voice / preview_voice)");
  const voiceProject = await api("POST", "/projects", student.token, { title: "Test cobro voz", target_duration: 60 });
  const voiceProjectId = voiceProject.body.id as string;
  await api("POST", `/projects/${voiceProjectId}/script`, student.token, { content: { text: "" } });
  const { data: voiceScript } = await admin.from("scripts").select("id").eq("video_project_id", voiceProjectId).single();
  r = await api("POST", "/tools/generate_voice/execute", student.token, { input: { script_id: voiceScript!.id, text: words(50) } });
  check("guion vacio: generate_voice da 400 aunque mande texto", r.status === 400 && /vac/i.test(r.body.error), r.body);

  await api("PATCH", `/projects/${voiceProjectId}/script`, student.token, { content: { text: words(100) } });
  r = await api("POST", "/tools/generate_voice/execute", student.token, {
    input: { script_id: voiceScript!.id, text: words(2000, "bla") },
  });
  // Mock: duracion = palabras / 2.5. 100 palabras del guion -> 40 s; si usara
  // el texto mandado (2000 palabras) serian 800 s.
  check("generate_voice ignora el texto mandado y narra el guion guardado", r.status === 200 && r.body.output?.duration_seconds === 40, r.body);
  const firstAsset = r.body.output?.asset_id;
  r = await api("POST", "/tools/generate_voice/execute", student.token, { input: { script_id: voiceScript!.id } });
  check("misma voz y mismo guion: reutiliza el audio (mismo asset)", r.status === 200 && r.body.output?.asset_id === firstAsset, r.body);

  await admin.from("scripts").update({ content: { text: "x".repeat(35_001) } }).eq("id", voiceScript!.id);
  r = await api("POST", "/tools/generate_voice/execute", student.token, { input: { script_id: voiceScript!.id } });
  check("guion de mas de 35.000 caracteres: generate_voice da 400", r.status === 400 && /35/.test(r.body.error), r.body);

  r = await api("POST", "/tools/preview_voice/execute", student.token, {
    input: { voice_id: "minimax_test", sample_text: words(5000) },
  });
  check("preview_voice responde con texto libre ignorado (3 s fijos)", r.status === 200 && r.body.output?.duration_seconds === 3, r.body);

  section("9. Whisper reutiliza la transcripcion");
  process.env.OFFLINE_PROVIDERS = "true";
  const { transcribeAudioTool } = await import("../src/tools/transcribeAudio.tool.js");
  const cachedResult = { words: [{ word: "CACHEADA", start: 0, end: 1 }], segments: [], duration_seconds: 1 };
  const { data: audioAsset } = await admin
    .from("assets")
    .insert({
      video_project_id: voiceProjectId,
      type: "AUDIO",
      storage_key: `audio/test-${stamp}.mp3`,
      metadata: { transcription: { storage_key: `audio/test-${stamp}.mp3`, result: cachedResult } },
    })
    .select("id")
    .single();
  const t1 = await transcribeAudioTool.execute({ asset_id: audioAsset!.id }, { userId: student.id });
  check("mismo audio: devuelve la transcripcion guardada (sin Whisper)", t1.words?.[0]?.word === "CACHEADA", t1.words?.slice(0, 2));
  await admin.from("assets").update({ storage_key: `audio/otro-${stamp}.mp3` }).eq("id", audioAsset!.id);
  let t2: any;
  try {
    t2 = await transcribeAudioTool.execute({ asset_id: audioAsset!.id }, { userId: student.id });
  } catch (e) {
    t2 = { error: (e as Error).message };
  }
  check("audio distinto: NO reutiliza la transcripcion vieja", t2?.words?.[0]?.word !== "CACHEADA", t2?.words?.slice?.(0, 2) ?? t2);

  section("10. Preview: una a la vez y limite por hora");
  r = await api("POST", "/projects", student.token, { title: "Test cobro pipeline", target_duration: 60 });
  const pipeProject = r.body.id as string;
  await api("POST", `/projects/${pipeProject}/script`, student.token, {
    content: { text: "El sol sale por el este. Los pajaros cantan en el bosque. La ciudad despierta con ruido. Termina el dia con calma." },
  });
  r = await api("POST", `/projects/${pipeProject}/pipeline/run`, student.token);
  const pipeJobId = r.body?.id as string;
  check("generar preview responde 202", r.status === 202, r);
  check("la preview tiene limite de 10 por hora", r.headers.get("ratelimit-limit") === "10", r.headers.get("ratelimit-limit"));
  r = await api("POST", `/projects/${pipeProject}/pipeline/run`, student.token);
  check("segunda preview mientras corre la primera: 409", r.status === 409, r);

  const pipeJob = await waitJob(pipeJobId, ["AWAITING_STOCK_REVIEW", "FAILED", "COMPLETED"]);
  check("la preview (con mocks) llega a revision de stock", pipeJob?.status === "AWAITING_STOCK_REVIEW", pipeJob);

  const { data: pipeScript } = await admin.from("scripts").select("id").eq("video_project_id", pipeProject).single();
  const { data: scene } = await admin.from("scenes").select("id").eq("script_id", pipeScript!.id).limit(1).maybeSingle();
  if (scene) {
    r = await api("POST", `/scenes/${scene.id}/regenerate-visual`, student.token, { source: "ai" });
    check("regenerar escena con IA: 400 'todavia no disponible'", r.status === 400 && /IA/.test(r.body.error), r.body);
    check("cambiar visual tiene limite de 120 por hora", r.headers.get("ratelimit-limit") === "120", r.headers.get("ratelimit-limit"));
    r = await api("POST", `/scenes/${scene.id}/regenerate-visual`, student.token, { source: "ai_image" });
    check("regenerar escena con imagen IA: 400", r.status === 400, r.body);
  } else {
    check("la preview creo escenas", false, "sin escenas");
  }
  r = await api("POST", `/scripts/${pipeScript!.id}/scenes/image-prompts`, student.token, {});
  check("prompts de Flow tienen limite de 200 por hora", r.headers.get("ratelimit-limit") === "200", r.headers.get("ratelimit-limit"));

  section("11. Renderizar de punta a punta (inline, render simulado)");
  await setBalance(student.id, 1);
  r = await api("POST", `/jobs/${pipeJobId}/approve-stock-review`, student.token);
  check("Renderizar con 1 video: 202", r.status === 202, r);
  check("descuenta el video al apretar (saldo 0)", (await balanceOf(student.id)).balance === 0);
  r = await api("POST", `/jobs/${pipeJobId}/approve-stock-review`, student.token);
  check("doble click: el segundo no pasa", r.status === 400 || r.status === 409, r);
  check("doble click: no cobra dos veces (saldo 0)", (await balanceOf(student.id)).balance === 0);
  const rendered = await waitJob(pipeJobId, ["COMPLETED", "FAILED"]);
  check("el render termina bien", rendered?.status === "COMPLETED", rendered);
  const { data: finalAsset } = await admin
    .from("assets")
    .select("id")
    .eq("video_project_id", pipeProject)
    .eq("metadata->>kind", "final_render")
    .limit(1);
  check("queda el video final y el saldo no se devuelve", (finalAsset?.length ?? 0) > 0 && (await balanceOf(student.id)).balance === 0, finalAsset);

  section("12. Render que falla: se devuelve el video");
  r = await api("POST", "/projects", student.token, { title: "Test cobro render fallido", target_duration: 60 });
  const failProject = r.body.id as string;
  await api("POST", `/projects/${failProject}/script`, student.token, {
    content: { text: "Una historia corta. Tiene dos escenas nomas. Y termina rapido." },
  });
  r = await api("POST", `/projects/${failProject}/pipeline/run`, student.token);
  const failJobId = r.body?.id as string;
  const failReady = await waitJob(failJobId, ["AWAITING_STOCK_REVIEW", "FAILED", "COMPLETED"]);
  check("segunda preview llega a revision de stock", failReady?.status === "AWAITING_STOCK_REVIEW", failReady);
  // Sin timeline el render falla ("Timeline not found").
  await admin.from("timelines").delete().eq("video_project_id", failProject);
  await setBalance(student.id, 1);
  r = await api("POST", `/jobs/${failJobId}/approve-stock-review`, student.token);
  check("Renderizar: 202 y descuenta", r.status === 202 && (await balanceOf(student.id)).balance === 0, r);
  const failed = await waitJob(failJobId, ["COMPLETED", "FAILED"]);
  check("el render falla", failed?.status === "FAILED", failed);
  await sleep(1500);
  check("el video se devuelve solo (saldo 1)", (await balanceOf(student.id)).balance === 1);
  const { data: refundMov } = await admin
    .from("video_credit_movements")
    .select("reason")
    .eq("project_id", failProject)
    .eq("reason", "render_refund");
  check("queda el movimiento de devolucion en el historial", (refundMov?.length ?? 0) === 1, refundMov);

  section("13. Cuentas sin limite");
  r = await api("POST", `/admin/users/${student.id}/unlimited`, boss.token, { unlimited: true });
  check("admin activa 'sin limite'", r.status === 200, r);
  me = await api("GET", "/auth/me", student.token);
  check("/auth/me muestra unlimited", me.body.unlimited === true, me.body);
  const before = (await balanceOf(student.id)).balance;
  r = await api("POST", "/projects", student.token, { title: "Test cobro sin limite", target_duration: 60 });
  c = await admin.rpc("charge_render", { p_project_id: r.body.id });
  check("render de cuenta sin limite no descuenta", c.data === "unlimited" && (await balanceOf(student.id)).balance === before, c);
  r = await api("POST", `/admin/users/${student.id}/unlimited`, boss.token, { unlimited: false });
  me = await api("GET", "/auth/me", student.token);
  check("admin saca 'sin limite'", r.status === 200 && me.body.unlimited === false, me.body);

  section("14. Rechazo");
  r = await api("POST", `/admin/users/${boss.id}/reject`, boss.token);
  check("no se puede rechazar a un admin", r.status >= 400, r.status);
  r = await api("POST", `/admin/users/${student.id}/reject`, boss.token);
  r = await api("GET", "/projects", student.token);
  check("rechazado: 403 ACCOUNT_REJECTED", r.status === 403 && r.body.code === "ACCOUNT_REJECTED", r);

  section("15. Key publica de Supabase (base cerrada)");
  const projects = await anon.from("video_projects").select("id").limit(1);
  check("no puede leer proyectos", !!projects.error, projects.error?.message ?? projects.data);
  const scripts = await anon.from("scripts").select("id").limit(1);
  check("no puede leer guiones", !!scripts.error, scripts.error?.message ?? scripts.data);
  const credits = await anon.from("video_credits").select("*").limit(1);
  check("no puede leer saldos", !!credits.error, credits.error?.message ?? credits.data);
  const upd = await anon.from("video_credits").update({ balance: 999 }).eq("user_id", student.id);
  check("no puede cargarse videos", !!upd.error, upd.error?.message);
  const jobUpd = await anon.from("jobs").update({ progress: 1 }).eq("id", job!.id);
  check("no puede escribir en jobs", !!jobUpd.error, jobUpd.error?.message);
  const rpc = await anon.rpc("charge_render", { p_project_id: projectA });
  check("no puede llamar a charge_render", !!rpc.error, rpc.data);
  const jobsRead = await anon.from("jobs").select("id").limit(1);
  check("SI puede leer jobs (lo necesita Realtime)", !jobsRead.error, jobsRead.error?.message);
}

async function cleanup() {
  stopApi();
  for (const id of createdUserIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log(`  ⚠️  no se pudo borrar el usuario temporal ${id}: ${error.message}`);
  }
}

try {
  await run();
} catch (error) {
  failures.push(`error inesperado: ${(error as Error).message}`);
  console.error("\n💥", error);
} finally {
  await cleanup();
  console.log(`\n${passed} ok, ${failures.length} fallaron`);
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log(createdUserIds.length ? "Usuarios temporales borrados." : "");
  process.exit(failures.length ? 1 : 0);
}
