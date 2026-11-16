import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import type { Phrase } from "./phrases.js";

// EL DIRECTOR DE MAPAS (como directorMapa.js de MaV): el video entero como
// mapa explicativo (componente motion map_cartoon). Claude convierte la
// narracion en planos de mapa:
//   1. LOS PLANOS: la voz se corta en frases de 2,5-6,5 s (pausas y
//      puntuacion). Cada frase es un plano.
//   2. EL REPARTO (una llamada): que paises salen, el color fijo de cada uno y
//      el protagonista con cara. Asi un pais no cambia de color.
//   3. LAS ESCENAS (tandas de 8 planos, 3 a la vez, 2 intentos): el JSON de
//      cada plano segun skills/mapa-cartoon/SKILL.md, con los elementos
//      entrando cuando la voz los nombra.
// Despues `volar` conecta los planos: cada uno arranca en el encuadre del
// anterior y vuela al suyo. FALLA ABIERTO: sin escenas devuelve null y el
// pipeline sigue con el documental normal; un plano sin escena valida repite
// el anterior con todo en su lugar.

export const MAPA_MODEL = "claude-sonnet-5-5";

export interface MapaShot {
  start: number;
  end: number;
  line: string;
  // Indices de palabra (en el orden de las frases) que cubre el plano.
  from: number;
  to: number;
}

export type Escena = Record<string, unknown> & {
  centro?: { lat: number; lon: number };
  km?: number;
  paises?: { nombre?: string; color?: string; en?: number; hasta?: number }[];
  cifra?: unknown;
  camara?: Record<string, unknown>;
};

const here = path.dirname(fileURLToPath(import.meta.url));

function guide(): string {
  for (const candidate of [path.join(here, "../../skills/mapa-cartoon/SKILL.md"), path.join(process.cwd(), "skills/mapa-cartoon/SKILL.md")]) {
    try {
      return readFileSync(candidate, "utf-8");
    } catch {
      // siguiente
    }
  }
  return "";
}

// La voz en planos de min-max segundos, cortando en puntuacion y pausas.
export function cortarEnPlanos(phrases: Phrase[], min = 2.5, max = 6.5): MapaShot[] {
  const words = phrases.flatMap((p) => p.words);
  const planos: { start: number; end: number; words: string[]; from: number; to: number }[] = [];
  let cur: (typeof planos)[number] | null = null;
  words.forEach((w, i) => {
    if (!cur) cur = { start: w.start, end: w.end, words: [], from: i, to: i };
    cur.words.push(w.text);
    cur.end = w.end;
    cur.to = i;
    const next = words[i + 1];
    const dur = cur.end - cur.start;
    const fin = /[.!?…]["»”)]*$/.test(w.text);
    const coma = /[,;:]["»”)]*$/.test(w.text);
    const pausa = next ? next.start - w.end > 0.35 : true;
    if (!next || dur >= max || (dur >= min && (fin || ((coma || pausa) && dur >= min + 1)))) {
      planos.push(cur);
      cur = null;
    }
  });
  const rest = cur as (typeof planos)[number] | null;
  if (rest) {
    const last = planos[planos.length - 1];
    if (last && rest.end - rest.start < min * 0.6) {
      last.end = rest.end;
      last.words.push(...rest.words);
      last.to = rest.to;
    } else planos.push(rest);
  }
  // Contiguos: cada plano empieza donde acaba el anterior (el primero en 0).
  return planos.map((p, i) => ({
    start: i === 0 ? 0 : +p.start.toFixed(3),
    end: i + 1 < planos.length ? +planos[i + 1]!.start.toFixed(3) : +p.end.toFixed(3),
    line: p.words.join(" "),
    from: p.from,
    to: p.to,
  }));
}

function parseJson<T>(text: string, open: "{" | "["): T {
  const close = open === "[" ? "]" : "}";
  const a = text.indexOf(open);
  const b = text.lastIndexOf(close);
  if (a < 0 || b <= a) throw new Error("sin JSON");
  return JSON.parse(text.slice(a, b + 1)) as T;
}

// Una escena se puede pintar si trae centro, km y al menos un pais con nombre.
export function valida(e: unknown): e is Escena {
  const x = e as Escena | null;
  return (
    !!x &&
    typeof x === "object" &&
    !!x.centro &&
    Number.isFinite(Number(x.centro.lat)) &&
    Number.isFinite(Number(x.centro.lon)) &&
    Number.isFinite(Number(x.km)) &&
    Array.isArray(x.paises) &&
    x.paises.some((p) => p && p.nombre)
  );
}

// La escena anterior otra vez, con todo en su lugar (sin cifra ni bocadillo).
export function continuar(e: Escena): Escena {
  return { centro: e.centro!, km: e.km!, paises: (e.paises ?? []).map((p) => ({ ...p, en: -1 })) };
}

// LA CAMARA ENTRE PLANOS (MaV, medido sobre el video de referencia): un vuelo
// desde el encuadre del plano anterior (1,4 s; 1,9 s si el salto es grande) y
// dentro del plano una deriva muy suave que se turna; con cifra, casi quieto.
export function volar(escenas: Escena[]): Escena[] {
  const DERIVAS: [number, number][] = [[0.02, 0], [-0.018, 0.008], [0, -0.014], [0.016, 0.01], [-0.015, -0.01]];
  const ZOOMS = [0.018, -0.014, 0.01, 0, 0.014];
  escenas.forEach((e, i) => {
    const c = (e.camara = { ...(e.camara ?? {}) });
    if (c.mov === "quieto") {
      c.deriva = [0, 0];
      c.zoom = 0;
    } else {
      if (!Array.isArray(c.deriva)) c.deriva = e.cifra ? [0, 0] : DERIVAS[i % DERIVAS.length];
      if (c.zoom == null) c.zoom = e.cifra ? 0.008 : ZOOMS[i % ZOOMS.length];
    }
  });
  const kmEntre = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
    const r = Math.PI / 180;
    const x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r);
    const y = (b.lat - a.lat) * r;
    return Math.hypot(x, y) * 6371;
  };
  const name = (p: { nombre?: string } | undefined) => String(p?.nombre ?? "").toLowerCase();
  for (let i = 1; i < escenas.length; i++) {
    const a = escenas[i - 1]!;
    const b = escenas[i]!;
    if (!a.centro || !b.centro) continue;
    const ka = Number(a.km) || 3500;
    const kb = Number(b.km) || 3500;
    const salto = kmEntre(a.centro, b.centro);
    const grande = salto > Math.max(ka, kb) * 1.5 || Math.max(ka, kb) / Math.min(ka, kb) > 4;
    // Mismo encuadre: la camara sigue con la misma deriva, sin volver atras.
    const mismo = salto < Math.min(ka, kb) * 0.08 && Math.abs(Math.log(ka / kb)) < 0.1;
    if (mismo) {
      b.centro = a.centro;
      b.km = ka;
      if (!b.cifra) b.camara!.deriva = a.camara!.deriva;
    }
    b.camara!.desde = { centro: a.centro, km: ka, deriva: a.camara!.deriva, zoom: a.camara!.zoom, ...(mismo ? { mantener: true } : {}) };
    b.camara!.vuelo = Number(b.camara!.vuelo) || (grande ? 1.9 : 1.4);
    // Los paises que ya estaban siguen ahi (no vuelven a subir)...
    const antes = new Set((a.paises ?? []).map(name));
    for (const p of b.paises ?? []) if (p && antes.has(name(p)) && !(Number(p.en) > 0.8)) p.en = -1;
    // ...y los que se van se desvanecen al empezar el vuelo.
    const ahora = new Set((b.paises ?? []).map(name));
    for (const p of a.paises ?? []) {
      if (p?.nombre && p.hasta == null && !ahora.has(name(p))) (b.paises = b.paises ?? []).unshift({ nombre: p.nombre, ...(p.color ? { color: p.color } : {}), en: -1, hasta: 0.45 });
    }
  }
  return escenas;
}

async function ask(client: Anthropic, model: string, system: string, content: string, maxTokens: number, usage: Record<string, number>): Promise<string> {
  // Sonnet 5.5 piensa antes de contestar y eso cuenta en max_tokens: margen amplio.
  const message = await client.messages
    .stream({
      model,
      max_tokens: maxTokens,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
    })
    .finalMessage();
  usage.input = (usage.input ?? 0) + message.usage.input_tokens;
  usage.output = (usage.output ?? 0) + message.usage.output_tokens;
  return message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
}

async function inParallel(tasks: (() => Promise<void>)[], n: number): Promise<void> {
  let i = 0;
  const worker = async () => {
    while (i < tasks.length) {
      const k = i++;
      await tasks[k]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
}

export async function directMapa(input: {
  client: Anthropic;
  model: string;
  phrases: Phrase[];
  scriptText: string;
  language?: string;
  min?: number;
  max?: number;
}): Promise<{ shots: MapaShot[]; escenas: Escena[]; buenas: number; usage: Record<string, number> } | null> {
  const usage: Record<string, number> = {};
  const shots = cortarEnPlanos(input.phrases, input.min ?? 2.5, input.max ?? 6.5);
  const system = guide();
  if (!shots.length || !system) return null;
  // Las lineas salen del reconocimiento de voz y a veces oyen mal: el guion
  // escrito manda en cifras, nombres y fechas.
  const written = input.scriptText.trim()
    ? `SCRIPT AS WRITTEN (authoritative for numbers, names and dates; the shot lines below come from speech recognition and may contain mistakes):\n${input.scriptText.slice(0, 30000)}\n\n`
    : "";
  const narration = written + shots.map((s, i) => `#${i + 1} [${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.line}`).join("\n");

  let palette: unknown;
  try {
    palette = parseJson(
      await ask(
        input.client,
        input.model,
        system,
        `FULL NARRATION (${input.language || "auto"}), shot by shot:\n${narration.slice(0, 60000)}\n\n` +
          "Before writing shots, decide the CAST of the map for the whole video: which countries appear, the colour of each " +
          "(fixed for the whole video, neighbours different), and which one is the protagonist with a face. " +
          'Answer only JSON: {"protagonista": "China", "paises": {"China": "#E8312A", "Iran": "#2F7FE0"}, "notas": "one line on the story"}',
        8000,
        usage
      ),
      "{"
    );
  } catch (err) {
    console.warn(`[directorMapa] sin reparto (${(err as Error).message}): sigue el documental normal`);
    return null;
  }

  const escenas: (Escena | null)[] = new Array(shots.length).fill(null);
  const batches: [number, number][] = [];
  for (let i = 0; i < shots.length; i += 8) batches.push([i, Math.min(shots.length, i + 8)]);
  await inParallel(
    batches.map(([a, b]) => async () => {
      const list = shots.slice(a, b).map((s, k) => ({ n: a + k + 1, dur: +(s.end - s.start).toFixed(2), line: s.line }));
      const prompt =
        `CAST (fixed for the whole video): ${JSON.stringify(palette)}\n\n` +
        `FULL NARRATION for context:\n${narration.slice(0, 40000)}\n\n` +
        `WRITE THESE SHOTS (times inside each shot start at 0; "en" must match when the words are said, about 0.4 s per word):\n${JSON.stringify(list)}\n\n` +
        `Shot #${a + 1} follows shot #${a} of the video: countries already shown in the previous shot can use "en": -1. ` +
        `Vary the framing (centro/km) with the story: zoom to the place being talked about. ` +
        `Answer only a JSON array with ${list.length} shot objects, in order.`;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const arr = parseJson<unknown[]>(await ask(input.client, input.model, system, prompt, 32000, usage), "[");
          arr.slice(0, list.length).forEach((e, k) => {
            if (valida(e)) escenas[a + k] = e;
          });
          return;
        } catch (err) {
          console.warn(`[directorMapa] tanda ${a + 1}-${b} (intento ${attempt}): ${(err as Error).message}`);
        }
      }
    }),
    3
  );
  const buenas = escenas.filter(Boolean).length;
  if (!buenas) {
    console.warn("[directorMapa] ninguna escena valida: sigue el documental normal");
    return null;
  }
  // Huecos: la escena anterior (o la siguiente buena) con todo en su lugar.
  for (let i = 0; i < escenas.length; i++) {
    if (escenas[i]) continue;
    const before = escenas.slice(0, i).reverse().find(Boolean) ?? escenas.find(Boolean)!;
    escenas[i] = continuar(before!);
  }
  return { shots, escenas: volar(escenas as Escena[]), buenas, usage };
}
