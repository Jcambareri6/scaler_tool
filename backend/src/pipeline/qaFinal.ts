import { spawn } from "node:child_process";
import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { claudeJudge, shotContext, type JudgeShot } from "../director/visualJudge.js";
import { WIKIMEDIA_UA } from "../lib/documentalSources.js";
import { ffmpegForNetwork } from "../lib/ffmpegBin.js";
import { mapWithConcurrency } from "../lib/concurrency.js";
import { envInt } from "../lib/env.js";
const QA_PARALLEL = envInt("DOCUMENTAL_QA_PARALLEL", 3);

// QA FINAL CON VISION (como qaPlan.js de MaV): despues de llenar los planos,
// el juez mira el video ENTERO en tandas (hasta 6 planos o 18 imagenes) con
// cuadros reales (3 por clip al 15/50/85 %, 1 por foto) y el contexto de cada
// plano. En MaV encontro 3 de 12 planos mal que habian pasado todos los
// filtros anteriores: el juez de cada plano elige entre candidatos, este mira
// el resultado en su lugar del video.
// Falla abierto: si el modelo no contesta, el plano pasa.

// ffmpeg que puede leer de la red (en el worker, el de Debian: ver lib/ffmpegBin.ts).
const ffmpegPath = ffmpegForNetwork;

export const QA_BATCH_SHOTS = 6;
export const QA_BATCH_IMAGES = 18;
// El mismo objeto/monumento puede volver si la frase lo nombra y esta lejos.
const OBRA_FAR = 12;
// Un sitio (lugar o edificio) puede repetirse cerca: hasta 3 usos a <= 3 planos.
const SITIO_NEAR = 3;
const SITIO_MAX_USES = 3;

export type QaFinalCode = "ok" | "generico" | "equivocado" | "persona" | "epoca" | "presentador" | "texto" | "oscuro" | "roto" | "borroso" | "vacio";
const CODES: QaFinalCode[] = ["ok", "generico", "equivocado", "persona", "epoca", "presentador", "texto", "oscuro", "roto", "borroso", "vacio"];

export interface QaItem {
  sceneId: string;
  order: number;
  shot: JudgeShot;
  url: string;
  type: "VIDEO" | "IMAGE";
  durationSeconds?: number;
  sourceTitle?: string;
  // Via por la que llego (rescate: se acepta material del tema).
  rescue: boolean;
}

export interface QaVerdict {
  order: number;
  code: QaFinalCode;
  stock: boolean;
  obra: string | null;
  sitio: boolean;
  hoy: boolean | null;
  habla: boolean | null;
  lugar: boolean | null;
  // Chequeos que el CODIGO hace cumplir (el modelo ignoraba las reglas):
  // alguien a camara (vlogger, selfie, presentador) o marca de agua / logo.
  camara: boolean | null;
  marca: boolean | null;
  por: string;
}

export interface QaDecision {
  sceneId: string;
  order: number;
  ronda: number;
  codigo: QaFinalCode | "sin_ver";
  final: QaFinalCode;
  por: string;
  malo: boolean;
  obra?: string | null;
  lugar?: boolean | null;
  stock?: boolean;
}

const SYSTEM = `You are the final QA of a documentary made with real footage. You get several SHOTS of the edited video, each with its frames and what the narration says over it. For EACH shot decide if a viewer would accept that picture under that sentence.

Codes:
- ok: the named person, thing or place itself, or clearly a picture of THIS story (its place, its people, its objects, its era).
- generico: shares one word or a vague idea with the sentence but is not about this story (e.g. a random beach for "the city grew", a modern office for "the company was founded in 1890", a generic crowd for "the workers went on strike").
- equivocado: a different concrete object, person or place. If the SOURCE TITLE names a different place or event, it is equivocado even if it looks similar. A similar but DIFFERENT thing (a related machine, another building, another event of the same kind) is equivocado.
- persona: a person is named but this is someone else, or not a recognisable portrait.
- epoca: ONLY if the shot has an Era line. Something clearly modern in a historical scene: today's cars, phones, screens, modern buildings, tourists, colour digital photos of a 1912 event. Before cinema (the Era line says so) ruins and statues are fine if nothing of today is visible. Actors in period costume in a documentary reconstruction are NOT epoca.
- presentador: a presenter talking to camera, a host on a set, a reaction or a podcast.
- texto: big burned-in text, subtitles or a big logo. A small corner logo or text that is part of the scene (a sign, a newspaper) is fine.
- oscuro / borroso / roto / vacio: technical defects (too dark, blurry, broken frame, empty frame).
"Must show": if a shot has it, that has to be visible.
A MODERN product, catalog, studio or stock photo over a HISTORICAL event is generico.
Be strict with generico/equivocado: a viewer must not feel the picture is random. But a picture of the story's own place, people or objects is ok even if it does not show the exact action.
In RESCUE shots a picture of the video's topic (right place, country and era) is ok.

Extra fields per shot:
- stock: true if it looks like a modern stock, product or studio photo.
- obra: English name (2-5 words) of ONE identifiable artwork, monument or building in the picture, else null.
- sitio: true if obra is a place/building, false if it is an object.
- hoy: true if something clearly from today is visible (tourists, railings, cars, phones...).
- habla: true if someone talks to camera or sits on a set with microphones.
- camara: true if ANY frame shows a person looking, posing or talking to the camera: a vlogger, a selfie, a host, a tourist posing, a youtuber. Never allowed in this documentary.
- marca: true if ANY frame has a watermark (a stock agency mark, a semi-transparent logo or text over the picture) or a TV / YouTube channel logo or name. Never allowed.
- lugar: ONLY if the shot has a "Place label": true if a viewer could recognise THAT place in the picture; anything that could be anywhere (open water, waves, an underwater scene, a generic street) is false. Otherwise null.

Answer ONLY with a JSON array, one object per shot:
[{"plano": <number>, "codigo": "ok|generico|equivocado|persona|epoca|presentador|texto|oscuro|roto|borroso|vacio", "stock": false, "obra": null, "sitio": false, "hoy": false, "habla": false, "camara": false, "marca": false, "lugar": null, "por": "<max 12 words>"}]`;

function ffmpeg(args: string[], timeoutMs = 45_000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg-static no resolvio el binario"));
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let err = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("ffmpeg tardo demasiado (qa)"));
    }, timeoutMs);
    proc.stderr.on("data", (c) => (err += c.toString()));
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg ${code}: ${err.slice(-300)}`));
    });
  });
}

async function written(file: string): Promise<boolean> {
  return stat(file).then((s) => s.size > 500).catch(() => false);
}

// Cuadros del plano: 1 de una foto (512 px), 3 de un clip (15/50/85 %, 448 px).
export async function qaFrames(item: QaItem, workDir: string): Promise<string[]> {
  const remote = /^https?:\/\//.test(item.url);
  const net = remote ? ["-user_agent", WIKIMEDIA_UA, "-rw_timeout", "15000000"] : [];
  const base = path.join(workDir, `qaf-${item.order}-${Date.now()}`);
  if (item.type === "IMAGE") {
    const out = `${base}.jpg`;
    await ffmpeg(["-y", "-loglevel", "error", ...net, "-i", item.url, "-frames:v", "1", "-vf", "scale=512:512:force_original_aspect_ratio=decrease", "-q:v", "5", out]);
    return (await written(out)) ? [out] : [];
  }
  const span = Math.max(1, item.durationSeconds ?? 6);
  const outs: string[] = [];
  for (const [i, f] of [0.15, 0.5, 0.85].entries()) {
    const out = `${base}-${i}.jpg`;
    try {
      await ffmpeg(["-y", "-loglevel", "error", ...net, "-ss", (f * span).toFixed(2), "-i", item.url, "-frames:v", "1", "-vf", "scale=448:-2", "-q:v", "5", out]);
      // ffmpeg sale con 0 sin escribir nada si el -ss cae despues del final
      // del clip: ese archivo inexistente tiraba la tanda entera (ENOENT).
      if (await written(out)) outs.push(out);
    } catch {
      // un cuadro que no se pudo leer no frena a los otros
    }
  }
  return outs;
}

// Tandas en orden del video: hasta 6 planos o 18 imagenes.
export function batches<T extends { images: number }>(items: T[]): T[][] {
  const out: T[][] = [];
  let current: T[] = [];
  let images = 0;
  for (const item of items) {
    if (current.length && (current.length >= QA_BATCH_SHOTS || images + item.images > QA_BATCH_IMAGES)) {
      out.push(current);
      current = [];
      images = 0;
    }
    current.push(item);
    images += item.images;
  }
  if (current.length) out.push(current);
  return out;
}

function parseArray(text: string): Record<string, unknown>[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("el QA no devolvio un array");
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>[];
}

const boolOrNull = (v: unknown): boolean | null => (v === true ? true : v === false ? false : null);

export function parseQaVerdicts(raw: Record<string, unknown>[], orders: number[]): QaVerdict[] {
  const out: QaVerdict[] = [];
  for (const r of raw) {
    const order = Number(r.plano);
    if (!orders.includes(order) || out.some((v) => v.order === order)) continue;
    const code = (CODES as string[]).includes(String(r.codigo)) ? (String(r.codigo) as QaFinalCode) : "ok";
    const obra = typeof r.obra === "string" && r.obra.trim() ? r.obra.trim().slice(0, 60) : null;
    out.push({
      order,
      code,
      stock: r.stock === true,
      obra,
      sitio: r.sitio === true,
      hoy: boolOrNull(r.hoy),
      habla: boolOrNull(r.habla),
      lugar: boolOrNull(r.lugar),
      camara: boolOrNull(r.camara),
      marca: boolOrNull(r.marca),
      por: String(r.por ?? "").slice(0, 160),
    });
  }
  return out;
}

// Ajustes en codigo al veredicto (qaPlan.js:451-470 de MaV).
export function adjustVerdict(v: QaVerdict, item: QaItem): QaFinalCode {
  const e = item.shot.epoca;
  // Lo que NUNCA entra, sin importar el codigo que puso el modelo.
  if (v.camara === true) return "presentador";
  if (v.marca === true) return "texto";
  let code = v.code;
  // epoca solo vale si el plano tiene linea Era; antes del cine, solo si se ve algo de hoy.
  if (code === "epoca" && !e?.historico) code = "ok";
  if (code === "epoca" && e?.preCine && v.hoy === false) code = "ok";
  // presentador solo si de verdad alguien habla.
  if (code === "presentador" && v.habla === false) code = "ok";
  // En un rescate se acepta material del tema.
  if (code === "generico" && item.rescue) code = "ok";
  // Foto de stock moderna en un plano historico.
  if (code === "ok" && v.stock && item.type === "IMAGE" && e?.historico) code = "epoca";
  return code;
}

// Comparten un NOMBRE PROPIO (no una palabra generica): "Iguazu Falls" y
// "Cataratas del Iguazu" son el mismo tema aunque esten en otro idioma.
const GENERIC_WORDS = new Set(["falls", "cataratas", "river", "lake", "lago", "mountain", "montana", "bridge", "puente", "tower", "torre", "church", "iglesia", "museum", "museo", "castle", "castillo", "palace", "palacio", "house", "casa", "building", "edificio", "park", "parque", "national", "nacional", "city", "ciudad", "desert", "desierto", "road", "camino", "canyon", "valley", "valle", "island", "isla", "beach", "playa", "salt", "flat", "argentina", "brasil", "brazil", "mexico", "espana", "spain", "bolivia"]);
export function sharesProperName(a: string, b: string): boolean {
  const wb = words(b);
  return [...words(a)].some((w) => w.length >= 5 && !GENERIC_WORDS.has(w) && wb.has(w));
}

function words(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !["the", "and", "of"].includes(w))
  );
}

// Misma obra: palabras en comun / el menor de los dos conjuntos >= 0,67.
export function sameWork(a: string, b: string): boolean {
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return false;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / Math.min(wa.size, wb.size) >= 0.67;
}

// Planos a rechazar por repetir obra (en orden del video; se queda el primero).
// Vuelve si la frase la nombra y esta a >= 12 planos; un sitio puede repetirse
// cerca (<= 3 planos) hasta 3 usos.
// `mainSubjects`: el tema del video y el lugar de la historia. Esa obra NO
// cuenta como repetida: en un documental SOBRE el Caminito del Rey todos los
// planos lo muestran (el piloto perdio 10 planos buenos por "obra repetida").
export function repeatedWorks(entries: { order: number; obra: string | null; sitio: boolean; text: string }[], mainSubjects: string[] = []): Set<number> {
  const reject = new Set<number>();
  const seen: { obra: string; orders: number[]; sitio: boolean }[] = [];
  for (const e of [...entries].sort((a, b) => a.order - b.order)) {
    if (!e.obra) continue;
    if (mainSubjects.some((s) => s && (sameWork(e.obra!, s) || sharesProperName(e.obra!, s)))) continue;
    const prev = seen.find((s) => sameWork(s.obra, e.obra!));
    if (!prev) {
      seen.push({ obra: e.obra, orders: [e.order], sitio: e.sitio });
      continue;
    }
    const last = prev.orders[prev.orders.length - 1]!;
    const named = [...words(e.obra)].some((w) => e.text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(w));
    const nearSite = prev.sitio && e.order - last <= SITIO_NEAR && prev.orders.length < SITIO_MAX_USES;
    if (nearSite || (named && e.order - last >= OBRA_FAR)) prev.orders.push(e.order);
    else reject.add(e.order);
  }
  return reject;
}

// Una llamada por tanda. Devuelve los veredictos de los planos que se vieron.
export async function judgeBatch(
  client: Anthropic,
  model: string,
  batch: { item: QaItem; frames: string[] }[],
  usage: Record<string, number>
): Promise<QaVerdict[]> {
  const content: Anthropic.ContentBlockParam[] = [];
  for (const { item, frames } of batch) {
    content.push({
      type: "text",
      text: `=== Shot ${item.order}${item.rescue ? " (RESCUE)" : ""} — ${item.type === "VIDEO" ? `clip, ${frames.length} frames` : "photo"}${item.sourceTitle ? `, source title: "${item.sourceTitle.slice(0, 100)}"` : ""}\n${shotContext(item.shot).replace("Rotulo de lugar en pantalla", "Place label").replace("Tiene que verse", "Must show")}`,
    });
    for (const f of frames) {
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: (await readFile(f)).toString("base64") } });
    }
  }
  const message = await claudeJudge(client, { model, max_tokens: 6000 + 800 * batch.length, system: SYSTEM, messages: [{ role: "user", content }] });
  usage.input = (usage.input ?? 0) + message.usage.input_tokens;
  usage.output = (usage.output ?? 0) + message.usage.output_tokens;
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return parseQaVerdicts(parseArray(text), batch.map((b) => b.item.order));
}

// Corre el QA sobre los planos dados. Devuelve una decision por plano visto
// (los que no se pudieron ver pasan, "sin_ver").
export async function runQaFinal(
  client: Anthropic,
  model: string,
  items: QaItem[],
  workDir: string,
  usage: Record<string, number>,
  ronda: number,
  previous: { order: number; obra: string | null; sitio: boolean; text: string }[] = [],
  mainSubjects: string[] = []
): Promise<{ decisions: QaDecision[]; obras: { order: number; obra: string | null; sitio: boolean; text: string }[] }> {
  const withFrames: { item: QaItem; frames: string[]; images: number }[] = [];
  const decisions: QaDecision[] = [];
  for (const item of [...items].sort((a, b) => a.order - b.order)) {
    const frames = await qaFrames(item, workDir).catch(() => [] as string[]);
    if (frames.length === 0) {
      decisions.push({ sceneId: item.sceneId, order: item.order, ronda, codigo: "sin_ver", final: "ok", por: "no se pudo leer ningun cuadro", malo: false });
      continue;
    }
    withFrames.push({ item, frames, images: frames.length });
  }
  const verdicts = new Map<number, QaVerdict>();
  try {
    // Tandas EN PARALELO (de a QA_PARALLEL): antes una detras de otra. La obra
    // repetida se calcula al final con todas, asi que el orden no importa.
    await mapWithConcurrency(batches(withFrames), QA_PARALLEL, async (batch) => {
      // Un error tecnico se reintenta una vez antes de dejar la tanda sin revisar.
      const got = await judgeBatch(client, model, batch, usage).catch(() => judgeBatch(client, model, batch, usage)).catch((err) => {
        console.warn(`[qa-final] tanda de ${batch.length} planos sin respuesta: ${(err as Error).message}`);
        return [] as QaVerdict[];
      });
      for (const v of got) verdicts.set(v.order, v);
    });
  } finally {
    await Promise.all(withFrames.flatMap((w) => w.frames.map((f) => rm(f, { force: true }).catch(() => undefined))));
  }
  const obras = [
    ...previous,
    ...withFrames.map(({ item }) => {
      const v = verdicts.get(item.order);
      return { order: item.order, obra: v?.obra ?? null, sitio: v?.sitio ?? false, text: item.shot.frase };
    }),
  ];
  const repeated = repeatedWorks(obras, mainSubjects);
  for (const { item } of withFrames) {
    const v = verdicts.get(item.order);
    if (!v) {
      decisions.push({ sceneId: item.sceneId, order: item.order, ronda, codigo: "sin_ver", final: "ok", por: "el juez no contesto", malo: false });
      continue;
    }
    let final = adjustVerdict(v, item);
    let por = v.por;
    if (final === "ok" && repeated.has(item.order)) {
      final = "equivocado";
      por = `obra repetida: ${v.obra}`;
    }
    decisions.push({ sceneId: item.sceneId, order: item.order, ronda, codigo: v.code, final, por, malo: final !== "ok", obra: v.obra, lugar: v.lugar, stock: v.stock });
    if (final !== "ok") console.log(`[qa-final] ronda ${ronda}: plano ${item.order} rechazado (${final}): ${por}`);
  }
  // Solo las obras de lo que quedo bien cuentan para las rondas siguientes.
  const bad = new Set(decisions.filter((d) => d.malo).map((d) => d.order));
  return { decisions, obras: obras.filter((o) => !bad.has(o.order)) };
}
