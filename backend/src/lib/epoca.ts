// EPOCA de cada plano, solo con reglas (como epocaPlano.js de MaV): el juez
// necesita saber si la frase habla de 1912, del siglo XIX o de hoy para
// rechazar una foto moderna en una escena historica (o al reves). No se le
// pregunta al modelo: la regex no inventa anios.

// Por debajo de este anio el plano es "historico" (el juez puede marcar
// "epoca"). Antes del cine (1890) no hay metraje real: valen reconstrucciones
// y ruinas sin nada moderno.
export const HISTORIC_BEFORE = 1990;
export const PRE_CINEMA_BEFORE = 1890;
// La epoca que escribe el plan no puede caer mas de esto despues del relato.
const PLAN_EPOCH_MAX_AHEAD = 150;

const TODAY = /\b(hoy|hoy en d[ií]a|actualmente|en la actualidad|a d[ií]a de hoy|today|nowadays|currently)\b/i;

// Una cifra seguida de una unidad no es un anio ("1500 trabajadores", "1914 km").
const UNIT_AFTER =
  /^\s*(%|por ciento|km|kil[oó]metros?|metros?|m\b|millas?|kg|kilos?|toneladas?|tn|litros?|personas?|habitantes?|trabajadores?|obreros?|soldados?|hombres?|mujeres?|ni[ñn]os?|muertos?|v[ií]ctimas?|pasajeros?|d[oó]lares?|euros?|pesos?|libras?|usd|millones?|mil\b|casas?|barcos?|aviones?|veces|a[ñn]os?|d[ií]as?|horas?|minutos?|segundos?|pies|metres|meters|miles|people|workers|men|dollars|tons)/i;

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };

function romanToInt(roman: string): number | null {
  let total = 0;
  const s = roman.toUpperCase();
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]!];
    const next = ROMAN[s[i + 1] ?? ""] ?? 0;
    if (!v) return null;
    total += v < next ? -v : v;
  }
  return total > 0 && total <= 21 ? total : null;
}

const BC = /^\s*(a\.?\s?\s?c\.?|antes de cristo|bc\b|b\.c\.|bce\b)/i;
const AD = /^\s*(d\.?\s?\s?c\.?|despu[eé]s de cristo|ad\b|a\.d\.|ce\b)/i;

export function isToday(text: string): boolean {
  return TODAY.test(text);
}

// El primer anio que dice la frase (negativo si es a. C.), o un siglo
// ("siglo XIX" -> 1850) si no dice ningun anio.
export function yearOf(text: string): number | undefined {
  // 1. Anio de 4 cifras (1400-2039), sin separador de miles ni unidad.
  for (const m of text.matchAll(/(?<![\d.,])(1[4-9]\d\d|20[0-3]\d)(?![\d.,]\d)/g)) {
    const after = text.slice((m.index ?? 0) + m[0].length);
    if (UNIT_AFTER.test(after)) continue;
    if (BC.test(after)) return -Number(m[1]);
    return Number(m[1]);
  }
  // 2. Anio antiguo: "anio 509", "753 a. C.", "146 BC", "79 d.C.".
  for (const m of text.matchAll(/(?<![\d.,])(\d{1,4})(?![\d.,]\d)/g)) {
    const n = Number(m[1]);
    const before = text.slice(Math.max(0, (m.index ?? 0) - 6), m.index);
    const after = text.slice((m.index ?? 0) + m[0].length);
    if (BC.test(after)) return -n;
    if (AD.test(after) || /\b(a[ñn]o|year)\s*$/i.test(before)) {
      if (UNIT_AFTER.test(after) && !AD.test(after)) continue;
      return n;
    }
  }
  // 3. Siglo: "siglo XIX", "siglo III a. C.", "19th century" -> mitad del siglo.
  const roman = /\bsiglo\s+([IVXLC]+)\b(.{0,12})/i.exec(text);
  if (roman) {
    const n = romanToInt(roman[1]!);
    if (n) return BC.test(roman[2] ?? "") ? -(n * 100 - 50) : n * 100 - 50;
  }
  const english = /\b(\d{1,2})(?:st|nd|rd|th)[\s-]+century\b(.{0,8})/i.exec(text);
  if (english) {
    const n = Number(english[1]);
    if (n >= 1 && n <= 21) return BC.test(english[2] ?? "") ? -(n * 100 - 50) : n * 100 - 50;
  }
  return undefined;
}

export interface ShotEpoch {
  // Anio de referencia del plano (negativo = a. C.).
  anio?: number;
  // La frase habla de hoy: una foto actual es la correcta.
  hoy: boolean;
  // anio < 1990: el juez puede marcar "epoca".
  historico: boolean;
  // anio < 1890: no hay metraje real; valen reconstrucciones y ruinas.
  preCine: boolean;
}

// Epoca de cada plano, en orden del video. `texts[i]` es lo que dice la voz
// en el plano i; `planYears[i]`, el anio que escribio el montajista (si hay).
// Regla: el anio de la frase; si no dice, el del plan (si es historico y no
// cae muy despues del relato); si no, el ultimo anio dicho antes; si no, el
// primero que se dice despues. "Hoy" gana y deja el plano sin anio.
export function shotEpochs(texts: string[], planYears: (number | undefined)[] = []): ShotEpoch[] {
  const own = texts.map((t) => yearOf(t));
  const firstAfter: (number | undefined)[] = new Array(texts.length);
  let next: number | undefined;
  for (let i = texts.length - 1; i >= 0; i--) {
    firstAfter[i] = next;
    if (own[i] !== undefined) next = own[i];
  }
  const out: ShotEpoch[] = [];
  let lastSaid: number | undefined;
  texts.forEach((text, i) => {
    const hoy = isToday(text);
    let anio: number | undefined;
    if (!hoy) {
      const plan = planYears[i];
      const story = lastSaid ?? firstAfter[i];
      const planOk = plan !== undefined && plan < HISTORIC_BEFORE && (story === undefined || plan - story <= PLAN_EPOCH_MAX_AHEAD);
      anio = own[i] ?? (planOk ? plan : undefined) ?? lastSaid ?? firstAfter[i];
    }
    if (own[i] !== undefined) lastSaid = own[i];
    out.push({
      ...(anio !== undefined ? { anio } : {}),
      hoy,
      historico: anio !== undefined && anio < HISTORIC_BEFORE,
      preCine: anio !== undefined && anio < PRE_CINEMA_BEFORE,
    });
  });
  return out;
}

// Linea de epoca para los prompts del juez (en ingles, como MaV).
export function epochLine(e: ShotEpoch): string | null {
  if (e.hoy) return "TODAY: the narration is about the present; a present-day picture is right here.";
  if (e.anio === undefined || !e.historico) return null;
  const year = e.anio < 0 ? `${-e.anio} BC` : String(e.anio);
  if (e.preCine) {
    return `Era: around ${year}, before cinema existed. Real footage cannot exist: a documentary reconstruction, an artwork of the time or the real ruins with NOTHING modern in view are right.`;
  }
  return `Era: ${year}. Archive material of that time is right; anything clearly modern (today's cars, phones, screens, buildings, colour digital photos of a 1912 event) is "epoca".`;
}
