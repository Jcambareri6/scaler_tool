// Test del frontend (navegador real) del cobro por video y la aprobacion de
// cuentas. Complementa scripts/test-cobro.ts, que prueba la API.
//
//   npm run test:frontend
//
// Que hace:
// - Crea 2 usuarios temporales (un "admin" y un "alumno").
// - Levanta una API propia (puerto 3099, login real, OFFLINE_PROVIDERS: no
//   gasta en ai33/Whisper/LLMs) y el frontend con Vite (puerto 5199)
//   apuntando a esa API.
// - Maneja la app con Playwright usando el Edge (o Chrome) instalado: un
//   navegador como alumno y otro como admin.
// - Al final borra los 2 usuarios (todo lo suyo se borra en cascada).
// Deja capturas de cada paso en la carpeta temporal que imprime al final.
//
// OJO: corre contra la base de backend/.env (hoy, la de produccion). Solo
// toca filas de los usuarios temporales.

import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { chromium, type Browser, type Page } from "playwright-core";

const API_PORT = 3099;
const WEB_PORT = 5199;
const API = `http://localhost:${API_PORT}`;
const WEB = `http://localhost:${WEB_PORT}`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = path.join(os.tmpdir(), "skaler-ui-test");
mkdirSync(SHOTS, { recursive: true });

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = readFileSync(path.join(ROOT, "frontend_v1/.env"), "utf8").match(/^VITE_SUPABASE_ANON_KEY=(.+)$/m)?.[1]?.trim();
if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (backend/.env) o VITE_SUPABASE_ANON_KEY (frontend_v1/.env)");
  process.exit(1);
}

const CLIENT_OPTS = { auth: { persistSession: false }, realtime: { transport: ws as any } };
const admin = createClient(SUPABASE_URL, SERVICE_KEY, CLIENT_OPTS);

// --- mini runner -----------------------------------------------------------

let passed = 0;
const failures: string[] = [];
let shot = 0;

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

async function snap(page: Page, name: string) {
  shot++;
  await page.screenshot({ path: path.join(SHOTS, `${String(shot).padStart(2, "0")}-${name}.png`), fullPage: true });
}

// Espera a que aparezca un texto; devuelve true/false en vez de tirar.
async function sees(page: Page, text: string | RegExp, timeout = 15_000) {
  try {
    await page.getByText(text).first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

async function notSees(page: Page, text: string | RegExp) {
  return (await page.getByText(text).count()) === 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(method: string, url: string, token: string, body?: unknown) {
  const res = await fetch(API + url, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

// --- usuarios temporales ---------------------------------------------------

const stamp = Date.now();
const PASSWORD = `Test-${stamp}-pass!`;
const createdUserIds: string[] = [];

async function createUser(label: string) {
  const email = `skaler-ui-${label}-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`No se pudo crear ${label}: ${error?.message}`);
  createdUserIds.push(data.user.id);
  const login = createClient(SUPABASE_URL, ANON_KEY!, CLIENT_OPTS);
  const { data: session, error: loginError } = await login.auth.signInWithPassword({ email, password: PASSWORD });
  if (loginError || !session.session) throw new Error(`No se pudo loguear ${label}: ${loginError?.message}`);
  return { id: data.user.id, email, token: session.session.access_token };
}

const setBalance = (userId: string, balance: number) =>
  admin.from("video_credits").update({ balance }).eq("user_id", userId);

// Proyecto con la preview lista (job en AWAITING_STOCK_REVIEW), armado por la API.
async function projectAwaitingReview(token: string, title: string) {
  const p = await api("POST", "/projects", token, { title, target_duration: 60 });
  await api("POST", `/projects/${p.body.id}/script`, token, {
    content: { text: "El sol sale por el este. Los pajaros cantan en el bosque. La ciudad despierta. Termina el dia con calma." },
  });
  const run = await api("POST", `/projects/${p.body.id}/pipeline/run`, token);
  for (let i = 0; i < 120; i++) {
    const { data } = await admin.from("jobs").select("status").eq("id", run.body.id).single();
    if (data?.status === "AWAITING_STOCK_REVIEW") return p.body.id as string;
    if (data?.status === "FAILED") throw new Error(`La preview de "${title}" fallo`);
    await sleep(1000);
  }
  throw new Error(`La preview de "${title}" no termino`);
}

// --- servidores ------------------------------------------------------------

const servers: ChildProcess[] = [];

function startProcess(args: string[], cwd: string, env: Record<string, string>) {
  const child = spawn("npx", args, { cwd, shell: true, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout?.on("data", (d) => (log += d));
  child.stderr?.on("data", (d) => (log += d));
  servers.push(child);
  return () => log;
}

async function waitUrl(url: string, ok: (status: number) => boolean, getLog: () => string) {
  for (let i = 0; i < 90; i++) {
    try {
      if (ok((await fetch(url)).status)) return;
    } catch {
      /* arrancando */
    }
    await sleep(500);
  }
  throw new Error(`No arranco ${url}:\n${getLog()}`);
}

async function startServers(adminId: string) {
  const apiLog = startProcess(["tsx", "src/server.ts"], ROOT, {
    PORT: String(API_PORT),
    DISABLE_AUTH: "false",
    MOCK_PROVIDERS: "true",
    OFFLINE_PROVIDERS: "true",
    EXECUTION_MODE: "inline",
    ADMIN_USER_IDS: adminId,
    FRONTEND_ORIGIN: WEB,
  });
  await waitUrl(`${API}/auth/me`, (s) => s === 401, apiLog);
  // Vite prioriza las variables de entorno sobre frontend_v1/.env.
  const webLog = startProcess(["vite", "--port", String(WEB_PORT), "--strictPort"], path.join(ROOT, "frontend_v1"), {
    PORT: String(WEB_PORT),
    VITE_API_URL: API,
    VITE_DISABLE_AUTH: "false",
  });
  await waitUrl(WEB, (s) => s === 200, webLog);
}

function stopServers() {
  for (const child of servers) {
    if (!child.pid) continue;
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  }
}

async function launchBrowser(): Promise<Browser> {
  for (const channel of ["msedge", "chrome"]) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      /* probar el siguiente */
    }
  }
  throw new Error("No se encontro Edge ni Chrome instalado");
}

async function login(browser: Browser, email: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${WEB}/login`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
  return page;
}

// --- pruebas ---------------------------------------------------------------

async function run() {
  console.log("Preparando usuarios, API, frontend y navegador...");
  const boss = await createUser("admin");
  const student = await createUser("alumno");
  await startServers(boss.id);
  const browser = await launchBrowser();

  try {
    section("1. Cuenta pendiente");
    const alumno = await login(browser, student.email);
    check("al entrar ve 'Tu cuenta está pendiente'", await sees(alumno, "Tu cuenta está pendiente"));
    check("tiene el boton 'Ya me aprobaron, revisar'", await sees(alumno, "Ya me aprobaron, revisar"));
    check("tiene 'Cerrar sesión'", await sees(alumno, "Cerrar sesión"));
    check("no ve el menu de la app", await notSees(alumno, "Proyectos"));
    await snap(alumno, "alumno-pendiente");

    section("2. Panel de administracion");
    const seba = await login(browser, boss.email);
    check("el admin ve 'Administración' en el menu", await sees(seba, "Administración"));
    await seba.goto(`${WEB}/admin`);
    check("abre la pagina de Administración", await sees(seba, "Aprobá las cuentas nuevas"));
    check("el alumno aparece en Pendientes", await sees(seba, student.email));
    await snap(seba, "admin-pendientes");
    const pendingRow = seba.locator("tr", { hasText: student.email });
    await pendingRow.getByRole("button", { name: "Aprobar" }).click();
    check("aprobar muestra confirmacion", await sees(seba, `${student.email} aprobado`));

    section("3. Alumno aprobado");
    await alumno.getByRole("button", { name: "Ya me aprobaron, revisar" }).click();
    check("entra a la app con '5 videos disponibles' en el menu", await sees(alumno, "5 videos disponibles"));
    check("el alumno NO ve 'Administración'", await notSees(alumno, "Administración"));
    await snap(alumno, "alumno-aprobado");
    await alumno.goto(`${WEB}/admin`);
    await sleep(1500);
    check("si entra a /admin lo saca", !alumno.url().endsWith("/admin") && (await notSees(alumno, "Aprobá las cuentas nuevas")), alumno.url());

    section("4. Pantallas del proyecto (sin opciones de IA)");
    const projectA = await projectAwaitingReview(student.token, "UI test proyecto A");
    await alumno.goto(`${WEB}/projects/${projectA}`);
    await alumno.getByRole("button", { name: "Audio" }).first().click();
    await sleep(1500);
    check("Audio: no esta el campo 'Texto de prueba'", await notSees(alumno, "Texto de prueba"));
    await snap(alumno, "audio");
    await alumno.getByRole("button", { name: "Scenes" }).first().click();
    await sleep(1500);
    check("Escenas: no aparecen 'Video con IA' ni 'Imagen con IA'", (await notSees(alumno, "Video con IA")) && (await notSees(alumno, "Imagen con IA")));
    await snap(alumno, "escenas");
    await alumno.getByRole("button", { name: "Preview" }).first().click();
    check("Preview: aparece la revision de stock", await sees(alumno, "Aprobar y renderizar", 20_000));
    check("Preview: no esta 'Fuente de los clips' (Stock / Solo IA / Mixto)", (await notSees(alumno, "Fuente de los clips")) && (await notSees(alumno, "Solo IA")));

    section("5. Renderizar descuenta 1 video");
    check("al lado del boton dice 'Usa 1 video (te quedan 5)'", await sees(alumno, "Usa 1 video (te quedan 5)."));
    await snap(alumno, "antes-de-renderizar");
    await alumno.getByRole("button", { name: "Aprobar y renderizar" }).click();
    check("despues de renderizar el menu baja a '4 videos disponibles'", await sees(alumno, "4 videos disponibles", 30_000));
    await snap(alumno, "despues-de-renderizar");

    section("6. Re-render y sin saldo");
    // Re-render: el proyecto A ya cobro. Se arma otra preview del mismo proyecto.
    for (let i = 0; i < 60; i++) {
      const { data } = await admin.from("jobs").select("status").eq("video_project_id", projectA).order("created_at", { ascending: false }).limit(1).single();
      if (data?.status === "COMPLETED" || data?.status === "FAILED") break;
      await sleep(1000);
    }
    const rerun = await api("POST", `/projects/${projectA}/pipeline/run`, student.token);
    for (let i = 0; i < 120; i++) {
      const { data } = await admin.from("jobs").select("status").eq("id", rerun.body?.id).single();
      if (data?.status === "AWAITING_STOCK_REVIEW") break;
      await sleep(1000);
    }
    await alumno.goto(`${WEB}/projects/${projectA}`);
    await alumno.getByRole("button", { name: "Preview" }).first().click();
    check("re-render: 'ya usó su video: renderizarlo de nuevo no descuenta'", await sees(alumno, "renderizarlo de nuevo no descuenta", 20_000));
    await snap(alumno, "re-render");

    const projectB = await projectAwaitingReview(student.token, "UI test proyecto B");
    await setBalance(student.id, 0);
    await alumno.goto(`${WEB}/projects/${projectB}`);
    await alumno.getByRole("button", { name: "Preview" }).first().click();
    check("sin saldo: 'Se terminaron tus videos...'", await sees(alumno, "Se terminaron tus videos. Contactá al administrador para cargar más.", 20_000));
    const renderBtn = alumno.getByRole("button", { name: "Aprobar y renderizar" });
    check("sin saldo: el boton Renderizar esta bloqueado", await renderBtn.isDisabled());
    check("sin saldo: el menu muestra '0 videos disponibles'", await sees(alumno, "0 videos disponibles"));
    await snap(alumno, "sin-saldo");

    section("7. Admin carga videos");
    await seba.goto(`${WEB}/admin`);
    await seba.getByRole("button", { name: /^Aprobados/ }).click();
    const approvedRow = seba.locator("tr", { hasText: student.email });
    await approvedRow.getByRole("button", { name: "Videos" }).click();
    check("el modal muestra el saldo actual (0)", await sees(seba, "Tiene 0 videos disponibles"));
    const amountInput = seba.locator('input[type="number"]');
    check("la cantidad viene en 20 (el paquete)", (await amountInput.inputValue()) === "20", await amountInput.inputValue());
    await seba.getByPlaceholder("Ej: pagó 25 USD por transferencia").fill("UI test: pagó 25 USD");
    await seba.getByRole("button", { name: "Cargar videos" }).click();
    check("el saldo sube a 20", await sees(seba, "Tiene 20 videos disponibles"));
    check("el historial muestra la nota", await sees(seba, "UI test: pagó 25 USD"));
    await snap(seba, "admin-cargar-videos");
    await amountInput.fill("-100");
    await seba.getByRole("button", { name: "Sacar videos" }).click();
    await sleep(1500);
    check("sacar de mas no deja el saldo en negativo", await sees(seba, "Tiene 20 videos disponibles"));
    await seba.getByRole("button", { name: "Cerrar", exact: true }).click();

    await alumno.reload();
    await alumno.getByRole("button", { name: "Preview" }).first().click();
    check("el alumno ve '20 videos disponibles'", await sees(alumno, "20 videos disponibles"));
    check("y el boton Renderizar se habilita", await sees(alumno, "Usa 1 video (te quedan 20).", 20_000));

    section("8. Rechazo");
    await seba.locator("tr", { hasText: student.email }).getByRole("button", { name: "Rechazar" }).click();
    await seba.getByRole("button", { name: "Rechazar" }).last().click();
    check("rechazar muestra confirmacion", await sees(seba, `${student.email} rechazado`));
    await alumno.reload();
    check("el alumno rechazado ve 'Tu cuenta no fue aprobada'", await sees(alumno, "Tu cuenta no fue aprobada"));
    await snap(alumno, "alumno-rechazado");
  } finally {
    await browser.close();
  }
}

async function cleanup() {
  stopServers();
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
  for (const f of failures) console.log(`  - ${f}`);
  console.log(`Capturas: ${SHOTS}`);
  if (createdUserIds.length) console.log("Usuarios temporales borrados.");
  process.exit(failures.length ? 1 : 0);
}
