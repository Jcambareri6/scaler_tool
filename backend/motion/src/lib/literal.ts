// Cifras del guion -> forma compacta para pantalla, sin inventar nada: el
// numero es el mismo que dice la narracion, solo cambia como se escribe
// ("más de 1.000 km por hora" -> "+" "1.000" "km/h").

export interface CompactNumber {
  value: number;
  decimals: number;
  prefix: string;
  unit: string;
}

const PREFIXES: [RegExp, string][] = [
  [/^(m[aá]s de|over|more than)\s*$/i, "+"],
  [/^(menos de|less than|under)\s*$/i, "<"],
  [/^(unos|unas|alrededor de|cerca de|casi|aproximadamente|about|around|almost|nearly)\s*$/i, "≈"],
];

const UNITS: [RegExp, string][] = [
  [/^kil[oó]metros por hora|^km por hora|^km\/h/i, "km/h"],
  [/^millas por hora|^mph/i, "mph"],
  [/^por ciento|^%/i, "%"],
  [/^kil[oó]metros|^km\b/i, "km"],
  [/^metros|^m\b/i, "m"],
  [/^cent[ií]metros|^cm\b/i, "cm"],
  [/^kilos|^kilogramos|^kg\b/i, "kg"],
  [/^toneladas/i, "t"],
  [/^grados/i, "°"],
];

export function parseLiteralNumber(text: string): CompactNumber | null {
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
    if (parts.length > 2 || (parts[1]!.length === 3 && parts[0]!.length <= 3)) thousandsSep = sep;
    else decimalSep = sep;
  }
  let normalized = raw;
  if (thousandsSep) normalized = normalized.split(thousandsSep).join("");
  if (decimalSep) normalized = normalized.replace(decimalSep, ".");
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;

  const before = text.slice(0, match.index).trim();
  const after = text.slice(match.index + match[0].length).trim();
  const prefix = PREFIXES.find(([re]) => re.test(before))?.[1] ?? before;
  const unit = UNITS.find(([re]) => re.test(after))?.[1] ?? after;
  return {
    value,
    decimals: decimalSep ? (normalized.split(".")[1]?.length ?? 0) : 0,
    prefix,
    unit,
  };
}

// Todas las cifras de un video con el mismo formato (el del idioma del
// canal), aunque el guion mezcle "1.500" y "1,000".
export function formatNumber(value: number, fmt: CompactNumber, locale = "es-AR"): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: fmt.decimals,
    maximumFractionDigits: fmt.decimals,
    useGrouping: true,
  }).format(value);
}
