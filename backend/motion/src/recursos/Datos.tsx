import { DOC } from "../scenes/palette";
import { entra, golpe, lerp, mecanismo, momento, momentos, T } from "./comun";
import type { ContenidoAB, ContenidoContador, ContenidoDocumento, ContenidoLeccion, ContenidoReloj, Recurso } from "./tipos";

// Recursos de datos de la referencia (fase 5). Igual que el resto: la IA da
// el contenido y la palabra de cada momento; aca se resuelve donde y como.

const Lienzo = ({ children }: { children: React.ReactNode }) => (
  <svg viewBox="0 0 1920 1080" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
    {children}
  </svg>
);
const MAQUINA = "'Courier Prime', 'Courier New', monospace";
const colorSig = (s?: string) => (s === "seguro" ? DOC.seguro : s === "peligro" ? DOC.peligro : s === "foco" ? DOC.foco : DOC.tintaOscuro);

// ---------- Documento a maquina (catalogo #14) ----------
// Hoja beige que entra; cada renglon se escribe letra a letra en su palabra
// (o uno tras otro); el renglon clave se resalta en amarillo; sello rojo seco.
export function Documento({ t, rec, inicio }: { t: number; rec: Recurso; inicio: number }) {
  const c = rec.contenido as ContenidoDocumento;
  const kHoja = entra(t, momento(rec, "aparece")?.at ?? inicio + 0.2, 0.6);
  const lineasAt = momentos(rec, "linea").map((m) => m.at);
  const base = momento(rec, "aparece")?.at ?? inicio + 0.2;
  const aResalta = momento(rec, "resalta")?.at;
  const aSello = momento(rec, "sello")?.at;
  const kSello = golpe(t, aSello, 0.2);
  // Renglones partidos a lo ancho de la hoja (un renglon largo se salia del
  // papel) y hoja mas baja: el subtitulo ya no la pisa.
  const filas = c.lineas.slice(0, 9).flatMap((linea, i) => partir(linea, LETRAS_RENGLON).map((texto, j) => ({ texto, i, j })));
  return (
    <Lienzo>
      <g opacity={kHoja} transform={`translate(0 ${(1 - kHoja) * 30}) rotate(${-1.2} 960 520)`}>
        <rect x={548} y={90} width={824} height={760} fill="#000" opacity={0.35} transform="translate(14 18)" />
        <rect x={548} y={90} width={824} height={760} fill="#EFE6D0" />
        <text x={608} y={170} fontFamily={MAQUINA} fontSize={34} fill="#2B2722" letterSpacing={2}>
          {c.titulo.toUpperCase()}
        </text>
        <line x1={608} y1={192} x2={1312} y2={192} stroke="#2B2722" strokeWidth={1.5} opacity={0.6} />
        {filas.slice(0, MAX_FILAS).map(({ texto, i, j }, fila) => {
          // Cada renglon del guion se escribe en su palabra; sus filas, una tras otra.
          const at = (lineasAt[i] ?? base + 0.8 + i * 1.1) + filas.slice(0, fila).filter((f) => f.i === i).reduce((acc, f) => acc + f.texto.length * 0.035, 0);
          const letras = Math.max(0, Math.floor((t - at) / 0.035));
          const y = 258 + fila * 56;
          const kRes = c.resaltar === i ? entra(t, aResalta, 0.4) : 0;
          return (
            <g key={`${i}-${j}`}>
              {kRes > 0 && <rect x={600} y={y - 34} width={Math.min(720, texto.length * 18.5 + 16) * kRes} height={46} fill="#F0C050" opacity={0.75} />}
              <text x={608} y={y} fontFamily={MAQUINA} fontSize={30} fill="#2B2722">
                {texto.slice(0, letras)}
              </text>
            </g>
          );
        })}
        {c.sello && kSello > 0 && (
          <g transform={`translate(1150 760) rotate(-14) scale(${lerp(1.35, 1, kSello)})`} opacity={kSello}>
            <rect x={-170} y={-50} width={340} height={100} fill="none" stroke={DOC.peligro} strokeWidth={7} rx={6} />
            <text textAnchor="middle" y={18} fontFamily="Inter, sans-serif" fontWeight={900} fontSize={50} letterSpacing={4} fill={DOC.peligro}>
              {c.sello.toUpperCase()}
            </text>
          </g>
        )}
      </g>
    </Lienzo>
  );
}

// Letras de maquina que entran en un renglon de la hoja (30 px, ~18,5 px cada una).
const LETRAS_RENGLON = 37;
const MAX_FILAS = 10;
function partir(texto: string, max: number): string[] {
  const filas: string[] = [];
  let actual = "";
  for (const palabra of texto.split(/\s+/).filter(Boolean)) {
    if (actual && (actual + " " + palabra).length > max) {
      filas.push(actual);
      actual = palabra;
    } else actual = actual ? `${actual} ${palabra}` : palabra;
  }
  if (actual) filas.push(actual);
  return filas;
}

// ---------- Reloj ----------
// Esfera fina en fondo oscuro; las agujas marcan la hora y, si hay "hasta",
// corren hasta esa hora en su palabra (el tiempo que pasa).
const minutos = (h: string) => {
  const m = /(\d{1,2})[:.h](\d{2})/.exec(h);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};
export function Reloj({ t, rec, inicio }: { t: number; rec: Recurso; inicio: number }) {
  const c = rec.contenido as ContenidoReloj;
  const k = entra(t, momento(rec, "aparece")?.at ?? inicio + 0.2, 0.6);
  const desde = minutos(c.hora);
  let hasta = c.hasta ? minutos(c.hasta) : desde;
  if (hasta < desde) hasta += 24 * 60;
  const kAvanza = mecanismo(t, momento(rec, "avanza")?.at, 2.2);
  const ahora = lerp(desde, hasta, kAvanza);
  const hh = Math.floor(ahora / 60) % 24;
  const mm = Math.floor(ahora % 60);
  const angM = (ahora % 60) * 6;
  const angH = ((ahora / 60) % 12) * 30;
  const kNota = entra(t, momento(rec, "nota")?.at);
  return (
    <Lienzo>
      <g opacity={k} transform={`translate(760 520) scale(${lerp(0.92, 1, k)})`}>
        <circle r={300} fill="none" stroke="#C9D3DE" strokeWidth={4} />
        {Array.from({ length: 12 }).map((_, i) => (
          <line key={i} x1={0} y1={-300} x2={0} y2={i % 3 === 0 ? -258 : -275} stroke="#C9D3DE" strokeWidth={i % 3 === 0 ? 6 : 3} transform={`rotate(${i * 30})`} />
        ))}
        <line x1={0} y1={20} x2={0} y2={-165} stroke="#FFFFFF" strokeWidth={12} strokeLinecap="round" transform={`rotate(${angH})`} />
        <line x1={0} y1={28} x2={0} y2={-245} stroke="#FFFFFF" strokeWidth={6} strokeLinecap="round" transform={`rotate(${angM})`} />
        <circle r={12} fill={DOC.foco} />
      </g>
      <text x={1180} y={520} fontFamily="Inter, sans-serif" fontWeight={300} fontSize={150} fill="#FFFFFF" opacity={k} style={{ fontVariantNumeric: "tabular-nums" }}>
        {`${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`}
      </text>
      {c.nota && (
        <text x={1186} y={590} fontFamily="Inter, sans-serif" fontSize={34} fill="#C9D3DE" opacity={kNota}>
          {c.nota}
        </text>
      )}
    </Lienzo>
  );
}

// ---------- Contador (catalogo #8) ----------
// 1 o 2 cifras grandes y finas que suben desde 0; despues la relacion.
// La cuenta respeta el valor final: si es entero, sube de entero en entero
// (mostraba "3,3 compartimentos" o "27,6 mil toneladas" a mitad de la cuenta).
const fmt = (n: number, final: number, locale: string) =>
  Number.isInteger(final) ? Math.round(n).toLocaleString(locale) : n.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export function Contador({ t, rec, inicio, locale }: { t: number; rec: Recurso; inicio: number; locale: string }) {
  const c = rec.contenido as ContenidoContador;
  const valores = c.valores.slice(0, 2);
  const apariciones = momentos(rec, "aparece");
  const kRel = golpe(t, momento(rec, "relacion")?.at, 0.3);
  return (
    <Lienzo>
      {valores.map((v, i) => {
        const at = apariciones[i]?.at ?? inicio + 0.3 + i * 1.5;
        const kSube = mecanismo(t, at, 1.4);
        const x = valores.length === 2 ? (i === 0 ? 560 : 1360) : 960;
        const color = v.significado ? colorSig(v.significado) : i === 1 ? T.dato2 : "#FFFFFF";
        // Ancho estimado de cifra + unidad: si no entra en su mitad (o en la
        // pantalla), la letra se achica en vez de pisar la otra cifra.
        const texto = fmt(v.valor, v.valor, locale);
        const ancho = texto.length * 0.56 * 190 + (v.unidad ? (v.unidad.length + 1) * 0.5 * 70 : 0);
        const f = Math.min(1, (valores.length === 2 ? 760 : 1600) / ancho);
        return (
          <g key={i} opacity={entra(t, at, 0.3)}>
            <text x={x} y={540} textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight={300} fontSize={190 * f} fill={color} style={{ fontVariantNumeric: "tabular-nums" }}>
              {fmt(v.valor * kSube, v.valor, locale)}
              {v.unidad && <tspan fontSize={70 * f}>{` ${v.unidad}`}</tspan>}
            </text>
            {v.etiqueta && (
              <text x={x} y={620} textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight={500} fontSize={38} fill="#C9D3DE">
                {v.etiqueta}
              </text>
            )}
          </g>
        );
      })}
      {c.relacion && (
        <text x={960} y={800} textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight={700} fontSize={56} fill={DOC.foco} opacity={kRel} transform={`translate(0 ${(1 - kRel) * 10})`}>
          {c.relacion}
        </text>
      )}
    </Lienzo>
  );
}

// ---------- Tarjeta de leccion (catalogo #15) ----------
// Fondo claro, etiqueta azul en versalitas y la frase en dos tiempos.
export function Leccion({ t, rec, inicio }: { t: number; rec: Recurso; inicio: number }) {
  const c = rec.contenido as ContenidoLeccion;
  const k = entra(t, momento(rec, "aparece")?.at ?? inicio + 0.2, 0.5);
  const k2 = entra(t, momento(rec, "segunda")?.at, 0.5);
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 12%", fontFamily: "Inter, sans-serif" }}>
      <div style={{ opacity: k, color: DOC.resaltadoClaro, fontSize: "1.4vw", letterSpacing: "0.3vw", fontWeight: 700, textTransform: "uppercase", borderBottom: `3px solid ${DOC.resaltadoClaro}`, alignSelf: "flex-start", paddingBottom: "0.5vw" }}>
        {c.etiqueta}
      </div>
      <div style={{ opacity: k, transform: `translateY(${(1 - k) * 10}px)`, color: T.tinta, fontSize: "3.6vw", fontWeight: 700, marginTop: "2.2vw", lineHeight: 1.2 }}>{c.frase}</div>
      {c.segunda && <div style={{ opacity: k2, transform: `translateY(${(1 - k2) * 10}px)`, color: T.texto, fontSize: "2.6vw", fontWeight: 500, marginTop: "1.4vw", lineHeight: 1.25 }}>{c.segunda}</div>}
    </div>
  );
}

// ---------- A/B lado a lado (catalogo #4) ----------
// Dos columnas con titulo; el resultado (verde con tilde o rojo con cruz)
// aparece en su palabra.
export function AB({ t, rec, inicio, claro = false }: { t: number; rec: Recurso; inicio: number; claro?: boolean }) {
  const c = rec.contenido as ContenidoAB;
  // En fondo claro el titulo blanco no se veia (s47 del Titanic).
  const tinta = claro ? T.tinta : "#FFFFFF";
  const suave = claro ? T.texto : "#C9D3DE";
  const apariciones = momentos(rec, "aparece");
  const resultados = momentos(rec, "resultado");
  return (
    <Lienzo>
      {c.titulo && (
        <text x={960} y={190} textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight={700} fontSize={50} fill={tinta} opacity={entra(t, apariciones[0]?.at ?? inicio + 0.2)}>
          {c.titulo}
        </text>
      )}
      <line x1={960} y1={280} x2={960} y2={860} stroke={claro ? "#B9C3CE" : "#2C4466"} strokeWidth={3} opacity={entra(t, apariciones[0]?.at ?? inicio + 0.2)} />
      {c.opciones.slice(0, 2).map((o, i) => {
        const x = i === 0 ? 520 : 1400;
        const k = entra(t, apariciones[i]?.at ?? apariciones[0]?.at ?? inicio + 0.2 + i * 0.6, 0.5);
        const kR = golpe(t, resultados[i]?.at ?? resultados[resultados.length - 1]?.at, 0.3);
        const color = o.bien ? DOC.seguro : DOC.peligro;
        return (
          <g key={i} opacity={k} transform={`translate(0 ${(1 - k) * 16})`}>
            <text x={x} y={400} textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight={600} fontSize={46} fill={suave}>
              {o.titulo}
            </text>
            <g opacity={kR} transform={`translate(${x} 560) scale(${lerp(1.3, 1, kR)})`}>
              <circle r={92} fill="none" stroke={color} strokeWidth={8} />
              {o.bien ? (
                <polyline points="-42,4 -10,36 46,-30" fill="none" stroke={color} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                <path d="M-36,-36 L36,36 M36,-36 L-36,36" stroke={color} strokeWidth={14} strokeLinecap="round" />
              )}
            </g>
            <text x={x} y={740} textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight={700} fontSize={44} fill={color} opacity={kR}>
              {o.resultado}
            </text>
          </g>
        );
      })}
    </Lienzo>
  );
}
