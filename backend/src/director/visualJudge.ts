import { spawn } from "node:child_process";
import { copyFile, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { fetchWithTimeout } from "../lib/http.js";
import { withRetry } from "../lib/retry.js";
import { WIKIMEDIA_UA, type VisualCandidate } from "../lib/documentalSources.js";
import type { ShotClass } from "../lib/documentalStyles.js";
import { epochLine, type ShotEpoch } from "../lib/epoca.js";
import { ffmpegForNetwork } from "../lib/ffmpegBin.js";
import { youtubeContactSheet } from "../lib/youtubeSource.js";

// JUEZ VISUAL del formato documental: mismo criterio que el Revisor de
// sceneReview.ts (vision + JSON), pero sobre MATERIAL REAL: mira una
// miniatura de cada candidato de un plano y elige el que muestra lo que dice
// la voz, o los rechaza a todos con un codigo (como el QA de MaV). El que
// llama prueba la siguiente fuente si no hay ninguno aprobado.
// Modelo: provider "anthropic", configuration.juez_model.

// ffmpeg que puede leer de la red (en el worker, el de Debian: ver lib/ffmpegBin.ts).
const ffmpegPath = ffmpegForNetwork;

// COSTO (19/11/2026): el juez con Sonnet era el 85 % del costo (~1 USD por
// minuto de video). El trabajo de VOLUMEN (biblioteca, elegir entre
// candidatos, revisar el tramo) va con Haiku 5.5 (20 veces mas barato); la
// ULTIMA palabra (QA final de todo el video y de lo rescatado) sigue en
// Sonnet. Los controles duros (vloggers, marcas, pais, epoca) estan en el codigo.
export const JUDGE_MODEL = "claude-haiku-5-5";
export const QA_MODEL = "claude-sonnet-5-5";
// Reserva del juez y del QA (MaV: el 429 pasa a otro modelo, el 404 al alias):
// si Sonnet esta saturado, limitado o retirado, Opus. Solo Claude. Sin esto,
// con Sonnet caido no entraba ningun YouTube y el QA dejaba pasar todo.
export const JUDGE_FALLBACK_MODEL = process.env.DOCUMENTAL_JUDGE_FALLBACK?.trim() || "claude-opus-5-5";
// Reserva de cada modelo: Haiku -> Sonnet, Sonnet -> Opus.
function fallbackFor(model: string): string {
  return /haiku/.test(model) ? QA_MODEL : JUDGE_FALLBACK_MODEL;
}

function retriable(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  return status === 429 || status === 404 || status === 500 || status === 503 || status === 529 || /overloaded|rate limit|not_found/i.test(String((err as Error).message));
}

export async function claudeJudge(client: Anthropic, params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
  try {
    return await client.messages.stream(params).finalMessage();
  } catch (err) {
    const fallback = fallbackFor(params.model);
    if (!retriable(err) || params.model === fallback) throw err;
    console.warn(`[juez] ${params.model} fallo (${(err as { status?: number }).status ?? "?"}): pasa a ${fallback}`);
    return await client.messages.stream({ ...params, model: fallback }).finalMessage();
  }
}

export type QaCode = "ok" | "generico" | "equivocado" | "persona" | "epoca" | "texto" | "oscuro" | "marca_agua" | "ficcion" | "sin_ver";

export interface JudgeShot {
  frase: string;
  clase: ShotClass;
  sujeto: string;
  anio?: number;
  // Para las transiciones: sirve una imagen del tema de la frase anterior.
  fraseAnterior?: string;
  // Contexto como el QA de MaV (textoPlano): la frase siguiente, el titulo
  // del video, lo que TIENE que verse, el rotulo de lugar y la epoca.
  fraseSiguiente?: string;
  titulo?: string;
  obligatorio?: string[];
  lugarRotulo?: string;
  epoca?: ShotEpoch;
  // Donde pasa la historia del video ("Baja California, México"), una vez por
  // video (documentalPipeline.ts::storyPlace). Sin esto el juez aceptaba
  // Alabama Hills o una roca de Islandia como "ambiente" de un video de México.
  lugarHistoria?: string;
  // "tema": rescate (como MaV): acepta material del tema del video si el
  // lugar, el pais y la epoca son los de la historia; no rechaza por generico.
  modo?: "tema";
  tema?: string;
}

export type LogoCorner = "tl" | "tr" | "bl" | "br";

export interface CandidateVerdict {
  index: number;
  code: QaCode;
  reason: string;
  // YouTube con hoja de cuadros: el cuadro (1-16) que mejor muestra la frase.
  frame?: number;
  // Logo CHICO de canal en una esquina: se recorta (MaV, crop al 84 %).
  logoCorner?: LogoCorner;
  // Todos los cuadros de la hoja que muestran lo de la frase (MaV: nota por
  // cuadro). Si el primero no da un tramo limpio se prueba el siguiente, y el
  // rescate saca de aca "otro momento" en vez de probar a ciegas.
  goodFrames?: number[];
}

export interface JudgeResult {
  chosen: number | null;
  verdicts: CandidateVerdict[];
  // Por que eligio ese (o ninguno), en palabras del juez: se guarda en el asset.
  justification?: string;
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
"Tiene que verse": si el plano lo trae, eso tiene que estar en la imagen; una cosa parecida pero DISTINTA (otra maquina, otro edificio, otro hecho del mismo tipo) es equivocado.
Si el titulo del candidato nombra otro lugar u otro hecho que el de la frase, es equivocado aunque se parezca.
Una foto MODERNA de producto, catalogo, estudio o stock sobre un hecho HISTORICO es generico.
"Era" y "TODAY": usalos para el codigo epoca. Sin linea Era, no marques epoca. Antes del cine (la linea lo dice) valen ruinas, estatuas, cuadros de la epoca y reconstrucciones si no se ve nada de hoy; actores con ropa de epoca en una reconstruccion documental no son epoca.
No apruebes por cortesia: si ninguno sirve, "elegido": null.

En CADA candidato contesta dos chequeos, mirando todos sus cuadros: "camara": true si alguien mira, posa o habla a camara (vlogger, selfie, presentador, turista posando, youtuber); "marca": true si hay una MARCA DE AGUA de verdad: de una agencia de stock, un logo o texto semitransparente encima de la imagen, un logo grande o en el centro, o el nombre de un canal escrito sobre la imagen. Cualquiera de los dos en true descarta el candidato. "logo_esquina": si lo UNICO que hay es un logo CHICO de canal (menos de un sexto del ancho) en UNA esquina, la esquina: "tl" (arriba izquierda), "tr" (arriba derecha), "bl" (abajo izquierda) o "br" (abajo derecha); si no, null. Ese logo se recorta y el clip sirve: no lo cuentes como marca.

Antes de los veredictos escribi "justificacion": 1 o 2 frases con el POR QUE de tu decision (por que elegiste ese candidato frente a los otros, o por que ninguno sirve y que tendria que mostrar la imagen). Queda guardada para revisar el video.

Responde SOLO con JSON: {"justificacion": "...", "elegido": numero|null, "veredictos": [{"i": numero, "codigo": "...", "motivo": "corto", "camara": true|false, "marca": true|false, "logo_esquina": null|"tl"|"tr"|"bl"|"br", "cuadro": numero, "cuadros_ok": [numeros] (estos dos solo en hojas de cuadros de YouTube)}]}`;

// JUEZ DE TEMA (rescate, como el prompt "tema" de fotoTema en MaV): el plano
// ya no tiene una imagen especifica, asi que la pregunta CAMBIA: no "¿es la
// cosa?" sino "¿es de ESTA historia?". Con el juez estricto en el rescate se
// rechazaban 11 candidatos por plano y quedaban rotulos.
const SYSTEM_TEMA = `Sos el juez de RESCATE de un documental hecho con material real. Este plano no consiguio una imagen especifica: necesita material del TEMA de esta historia (b-roll) que no se sienta al azar bajo la frase.

Elegi el UNO que claramente pertenece a esta historia: su lugar principal, su barco/vehiculo, sus edificios, su gente, sus objetos o su epoca. No hace falta que muestre la accion exacta de la frase.

Codigos por candidato:
- ok: pertenece a esta historia (mismo pais, lugar y epoca) y no se siente al azar bajo la frase.
- equivocado: es de OTRA historia, otro pais, otro lugar u otra epoca.
- epoca: el plano es historico y se ve algo claramente moderno (o al reves).
- texto: texto grande quemado, subtitulos o graficos encima.
- marca_agua: marca de agua o logo grande.
- ficcion: pelicula, serie, animacion, CGI, videojuego o remix (solo material real).
- persona: se ve claramente a otra persona presentada como protagonista.
- oscuro: muy oscuro, borroso o de muy baja calidad.
- generico: SOLO si no tiene nada que ver con la historia (una oficina moderna cualquiera, un paisaje de otro lado).
Rechaza mapas, diagramas y escenas modernas sin relacion.
Rechaza (persona) gente hablando o posando a camara: vloggers, selfies, presentadores, turistas como protagonistas. Un documental no muestra a los youtubers del video de origen.
Rechaza (equivocado) OTRO sitio aunque sea de la misma zona: si la frase nombra un lugar o una cosa concreta (Campo Alaska, la cuesta, las cruces), unas ruinas, una mina, un tunel o un edificio que NO son eso no sirven. Material del tema sirve solo cuando la frase no nombra nada concreto.
Si ninguno pertenece a la historia, "elegido": null.

En CADA candidato contesta dos chequeos, mirando todos sus cuadros: "camara": true si alguien mira, posa o habla a camara (vlogger, selfie, presentador, turista posando, youtuber); "marca": true si hay una MARCA DE AGUA de verdad: de una agencia de stock, un logo o texto semitransparente encima de la imagen, un logo grande o en el centro, o el nombre de un canal escrito sobre la imagen. Cualquiera de los dos en true descarta el candidato. "logo_esquina": si lo UNICO que hay es un logo CHICO de canal (menos de un sexto del ancho) en UNA esquina, la esquina: "tl" (arriba izquierda), "tr" (arriba derecha), "bl" (abajo izquierda) o "br" (abajo derecha); si no, null. Ese logo se recorta y el clip sirve: no lo cuentes como marca.

Antes de los veredictos escribi "justificacion": 1 o 2 frases con el POR QUE de tu decision (por que elegiste ese candidato frente a los otros, o por que ninguno sirve y que tendria que mostrar la imagen). Queda guardada para revisar el video.

Responde SOLO con JSON: {"justificacion": "...", "elegido": numero|null, "veredictos": [{"i": numero, "codigo": "...", "motivo": "corto", "camara": true|false, "marca": true|false, "logo_esquina": null|"tl"|"tr"|"bl"|"br", "cuadro": numero, "cuadros_ok": [numeros] (estos dos solo en hojas de cuadros de YouTube)}]}`;

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

// Duracion de un video local (linea "Duration" de ffmpeg).
function localDuration(file: string): Promise<number | null> {
  return new Promise((resolve) => {
    if (!ffmpegPath) return resolve(null);
    const proc = spawn(ffmpegPath, ["-hide_banner", "-i", file], { windowsHide: true });
    let err = "";
    proc.stderr.on("data", (c) => (err += c.toString()));
    proc.on("error", () => resolve(null));
    proc.on("close", () => {
      const m = err.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
      resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null);
    });
  });
}

// Miniatura JPEG de 480 px de ancho: la del proveedor si hay, si no tres
// cuadros del video (20/50/80% de los primeros segundos) en una tira.
export async function candidateThumbnail(candidate: VisualCandidate, workDir: string, key: string): Promise<string | null> {
  const out = path.join(workDir, `${key}.jpg`);
  // YouTube: 16 cuadros reales del video (no la tapa). Si no se puede (bot
  // check, video sin formato chico), la miniatura de siempre.
  // Video de la biblioteca: la hoja ya esta armada (no se vuelve a escanear).
  if (candidate.sheet_path && candidate.sheet_times?.length) {
    const copied = await copyFile(candidate.sheet_path, out).then(() => true).catch(() => false);
    if (copied) return out;
  }
  if (candidate.provider === "youtube" && /youtube.com|youtu.be/.test(candidate.url)) {
    const sheet = await youtubeContactSheet(candidate, workDir, key).catch((err) => {
      console.warn(`[juez] sin hoja de cuadros para youtube:${candidate.external_id}: ${(err as Error).message.slice(0, 160)}`);
      return null;
    });
    if (sheet) {
      candidate.sheet_times = sheet.times;
      return sheet.path;
    }
    delete candidate.sheet_times;
  }
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
    const remote = /^https?:\/\//.test(candidate.url);
    // Clip LOCAL ya cortado (tramo de YouTube, 2da revision): 4 cuadros al 3,
    // 35, 65 y 97 % del clip ENTERO (MaV). Antes miraba solo los primeros 8 s
    // y en un tramo de 12 s no veia el final.
    if (!remote) {
      const dur = await localDuration(candidate.url);
      if (dur && dur > 0.5) {
        const parts: string[] = [];
        for (const [k, f] of [0.03, 0.35, 0.65, 0.97].entries()) {
          const part = path.join(workDir, `${key}-v${k}.jpg`);
          await runFfmpeg(["-y", "-ss", (dur * f).toFixed(2), "-i", candidate.url, "-frames:v", "1", "-vf", "scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2", "-q:v", "4", part]).catch(() => undefined);
          if (await stat(part).then((s) => s.size > 500).catch(() => false)) parts.push(part);
        }
        if (parts.length >= 2) {
          await runFfmpeg(["-y", ...parts.flatMap((p) => ["-i", p]), "-filter_complex", `${parts.map((_, i) => `[${i}:v]`).join("")}hstack=inputs=${parts.length}`, "-frames:v", "1", "-q:v", "4", out]);
          await Promise.all(parts.map((p) => rm(p, { force: true })));
          return out;
        }
        await Promise.all(parts.map((p) => rm(p, { force: true })));
      }
    }
    // Video remoto sin miniatura: cuadros a 1, 3 y 6 s (o repartidos en la duracion).
    const span = Math.min(candidate.duration_seconds ?? 8, 8);
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
    // Chequeos que hace cumplir el codigo: el modelo los marcaba y elegia igual.
    if (v.camara === true) { verdicts.push({ index, code: "persona", reason: `alguien a camara (vlogger/selfie/presentador): ${String(v.motivo ?? "").slice(0, 150)}` }); continue; }
    if (v.marca === true) { verdicts.push({ index, code: "marca_agua", reason: `marca de agua o logo de canal: ${String(v.motivo ?? "").slice(0, 150)}` }); continue; }
    const corner = ["tl", "tr", "bl", "br"].includes(String(v.logo_esquina)) ? (String(v.logo_esquina) as LogoCorner) : undefined;
    const frame = Number(v.cuadro);
    const goodFrames = Array.isArray(v.cuadros_ok) ? [...new Set((v.cuadros_ok as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 16))] : [];
    verdicts.push({
      index,
      code,
      reason: String(v.motivo ?? "").slice(0, 200),
      ...(Number.isInteger(frame) && frame >= 1 && frame <= 16 ? { frame } : {}),
      ...(goodFrames.length ? { goodFrames } : {}),
      ...(corner ? { logoCorner: corner } : {}),
    });
  }
  const chosenRaw = raw.elegido;
  let chosen = chosenRaw === null || chosenRaw === undefined ? null : Number(chosenRaw) - 1;
  // Solo vale un candidato que el juez vio y no rechazo.
  if (chosen !== null && (!Number.isInteger(chosen) || chosen < 0 || chosen >= count || !seen.has(chosen))) chosen = null;
  if (chosen !== null && verdicts.some((v) => v.index === chosen && v.code !== "ok")) chosen = null;
  const justification = typeof raw.justificacion === "string" ? raw.justificacion.trim().slice(0, 400) : "";
  return { chosen, verdicts, ...(justification ? { justification } : {}) };
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// Bloque de texto de un plano para el juez (como textoPlano de MaV): lo arma
// el codigo con lo que ya tiene el plano, sin otra llamada al modelo. Lo usa
// tambien el QA final (qaFinal.ts).
export function shotContext(shot: JudgeShot): string {
  const lines: string[] = [];
  if (shot.titulo) lines.push(`Documental: "${clip(shot.titulo, 120)}".`);
  if (shot.lugarHistoria) {
    lines.push(
      `La historia pasa en: ${clip(shot.lugarHistoria, 120)}. Una imagen de OTRO pais o region (paisaje, ciudad, gente, carteles de otro lado) es "equivocado", aunque se parezca, salvo que la frase hable justamente de ese otro lugar.`
    );
  }
  lines.push(`Plano: clase ${shot.clase}. Sujeto: ${shot.sujeto || "(sin sujeto)"}.`);
  if (shot.obligatorio?.length) lines.push(`Tiene que verse: ${shot.obligatorio.join(", ")}.`);
  if (shot.lugarRotulo) lines.push(`Rotulo de lugar en pantalla: "${shot.lugarRotulo}".`);
  lines.push(`La voz dice: "${clip(shot.frase, 260)}"`);
  if (shot.fraseAnterior || shot.fraseSiguiente) {
    lines.push(`Alrededor: antes: «${clip(shot.fraseAnterior ?? "", 140)}» despues: «${clip(shot.fraseSiguiente ?? "", 140)}»`);
  }
  const era = shot.epoca ? epochLine(shot.epoca) : shot.anio ? `Era: ${shot.anio}.` : null;
  if (era) lines.push(era);
  if (shot.modo === "tema") {
    lines.push(
      `MODO RESCATE: ninguna fuente dio el sujeto exacto. Acepta (ok) material del tema del video${shot.tema ? ` ("${shot.tema}")` : ""} si el lugar, el pais y la epoca son los de la historia; no lo rechaces por "generico". Si rechaza (equivocado/epoca/texto/marca_agua) otro lugar, otro pais, otra epoca, texto o marca de agua.`
    );
  }
  return lines.join("\n");
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
    const youtubeNote =
      c.provider !== "youtube" || !/youtube.com|youtu.be/.test(c.url)
        ? ""
        : c.sheet_times?.length
          ? `. Es una HOJA de ${c.sheet_times.length} cuadros REALES del video, en orden de tiempo (de izquierda a derecha y de arriba abajo). Si lo elegis, pone en "cuadro" el numero del cuadro que mejor muestra lo que dice la voz (el clip arranca ahi) y en "cuadros_ok" TODOS los cuadros que tambien lo muestran, sin gente a camara ni marcas`
          : ". Es la MINIATURA (la tapa) del video: puede tener titulos, flechas o montajes que el video no tiene; no lo rechaces por el texto de la tapa, juzga si el video muestra el sujeto";
    content.push({ type: "text", text: `Candidato ${i + 1} (${c.type === "VIDEO" ? "video" : "foto"}, ${c.provider}${c.title ? `, "${c.title.slice(0, 80)}"` : ""}${youtubeNote}):` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: (await readFile(thumb)).toString("base64") } });
  }
  content.push({ type: "text", text: shotContext(shot) });
  try {
    const message = await claudeJudge(client, { model, max_tokens: 8000, system: shot.modo === "tema" ? SYSTEM_TEMA : SYSTEM, messages: [{ role: "user", content }] });
    usage.input = (usage.input ?? 0) + message.usage.input_tokens;
    usage.output = (usage.output ?? 0) + message.usage.output_tokens;
    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const result = parseVerdict(parseJson(text), candidates.length, seen);
    // El logo de esquina solo se puede recortar en un video de YouTube que
    // todavia no se bajo. En una foto, un stock o el clip ya cortado (2da
    // revision): es una marca y se descarta.
    for (const v of result.verdicts) {
      const c = candidates[v.index];
      const croppable = c?.provider === "youtube" && /youtube.com|youtu.be/.test(c.url);
      if (v.logoCorner && !croppable) {
        v.code = "marca_agua";
        v.reason = `logo de canal en la esquina: ${v.reason}`.slice(0, 200);
        if (result.chosen === v.index) result.chosen = null;
      }
    }
    // Los que no se pudieron ver quedan marcados.
    for (const i of candidates.keys()) {
      if (!seen.has(i)) result.verdicts.push({ index: i, code: "sin_ver", reason: "no se pudo ver" });
    }
    return result;
  } finally {
    await Promise.all(thumbs.map((t) => (t ? rm(t, { force: true }) : undefined)));
  }
}
