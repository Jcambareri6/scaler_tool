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

export function resolveTheme(theme: string | PaletteTheme | undefined): Theme {
  if (theme && typeof theme === "object") {
    const { titleFont, ...colors } = theme;
    return { ...colors, fontSans: SANS, fontSerif: titleFont === "sans" ? SANS : SERIF };
  }
  return THEMES[(theme as ThemeName) in THEMES ? (theme as ThemeName) : "documental"];
}
