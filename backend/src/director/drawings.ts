// Verificador de los componentes que dibuja el agente Dibujante. El SVG lo
// escribe un modelo y despues se inyecta tal cual en la preview y en el
// render: solo pasan formas y atributos conocidos, sin texto (todo texto en
// pantalla tiene que pasar por el verificador de escenas), scripts ni enlaces.

export interface DrawingComponent {
  id: string;
  name: string;
  width: number;
  height: number;
  svg: string;
  // Parte -> punto de giro CSS ("50% 0%") o null (el centro).
  parts: Record<string, string | null>;
  // Formato documental: fraccion del alto que queda bajo el agua si flota
  // (barco ~0.25, iceberg ~0.85). La da el director en objetos_nuevos.
  calado?: number;
}

const MAX_SVG_CHARS = 14000;
const TAGS = new Set(["g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);
const ATTRS = new Set([
  "d", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "width", "height", "points",
  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray",
  "opacity", "fill-opacity", "stroke-opacity", "transform", "id", "data-part", "data-pivot", "fill-rule", "clip-rule",
]);
const COLOR = /^(none|currentColor|var\(--accent\)|#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\))$/;
const PIVOT = /^\d{1,3}% \d{1,3}%$/;
const PART_ID = /^[a-z][a-z0-9_]{0,30}$/;

// Devuelve el componente limpio, o el motivo del rechazo.
export function checkComponent(raw: Record<string, unknown>): DrawingComponent | string {
  const id = typeof raw.id === "string" ? raw.id.trim().toLowerCase() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : id;
  const width = Number(raw.width);
  const height = Number(raw.height);
  if (!PART_ID.test(id)) return `id invalido "${String(raw.id)}"`;
  if (!(width >= 1 && width <= 2000 && height >= 1 && height <= 2000)) return `${id}: width y height tienen que ir de 1 a 2000`;
  const source = typeof raw.svg === "string" ? raw.svg.replace(/<\/?svg\b[^>]*>/g, "").trim() : "";
  if (!source) return `${id}: falta el svg`;
  if (source.length > MAX_SVG_CHARS) return `${id}: el svg supera ${MAX_SVG_CHARS} caracteres, simplificalo`;

  const parts: DrawingComponent["parts"] = {};
  const open: string[] = [];
  let shapes = 0;
  let cursor = 0;
  let svg = "";
  for (const tag of source.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^<>]*?)(\/?)>/g)) {
    if (source.slice(cursor, tag.index).trim()) return `${id}: no puede haber texto dentro del dibujo`;
    cursor = tag.index + tag[0].length;
    const [, closing, name_, attrs = "", selfClosed] = tag;
    const tagName = name_!;
    if (!TAGS.has(tagName)) return `${id}: etiqueta no permitida <${tagName}>`;
    if (closing) {
      if (open.pop() !== tagName) return `${id}: etiquetas mal cerradas en <${tagName}>`;
      svg += `</${tagName}>`;
      continue;
    }
    let out = `<${tagName}`;
    let part: string | null = null;
    let pivot: string | null = null;
    let hasTransform = false;
    const rest = attrs.replace(/([a-zA-Z0-9-]+)\s*=\s*"([^"]*)"/g, (_, attr: string, value: string) => {
      if (!ATTRS.has(attr)) throw new Error(`${id}: atributo no permitido "${attr}"`);
      if ((attr === "fill" || attr === "stroke") && !COLOR.test(value)) throw new Error(`${id}: color no permitido "${value}"`);
      // La parte llega como id (formato anterior) o data-part (dibujante documental).
      if (attr === "id" || attr === "data-part") part = value;
      else if (attr === "data-pivot") pivot = value;
      else {
        if (attr === "transform") hasTransform = true;
        out += ` ${attr}="${value}"`;
      }
      return "";
    });
    if (rest.trim()) return `${id}: atributo mal escrito en <${tagName}>`;
    if (part !== null) {
      if (!PART_ID.test(part)) return `${id}: nombre de parte invalido "${part}"`;
      if (hasTransform) return `${id}: la parte "${part}" no puede tener transform: ponelo en un <g> de adentro`;
      if (pivot !== null && !PIVOT.test(pivot)) return `${id}: data-pivot invalido "${pivot}", usa "50% 0%"`;
      parts[part] = pivot;
      out += ` data-part="${part}"`;
    }
    shapes += tagName === "g" ? 0 : 1;
    if (selfClosed) svg += `${out}/>`;
    else {
      open.push(tagName);
      svg += `${out}>`;
    }
  }
  if (source.slice(cursor).trim()) return `${id}: no puede haber texto dentro del dibujo`;
  if (open.length > 0) return `${id}: falta cerrar <${open[open.length - 1]}>`;
  if (shapes === 0) return `${id}: el dibujo esta vacio`;
  return { id, name, width, height, svg, parts };
}

// checkComponent tira cuando un atributo o color no pasa: lo devuelve como motivo.
export function validateComponent(raw: Record<string, unknown>): DrawingComponent | string {
  try {
    return checkComponent(raw);
  } catch (err) {
    return (err as Error).message;
  }
}
