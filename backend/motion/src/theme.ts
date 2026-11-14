// Temas por genero/canal: mismo set de componentes, distinto look. Los
// valores salen del analisis de canales de referencia (ej. "documental":
// dorado calido + serif para titulos + sans muy bold para cifras, sin cajas).
export interface Theme {
  accent: string;
  text: string;
  textMuted: string;
  // Velo oscuro detras de los graficos para que se lean sobre cualquier stock.
  scrim: string;
  fontSans: string;
  fontSerif: string;
}

export type ThemeName = "documental" | "ciencia" | "finanzas" | "historia" | "crimen" | "minimal";

const SANS = "Inter, sans-serif";
const SERIF = "'Cormorant Garamond', serif";

export const THEMES: Record<ThemeName, Theme> = {
  documental: { accent: "#E8B65A", text: "#FFFFFF", textMuted: "rgba(255,255,255,0.78)", scrim: "rgba(0,0,0,0.55)", fontSans: SANS, fontSerif: SERIF },
  ciencia: { accent: "#4FD1FF", text: "#FFFFFF", textMuted: "rgba(225,240,255,0.78)", scrim: "rgba(2,10,20,0.6)", fontSans: SANS, fontSerif: SERIF },
  finanzas: { accent: "#2EE59D", text: "#FFFFFF", textMuted: "rgba(230,255,240,0.78)", scrim: "rgba(0,12,6,0.6)", fontSans: SANS, fontSerif: SERIF },
  historia: { accent: "#D9B377", text: "#FBF5EA", textMuted: "rgba(251,245,234,0.75)", scrim: "rgba(20,12,4,0.6)", fontSans: SANS, fontSerif: SERIF },
  crimen: { accent: "#FF4040", text: "#FFFFFF", textMuted: "rgba(255,235,235,0.75)", scrim: "rgba(10,0,0,0.62)", fontSans: SANS, fontSerif: SERIF },
  minimal: { accent: "#FFFFFF", text: "#FFFFFF", textMuted: "rgba(255,255,255,0.7)", scrim: "rgba(0,0,0,0.5)", fontSans: SANS, fontSerif: SERIF },
};

// Paleta de un nicho (motion/niches.json) ya resuelta por el backend
// (lib/niches.ts: la del video, la del canal o la del nicho).
export interface PaletteTheme {
  accent: string;
  text: string;
  textMuted: string;
  scrim: string;
  // Fuente de los titulos (capitulos, frases en serif...): en nichos "sans"
  // (crimen, deportes, tecnologia) todo va en sans.
  titleFont: "serif" | "sans";
}

// Contraste minimo para TODAS las paletas: los graficos van encima de fotos y
// clips reales (cielos blancos, sepia de archivo, nieve) y con velos de
// 0,55-0,66 y texto secundario al 78% no se leian. Piso: velo al 0,80 y texto
// secundario al 0,94 (mismo color de la paleta, solo mas opaco).
const MIN_SCRIM_ALPHA = 0.8;
const MIN_MUTED_ALPHA = 0.94;

function withMinAlpha(color: string, min: number): string {
  const m = color.match(/^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i);
  if (!m) return color;
  return `rgba(${m[1]},${m[2]},${m[3]},${Math.max(Number(m[4]), min)})`;
}

function withContrast(theme: Theme): Theme {
  return { ...theme, scrim: withMinAlpha(theme.scrim, MIN_SCRIM_ALPHA), textMuted: withMinAlpha(theme.textMuted, MIN_MUTED_ALPHA) };
}

export function resolveTheme(theme: string | PaletteTheme | undefined): Theme {
  if (theme && typeof theme === "object") {
    const { titleFont, ...colors } = theme;
    return withContrast({ ...colors, fontSans: SANS, fontSerif: titleFont === "sans" ? SANS : SERIF });
  }
  return withContrast(THEMES[(theme as ThemeName) in THEMES ? (theme as ThemeName) : "documental"]);
}
