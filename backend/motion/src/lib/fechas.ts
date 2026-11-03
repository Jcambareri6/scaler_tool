// Fechas en pantalla del formato documental: siempre DD/MM/AAAA.
// La IA escribe la fecha como la dice el guion ("26 de abril de 1986") y el
// motor la muestra con un unico formato. No toca horas ni anos sueltos.

const MESES: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

// "26 de abril de 1986", "26 de abril, 1986", "26 abril 1986", "1.º de mayo de 1990"
const FECHA = new RegExp(
  `\\b(\\d{1,2})(?:\\.?\\s*[ºo°])?\\s+(?:de\\s+)?(${Object.keys(MESES).join("|")})(?:\\s+de\\s+|\\s*,\\s*|\\s+)(\\d{4})\\b`,
  "gi"
);

const dos = (n: number) => String(n).padStart(2, "0");

export function conFechas(text: string): string;
export function conFechas(text: string | undefined): string | undefined;
export function conFechas(text: string | undefined): string | undefined {
  if (!text) return text;
  return text.replace(FECHA, (match, dia: string, mes: string, anio: string) => {
    const d = Number(dia);
    const m = MESES[mes.toLowerCase()];
    if (!m || d < 1 || d > 31) return match;
    return `${dos(d)}/${dos(m)}/${anio}`;
  });
}

// Aplica conFechas a todos los textos de un spec de grafico (map_marker, etc.).
export function fechasEnSpec<T>(value: T): T {
  if (typeof value === "string") return conFechas(value) as T;
  if (Array.isArray(value)) return value.map((v) => fechasEnSpec(v)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, fechasEnSpec(v)])) as T;
  }
  return value;
}
