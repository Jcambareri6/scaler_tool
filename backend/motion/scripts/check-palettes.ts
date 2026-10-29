// Verifica que todas las paletas de niches.json se lean sobre cualquier
// stock: contraste WCAG del texto y del acento contra el velo (scrim)
// puesto sobre el peor fondo posible (clip blanco, gris claro, gris medio).
// Los graficos usan texto grande, asi que el minimo es 3:1 (AA texto
// grande); el texto secundario pide 4.5:1. Uso:
//   npm run check-palettes            (tabla + exit 1 si alguna falla)
//   npm run check-palettes -- --json  (resultado en JSON, para el informe)
//   npm run check-palettes -- --fix   (sube el alfa del velo de cada paleta
//                                      al minimo que la hace pasar, tope
//                                      MAX_SCRIM, y reescribe niches.json)
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type RGBA = [number, number, number, number];
interface Palette { id: string; name: string; accent: string; text: string; textMuted: string; scrim: string }
interface Niche { name: string; palettes: Palette[] }

const MIN_LARGE = 3;
const MIN_MUTED = 4.5;
// Peores fondos para un texto claro: el velo es lo unico que lo salva.
const BACKGROUNDS: Record<string, RGBA> = { blanco: [255, 255, 255, 1], gris_claro: [200, 200, 200, 1], gris_medio: [128, 128, 128, 1] };

function parseColor(c: string): RGBA {
  const hex = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba?\(([^)]+)\)$/i.exec(c.trim());
  if (rgba) {
    const [r, g, b, a = "1"] = rgba[1]!.split(",").map((s) => s.trim());
    return [Number(r), Number(g), Number(b), Number(a)];
  }
  throw new Error(`color invalido: ${c}`);
}

// a encima de b (b opaco).
function over(a: RGBA, b: RGBA): RGBA {
  const al = a[3];
  return [a[0] * al + b[0] * (1 - al), a[1] * al + b[1] * (1 - al), a[2] * al + b[2] * (1 - al), 1];
}

function luminance([r, g, b]: RGBA): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrast(fg: RGBA, bg: RGBA): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// Mas oscuro que esto el velo ya tapa el video: si no alcanza, hay que
// cambiar el color de acento.
const MAX_SCRIM = 0.85;

const here = path.dirname(fileURLToPath(import.meta.url));
const nichesPath = path.join(here, "../niches.json");
const data = JSON.parse(readFileSync(nichesPath, "utf-8")) as { niches: Record<string, Niche> };

// El peor de los tres fondos para cada medida.
function measure(p: Palette, scrim: RGBA) {
  let accent = Infinity, text = Infinity, muted = Infinity;
  for (const bgColor of Object.values(BACKGROUNDS)) {
    const bg = over(scrim, bgColor);
    accent = Math.min(accent, contrast(parseColor(p.accent), bg));
    text = Math.min(text, contrast(parseColor(p.text), bg));
    muted = Math.min(muted, contrast(over(parseColor(p.textMuted), bg), bg));
  }
  return { accent, text, muted, ok: accent >= MIN_LARGE && text >= MIN_LARGE && muted >= MIN_LARGE };
}

const fix = process.argv.includes("--fix");
const results: { niche: string; palette: string; accent: number; text: number; muted: number; scrimAlpha: number; ok: boolean }[] = [];
for (const [nicheId, niche] of Object.entries(data.niches)) {
  for (const p of niche.palettes) {
    let scrim = parseColor(p.scrim);
    if (fix && !measure(p, scrim).ok) {
      // Minimo alfa (de a 0.01) que la hace pasar, sin pasar MAX_SCRIM.
      for (let a = scrim[3]; a <= MAX_SCRIM + 1e-9; a += 0.01) {
        const candidate: RGBA = [scrim[0], scrim[1], scrim[2], +a.toFixed(2)];
        if (measure(p, candidate).ok || a + 0.01 > MAX_SCRIM) {
          scrim = candidate;
          break;
        }
      }
      p.scrim = `rgba(${scrim[0]},${scrim[1]},${scrim[2]},${scrim[3]})`;
    }
    const m = measure(p, scrim);
    results.push({ niche: nicheId, palette: p.id, accent: +m.accent.toFixed(2), text: +m.text.toFixed(2), muted: +m.muted.toFixed(2), scrimAlpha: scrim[3], ok: m.ok });
  }
}
if (fix) writeFileSync(nichesPath, JSON.stringify(data, null, 2) + "\n");

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(results));
} else {
  for (const r of results) {
    const flag = r.ok ? "ok " : "MAL";
    console.log(`${flag} ${r.niche.padEnd(16)} ${r.palette.padEnd(14)} acento ${r.accent.toFixed(2).padStart(5)}  texto ${r.text.toFixed(2).padStart(5)}  secundario ${r.muted.toFixed(2).padStart(5)}${r.muted < MIN_MUTED ? " (secundario < 4.5)" : ""}`);
  }
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} paletas pasan (minimo ${MIN_LARGE}:1 sobre velo + fondo blanco/gris).`);
  if (bad.length) process.exit(1);
}
