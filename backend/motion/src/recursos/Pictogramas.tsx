import { DOC } from "../scenes/palette";
import { entra, golpe, mezcla, momentos, T } from "./comun";
import type { ContenidoPictogramas, Recurso } from "./tipos";

// PICTOGRAMAS (catalogo #6): grilla de figuras con cambio de estado. En la
// referencia: "54 responsables" (AVE 5:20), la proporcion de asientos
// (Asientos 5:00), la grilla de los suenos (0:30). Lo fijo: grilla centrada,
// figuras de un solo color, entrada en cascada, las marcadas se pintan una
// tras otra en la palabra clave y la cifra entra con golpe seco. Lo que
// cambia: cuantas, cuantas marcadas, etiqueta y cifra de cada grupo.
//
// Momentos (hace): aparece (entra la grilla; con varios grupos, uno por
// momento en orden), marca (se pintan las marcadas del grupo siguiente).

const CASCADA_S = 0.012;
const PINTA_S = 0.02;
const MAX_FIGURAS = 100;

function Figura({ x, y, s, color, lugar }: { x: number; y: number; s: number; color: string; lugar: boolean }) {
  if (lugar) {
    // Asiento visto de frente: respaldo y base.
    return (
      <g transform={`translate(${x} ${y}) scale(${s})`} fill={color}>
        <rect x={-10} y={-24} width={20} height={22} rx={4} />
        <rect x={-13} y={0} width={26} height={9} rx={3} />
      </g>
    );
  }
  // Persona: cabeza y hombros redondeados, sin cara (como la referencia).
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} fill={color}>
      <circle cx={0} cy={-20} r={8} />
      <path d="M-14,8 Q-14,-8 0,-8 Q14,-8 14,8 Z" />
    </g>
  );
}

export function Pictogramas({ t, rec, inicio }: { t: number; rec: Recurso; inicio: number }) {
  const c = rec.contenido as ContenidoPictogramas;
  const grupos = c.grupos.slice(0, 2);
  const claro = (rec.fondo ?? "oscuro") === "claro";
  const apagado = claro ? "#C3CBD3" : "#2A3A52";
  const tinta = claro ? T.tinta : DOC.tintaOscuro;
  const apariciones = momentos(rec, "aparece");
  const marcas = momentos(rec, "marca");
  const ancho = grupos.length === 2 ? 760 : 1300;
  // Grilla de cada grupo; con dos grupos, el mismo tamano de figura en ambos
  // (10 chicas contra 4 grandes hacia ver mas grande al grupo menor).
  const grillas = grupos.map((g) => {
    const total = Math.max(1, Math.min(MAX_FIGURAS, Math.round(g.total)));
    const cols = total <= 10 ? total : Math.ceil(Math.sqrt(total * 2.2));
    const filas = Math.ceil(total / cols);
    return { total, cols, filas, paso: Math.min(ancho / cols, 520 / filas, 170) };
  });
  const pasoComun = Math.min(...grillas.map((g) => g.paso));

  return (
    <svg viewBox="0 0 1920 1080" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      {grupos.map((g, gi) => {
        const { total, cols, filas } = grillas[gi]!;
        const marcados = Math.max(0, Math.min(total, Math.round(g.marcados)));
        const paso = pasoComun;
        const s = Math.min(4, paso / (c.figura === "lugar" ? 46 : 38));
        const cx = grupos.length === 2 ? (gi === 0 ? 560 : 1360) : 960;
        const x0 = cx - ((cols - 1) * paso) / 2;
        const y0 = 560 - ((filas - 1) * paso) / 2;
        const aparece = apariciones[gi]?.at ?? apariciones[0]?.at ?? inicio + 0.3;
        const marca = marcas[gi]?.at ?? marcas[marcas.length - 1]?.at;
        const color = g.significado === "seguro" ? DOC.seguro : g.significado === "peligro" ? DOC.peligro : g.significado === "foco" ? DOC.foco : T.dato2;
        const kEtiqueta = entra(t, aparece);
        const kCifra = golpe(t, marca === undefined ? undefined : marca + Math.min(0.6, marcados * PINTA_S));
        return (
          <g key={gi}>
            {g.etiqueta && (
              <text x={cx} y={y0 - paso * 0.9 - 30} textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight={600} fontSize={42} fill={tinta} opacity={kEtiqueta} transform={`translate(0 ${(1 - kEtiqueta) * 8})`}>
                {g.etiqueta}
              </text>
            )}
            {Array.from({ length: total }).map((_, i) => {
              const k = entra(t, aparece + i * CASCADA_S, 0.35);
              const kPinta = i < marcados ? entra(t, marca === undefined ? undefined : marca + i * PINTA_S, 0.25) : 0;
              const x = x0 + (i % cols) * paso;
              const y = y0 + Math.floor(i / cols) * paso;
              return (
                <g key={i} opacity={k} transform={`translate(0 ${(1 - k) * 14})`}>
                  <Figura x={x} y={y} s={s * (1 + 0.18 * kPinta * (1 - kPinta) * 4)} color={mezcla(apagado, color, kPinta)} lugar={c.figura === "lugar"} />
                </g>
              );
            })}
            {g.texto && (
              <text x={cx} y={y0 + (filas - 1) * paso + paso * 0.6 + 70} textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight={300} fontSize={78} fill={color} opacity={kCifra} transform={`translate(0 ${(1 - kCifra) * 10})`}>
                {g.texto}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
