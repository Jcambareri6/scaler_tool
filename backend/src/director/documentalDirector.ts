import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { mapWithConcurrency } from "../lib/concurrency.js";
import { makeWorkDir } from "../lib/workDir.js";
import { motionCatalog, renderAnimatedStills } from "../lib/motion.js";
import { placeNavHeaders, type PlacedOverlay } from "../lib/overlayTiming.js";
import { getActiveProvider } from "../lib/providers.js";
import { normalize } from "../tools/generateOverlay.tool.js";
import { TYPE_GUIDE, plannableTypes, toOverlaySpec } from "../tools/planOverlays.tool.js";
import { asList, callTool, clock, type Usage } from "./director.js";
import { validateComponent, type DrawingComponent } from "./drawings.js";
import type { Phrase } from "./phrases.js";
import { wordTime, type AnimatedPlan, type AnimatedScene } from "./sceneDirector.js";

// FORMATO DOCUMENTAL (docs/formato-documental/INFORME.md, fases 3 y 4).
// La IA decide QUE se muestra; el codigo decide DONDE y COMO se ve.
//
// Hub and spoke: este archivo es el ORQUESTADOR. Cada agente recibe su
// entrada solo de aca y devuelve su salida solo aca; ningun agente llama a
// otro ni lee su salida:
//   1. DIRECTOR (Opus, 1 llamada): plan de recursos (sin coordenadas, colores
//      ni duraciones). Si el codigo lo rechaza, a lo sumo 1 correccion.
//   2. DIBUJANTES (Sonnet, en paralelo): solo los objetos que no estan en la
//      biblioteca base. El orquestador les arma el pedido.
//   3. VERIFICADOR (codigo): datos del guion, nada rojo antes del remate,
//      objetos existentes, cobertura completa.
//   4. REVISOR (Sonnet, configurable): 1 pasada sobre capturas reales. Lo que
//      rechaza pasa a un recurso seguro: no hay rondas de ida y vuelta.
// Modelos por rol en provider.configuration: documental_director_model,
// documental_artist_model, documental_reviewer_model. "documental: false"
// apaga este camino y vuelve al formato anterior.

const DEFAULTS = {
  director: "claude-opus-5-5",
  artist: "claude-sonnet-5-5",
  reviewer: "claude-sonnet-5-5",
};
const DIRECTOR_MAX_TOKENS = 32000;
const ARTIST_MAX_TOKENS = 8000;
const ARTISTS = 6;
const REVIEW_BATCH = 12;
const TAIL_SECONDS = 0.8;
const CAPTION_WORDS = 7;

// Biblioteca base del motor (backend/motion/src/biblioteca). Mantener igual.
const BIBLIOTECA_BASE: Record<string, { nombre: string; partes: string[] }> = {
  consola: { nombre: "consola o tablero de control, con un boton", partes: ["boton"] },
  reactor_corte: { nombre: "reactor o deposito en corte, con barras que bajan y nucleo", partes: ["barras", "nucleo"] },
  ciudad: { nombre: "ciudad (edificios con ventanas que se encienden)", partes: ["ventanas"] },
};

const HACE_UBICACION = ["fecha", "hora", "hora_nota", "pais", "lugar", "region"];
const HACE_ESQUEMA = ["aparece", "tarjeta", "aprieta", "parte", "lupa", "lupa_accion", "lupa_texto", "lupa_nota", "etiqueta", "escudo", "conectar", "flujo", "evento"];
const SIGNIFICADOS = ["seguro", "peligro", "foco", "neutro"];
const GRAFICOS = ["big_number", "versus", "data_viz_single", "timeline", "list", "kinetic_quote", "pivot_question", "card_grid", "myth_fact", "number_phrase", "person_card", "line_chart", "scale_compare", "map_globe"];

type Raw = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function directorSystem(types: string[]): string {
  const base = Object.entries(BIBLIOTECA_BASE)
    .map(([id, o]) => `- ${id}: ${o.nombre} · partes: ${o.partes.join(", ")}`)
    .join("\n");
  return `Sos el DIRECTOR de un video documental animado (estilo Ciencia y Vida). Recibis el guion en frases con id y decidis QUE se muestra en cada tramo. El codigo decide donde y como se ve: nunca des coordenadas, colores, tamanos ni duraciones.

Reglas del formato:
- Demostrar, no ilustrar: la imagen cambiaria si la afirmacion fuera falsa.
- Una idea por pantalla. Pocas escenas largas que suman capas con la voz, no muchas sueltas.
- Fondo claro para mecanismos ("como funciona"); oscuro para datos, lugares y giros.
- Significados: seguro (verde), peligro (rojo), foco (naranja), neutro. NADA "peligro" antes del momento con remate=true.
- Todo texto, cifra, fecha o nombre en pantalla sale literal del guion.
- Cada momento va atado a una palabra exacta de una frase: {"frase": "p7", "palabra": "apagar"}. El cambio fuerte (remate) cae en la palabra clave.

RECURSOS (tipo de cada escena):
1. "ubicacion": mapa con capas. contenido: {lugar, subtitulo?, region?, geo:{lat,lon}, fecha?:{dia,mes,anio}, hora?, hora_nota?}. momentos (hace): fecha (parte: dia|mes|anio), hora, hora_nota, pais, lugar, region.
2. "esquema_capas": escenario de perfil con lugares fijos de izquierda a derecha: personaje (pictograma), secundario, principal, destino. contenido: {principal, secundario?, destino?, personaje?:{tarjeta?, rol?}, lupa?:{objeto: "secundario"|"principal"|"destino", parte, texto?, nota?}}. Los objetos son ids de la biblioteca base o de objetos_nuevos. momentos (hace): aparece (objeto: lugar o "personaje"), tarjeta, aprieta (objeto + parte), parte (objeto + parte + significado: la parte se mueve, se pinta o se enciende), lupa, lupa_accion, lupa_texto (significado), lupa_nota, etiqueta (objeto + texto + significado, con parte o posicion "arriba"), escudo (objeto + texto + significado "seguro": promesa que se rompe en el remate), conectar (de principal a destino), flujo, evento (objeto + texto + remate: true; reemplaza a cualquier explosion: grietas, halo rojo y etiqueta).
3. "grafico": grafico del catalogo a pantalla completa para datos (una cifra, una comparacion, una lista, una linea de tiempo). grafico: {type, text, label?, items?, lat?, lon?, frase, palabra}. Tipos:
${types.map((t) => `- ${t}: ${TYPE_GUIDE[t as keyof typeof TYPE_GUIDE] ?? ""}`).join("\n")}
Como mucho un tercio de las escenas son graficos y nunca dos seguidos.

BIBLIOTECA BASE (dibujos que ya existen; usalos cuando sirvan):
${base}
Si hace falta otro objeto, pedilo en objetos_nuevos con id corto, nombre, descripcion de como se ve de perfil y sus partes con nombre. Cada objeto existe una sola vez y se reutiliza.

Ejemplo de escena (resumido): {"desde":"p3","hasta":"p8","tipo":"esquema_capas","fondo":"claro","titulo":[{"texto":"Sala de control","frase":"p3","palabra":"sala"}],"contenido":{"secundario":"consola","principal":"reactor_corte","destino":"ciudad","personaje":{"tarjeta":"25 años","rol":"el ingeniero"},"lupa":{"objeto":"secundario","parte":"boton","texto":"APAGAR"}},"momentos":[{"hace":"aprieta","objeto":"secundario","parte":"boton","frase":"p4","palabra":"pulsa"},{"hace":"parte","objeto":"principal","parte":"barras","frase":"p6","palabra":"apagar"},{"hace":"escudo","objeto":"principal","texto":"último recurso","significado":"seguro","frase":"p7","palabra":"último"},{"hace":"evento","objeto":"principal","texto":"explota","remate":true,"frase":"p8","palabra":"explota"}]}

Entrega con la herramienta plan_documental: capitulos (titulo corto literal del guion y frase donde empieza), escenas seguidas que cubren TODAS las frases (desde/hasta), y objetos_nuevos.`;
}

const directorTool: Anthropic.Tool = {
  name: "plan_documental",
  description: "Entrega el plan de recursos del video.",
  input_schema: {
    type: "object",
    properties: {
      capitulos: { type: "array", items: { type: "object" } },
      escenas: { type: "array", items: { type: "object" } },
      objetos_nuevos: { type: "array", items: { type: "object" } },
    },
    required: ["capitulos", "escenas"],
  },
};

const artistSystem = `Sos el DIBUJANTE de un video documental animado. Dibujas UN objeto en SVG, de perfil, estilo infografia editorial: relleno plano claro (#DFE5EB o #D5DCE3), linea fina oscura (#2A3340, 3 px), sin texto, sin degradados, sin sombras. Cada parte pedida va en un <g data-part="nombre">. Solo formas: g, path, rect, circle, ellipse, line, polyline, polygon. Entrega con la herramienta.`;

const artistTool: Anthropic.Tool = {
  name: "entregar_dibujo",
  description: "Entrega el componente dibujado.",
  input_schema: {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      width: { type: "number" },
      height: { type: "number" },
      svg: { type: "string" },
      parts: { type: "object" },
    },
    required: ["id", "name", "width", "height", "svg", "parts"],
  },
};

// ---------- Verificador (codigo) ----------

interface Ctx {
  phrases: Phrase[];
  index: Map<string, number>;
  fullNorm: string;
  objetos: Set<string>;
  types: string[];
}

function at(ctx: Ctx, raw: Raw): number | null {
  const i = ctx.index.get(String(raw.frase ?? ""));
  if (i === undefined) return null;
  return wordTime(ctx.phrases[i]!, str(raw.palabra));
}

// Cada cifra de un texto tiene que estar en el guion (datos inventados =
// rechazo). "Reactor 4" pasa si el guion dice "reactor numero 4"; "3 millones"
// no pasa si el 3 no aparece.
const CIFRA = /\d+(?:[.,]\d+)*/g;
function textoValido(ctx: Ctx, texto: string | undefined): boolean {
  if (!texto) return true;
  const cifras = texto.match(CIFRA) ?? [];
  if (cifras.length === 0) return true;
  const delGuion = new Set(ctx.fullNorm.match(CIFRA) ?? []);
  return cifras.every((c) => delGuion.has(c));
}

interface Verificada {
  scene: Omit<AnimatedScene, "id" | "start" | "end">;
  desde: number;
  hasta: number;
  problemas: string[];
}

function verificarEscena(ctx: Ctx, raw: Raw, n: number): Verificada {
  const problemas: string[] = [];
  const desde = ctx.index.get(String(raw.desde ?? ""));
  const hasta = ctx.index.get(String(raw.hasta ?? ""));
  if (desde === undefined || hasta === undefined || hasta < desde) {
    return { scene: { elements: [], steps: [] }, desde: desde ?? 0, hasta: hasta ?? desde ?? 0, problemas: [`escena ${n}: desde/hasta invalidos`] };
  }
  const tipo = str(raw.tipo);

  if (tipo === "grafico") {
    const g = (raw.grafico ?? {}) as Raw;
    const spec = toOverlaySpec(g, ctx.types as never);
    if (!spec) return { scene: { elements: [], steps: [] }, desde, hasta, problemas: [`escena ${n}: grafico invalido`] };
    if (!textoValido(ctx, spec.text) || !textoValido(ctx, spec.label) || (spec.items ?? []).some((i) => !textoValido(ctx, i.text))) {
      problemas.push(`escena ${n}: el grafico tiene cifras que no estan en el guion`);
    }
    const t = at(ctx, g) ?? ctx.phrases[desde]!.start;
    return { scene: { elements: [{ id: "g", kind: "graphic", slot: "full", spec }], steps: [{ action: "show", target: "g", at: t }] } as never, desde, hasta, problemas };
  }

  if (tipo !== "ubicacion" && tipo !== "esquema_capas") {
    return { scene: { elements: [], steps: [] }, desde, hasta, problemas: [`escena ${n}: tipo "${String(tipo)}" desconocido`] };
  }
  const permitidos = tipo === "ubicacion" ? HACE_UBICACION : HACE_ESQUEMA;
  const contenido = (raw.contenido ?? {}) as Raw;
  const momentos = asList(raw.momentos, "momentos")
    .map((m) => m as Raw)
    .flatMap((m) => {
      const t = at(ctx, m);
      const hace = str(m.hace);
      if (t === null || !hace || !permitidos.includes(hace)) {
        problemas.push(`escena ${n}: momento invalido (${String(m.hace)} en ${String(m.frase)})`);
        return [];
      }
      if (!textoValido(ctx, str(m.texto))) {
        problemas.push(`escena ${n}: "${String(m.texto)}" no esta en el guion`);
        return [];
      }
      const sig = str(m.significado);
      return [
        {
          at: t,
          hace,
          ...(str(m.objeto) ? { objeto: str(m.objeto) } : {}),
          ...(str(m.parte) ? { parte: str(m.parte) } : {}),
          ...(str(m.texto) ? { texto: str(m.texto) } : {}),
          ...(sig && SIGNIFICADOS.includes(sig) ? { significado: sig } : {}),
          ...(m.posicion === "arriba" ? { posicion: "arriba" } : {}),
          ...(m.remate === true ? { remate: true } : {}),
        },
      ];
    })
    .sort((a, b) => a.at - b.at);

  // Nada rojo antes del remate: se baja a neutro (y se avisa).
  const remate = momentos.find((m) => m.remate)?.at;
  for (const m of momentos) {
    if (m.significado === "peligro" && (remate === undefined || m.at < remate)) {
      m.significado = "neutro";
      problemas.push(`escena ${n}: "peligro" antes del remate (pasado a neutro)`);
    }
  }

  if (tipo === "ubicacion") {
    const geo = contenido.geo as { lat?: unknown; lon?: unknown } | undefined;
    if (!str(contenido.lugar) || typeof geo?.lat !== "number" || typeof geo?.lon !== "number") problemas.push(`escena ${n}: ubicacion sin lugar o coordenadas`);
    const f = contenido.fecha as { anio?: unknown } | undefined;
    if (f?.anio !== undefined && !ctx.fullNorm.includes(String(f.anio))) problemas.push(`escena ${n}: el año ${String(f.anio)} no esta en el guion`);
  } else {
    for (const lugar of ["principal", "secundario", "destino"]) {
      const id = str(contenido[lugar]);
      if (id && !ctx.objetos.has(id)) problemas.push(`escena ${n}: el objeto "${id}" no existe ni se pidio en objetos_nuevos`);
    }
    if (!str(contenido.principal)) problemas.push(`escena ${n}: falta el objeto principal`);
  }

  const titulo = asList(raw.titulo ?? [], "titulo")
    .map((p) => p as Raw)
    .flatMap((p) => (str(p.texto) ? [{ texto: str(p.texto)!, at: at(ctx, p) ?? ctx.phrases[desde]!.start }] : []));
  const fondo = raw.fondo === "claro" || raw.fondo === "oscuro" ? raw.fondo : undefined;
  return {
    scene: { elements: [], steps: [], recurso: { tipo, ...(fondo ? { fondo } : {}), ...(titulo.length ? { titulo } : {}), contenido, momentos } } as never,
    desde,
    hasta,
    problemas: problemas.filter((p) => !p.includes("pasado a neutro")),
  };
}

// Recurso seguro: la frase mas fuerte del tramo como cita (dato del guion).
function escenaSegura(ctx: Ctx, desde: number): Verificada["scene"] {
  const words = ctx.phrases[desde]!.text.split(/\s+/).slice(0, 8);
  const label = [...words].sort((a, b) => b.length - a.length)[0] ?? words[0] ?? "";
  const spec = { type: "kinetic_quote", text: words.join(" ").replace(/[.,;:]+$/, ""), label: label.replace(/[.,;:]+$/, ""), source: "script" };
  return { elements: [{ id: "g", kind: "graphic", slot: "full", spec }], steps: [{ action: "show", target: "g", at: ctx.phrases[desde]!.start }] } as never;
}

// ---------- Verificacion y armado (codigo puro, sin IA: se puede probar) ----------

export function verificarPlan(r: Raw | undefined, phrases: Phrase[]) {
  const types = plannableTypes().filter((t) => GRAFICOS.includes(t));
  const ctx: Ctx = {
    phrases,
    index: new Map(phrases.map((p, i) => [p.id, i])),
    fullNorm: normalize(phrases.map((p) => p.text).join(" ")),
    objetos: new Set([...Object.keys(BIBLIOTECA_BASE), ...asList(r?.objetos_nuevos ?? [], "objetos_nuevos").flatMap((o) => (str((o as Raw).id) ? [str((o as Raw).id)!] : []))]),
    types,
  };
  const escenas = asList(r?.escenas ?? [], "escenas").map((e, i) => verificarEscena(ctx, e as Raw, i + 1));
  const problemas = escenas.flatMap((e) => e.problemas);
  // Cobertura: escenas seguidas sin huecos desde la primera frase a la ultima.
  let next = 0;
  for (const e of escenas) {
    if (e.desde !== next) problemas.push(`hueco o solape: la escena que empieza en ${phrases[e.desde]?.id} deberia empezar en ${phrases[next]?.id}`);
    next = e.hasta + 1;
  }
  if (next !== phrases.length) problemas.push(`faltan frases al final: desde ${phrases[next]?.id ?? "?"}`);
  return { ctx, escenas, problemas };
}

export function armarPlan(
  raw: Raw,
  v: ReturnType<typeof verificarPlan>,
  phrases: Phrase[],
  components: Record<string, DrawingComponent>,
  navCtx: { channel: string | null; topic: string | null; locale: string | null },
  models: { director: string; designer: string },
  usage: Usage
): { plan: AnimatedPlan; seguras: string[] } {
  const videoEnd = phrases[phrases.length - 1]!.end + TAIL_SECONDS;
  const inicio = (i: number) => (i === 0 ? 0 : Math.max(0, phrases[i]!.start - 0.15));
  const disponible = (id: unknown) => !str(id) || !!BIBLIOTECA_BASE[str(id)!] || !!components[str(id)!];
  const seguras: string[] = [];
  const scenes: AnimatedScene[] = v.escenas.map((e, i) => {
    const rec = (e.scene as unknown as { recurso?: { tipo: string; contenido: Raw } }).recurso;
    const faltaDibujo = rec?.tipo === "esquema_capas" && ["principal", "secundario", "destino"].some((l) => !disponible(rec.contenido[l]));
    const roto = e.problemas.some((p) => /invalid|desconocido|no existe|falta el objeto|sin lugar/.test(p)) || faltaDibujo;
    if (roto) seguras.push(`s${i + 1}`);
    const next = v.escenas[i + 1];
    return { id: `s${i + 1}`, start: inicio(e.desde), end: next ? inicio(next.desde) : videoEnd, ...(roto ? escenaSegura(v.ctx, e.desde) : e.scene) } as AnimatedScene;
  });

  // Capa fija: capitulos -> linea de capitulo; subtitulos palabra por palabra.
  const capitulos = asList(raw.capitulos ?? [], "capitulos").map((c) => c as Raw);
  const marks: PlacedOverlay[] = capitulos.flatMap((c) => {
    const i = v.ctx.index.get(String(c.frase ?? c.desde ?? ""));
    return i === undefined || !str(c.titulo) ? [] : [{ spec: { type: "title_card", text: str(c.titulo)!, source: "script" }, start: phrases[i]!.start, end: phrases[i]!.start + 1 } as PlacedOverlay];
  });
  const nav = placeNavHeaders(marks, videoEnd, navCtx);
  const captions: { start: number; end: number; words: { text: string; start: number; end: number }[] }[] = [];
  for (const p of phrases) {
    for (let i = 0; i < p.words.length; i += CAPTION_WORDS) captions.push({ start: p.words[i]!.start, end: 0, words: p.words.slice(i, i + CAPTION_WORDS) });
  }
  captions.forEach((c, i) => (c.end = captions[i + 1]?.start ?? videoEnd));

  return {
    seguras,
    plan: {
      scenes,
      components,
      nav,
      captions,
      durationSeconds: videoEnd,
      storyboard: {
        chapters: marks.map((m) => ({ title: m.spec.text, start: m.start })),
        scenes: v.escenas.map((e, i) => ({ from: phrases[e.desde]!.id, to: phrases[e.hasta]!.id, intent: (e.scene as unknown as { recurso?: { tipo: string } }).recurso?.tipo ?? "grafico", idea: seguras.includes(`s${i + 1}`) ? "recurso seguro" : "", dropped: e.problemas })),
        models,
        usage,
      },
    },
  };
}

// ---------- Orquestador ----------

export async function directDocumental(input: {
  phrases: Phrase[];
  videoTopic?: string;
  nav: { channel: string | null; topic: string | null; locale: string | null };
}): Promise<AnimatedPlan | null> {
  const { phrases } = input;
  if (phrases.length === 0) return null;
  const provider = await getActiveProvider("anthropic");
  if (!provider?.api_key) return null;
  const config = (provider.configuration ?? {}) as Record<string, unknown>;
  if (config.documental === false) return null;
  const models = {
    director: str(config.documental_director_model) ?? DEFAULTS.director,
    artist: str(config.documental_artist_model) ?? DEFAULTS.artist,
    reviewer: str(config.documental_reviewer_model) ?? DEFAULTS.reviewer,
  };
  const client = new Anthropic({ apiKey: provider.api_key, timeout: 600_000 });
  const usage: Usage = {};
  const types = plannableTypes().filter((t) => GRAFICOS.includes(t));
  const script = phrases.map((p) => `[${p.id} · ${clock(p.start)}] ${p.text}`).join("\n");
  const user = `${input.videoTopic ? `Tema del video: ${input.videoTopic}\n` : ""}Duracion: ${clock(phrases[phrases.length - 1]!.end)}\n\nGUION EN FRASES:\n${script}`;

  // 1. Director (+ a lo sumo 1 correccion, armada por el orquestador).
  let raw = await callTool(client, models.director, DIRECTOR_MAX_TOKENS, directorSystem(types), directorTool, user, usage);
  const verificar = (r: Raw | undefined) => verificarPlan(r, phrases);
  let v = verificar(raw);
  if (v.problemas.length > 0) {
    console.log(`[documental] correccion del director (${v.problemas.length} problemas)`);
    const corregido = await callTool(
      client,
      models.director,
      DIRECTOR_MAX_TOKENS,
      directorSystem(types),
      directorTool,
      `${user}\n\nTU PLAN ANTERIOR:\n${JSON.stringify(raw)}\n\nPROBLEMAS QUE HAY QUE CORREGIR (entrega el plan completo otra vez):\n${v.problemas.join("\n")}`,
      usage
    );
    if (corregido) {
      const v2 = verificar(corregido);
      if (v2.problemas.length <= v.problemas.length) {
        raw = corregido;
        v = v2;
      }
    }
  }
  if (!raw || v.escenas.length === 0) return null;

  // 2. Dibujantes: solo objetos que faltan, en paralelo, pedido armado aca.
  const pedidos = asList(raw.objetos_nuevos ?? [], "objetos_nuevos")
    .map((o) => o as Raw)
    .filter((o) => str(o.id) && !BIBLIOTECA_BASE[str(o.id)!]);
  const components: Record<string, DrawingComponent> = {};
  await mapWithConcurrency(pedidos, ARTISTS, async (o) => {
    const pedido = `Objeto: ${str(o.id)} · ${str(o.nombre) ?? ""}\nComo se ve: ${str(o.descripcion) ?? ""}\nPartes: ${asList(o.partes ?? [], "partes").map(String).join(", ") || "ninguna"}`;
    for (let intento = 0; intento < 2; intento++) {
      try {
        const out = await callTool(client, models.artist, ARTIST_MAX_TOKENS, artistSystem, artistTool, intento === 0 ? pedido : `${pedido}\n\nEl anterior fue rechazado, corregilo.`, usage);
        const comp = out ? validateComponent({ ...out, id: str(o.id) }) : "sin respuesta";
        if (typeof comp !== "string") {
          components[comp.id] = comp;
          return;
        }
        console.warn(`[documental] dibujo ${String(o.id)} rechazado: ${comp}`);
      } catch (err) {
        console.warn(`[documental] dibujante ${String(o.id)}:`, (err as Error).message);
      }
    }
  });

  // 3. Armado: escenas invalidas o con objetos sin dibujo -> recurso seguro.
  const { plan, seguras } = armarPlan(raw, v, phrases, components, input.nav, { director: models.director, designer: models.artist }, usage);
  const { scenes, nav, captions, durationSeconds: videoEnd } = plan;
  const words = phrases.flatMap((p) => p.words);

  // 4. Revisor: 1 pasada con capturas reales; lo rechazado -> recurso seguro.
  if (motionCatalog() && config.documental_review !== false) {
    const dir = await makeWorkDir("skaler-doc-review-");
    try {
      const pedidosStills = scenes.map((s) => ({ id: s.id, seconds: s.start + (s.end - s.start) * 0.75 }));
      await renderAnimatedStills({ scenes, components, nav, captions, durationSeconds: videoEnd, locale: input.nav.locale ?? "es-AR" }, pedidosStills, dir);
      const lotes: (typeof scenes)[] = [];
      for (let i = 0; i < scenes.length; i += REVIEW_BATCH) lotes.push(scenes.slice(i, i + REVIEW_BATCH));
      const rechazadas = new Set<string>();
      await mapWithConcurrency(lotes, 3, async (lote) => {
        const content: Anthropic.ContentBlockParam[] = lote.flatMap((s) => [
          { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: readFileSync(path.join(dir, `${s.id}.jpg`)).toString("base64") } },
          { type: "text" as const, text: `Escena ${s.id}. La voz dice: "${phrases.filter((p) => p.start < s.end && p.end > s.start).map((p) => p.text).join(" ")}"` },
        ]);
        const msg = await client.messages.create({
          model: models.reviewer,
          max_tokens: 2000,
          system: `Sos el REVISOR de un video documental animado. Rechaza SOLO escenas rotas: algo cortado o encimado que no se entiende, pantalla vacia, o una imagen que contradice a la voz. No rechaces por gusto. Responde solo JSON: {"rechazadas": [{"escena": "s3", "motivo": "..."}]}`,
          messages: [{ role: "user", content }],
        });
        const spent = (usage[models.reviewer] ??= { input: 0, output: 0 });
        spent.input += msg.usage.input_tokens;
        spent.output += msg.usage.output_tokens;
        const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
        try {
          const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { rechazadas?: { escena: string; motivo: string }[] };
          for (const r of json.rechazadas ?? []) rechazadas.add(r.escena);
        } catch {
          /* respuesta ilegible: no se rechaza nada */
        }
      });
      for (const s of scenes) {
        if (!rechazadas.has(s.id)) continue;
        const i = Number(s.id.slice(1)) - 1;
        Object.assign(s, escenaSegura(v.ctx, v.escenas[i]!.desde));
        delete (s as { recurso?: unknown }).recurso;
        seguras.push(s.id);
      }
      console.log(`[documental] revisor: ${rechazadas.size} de ${scenes.length} escenas a recurso seguro`);
    } catch (err) {
      console.warn("[documental] la revision visual fallo, sigo sin ella:", (err as Error).message);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  console.log(`[documental] ${scenes.length} escenas · ${Object.keys(components).length} dibujos nuevos · ${seguras.length} seguras · ${words.length} palabras`);
  return plan;
}
