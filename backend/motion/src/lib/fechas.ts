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

const NOMBRES = Object.keys(MESES).join("|");
// "23/abril/1912", "23-abril-1912" (la IA a veces mezcla numero y nombre).
const MIXTA = new RegExp(`\\b(\\d{1,2})\\s*[/-]\\s*(${NOMBRES})\\s*[/-]\\s*(\\d{4})\\b`, "gi");
// Sin año: "23 de abril", "23/abril" -> DD/MM.
const SIN_ANIO = new RegExp(`\\b(\\d{1,2})(?:\\.?\\s*[ºo°])?\\s*(?:de\\s+|[/-]\\s*|\\s+)(${NOMBRES})\\b`, "gi");
// Mes y año: "abril de 1912" -> MM/AAAA.
const MES_ANIO = new RegExp(`\\b(${NOMBRES})(?:\\s+de\\s+|\\s*[/,-]\\s*|\\s+)(\\d{4})\\b`, "gi");

const dos = (n: number) => String(n).padStart(2, "0");

export function conFechas(text: string): string;
export function conFechas(text: string | undefined): string | undefined;
export function conFechas(text: string | undefined): string | undefined {
  if (!text) return text;
  const completa = (match: string, dia: string, mes: string, anio: string) => {
    const d = Number(dia);
    const m = MESES[mes.toLowerCase()];
    if (!m || d < 1 || d > 31) return match;
    return `${dos(d)}/${dos(m)}/${anio}`;
  };
  return text
    .replace(FECHA, completa)
    .replace(MIXTA, completa)
    .replace(SIN_ANIO, (match, dia: string, mes: string) => {
      const d = Number(dia);
      const m = MESES[mes.toLowerCase()];
      return !m || d < 1 || d > 31 ? match : `${dos(d)}/${dos(m)}`;
    })
    .replace(MES_ANIO, (match, mes: string, anio: string) => {
      const m = MESES[mes.toLowerCase()];
      return m ? `${dos(m)}/${anio}` : match;
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
