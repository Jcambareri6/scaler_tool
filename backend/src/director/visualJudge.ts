import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import Anthropic from "@anthropic-ai/sdk";
import { fetchWithTimeout } from "../lib/http.js";
import { withRetry } from "../lib/retry.js";
import { WIKIMEDIA_UA, type VisualCandidate } from "../lib/documentalSources.js";
import type { ShotClass } from "../lib/documentalStyles.js";

// JUEZ VISUAL del formato documental: mismo criterio que el Revisor de
// sceneReview.ts (vision + JSON), pero sobre MATERIAL REAL: mira una
// miniatura de cada candidato de un plano y elige el que muestra lo que dice
// la voz, o los rechaza a todos con un codigo (como el QA de MaV). El que
// llama prueba la siguiente fuente si no hay ninguno aprobado.
// Modelo: provider "anthropic", configuration.juez_model.

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static") as string | null;

export const JUDGE_MODEL = "claude-sonnet-5-5";

export type QaCode = "ok" | "generico" | "equivocado" | "persona" | "epoca" | "texto" | "oscuro" | "marca_agua" | "ficcion" | "sin_ver";

export interface JudgeShot {
  frase: string;
  clase: ShotClass;
  sujeto: string;
  anio?: number;
  // Para las transiciones: sirve una imagen del tema de la frase anterior.
  fraseAnterior?: string;
  // "tema": rescate (como MaV): acepta material del tema del video si el
  // lugar, el pais y la epoca son los de la historia; no rechaza por generico.
  modo?: "tema";
  tema?: string;
}

export interface CandidateVerdict {
  index: number;
  code: QaCode;
  reason: string;
}

export interface JudgeResult {
  chosen: number | null;
  verdicts: CandidateVerdict[];
}

const CODES: QaCode[] = ["ok", "generico", "equivocado", "persona", "epoca", "texto", "oscuro", "marca_agua", "ficcion"];

const SYSTEM = `Sos el JUEZ VISUAL de un documental hecho con material real. Te paso candidatos (fotos o cuadros de video) para UN plano y lo que dice la voz en ese momento. Elegis el que mejor muestra el sujeto, o los rechazas.

Codigos por candidato:
- ok: muestra el sujeto de la frase y sirve en un documental serio.
- generico: es material de relleno que podria ir en cualquier video; no muestra el sujeto concreto.
- equivocado: muestra otra cosa, otro lugar u otro objeto.
- persona: es otra persona, o no es un RETRATO donde se vea a la persona nombrada (una placa, una tumba, un monumento o una foto grupal donde no se distingue quien es, no sirven para clase persona).
- epoca: el plano es historico y se ven cosas modernas (o al reves): colores y fotos actuales, edificios, gruas, barcos o pantallas de hoy en una historia de 1912.
- texto: tiene texto, subtitulos o graficos quemados que molestan.
- oscuro: muy oscuro, borroso o de muy baja calidad.
- marca_agua: tiene marca de agua o logo grande.
- ficcion: es una escena de pelicula o serie (actores, decorados), una dramatizacion, una animacion o CGI, un videojuego o simulacion, un remix o video de fans. En un documental solo va material real.
Metaforas: si la frase usa una comparacion ("funcionaban como cubeteras de hielo"), la imagen del objeto de la comparacion NO sirve (equivocado): tiene que mostrarse el sujeto real.

La pregunta de fondo: el espectador escucha esta frase mientras ve la imagen. ¿La imagen muestra lo que se esta diciendo: la misma cosa, accion o lugar, no solo un clima parecido?
Se estricto con generico/equivocado (el espectador no tiene que sentir que la imagen es al azar), PERO una imagen del lugar, la gente o los objetos de la propia historia sirve aunque no muestre la accion exacta (una foto del barco mientras se habla de su velocidad, ok).
Para clase "ambiente" alcanza con que el ambiente sea coherente con la frase, la epoca y el lugar (no hace falta un sujeto exacto).
En videos (cuadros de un clip o miniatura de YouTube): rechaza (codigo generico) un presentador hablando a camara, una reaccion, una recopilacion o una animacion; y (codigo equivocado) un sujeto solo "parecido" al que se pide.
Si la frase es una transicion sin nada concreto que mostrar ("pero eso no fue todo", "y entonces"), sirve una imagen del tema de la frase anterior. Una imagen de algo sin relacion, no.
No apruebes por cortesia: si ninguno sirve, "elegido": null.

Responde SOLO con JSON: {"elegido": numero|null, "veredictos": [{"i": numero, "codigo": "...", "motivo": "corto"}]}`;

// Tope por ffmpeg: leyendo un clip remoto, si el CDN deja de responder
// (paso con cdn.pixabay.com) ffmpeg espera para siempre y traba el plano.
const FFMPEG_TIMEOUT_MS = 45_000;

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg-static no resolvio el binario"));
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`ffmpeg tardo mas de ${FFMPEG_TIMEOUT_MS / 1000} s`));
    }, FFMPEG_TIMEOUT_MS);
    proc.stderr.on("data", (c) => (stderr += c.toString()));
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg ${code}: ${stderr.slice(-400)}`));
    });
  });
}

// Miniatura JPEG de 480 px de ancho: la del proveedor si hay, si no tres
// cuadros del video (20/50/80% de los primeros segundos) en una tira.
export async function candidateThumbnail(candidate: VisualCandidate, workDir: string, key: string): Promise<string | null> {
  const out = path.join(workDir, `${key}.jpg`);
  try {
    const primary = candidate.thumb_url ?? (candidate.type === "IMAGE" ? candidate.url : null);
    if (primary) {
      const download = (src: string) =>
        withRetry(
          async () => {
            const res = await fetchWithTimeout(src, { headers: { "User-Agent": WIKIMEDIA_UA } }, 20_000);
            if (!res.ok) throw new Error(`miniatura (${res.status})`);
            return Buffer.from(await res.arrayBuffer());
          },
          { retries: 3, baseDelayMs: 2000 }
        );
      // Si la miniatura del proveedor falla (p. ej. Openverse 424), la imagen original.
      const fallback = candidate.type === "IMAGE" && candidate.url !== primary ? candidate.url : null;
      const body = await download(primary).catch((err) => (fallback ? download(fallback) : Promise.reject(err)));
      const raw = path.join(workDir, `${key}.src`);
      await writeFile(raw, body);
      await runFfmpeg(["-y", "-i", raw, "-vf", "scale=480:-2", "-frames:v", "1", "-q:v", "4", out]);
      await rm(raw, { force: true });
      return out;
    }
    // Video sin miniatura: cuadros a 1, 3 y 6 s (o repartidos en la duracion).
    const span = Math.min(candidate.duration_seconds ?? 8, 8);
    const remote = /^https?:\/\//.test(candidate.url);
    await runFfmpeg([
      "-y",
      // Corta la lectura si el servidor no manda nada en 15 s (microsegundos).
      ...(remote ? ["-rw_timeout", "15000000"] : []),
      "-t",
      String(span),
      "-i",
      candidate.url,
      "-vf",
      `fps=${(3 / span).toFixed(3)},scale=320:-2,tile=3x1`,
      "-frames:v",
      "1",
      "-q:v",
      "4",
      out,
    ]);
    return out;
  } catch (err) {
    console.warn(`[juez] sin miniatura para ${candidate.provider}:${candidate.external_id}:`, (err as Error).message);
    return null;
  }
}

// El primer objeto JSON balanceado: a veces el juez manda dos bloques
// ("Unexpected non-whitespace character after JSON").
function parseJson(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("el juez no devolvio JSON");
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>;
  }
  throw new Error("el juez no devolvio JSON completo");
}

export function parseVerdict(raw: Record<string, unknown>, count: number, seen: Set<number>): JudgeResult {
  const verdicts: CandidateVerdict[] = [];
  for (const v of (raw.veredictos as Record<string, unknown>[] | undefined) ?? []) {
    const index = Number(v.i) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= count) continue;
    const code = (CODES as string[]).includes(String(v.codigo)) ? (String(v.codigo) as QaCode) : "generico";
    verdicts.push({ index, code, reason: String(v.motivo ?? "").slice(0, 200) });
  }
  const chosenRaw = raw.elegido;
  let chosen = chosenRaw === null || chosenRaw === undefined ? null : Number(chosenRaw) - 1;
  // Solo vale un candidato que el juez vio y no rechazo.
  if (chosen !== null && (!Number.isInteger(chosen) || chosen < 0 || chosen >= count || !seen.has(chosen))) chosen = null;
  if (chosen !== null && verdicts.some((v) => v.index === chosen && v.code !== "ok")) chosen = null;
  return { chosen, verdicts };
}

export async function judgeCandidates(
  client: Anthropic,
  model: string,
  shot: JudgeShot,
  candidates: VisualCandidate[],
  workDir: string,
  usage: Record<string, number>
): Promise<JudgeResult> {
  const thumbs = await Promise.all(candidates.map((c, i) => candidateThumbnail(c, workDir, `${Date.now()}-${Math.random().toString(36).slice(2)}-${i}`)));
  const seen = new Set(thumbs.flatMap((t, i) => (t ? [i] : [])));
  if (seen.size === 0) {
    return { chosen: null, verdicts: candidates.map((_, index) => ({ index, code: "sin_ver" as const, reason: "no se pudo ver" })) };
  }
  const content: Anthropic.ContentBlockParam[] = [];
  for (const [i, thumb] of thumbs.entries()) {
    if (!thumb) continue;
    const c = candidates[i]!;
    content.push({ type: "text", text: `Candidato ${i + 1} (${c.type === "VIDEO" ? "video" : "foto"}, ${c.provider}${c.title ? `, "${c.title.slice(0, 80)}"` : ""}):` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: (await readFile(thumb)).toString("base64") } });
  }
  content.push({
    type: "text",
    text: `Plano: clase ${shot.clase}. Sujeto: ${shot.sujeto || "(sin sujeto)"}${shot.anio ? `. Ano: ${shot.anio}` : ""}.${shot.fraseAnterior ? `\nFrase anterior: "${shot.fraseAnterior}"` : ""}\nLa voz dice: "${shot.frase}"${
      shot.modo === "tema"
        ? `\nMODO RESCATE: ninguna fuente dio el sujeto exacto. Acepta (ok) material del tema del video${shot.tema ? ` ("${shot.tema}")` : ""} si el lugar, el pais y la epoca son los de la historia; no lo rechaces por "generico". Si rechaza (equivocado/epoca/texto/marca_agua) otro lugar, otro pais, otra epoca, texto o marca de agua.`
        : ""
    }`,
  });
  try {
    const message = await client.messages.stream({ model, max_tokens: 1500, system: SYSTEM, messages: [{ role: "user", content }] }).finalMessage();
    usage.input = (usage.input ?? 0) + message.usage.input_tokens;
    usage.output = (usage.output ?? 0) + message.usage.output_tokens;
    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const result = parseVerdict(parseJson(text), candidates.length, seen);
    // Los que no se pudieron ver quedan marcados.
    for (const i of candidates.keys()) {
      if (!seen.has(i)) result.verdicts.push({ index: i, code: "sin_ver", reason: "no se pudo ver" });
    }
    return result;
  } finally {
    await Promise.all(thumbs.map((t) => (t ? rm(t, { force: true }) : undefined)));
  }
}
