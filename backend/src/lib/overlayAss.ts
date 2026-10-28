import type { OverlaySpec } from "../types/shared/typeShared.js";

// Metricas animadas estilo documental ("¿Que pasaria si...?"): contadores
// que suben hasta el numero, barras comparativas que crecen, lower thirds,
// title cards. Todo se dibuja como un archivo ASS (libass, el mismo motor
// que ya usa el filtro `subtitles` del render) -- sin canvas, sin
// navegador, sin dependencias nuevas: ffmpeg lo quema en la pasada final.
//
// El ASS se escribe siempre en un lienzo virtual de 1920x1080 (PlayRes) y
// libass lo escala solo a la resolucion real del render (720p/1080p).

const W = 1920;
const H = 1080;

const WHITE = "&HFFFFFF&";
const BLACK = "&H000000&";

// Tema visual por genero de video: mismo set de plantillas, distinta
// paleta. "documental" es el look de canales tipo "¿Que pasaria si...?"
// (ambar sobre oscuro). El acento se puede pisar por env.
export type OverlayTheme = "documental" | "ciencia" | "finanzas" | "historia" | "crimen" | "minimal";

export const OVERLAY_THEMES: OverlayTheme[] = ["documental", "ciencia", "finanzas", "historia", "crimen", "minimal"];

interface ThemeColors {
  accent: string;
  panel: string;
  muted: string;
  font: string;
}

const THEME_HEX: Record<OverlayTheme, { accent: string; panel: string; muted: string }> = {
  documental: { accent: "#FFC83D", panel: "#101010", muted: "#C8C8C8" },
  ciencia: { accent: "#4FD1FF", panel: "#06121C", muted: "#BFD3E0" },
  finanzas: { accent: "#2EE59D", panel: "#0B1410", muted: "#C4D6CC" },
  historia: { accent: "#E8C27A", panel: "#1A140C", muted: "#D8CBB4" },
  crimen: { accent: "#FF3B3B", panel: "#120808", muted: "#D0C4C4" },
  minimal: { accent: "#FFFFFF", panel: "#000000", muted: "#BBBBBB" },
};

function resolveTheme(theme: string | null | undefined): ThemeColors {
  const hex = THEME_HEX[(OVERLAY_THEMES as string[]).includes(theme ?? "") ? (theme as OverlayTheme) : "documental"];
  return {
    accent: hexToAss(process.env.OVERLAY_ACCENT_COLOR ?? hex.accent),
    panel: hexToAss(hex.panel),
    muted: hexToAss(hex.muted),
    font: process.env.OVERLAY_FONT ?? "Arial",
  };
}

// Se asigna en buildOverlayAss antes de correr las plantillas (el render
// es un unico archivo ASS por video, sincrono, sin concurrencia).
let theme: ThemeColors = resolveTheme("documental");

// Cada paso del contador es un evento ASS distinto (ASS no interpola
// numeros); 20 por segundo alcanza para que se vea fluido a 30fps.
const COUNTER_STEP_SECONDS = 0.05;
const COUNTER_DURATION_SECONDS = 1.3;

const DEFAULT_DURATIONS: Partial<Record<OverlaySpec["type"], number>> = {
  big_number: 4.5,
  data_viz_single: 6,
  versus: 5.5,
  timeline: 7,
  location: 4,
  lower_third: 4,
  title_card: 3.5,
  rank_reveal: 4,
  badge: 4,
  cta: 4,
};

export interface OverlaySceneTiming {
  start_seconds?: number;
  end_seconds?: number;
  overlay?: OverlaySpec | null;
  overlays?: OverlaySpec[] | null;
}

interface PlacedOverlay {
  spec: OverlaySpec;
  start: number;
  end: number;
}

function hexToAss(hex: string): string {
  const clean = hex.replace("#", "").padEnd(6, "0").slice(0, 6);
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  return `&H${b}${g}${r}&`.toUpperCase();
}

function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

// Llaves y barras invertidas son sintaxis de override en ASS.
function escapeText(text: string): string {
  return text.replace(/\\/g, "/").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\r?\n/g, " ");
}

function dialogue(layer: number, start: number, end: number, text: string): string {
  return `Dialogue: ${layer},${assTime(start)},${assTime(end)},Default,,0,0,0,,${text}`;
}

function rect(w: number, h: number): string {
  return `m 0 0 l ${w} 0 l ${w} ${h} l 0 ${h}`;
}

function roundedRect(w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2);
  return (
    `m ${rr} 0 l ${w - rr} 0 b ${w} 0 ${w} 0 ${w} ${rr} l ${w} ${h - rr} b ${w} ${h} ${w} ${h} ${w - rr} ${h} ` +
    `l ${rr} ${h} b 0 ${h} 0 ${h} 0 ${h - rr} l 0 ${rr} b 0 0 0 0 ${rr} 0`
  );
}

// Ancho aproximado de un texto en px (fuente sans bold) -- libass no
// expone metricas, y para posicionar barras/paneles alcanza con esto.
function textWidth(text: string, fontSize: number): number {
  return Math.round(text.length * fontSize * 0.6);
}

// Achica la fuente hasta que el texto entre en `maxWidth` (textos del
// guion de largo variable: "40" y "más de 1,000 km por hora" usan la misma
// plantilla).
function fitSize(text: string, maxWidth: number, maxSize: number, minSize = 36): number {
  const size = Math.floor(maxWidth / Math.max(1, text.length * 0.6));
  return Math.max(minSize, Math.min(maxSize, size));
}

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}

// --- numeros -----------------------------------------------------------

export interface ParsedNumber {
  value: number;
  decimals: number;
  decimalSep: string;
  thousandsSep: string;
  prefix: string;
  suffix: string;
}

// Lee el primer numero de un texto literal del guion respetando como esta
// escrito ("1.500 km/h", "3,8 cm", "40%", "US$ 2,5 millones"), para que el
// contador muestre el mismo formato que dice la narracion.
export function parseLiteralNumber(text: string): ParsedNumber | null {
  const match = /\d[\d.,  ]*\d|\d/.exec(text);
  if (!match) return null;
  const raw = match[0].replace(/[  ]/g, "");
  let decimalSep = "";
  let thousandsSep = "";

  const hasDot = raw.includes(".");
  const hasComma = raw.includes(",");
  if (hasDot && hasComma) {
    decimalSep = raw.lastIndexOf(".") > raw.lastIndexOf(",") ? "." : ",";
    thousandsSep = decimalSep === "." ? "," : ".";
  } else if (hasDot || hasComma) {
    const sep = hasDot ? "." : ",";
    const parts = raw.split(sep);
    const groupedLikeThousands = parts.length > 2 || (parts[1]!.length === 3 && parts[0]!.length <= 3);
    if (groupedLikeThousands) thousandsSep = sep;
    else decimalSep = sep;
  }

  let normalized = raw;
  if (thousandsSep) normalized = normalized.split(thousandsSep).join("");
  if (decimalSep) normalized = normalized.replace(decimalSep, ".");
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;

  const decimals = decimalSep ? (normalized.split(".")[1]?.length ?? 0) : 0;
  return {
    value,
    decimals,
    decimalSep: decimalSep || ",",
    thousandsSep,
    prefix: text.slice(0, match.index),
    suffix: text.slice(match.index + match[0].length),
  };
}

function formatNumber(value: number, fmt: ParsedNumber): string {
  const fixed = value.toFixed(fmt.decimals);
  const [intPart, decPart] = fixed.split(".");
  const grouped = fmt.thousandsSep ? intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, fmt.thousandsSep) : intPart!;
  return decPart ? `${grouped}${fmt.decimalSep}${decPart}` : grouped;
}

// Eventos de un contador que sube de 0 al valor final, todos en la misma
// posicion; el ultimo queda fijo hasta `end` con un "pop" de escala.
function counterEvents(
  layer: number,
  start: number,
  end: number,
  text: string,
  style: string,
  options: { countDuration?: number; finalTags?: string } = {}
): string[] {
  const parsed = parseLiteralNumber(text);
  const fadeOut = "\\fad(0,300)";
  if (!parsed || parsed.value === 0) {
    return [dialogue(layer, start, end, `{${style}\\fad(250,300)}${escapeText(text)}`)];
  }

  const countDuration = Math.min(options.countDuration ?? COUNTER_DURATION_SECONDS, Math.max(0.3, (end - start) * 0.4));
  const steps = Math.max(1, Math.round(countDuration / COUNTER_STEP_SECONDS));
  const events: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t0 = start + i * COUNTER_STEP_SECONDS;
    const t1 = t0 + COUNTER_STEP_SECONDS;
    const progress = easeOutCubic(i / steps);
    const current = parsed.value * progress;
    // Fade-in "a mano" (\fad se reiniciaria en cada evento).
    const alpha = Math.round(255 * Math.max(0, 1 - (i * COUNTER_STEP_SECONDS) / 0.25));
    const alphaTag = `\\alpha&H${alpha.toString(16).padStart(2, "0").toUpperCase()}&`;
    const shown = `${parsed.prefix}${formatNumber(current, parsed)}${parsed.suffix}`;
    events.push(dialogue(layer, t0, t1, `{${style}${alphaTag}}${escapeText(shown)}`));
  }
  const finalStart = start + steps * COUNTER_STEP_SECONDS;
  const pop = "\\t(0,120,\\fscx108\\fscy108)\\t(120,280,\\fscx100\\fscy100)";
  events.push(
    dialogue(layer, finalStart, end, `{${style}${options.finalTags ?? pop}${fadeOut}}${escapeText(text.trim())}`)
  );
  return events;
}

// Sombra suave para que el texto se lea sobre cualquier stock.
const SOFT_SHADOW = `\\bord0\\shad4\\4c${BLACK}\\4a&H60&`;

// Oscurece una zona con un rectangulo muy difuminado (ASS no tiene
// degradados) -- mejora la legibilidad sin tapar el video.
function scrim(layer: number, start: number, end: number, x: number, y: number, w: number, h: number, alpha = "70"): string {
  return dialogue(
    layer,
    start,
    end,
    `{\\an7\\pos(${x},${y})\\p1\\bord0\\shad0\\blur60\\1c${BLACK}\\1a&H${alpha}&\\fad(400,400)}${rect(w, h)}{\\p0}`
  );
}

// --- plantillas -----------------------------------------------------------

function bigNumber(o: PlacedOverlay): string[] {
  const { start, end, spec } = o;
  const x = 140;
  const numberSize = fitSize(spec.text, W - 2 * x, 150, 80);
  const numberY = 470;
  const events: string[] = [scrim(0, start, end, -300, 180, 1500, 620)];

  events.push(
    ...counterEvents(2, start, end, spec.text, `\\an4\\pos(${x},${numberY})\\fn${theme.font}\\b1\\fs${numberSize}\\1c${theme.accent}${SOFT_SHADOW}`)
  );

  const barWidth = Math.min(1100, Math.max(260, textWidth(spec.text, numberSize)));
  events.push(
    dialogue(
      1,
      start + 0.15,
      end,
      `{\\an7\\pos(${x},${numberY + 85})\\p1\\bord0\\shad0\\1c${theme.accent}\\fscx0\\t(0,600,0.4,\\fscx100)\\fad(0,300)}${rect(barWidth, 8)}{\\p0}`
    )
  );

  if (spec.label) {
    events.push(
      dialogue(
        2,
        start + 0.35,
        end,
        `{\\an7\\move(${x - 30},${numberY + 112},${x},${numberY + 112},0,400)\\fn${theme.font}\\b1\\fs52\\fsp2\\1c${WHITE}${SOFT_SHADOW}\\fad(300,300)}${escapeText(spec.label.toUpperCase())}`
      )
    );
  }
  return events;
}

function dataViz(o: PlacedOverlay): string[] {
  const { start, end, spec } = o;
  const items = (spec.items ?? [])
    .map((item) => ({ ...item, parsed: parseLiteralNumber(item.text) }))
    .filter((item) => item.parsed && item.parsed.value > 0)
    .slice(0, 5);
  if (items.length === 0) return bigNumber(o);

  const maxValue = Math.max(...items.map((i) => i.parsed!.value));
  const rowH = 110;
  const panelW = 1400;
  const titleH = spec.label || spec.text ? 110 : 30;
  const panelH = titleH + items.length * rowH + 40;
  const panelX = (W - panelW) / 2;
  const panelY = Math.max(80, (H - panelH) / 2 - 60);
  const labelX = panelX + 60;
  const barX = panelX + 520;
  const barMax = panelW - 520 - 260;

  const events: string[] = [
    dialogue(
      0,
      start,
      end,
      `{\\an7\\pos(${panelX},${panelY})\\p1\\bord0\\shad0\\1c${theme.panel}\\1a&H40&\\fad(300,300)}${roundedRect(panelW, panelH, 24)}{\\p0}`
    ),
  ];

  const title = spec.label ?? spec.text;
  if (title) {
    events.push(
      dialogue(
        2,
        start + 0.1,
        end,
        `{\\an7\\pos(${labelX},${panelY + 34})\\fn${theme.font}\\b1\\fs54\\1c${WHITE}\\bord0\\shad0\\fad(300,300)}${escapeText(title.toUpperCase())}`
      )
    );
  }

  const maxIndex = items.findIndex((i) => i.parsed!.value === maxValue);
  items.forEach((item, idx) => {
    const rowY = panelY + titleH + idx * rowH + 20;
    const rowStart = start + 0.35 + idx * 0.18;
    const barLen = Math.max(12, Math.round((item.parsed!.value / maxValue) * barMax));
    const color = idx === maxIndex ? theme.accent : WHITE;
    const alpha = idx === maxIndex ? "&H00&" : "&H50&";

    events.push(
      dialogue(
        2,
        rowStart,
        end,
        `{\\an4\\pos(${labelX},${rowY + 32})\\fn${theme.font}\\b1\\fs44\\1c${theme.muted}\\bord0\\shad0\\fad(250,300)}${escapeText(item.label)}`
      ),
      dialogue(
        1,
        rowStart,
        end,
        `{\\an7\\pos(${barX},${rowY + 8})\\p1\\bord0\\shad0\\1c${color}\\1a${alpha}\\fscx0\\t(0,900,0.35,\\fscx100)\\fad(0,300)}${roundedRect(barLen, 48, 8)}{\\p0}`
      ),
      ...counterEvents(
        2,
        rowStart,
        end,
        item.text,
        `\\an4\\pos(${barX + barLen + 24},${rowY + 32})\\fn${theme.font}\\b1\\fs46\\1c${color}\\bord0\\shad0`,
        { countDuration: 0.9, finalTags: "" }
      )
    );
  });
  return events;
}

function lowerThird(o: PlacedOverlay): string[] {
  const { start, end, spec } = o;
  const x = 120;
  const y = 760;
  const textSize = fitSize(spec.text, 1400, 60, 40);
  const panelW = Math.min(1500, textWidth(spec.text, textSize) + 90);
  const events: string[] = [
    dialogue(1, start, end, `{\\an7\\pos(${x},${y})\\p1\\bord0\\shad0\\1c${theme.accent}\\fscy0\\t(0,250,\\fscy100)\\fad(0,300)}${rect(10, 110)}{\\p0}`),
    dialogue(
      0,
      start + 0.1,
      end,
      `{\\an7\\pos(${x + 10},${y})\\p1\\bord0\\shad0\\1c${theme.panel}\\1a&H38&\\fscx0\\t(0,450,0.4,\\fscx100)\\fad(0,300)}${rect(panelW, 110)}{\\p0}`
    ),
  ];
  const textY = spec.label ? y + 70 : y + 55;
  if (spec.label) {
    events.push(
      dialogue(2, start + 0.3, end, `{\\an4\\pos(${x + 45},${y + 28})\\fn${theme.font}\\b1\\fs30\\fsp3\\1c${theme.accent}\\bord0\\shad0\\fad(250,300)}${escapeText(spec.label.toUpperCase())}`)
    );
  }
  events.push(
    dialogue(
      2,
      start + 0.35,
      end,
      `{\\an4\\move(${x + 15},${textY},${x + 45},${textY},0,400)\\fn${theme.font}\\b1\\fs${textSize}\\1c${WHITE}\\bord0\\shad0\\fad(300,300)}${escapeText(spec.text)}`
    )
  );
  return events;
}

function titleCard(o: PlacedOverlay): string[] {
  const { start, end, spec } = o;
  const cy = H / 2 - 40;
  const size = fitSize(spec.text, W - 300, 110, 56);
  const lineW = Math.min(1500, textWidth(spec.text, size));
  const events: string[] = [
    dialogue(0, start, end, `{\\an7\\pos(0,0)\\p1\\bord0\\shad0\\1c${BLACK}\\1a&H70&\\fad(400,400)}${rect(W, H)}{\\p0}`),
    dialogue(
      2,
      start + 0.1,
      end,
      `{\\an5\\pos(${W / 2},${cy})\\fn${theme.font}\\b1\\fs${size}\\fsp30\\t(0,900,0.4,\\fsp6)\\1c${WHITE}${SOFT_SHADOW}\\fad(500,400)}${escapeText(spec.text.toUpperCase())}`
    ),
    dialogue(
      1,
      start + 0.3,
      end,
      `{\\an8\\pos(${W / 2},${cy + 80})\\p1\\bord0\\shad0\\1c${theme.accent}\\fscx0\\t(0,700,0.4,\\fscx100)\\fad(0,400)}${rect(lineW, 6)}{\\p0}`
    ),
  ];
  if (spec.label) {
    events.push(
      dialogue(2, start + 0.6, end, `{\\an8\\pos(${W / 2},${cy + 110})\\fn${theme.font}\\fs46\\fsp4\\1c${theme.muted}\\bord0\\shad0\\fad(400,400)}${escapeText(spec.label.toUpperCase())}`)
    );
  }
  return events;
}

function rankReveal(o: PlacedOverlay): string[] {
  const { start, end, spec } = o;
  const parsed = parseLiteralNumber(spec.text);
  const rank = parsed ? `#${Math.round(parsed.value)}` : "#";
  const x = 140;
  const y = 470;
  const events: string[] = [
    scrim(0, start, end, -300, 200, 1500, 560),
    dialogue(
      2,
      start,
      end,
      `{\\an4\\pos(${x},${y})\\fn${theme.font}\\b1\\fs220\\1c${theme.accent}${SOFT_SHADOW}\\fscx140\\fscy140\\t(0,350,0.5,\\fscx100\\fscy100)\\fad(200,300)}${rank}`
    ),
  ];
  const caption = spec.label ?? spec.text;
  events.push(
    dialogue(
      2,
      start + 0.35,
      end,
      `{\\an4\\move(${x + textWidth(rank, 220) - 20},${y},${x + textWidth(rank, 220) + 20},${y},0,400)\\fn${theme.font}\\b1\\fs64\\1c${WHITE}${SOFT_SHADOW}\\fad(300,300)}${escapeText(caption)}`
    )
  );
  return events;
}

function badge(o: PlacedOverlay): string[] {
  const { start, end, spec } = o;
  const size = 40;
  const w = textWidth(spec.text, size) + 60;
  const x = 100;
  const y = 90;
  return [
    dialogue(1, start, end, `{\\an7\\move(${x},${y - 40},${x},${y},0,350)\\p1\\bord0\\shad0\\1c${theme.accent}\\fad(250,300)}${roundedRect(w, 70, 35)}{\\p0}`),
    dialogue(
      2,
      start,
      end,
      `{\\an5\\move(${x + w / 2},${y - 5},${x + w / 2},${y + 35},0,350)\\fn${theme.font}\\b1\\fs${size}\\1c${BLACK}\\bord0\\shad0\\fad(250,300)}${escapeText(spec.text.toUpperCase())}`
    ),
  ];
}

function cta(o: PlacedOverlay): string[] {
  const { start, end, spec } = o;
  const size = 50;
  const w = textWidth(spec.text, size) + 100;
  const x = (W - w) / 2;
  const y = 860;
  return [
    dialogue(
      1,
      start,
      end,
      `{\\an7\\pos(${x},${y})\\p1\\bord0\\shad0\\1c${theme.accent}\\fscx80\\fscy80\\t(0,300,\\fscx100\\fscy100)\\fad(250,300)}${roundedRect(w, 90, 45)}{\\p0}`
    ),
    dialogue(2, start + 0.1, end, `{\\an5\\pos(${W / 2},${y + 45})\\fn${theme.font}\\b1\\fs${size}\\1c${BLACK}\\bord0\\shad0\\fad(250,300)}${escapeText(spec.text)}`),
  ];
}

// Pantalla dividida "X vs Y" (huracan 300 km/h vs viento 1.000 km/h, "6
// meses de luz / 6 meses de oscuridad"): dos contadores enfrentados.
function versus(o: PlacedOverlay): string[] {
  const { start, end, spec } = o;
  const items = (spec.items ?? []).slice(0, 2);
  if (items.length < 2) return bigNumber(o);

  const cy = H / 2;
  const events: string[] = [
    dialogue(0, start, end, `{\\an7\\pos(0,0)\\p1\\bord0\\shad0\\1c${BLACK}\\1a&H78&\\fad(300,300)}${rect(W, H)}{\\p0}`),
    dialogue(1, start + 0.1, end, `{\\an8\\pos(${W / 2},${cy - 230})\\p1\\bord0\\shad0\\1c${theme.accent}\\fscy0\\t(0,500,0.5,\\fscy100)\\fad(0,300)}${rect(4, 460)}{\\p0}`),
    dialogue(2, start + 0.4, end, `{\\an5\\pos(${W / 2},${cy})\\fn${theme.font}\\b1\\fs50\\1c${BLACK}\\3c${theme.accent}\\bord26\\shad0\\fscx0\\fscy0\\t(0,250,\\fscx100\\fscy100)\\fad(0,300)}VS`),
  ];
  if (spec.label) {
    events.push(
      dialogue(2, start + 0.1, end, `{\\an8\\pos(${W / 2},${cy - 330})\\fn${theme.font}\\b1\\fs52\\fsp3\\1c${WHITE}${SOFT_SHADOW}\\fad(300,300)}${escapeText(spec.label.toUpperCase())}`)
    );
  }

  items.forEach((item, idx) => {
    const x = idx === 0 ? W / 4 : (W * 3) / 4;
    const itemStart = start + 0.3 + idx * 0.35;
    const color = idx === 1 ? theme.accent : WHITE;
    events.push(
      ...counterEvents(2, itemStart, end, item.text, `\\an5\\pos(${x},${cy - 20})\\fn${theme.font}\\b1\\fs${fitSize(item.text, W / 2 - 200, 120, 48)}\\1c${color}${SOFT_SHADOW}`),
      dialogue(
        2,
        itemStart + 0.2,
        end,
        `{\\an8\\move(${x},${cy + 90},${x},${cy + 70},0,350)\\fn${theme.font}\\b1\\fs46\\fsp2\\1c${theme.muted}${SOFT_SHADOW}\\fad(300,300)}${escapeText(item.label.toUpperCase())}`
      )
    );
  });
  return events;
}

// Linea de tiempo con hitos que aparecen en orden ("hace 4.600 millones de
// años", "un dia dura 30 horas... 40... 100"). Cada hito: punto + valor
// arriba + etiqueta abajo.
function timeline(o: PlacedOverlay): string[] {
  const { start, end, spec } = o;
  const items = (spec.items ?? []).slice(0, 6);
  if (items.length < 2) return lowerThird(o);

  const y = 640;
  const x0 = 220;
  const x1 = W - 220;
  const lineW = x1 - x0;
  const lineDrawMs = 800;
  const events: string[] = [
    scrim(0, start, end, -200, 380, W + 400, 520, "60"),
    dialogue(1, start, end, `{\\an4\\pos(${x0},${y})\\p1\\bord0\\shad0\\1c${WHITE}\\1a&H60&\\fscx0\\t(0,${lineDrawMs},0.5,\\fscx100)\\fad(0,300)}${rect(lineW, 4)}{\\p0}`),
  ];
  if (spec.label) {
    events.push(
      dialogue(2, start, end, `{\\an7\\pos(${x0},${y - 230})\\fn${theme.font}\\b1\\fs50\\fsp3\\1c${WHITE}${SOFT_SHADOW}\\fad(300,300)}${escapeText(spec.label.toUpperCase())}`)
    );
  }

  const usable = Math.max(1.5, end - start - lineDrawMs / 1000 - 1);
  const stepSeconds = Math.min(1.2, usable / items.length);
  items.forEach((item, idx) => {
    const x = items.length === 1 ? x0 : x0 + (lineW * idx) / (items.length - 1);
    const t = start + lineDrawMs / 1000 * 0.6 + idx * stepSeconds;
    const isLast = idx === items.length - 1;
    const color = isLast ? theme.accent : WHITE;
    events.push(
      dialogue(2, t, end, `{\\an5\\pos(${x},${y + 2})\\p1\\bord0\\shad0\\1c${color}\\fscx0\\fscy0\\t(0,200,\\fscx130\\fscy130)\\t(200,350,\\fscx100\\fscy100)\\fad(0,300)}${roundedRect(26, 26, 13)}{\\p0}`),
      dialogue(
        2,
        t + 0.1,
        end,
        `{\\an2\\move(${x},${y - 20},${x},${y - 40},0,300)\\fn${theme.font}\\b1\\fs${isLast ? 54 : 46}\\1c${color}${SOFT_SHADOW}\\fad(250,300)}${escapeText(item.text)}`
      ),
      dialogue(2, t + 0.2, end, `{\\an8\\pos(${x},${y + 40})\\fn${theme.font}\\fs36\\1c${theme.muted}${SOFT_SHADOW}\\fad(250,300)}${escapeText(item.label)}`)
    );
  });
  return events;
}

// Pin de ubicacion ("Quito", "Ciudad de México", "Antártida") arriba a la
// izquierda, con un dato opcional debajo ("a casi 3,000 m").
function location(o: PlacedOverlay): string[] {
  const { start, end, spec } = o;
  const x = 110;
  const y = 110;
  const pin = "m 30 0 b 13 0 0 13 0 30 b 0 52 30 80 30 80 b 30 80 60 52 60 30 b 60 13 47 0 30 0 m 30 18 b 23 18 18 23 18 30 b 18 37 23 42 30 42 b 37 42 42 37 42 30 b 42 23 37 18 30 18";
  const events: string[] = [
    scrim(0, start, end, -200, -100, 1100, 400, "78"),
    dialogue(
      2,
      start,
      end,
      `{\\an7\\move(${x},${y - 60},${x},${y - 10},0,350)\\p1\\bord0\\shad0\\1c${theme.accent}\\fad(200,300)}${pin}{\\p0}`
    ),
    dialogue(
      2,
      start + 0.2,
      end,
      `{\\an4\\move(${x + 60},${y + 30},${x + 90},${y + 30},0,400)\\fn${theme.font}\\b1\\fs68\\1c${WHITE}${SOFT_SHADOW}\\fad(300,300)}${escapeText(spec.text.toUpperCase())}`
    ),
  ];
  if (spec.label) {
    events.push(
      dialogue(2, start + 0.45, end, `{\\an4\\pos(${x + 92},${y + 92})\\fn${theme.font}\\fs42\\1c${theme.accent}${SOFT_SHADOW}\\fad(300,300)}${escapeText(spec.label)}`)
    );
  }
  return events;
}

const TEMPLATES: Partial<Record<OverlaySpec["type"], (o: PlacedOverlay) => string[]>> = {
  big_number: bigNumber,
  data_viz_single: dataViz,
  lower_third: lowerThird,
  title_card: titleCard,
  rank_reveal: rankReveal,
  badge,
  cta,
  versus,
  timeline,
  location,
};

// --- timing ---------------------------------------------------------------

function sceneOverlays(scene: OverlaySceneTiming): OverlaySpec[] {
  const list = scene.overlays?.length ? scene.overlays : scene.overlay ? [scene.overlay] : [];
  return list.filter((o) => o && o.type !== "ninguno" && o.text?.trim());
}

// Ubica cada overlay dentro de su escena: arranca un poco antes de que la
// narracion diga el texto (anchor = posicion relativa del texto dentro de
// la escena, ver plan_overlays) y nunca se pisa con el siguiente.
export function placeOverlays(scenes: OverlaySceneTiming[]): PlacedOverlay[] {
  const placed: PlacedOverlay[] = [];
  for (const scene of scenes) {
    const sceneStart = scene.start_seconds;
    const sceneEnd = scene.end_seconds;
    if (sceneStart === undefined || sceneEnd === undefined || sceneEnd <= sceneStart) continue;
    const sceneDuration = sceneEnd - sceneStart;

    const specs = sceneOverlays(scene)
      .map((spec) => {
        const anchor = Math.min(1, Math.max(0, spec.anchor ?? 0));
        return { spec, start: Math.max(sceneStart, sceneStart + anchor * sceneDuration - 0.3) };
      })
      .sort((a, b) => a.start - b.start);

    specs.forEach(({ spec, start }, i) => {
      const wanted = spec.duration ?? DEFAULT_DURATIONS[spec.type] ?? 4;
      const nextStart = specs[i + 1]?.start ?? Infinity;
      const end = Math.min(start + wanted, nextStart - 0.15, sceneEnd + 1.5);
      if (end - start >= 1.2) placed.push({ spec, start, end });
    });
  }

  // Entre escenas tampoco se pisan: si el anterior sigue en pantalla, se
  // corta justo antes del siguiente.
  placed.sort((a, b) => a.start - b.start);
  for (let i = 0; i < placed.length - 1; i++) {
    placed[i]!.end = Math.min(placed[i]!.end, placed[i + 1]!.start - 0.15);
  }
  return placed.filter((p) => p.end - p.start >= 1.2);
}

export function buildOverlayAss(
  scenes: OverlaySceneTiming[],
  themeName?: string | null
): { ass: string; count: number } {
  theme = resolveTheme(themeName);
  const placed = placeOverlays(scenes);
  const events = placed.flatMap((o) => TEMPLATES[o.spec.type]?.(o) ?? []);

  const ass = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${theme.font},48,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");

  return { ass, count: placed.length };
}
