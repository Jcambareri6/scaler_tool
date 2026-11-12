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

export type QaCode = "ok" | "generico" | "equivocado" | "persona" | "epoca" | "texto" | "oscuro" | "marca_agua" | "sin_ver";

export interface JudgeShot {
  frase: string;
  clase: ShotClass;
  sujeto: string;
  anio?: number;
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

const CODES: QaCode[] = ["ok", "generico", "equivocado", "persona", "epoca", "texto", "oscuro", "marca_agua"];

const SYSTEM = `Sos el JUEZ VISUAL de un documental hecho con material real. Te paso candidatos (fotos o cuadros de video) para UN plano y lo que dice la voz en ese momento. Elegis el que mejor muestra el sujeto, o los rechazas.

Codigos por candidato:
- ok: muestra el sujeto de la frase y sirve en un documental serio.
- generico: es material de relleno que podria ir en cualquier video; no muestra el sujeto concreto.
- equivocado: muestra otra cosa, otro lugar u otro objeto.
- persona: es otra persona (o no se reconoce que sea la persona nombrada).
- epoca: el plano es historico y se ven cosas modernas (o al reves).
- texto: tiene texto, subtitulos o graficos quemados que molestan.
- oscuro: muy oscuro, borroso o de muy baja calidad.
- marca_agua: tiene marca de agua o logo grande.

Para clase "ambiente" alcanza con que el ambiente sea coherente con la frase, la epoca y el lugar (no hace falta un sujeto exacto).
No apruebes por cortesia: si ninguno sirve, "elegido": null.

Responde SOLO con JSON: {"elegido": numero|null, "veredictos": [{"i": numero, "codigo": "...", "motivo": "corto"}]}`;

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg-static no resolvio el binario"));
    const proc = spawn(ffmpegPath, args);
    let stderr = "";
    proc.stderr.on("data", (c) => (stderr += c.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${stderr.slice(-400)}`))));
  });
}

// Miniatura JPEG de 480 px de ancho: la del proveedor si hay, si no tres
// cuadros del video (20/50/80% de los primeros segundos) en una tira.
export async function candidateThumbnail(candidate: VisualCandidate, workDir: string, key: string): Promise<string | null> {
  const out = path.join(workDir, `${key}.jpg`);
  try {
    const source = candidate.thumb_url ?? (candidate.type === "IMAGE" ? candidate.url : null);
    if (source) {
      const body = await withRetry(
        async () => {
          const res = await fetchWithTimeout(source, { headers: { "User-Agent": WIKIMEDIA_UA } }, 20_000);
          if (!res.ok) throw new Error(`miniatura (${res.status})`);
          return Buffer.from(await res.arrayBuffer());
        },
        { retries: 3, baseDelayMs: 2000 }
      );
      const raw = path.join(workDir, `${key}.src`);
      await writeFile(raw, body);
      await runFfmpeg(["-y", "-i", raw, "-vf", "scale=480:-2", "-frames:v", "1", "-q:v", "4", out]);
      await rm(raw, { force: true });
      return out;
    }
    // Video sin miniatura: cuadros a 1, 3 y 6 s (o repartidos en la duracion).
    const span = Math.min(candidate.duration_seconds ?? 8, 8);
    await runFfmpeg([
      "-y",
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

function parseJson(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("el juez no devolvio JSON");
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
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
    text: `Plano: clase ${shot.clase}. Sujeto: ${shot.sujeto || "(sin sujeto)"}${shot.anio ? `. Ano: ${shot.anio}` : ""}.\nLa voz dice: "${shot.frase}"`,
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
