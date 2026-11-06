import { createContext, useContext } from "react";
import { BIBLIOTECA, objetoDesdeSvg, type ComponenteSvg, type EstadoParte, type ObjetoBase } from "../biblioteca";
import { DOC } from "../scenes/palette";
import { colorDe, entra, golpe, lerp, mecanismo, mezcla, momento, momentos, remateAt, SUELO, T } from "./comun";
import type { ContenidoEsquema, Escenario, Lugar, Momento, Recurso } from "./tipos";

// ESQUEMA POR CAPAS (catalogo #1): un escenario de perfil sobre el suelo al que
// se le suman capas con la voz. Aparece en la referencia como el corte del
// vagon, la rueda y el carril, el cerebro o la cremallera del ADN.
// Lugares FIJOS (de izquierda a derecha): personaje, secundario, principal y
// destino. Cada objeto de la biblioteca se escala a su lugar y se apoya en el
// suelo; las etiquetas se pegan al objeto o a su parte. Incluye:
//   - CONTRASTE (catalogo #3): "escudo" y etiquetas "seguro" prometen algo en
//     verde; en el remate se apagan.
//   - EVENTO CONTENIDO (catalogo #12): en vez de explosion, golpe seco de
//     0,25 s con grietas, halo rojo, piezas y etiqueta, y despues quietud.
//
// Momentos (hace): aparece, tarjeta, aprieta, parte, lupa, lupa_accion,
// lupa_texto, lupa_nota, etiqueta, escudo, conectar, flujo, evento.

const LUGARES: Record<Exclude<Lugar, "personaje">, { cx: number; maxW: number; maxH: number }> = {
  secundario: { cx: 640, maxW: 480, maxH: 400 },
  principal: { cx: 1220, maxW: 700, maxH: 560 },
  destino: { cx: 1740, maxW: 330, maxH: 320 },
};
// Acciones (fase 3): duraciones y angulos fijos, la IA solo dice cuando.
const INCLINA_S = 2.5;
const INCLINA_GRADOS = 9;
const HUNDE_S = 6;
const HUNDE_GRADOS = 14;
const INUNDA_S = 3.5;
const INUNDA_NIVEL = 0.8;
const PERSONAJE_X = 330;
// Textos pegados a los dibujos (etiquetas, escudo, choque, lupa): apagados.
// El esquema cuenta con imagen y movimiento; el texto lo lleva el titulo y el
// subtitulo. Para volver a mostrarlos, true.
const TEXTOS_EN_DIBUJOS = false;
// Tema de la escena: en fondo oscuro la tinta es clara (antes se perdian el
// personaje, las etiquetas y los dibujos negros sobre el azul noche).
const Claro = createContext(true);
const tinta = (claro: boolean) => (claro ? T.tinta : DOC.tintaOscuro);
// Halo del color del fondo detras de los textos: se leen aunque crucen un dibujo.
const halo = (claro: boolean) => ({ stroke: claro ? "#F1F4F7" : "#08111F", strokeWidth: 7, paintOrder: "stroke" as const, strokeLinejoin: "round" as const });
// Dibujos sobre fondo oscuro: linea clara y relleno medio, los colores conservan su tono.
const DIBUJO_OSCURO = "invert(0.86) hue-rotate(180deg) saturate(1.3)";
// Dibujo claro de noche: apenas mas oscuro (el hielo sigue blanco; invertirlo
// lo dejaba gris carbon).
const DIBUJO_NOCHE = "brightness(0.86) saturate(0.95)";
// Los dibujos vectoriales pueden crecer para llenar su lugar (antes se
// quedaban en su tamano original, chiquitos en 1920x1080).
const MAX_AMPLIAR = 2;
// Mar: linea de agua y fraccion del objeto que queda sumergida.
const AGUA = 640;
const CALADO = 0.22;
// Cielo: centro vertical de los objetos.
const CIELO_Y = 470;

interface Ubicado {
  obj: ObjetoBase;
  x0: number;
  y0: number;
  w: number;
  h: number;
  esc: number;
}

function ubicar(id: string | undefined, lugar: keyof typeof LUGARES, escenario: Escenario, propios?: Record<string, ComponenteSvg>): Ubicado | null {
  // Primero la biblioteca base; si no, el dibujo de este video (Dibujante).
  const obj = id ? (BIBLIOTECA[id] ?? (propios?.[id] ? objetoDesdeSvg(propios[id]!) : undefined)) : undefined;
  if (!obj) return null;
  const l = LUGARES[lugar];
  const esc = Math.min(l.maxW / obj.ancho, l.maxH / obj.alto, MAX_AMPLIAR);
  const w = obj.ancho * esc;
  const h = obj.alto * esc;
  // Cada objeto flota con su calado: el iceberg ~85 % bajo el agua, un barco ~25 %.
  const y0 = escenario === "mar" ? AGUA - h * (1 - (obj.calado ?? CALADO)) : escenario === "cielo" ? CIELO_Y - h / 2 : SUELO - h;
  return { obj, x0: l.cx - w / 2, y0, w, h, esc };
}

// "avanza": el objeto va hacia otro lugar hasta quedar pegado a el.
function desplazamiento(t: number, rec: Recurso, lugar: string, base: Record<string, Ubicado | null>): number {
  const u = base[lugar];
  if (!u) return 0;
  let dx = 0;
  for (const m of momentos(rec, "avanza")) {
    if (m.objeto !== lugar || !m.hacia || !base[m.hacia]) continue;
    const meta = base[m.hacia]!;
    const hasta = meta.x0 > u.x0 ? meta.x0 - 12 - (u.x0 + u.w) : meta.x0 + meta.w + 12 - u.x0;
    dx += hasta * mecanismo(t, m.at, AVANCE_S);
  }
  return dx;
}
const AVANCE_S = 3;

// Que ningun objeto quede cortado en el borde (el iceberg o el bote a la
// derecha): si el grupo se pasa del margen, se achica y se corre lo justo.
const MARGEN = 110;
function encajar(base: Record<string, Ubicado | null>, escenario: Escenario): void {
  const todos = Object.values(base).filter((u): u is Ubicado => !!u);
  if (todos.length === 0) return;
  const x0 = Math.min(...todos.map((u) => u.x0));
  const x1 = Math.max(...todos.map((u) => u.x0 + u.w));
  if (x0 >= MARGEN && x1 <= 1920 - MARGEN) return;
  const f = Math.min(1, (1920 - 2 * MARGEN) / (x1 - x0));
  const centro = (x0 + x1) / 2;
  const nx0 = centro - ((x1 - x0) * f) / 2;
  const nx1 = centro + ((x1 - x0) * f) / 2;
  const corre = Math.max(0, MARGEN - nx0) - Math.max(0, nx1 - (1920 - MARGEN));
  for (const u of todos) {
    const cx = centro + (u.x0 + u.w / 2 - centro) * f + corre;
    const altoAntes = u.h;
    u.esc *= f;
    u.w *= f;
    u.h *= f;
    u.x0 = cx - u.w / 2;
    // Misma linea de apoyo: en el mar, el mismo calado; en tierra, el piso.
    if (escenario === "mar") u.y0 = AGUA - (AGUA - u.y0) * f;
    else if (escenario === "cielo") u.y0 += (altoAntes - u.h) / 2;
    else u.y0 += altoAntes - u.h;
  }
}

// ---------- Escenario ----------
function Escenario({ t, escenario, claro }: { t: number; escenario: Escenario; claro: boolean }) {
  const linea = claro ? T.linea : "#3A4A60";
  if (escenario === "cielo") return null;
  if (escenario === "mar") {
    // Cielo arriba, nada mas: el agua va por delante de los objetos (AguaDelante).
    return null;
  }
  if (escenario === "interior") {
    return (
      <g>
        <rect x={60} y={150} width={1800} height={SUELO - 150} fill={claro ? "#DCE2E8" : "#0D1A2C"} />
        <line x1={60} y1={150} x2={60} y2={SUELO} stroke={linea} strokeWidth={2} opacity={0.5} />
        <line x1={1860} y1={150} x2={1860} y2={SUELO} stroke={linea} strokeWidth={2} opacity={0.5} />
        <line x1={60} y1={SUELO} x2={1860} y2={SUELO} stroke={linea} strokeWidth={3} />
      </g>
    );
  }
  return <line x1={60} y1={SUELO} x2={1860} y2={SUELO} stroke={linea} strokeWidth={3} />;
}

// El agua se dibuja por delante: la parte sumergida de cada objeto (el casco,
// la masa del iceberg) se ve a traves, como en un esquema de perfil.
function AguaDelante({ t, claro }: { t: number; claro: boolean }) {
  const ola = (x: number) => AGUA + Math.sin(x / 95 + t * 1.4) * 4 + Math.sin(x / 41 - t * 0.9) * 1.5;
  const puntos: string[] = [];
  for (let x = 0; x <= 1920; x += 24) puntos.push(`${x},${ola(x).toFixed(1)}`);
  const superficie = `M${puntos.join(" L")}`;
  // Azul de verdad (antes era un gris celeste casi blanco): mas profundo abajo,
  // superficie con una linea clara.
  const id = claro ? "agua-claro" : "agua-oscuro";
  return (
    <g>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={claro ? "#6FA3CF" : "#1B5A92"} stopOpacity={claro ? 0.72 : 0.78} />
          <stop offset="100%" stopColor={claro ? "#2F6696" : "#0A2747"} stopOpacity={claro ? 0.9 : 0.92} />
        </linearGradient>
      </defs>
      <path d={`${superficie} L1920,1080 L0,1080 Z`} fill={`url(#${id})`} />
      <path d={superficie} fill="none" stroke={claro ? "#E8F2FB" : "#5FA2DD"} strokeWidth={3} opacity={0.9} />
    </g>
  );
}

// ---------- Etiquetas sin choques ----------
type Caja = [number, number, number, number];
const choca = (a: Caja, b: Caja) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const anchoTexto = (texto: string, size: number) => texto.length * size * 0.56;

// Corre la caja arriba o abajo (pasos de su alto) hasta que no choque con nada
// ni salga del cuadro util (debajo de la linea de titulo, arriba del piso).
function acomodar(caja: Caja, ocupadas: Caja[], piso: number): number {
  const alto = caja[3] - caja[1] + 6;
  for (const paso of [0, -1, 1, -2, 2, -3, 3, -4, 4]) {
    const dy = paso * alto;
    const c: Caja = [caja[0], caja[1] + dy, caja[2], caja[3] + dy];
    if (c[1] < 125 || c[3] > piso) continue;
    if (!ocupadas.some((o) => choca(o, c))) return dy;
  }
  return Math.min(0, piso - caja[3]);
}

const ancla = (u: Ubicado, parte: string): [number, number] => {
  const a = u.obj.anclas[parte] ?? [u.obj.ancho / 2, u.obj.alto / 2];
  return [u.x0 + a[0] * u.esc, u.y0 + a[1] * u.esc];
};

// ---------- Personaje: pictograma negro, sin cara ----------
// Paso del personaje: px por segundo y ciclo de piernas.
const PASO_PX_S = 260;
const PASO_HZ = 1.8;

// Donde esta parado el personaje en el segundo t (camina hacia un objeto).
function personajeX(t: number, rec: Recurso, lugares: Record<string, Ubicado | null>): { x: number; andando: boolean } {
  let x = PERSONAJE_X;
  let andando = false;
  for (const m of momentos(rec, "camina")) {
    const u = m.objeto ? lugares[m.objeto] : null;
    if (!u || t < m.at) continue;
    const meta = Math.max(PERSONAJE_X, u.x0 - 70);
    const dur = Math.max(0.6, Math.abs(meta - x) / PASO_PX_S);
    const k = Math.min(1, (t - m.at) / dur);
    if (k < 1) andando = true;
    x = lerp(x, meta, k);
  }
  return { x, andando };
}

function Personaje({ t, rec, objetivo, x: px, andando }: { t: number; rec: Recurso; objetivo: [number, number] | null; x: number; andando: boolean }) {
  const claro = useContext(Claro);
  const k = entra(t, momento(rec, "aparece", (m) => m.objeto === "personaje")?.at ?? rec.momentos[0]?.at);
  const aprieta = momento(rec, "aprieta")?.at;
  const kBrazo = golpe(t, aprieta, 0.3);
  const kRetro = entra(t, momento(rec, "evento")?.at, 0.3);
  // Ciclo de caminata: piernas y brazo libre en contrafase, rebote del paso.
  const fase = andando ? Math.sin(t * PASO_HZ * Math.PI * 2) : 0;
  const rebote = andando ? Math.abs(fase) * -6 : 0;
  const hombro: [number, number] = [px, 535 + rebote];
  const destino = objetivo ?? [hombro[0] + 150, hombro[1] + 70];
  const angObj = (Math.atan2(destino[1] - hombro[1], destino[0] - hombro[0]) * 180) / Math.PI;
  const largoObj = Math.min(170, Math.hypot(destino[0] - hombro[0], destino[1] - hombro[1]) - 6);
  const ang = (lerp(lerp(80 - fase * 25, angObj, kBrazo), 95, kRetro) * Math.PI) / 180;
  const largo = lerp(140, largoObj, kBrazo);
  const mano = [hombro[0] + Math.cos(ang) * largo, hombro[1] + Math.sin(ang) * largo];
  const cadera = 640 + rebote;
  const pie = (lado: number) => px + lado * 22 + fase * lado * 34;
  return (
    <g opacity={k} transform={`translate(${(1 - k) * -20} 0) rotate(${-kRetro * 10} ${px} ${SUELO})`} stroke={tinta(claro)} strokeLinecap="round" strokeWidth={18} fill="none">
      <line x1={px} y1={cadera} x2={pie(-1)} y2={SUELO} />
      <line x1={px} y1={cadera} x2={pie(1)} y2={SUELO} />
      <line x1={px} y1={520 + rebote} x2={px} y2={cadera} />
      <line x1={px} y1={535 + rebote} x2={px - 28 + fase * 30} y2={640 + rebote} />
      <line x1={hombro[0]} y1={hombro[1]} x2={mano[0]} y2={mano[1]} />
      <circle cx={px} cy={478 + rebote} r={26} fill={tinta(claro)} stroke="none" />
    </g>
  );
}

// En el mar o el cielo no hay donde pararse: el personaje va en un recuadro
// arriba a la izquierda con su tarjeta (como "23 años · el maquinista" de la
// referencia, AVE 3:50).
const CUADRO = { x: 110, y: 160, w: 260, h: 250 };
function PersonajeEnCuadro({ t, rec, c }: { t: number; rec: Recurso; c: ContenidoEsquema }) {
  const k = entra(t, momento(rec, "aparece", (m) => m.objeto === "personaje")?.at ?? rec.momentos[0]?.at);
  const kT = entra(t, momento(rec, "tarjeta")?.at ?? momento(rec, "aparece", (m) => m.objeto === "personaje")?.at);
  return (
    <g opacity={k} transform={`translate(${(1 - k) * -16} 0)`}>
      <rect x={CUADRO.x} y={CUADRO.y} width={CUADRO.w} height={CUADRO.h} fill="#FFFFFF" stroke="#C5CDD5" strokeWidth={2} />
      <g transform={`translate(${CUADRO.x + CUADRO.w / 2} ${CUADRO.y + 175}) scale(0.48) translate(${-PERSONAJE_X} ${-SUELO})`}>
        <line x1={PERSONAJE_X - 160} y1={SUELO} x2={PERSONAJE_X + 160} y2={SUELO} stroke={T.linea} strokeWidth={4} />
        <Claro.Provider value={true}>
          <Personaje t={t} rec={rec} objetivo={null} x={PERSONAJE_X} andando={false} />
        </Claro.Provider>
      </g>
      <g opacity={kT}>
        {c.personaje?.tarjeta && (
          <text x={CUADRO.x + 18} y={CUADRO.y + 212} fontFamily="Inter, sans-serif" fontWeight={800} fontSize={30} fill={T.tinta}>
            {c.personaje.tarjeta}
          </text>
        )}
        {c.personaje?.rol && (
          <text x={CUADRO.x + 18} y={CUADRO.y + 240} fontFamily="Inter, sans-serif" fontSize={21} fill={T.texto}>
            {c.personaje.rol}
          </text>
        )}
      </g>
    </g>
  );
}

function Tarjeta({ t, m, c, px }: { t: number; m: Momento | undefined; c: ContenidoEsquema; px: number }) {
  const k = entra(t, m?.at);
  if (!m || !c.personaje?.tarjeta) return null;
  const x = Math.max(70, px - 190);
  return (
    <g opacity={k}>
      <line x1={x + 110} y1={392} x2={px - 12} y2={452} stroke={T.linea} strokeWidth={2} />
      <rect x={x} y={300} width={220} height={92} fill="#FFFFFF" stroke="#C5CDD5" strokeWidth={2} />
      <text x={x + 20} y={346} fontFamily="Inter, sans-serif" fontWeight={800} fontSize={40} fill={T.tinta}>
        {c.personaje.tarjeta}
      </text>
      {c.personaje.rol && (
        <text x={x + 20} y={378} fontFamily="Inter, sans-serif" fontSize={22} fill={T.texto}>
          {c.personaje.rol}
        </text>
      )}
    </g>
  );
}

// ---------- Lupa: detalle ampliado de una parte ----------
// La lupa solo amplia algo que se pueda ver: con detalle hecho a mano, o una
// parte del dibujo ni diminuta ni casi todo el objeto (ampliar una ventana
// daba un cuadrado negro).
function lupaUtil(u: Ubicado, parte: string): boolean {
  if (u.obj.Detalle) return true;
  const c = u.obj.cajas?.[parte];
  if (!c || !u.obj.conDetalle?.includes(parte)) return false;
  const fraccion = ((c[2] - c[0]) * (c[3] - c[1])) / Math.max(1, u.obj.ancho * u.obj.alto);
  return fraccion > 0.01 && fraccion < 0.5;
}

const centroLupa = (u: Ubicado, parte: string): [number, number] => {
  const [ax, ay] = ancla(u, parte);
  return [Math.min(1920 - 160, ax + 295), Math.max(165, ay - 298)];
};

function Lupa({ t, rec, u, c, apagado, partes }: { t: number; rec: Recurso; u: Ubicado | null; c: ContenidoEsquema; apagado: number; partes: Record<string, EstadoParte | undefined> }) {
  const claro = useContext(Claro);
  const abre = momento(rec, "lupa")?.at;
  const k = entra(t, abre, 0.4);
  if (!u || !c.lupa || k === 0 || !lupaUtil(u, c.lupa.parte)) return null;
  const [ax, ay] = ancla(u, c.lupa.parte);
  const [cx, cy] = centroLupa(u, c.lupa.parte);
  const accion = mecanismo(t, momento(rec, "lupa_accion")?.at, 0.6);
  const mTexto = momento(rec, "lupa_texto");
  const kTexto = golpe(t, mTexto?.at);
  const kNota = entra(t, momento(rec, "lupa_nota")?.at);
  const Detalle = u.obj.Detalle;
  // Sin detalle hecho a mano (dibujos del Dibujante): la parte real, ampliada.
  const caja = u.obj.cajas?.[c.lupa.parte];
  const local = u.obj.anclas[c.lupa.parte] ?? [u.obj.ancho / 2, u.obj.alto / 2];
  const zoom = caja ? Math.min(5, Math.max(1.3, 190 / Math.max(caja[2] - caja[0], caja[3] - caja[1], 1))) : 2;
  const Dibujo = u.obj.Dibujo;
  const clip = `lupa-${c.lupa.objeto}-${c.lupa.parte}`;
  return (
    <g opacity={k * (1 - 0.5 * apagado)}>
      <line x1={ax + 15} y1={ay - 8} x2={cx - 92} y2={cy + 95} stroke={T.linea} strokeWidth={2} strokeDasharray="6 6" />
      <g transform={`translate(${cx} ${cy}) scale(${lerp(0.85, 1, k)})`}>
        <clipPath id={clip}>
          <circle r={132} />
        </clipPath>
        <circle r={135} fill="#FFFFFF" stroke={T.linea} strokeWidth={3} />
        {Detalle ? (
          <Detalle t={t} parte={c.lupa.parte} accion={accion} />
        ) : (
          <g clipPath={`url(#${clip})`}>
            <g transform={`scale(${zoom}) translate(${-local[0]} ${-local[1] + (c.lupa.texto ? 14 / zoom : 0)})`}>
              <Dibujo t={t} partes={partes} />
            </g>
          </g>
        )}
        {TEXTOS_EN_DIBUJOS && c.lupa.texto && (
          <rect x={-120} y={26} width={240} height={40} fill="#FFFFFF" opacity={Detalle ? 0 : 0.85 * kTexto} />
        )}
        {TEXTOS_EN_DIBUJOS && c.lupa.texto && (
          // Texto corto adentro del circulo; largo, debajo (adentro no entra).
          <text y={c.lupa.texto.length > 12 ? 180 : 56} textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight={800} fontSize={c.lupa.texto.length > 12 ? 32 : 30} letterSpacing={c.lupa.texto.length > 12 ? 1 : 4} fill={colorDe(mTexto?.significado, c.lupa.texto.length > 12 ? claro : true)} opacity={kTexto} {...(c.lupa.texto.length > 12 ? halo(claro) : {})}>
            {c.lupa.texto}
          </text>
        )}
        {TEXTOS_EN_DIBUJOS && c.lupa.nota && (
          <text y={88} textAnchor="middle" fontFamily="Inter, sans-serif" fontSize={21} fill={T.texto} opacity={kNota}>
            {c.lupa.nota}
          </text>
        )}
      </g>
    </g>
  );
}

// ---------- Contraste: escudo que promete y se rompe en el remate ----------
function Escudo({ t, m, u, remate }: { t: number; m: Momento | undefined; u: Ubicado | null; remate: number | undefined }) {
  const k = entra(t, m?.at, 0.5);
  if (!m || !u || k === 0) return null;
  const kE = golpe(t, remate, 0.15);
  const x0 = u.x0 - 30;
  const x1 = u.x0 + u.w + 30;
  const y0 = u.y0 + 5;
  const ym = u.y0 + u.h * 0.6;
  const cx = (x0 + x1) / 2;
  const fondo = SUELO + 15;
  const d = `M${x0},${y0} L${x1},${y0} L${x1},${ym} Q${x1},${fondo - 75} ${cx},${fondo} Q${x0},${fondo - 75} ${x0},${ym} Z`;
  const tf = remate === undefined ? 0 : Math.max(0, t - remate);
  const frag: [number, number, number, number][] = [
    [x0 + 10, y0 + 65, -1, -1],
    [x1 - 10, y0 + 65, 1, -1],
    [x0 + 5, ym, -1, 0.2],
    [x1 - 5, ym, 1, 0.2],
    [cx - 110, fondo - 5, -0.6, 1],
    [cx + 110, fondo - 5, 0.6, 1],
  ];
  return (
    <>
      <g opacity={k * (1 - kE)} transform={`translate(${cx} ${ym}) scale(${lerp(0.94, 1, k)}) translate(${-cx} ${-ym})`}>
        <path d={d} fill="rgba(46,184,114,0.07)" stroke={DOC.seguro} strokeWidth={4} />
      </g>
      {remate !== undefined &&
        t >= remate &&
        frag.map(([x, y, dx, dy], i) => {
          const dd = 160 * Math.min(tf / 0.7, 1);
          return (
            <polygon
              key={i}
              points="-16,-10 18,-6 2,16"
              fill="none"
              stroke={DOC.seguro}
              strokeWidth={4}
              opacity={Math.max(0, 1 - tf / 0.8)}
              transform={`translate(${x + dx * dd} ${y + dy * dd}) rotate(${tf * 240 * (i % 2 ? 1 : -1)})`}
            />
          );
        })}
    </>
  );
}

// ---------- Conexion entre principal y destino (cable, flujo) ----------
function Conexion({ t, rec, de, a, remate }: { t: number; rec: Recurso; de: Ubicado | null; a: Ubicado | null; remate: number | undefined }) {
  const m = momento(rec, "conectar");
  if (!m || !de || !a) return null;
  const p0 = [de.x0 + de.w, de.y0 + de.h * 0.67];
  const p2 = [a.x0, a.y0 + a.h * 0.5];
  const p1 = [(p0[0]! + p2[0]!) / 2, Math.max(p0[1]!, p2[1]!) + 60];
  const k = mecanismo(t, m.at, 0.7);
  const flujo = momento(rec, "flujo")?.at;
  const largo = Math.hypot(p2[0]! - p0[0]!, p2[1]! - p0[1]!) * 1.25;
  const punto = (u: number) => {
    const a2 = (1 - u) * (1 - u);
    const b = 2 * (1 - u) * u;
    const c2 = u * u;
    return [a2 * p0[0]! + b * p1[0]! + c2 * p2[0]!, a2 * p0[1]! + b * p1[1]! + c2 * p2[1]!];
  };
  const activo = flujo !== undefined && t >= flujo && (remate === undefined || t < remate);
  return (
    <g opacity={entra(t, m.at)}>
      <path d={`M${p0[0]},${p0[1]} Q${p1[0]},${p1[1]} ${p2[0]},${p2[1]}`} fill="none" stroke={T.linea} strokeWidth={3} strokeDasharray={largo} strokeDashoffset={largo * (1 - k)} />
      {activo &&
        [0, 0.33, 0.66].map((o, i) => {
          const [x, y] = punto(((t - flujo) * 0.7 + o) % 1);
          return <circle key={i} cx={x} cy={y} r={6} fill={T.dato2} />;
        })}
    </g>
  );
}

// ---------- Evento contenido ----------
function Evento({ t, m, u }: { t: number; m: Momento | undefined; u: Ubicado | null }) {
  const claro = useContext(Claro);
  if (!m || !u || t < m.at) return null;
  const k = golpe(t, m.at);
  const cx = u.x0 + u.w / 2;
  const cy = u.y0 + u.h * 0.6;
  const tf = t - m.at;
  const piezas = Array.from({ length: 12 }).map((_, i) => ({
    vx: Math.sin(i * 12.9898) * 420,
    vy: -380 - Math.abs(Math.cos(i * 78.233)) * 320,
    rot: (i % 2 ? 1 : -1) * (200 + i * 30),
    w: 10 + (i % 3) * 6,
  }));
  return (
    <g>
      <defs>
        <radialGradient id="halo-evento">
          <stop offset="0%" stopColor={DOC.peligro} stopOpacity={0.55} />
          <stop offset="100%" stopColor={DOC.peligro} stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={u.w * 1.1 * k} fill="url(#halo-evento)" />
      {piezas.map((p, i) => {
        const x = cx + p.vx * tf;
        const y = u.y0 + 160 * u.esc + p.vy * tf + 0.5 * 1100 * tf * tf;
        if (y > SUELO) return null;
        return <rect key={i} x={x} y={y} width={p.w} height={p.w * 0.6} fill={tinta(claro)} transform={`rotate(${p.rot * tf} ${x} ${y})`} />;
      })}
    </g>
  );
}

// Las capas que van por detras del objeto (halo) y por delante (etiqueta).
function EventoEtiqueta({ t, m, u, dy }: { t: number; m: Momento | undefined; u: Ubicado | null; dy: number }) {
  const claro = useContext(Claro);
  if (!m || !u || !m.texto) return null;
  const k = golpe(t, m.at);
  return (
    <text x={u.x0 + u.w / 2} y={u.y0 - 100 + dy + (1 - k) * 8} textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight={800} fontSize={54} fill={DOC.peligro} opacity={k} {...halo(claro)}>
      {m.texto}
    </text>
  );
}

// ---------- Etiquetas pegadas al objeto ----------
// Donde va cada texto pegado al dibujo (antes de acomodarlo).
const ETIQUETA = 38;
function cajaEtiqueta(m: Momento, u: Ubicado): Caja {
  const w = anchoTexto(m.texto ?? "", ETIQUETA);
  if (m.hace === "escudo") {
    const x = u.x0 + u.w + 30;
    const y = Math.min(u.y0 + 200, SUELO - 20);
    return [x, y - ETIQUETA, x + 25 + w, y + 6];
  }
  if (m.hace === "evento") {
    const cx = u.x0 + u.w / 2;
    const ww = anchoTexto(m.texto ?? "", 54);
    return [cx - ww / 2, u.y0 - 100 - 54, cx + ww / 2, u.y0 - 100 + 8];
  }
  if (m.posicion === "arriba" || !m.parte) {
    const cx = u.x0 + u.w / 2;
    return [cx - w / 2, u.y0 - 25 - ETIQUETA, cx + w / 2, u.y0 - 25 + 6];
  }
  const ay = ancla(u, m.parte)[1] + 8;
  return [u.x0 - w, ay - ETIQUETA, u.x0, ay + 6];
}

function Etiquetas({ t, rec, lugares, remate, ajuste }: { t: number; rec: Recurso; lugares: Record<string, Ubicado | null>; remate: number | undefined; ajuste: Map<Momento, number> }) {
  const claro = useContext(Claro);
  const kR = golpe(t, remate);
  const lista = momentos(rec, "etiqueta");
  return (
    <>
      {lista.map((m, i) => {
        const u = lugares[m.objeto ?? "principal"];
        if (!u || !m.texto) return null;
        const dy = ajuste.get(m) ?? 0;
        const k = entra(t, m.at) * (m.posicion === "arriba" && remate !== undefined ? 1 - golpe(t, remate, 0.15) : 1);
        const seguro = m.significado === "seguro";
        const color = seguro ? mezcla(DOC.seguro, T.gris, kR) : colorDe(m.significado, claro);
        const op = k * (seguro ? 1 - 0.6 * kR : 1);
        if (m.posicion === "arriba" || !m.parte) {
          return (
            <text key={i} x={u.x0 + u.w / 2} y={u.y0 - 25 + dy + (1 - k) * 8} textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight={600} fontSize={ETIQUETA} fill={color} opacity={op} {...halo(claro)}>
              {m.texto}
            </text>
          );
        }
        const [ax, ay] = ancla(u, m.parte);
        // Si la etiqueta se corrio, la linea baja en angulo hasta la parte.
        return (
          <g key={i} opacity={op}>
            <polyline points={`${u.x0 + 4},${ay + dy} ${u.x0 + 30},${ay + dy} ${ax},${ay}`} fill="none" stroke={color} strokeWidth={2} />
            <circle cx={ax} cy={ay} r={5} fill={color} />
            <text x={u.x0} y={ay + 8 + dy + (1 - k) * 8} textAnchor="end" fontFamily="Inter, sans-serif" fontWeight={600} fontSize={ETIQUETA} fill={color} {...halo(claro)}>
              {m.texto}
            </text>
          </g>
        );
      })}
    </>
  );
}

function EscudoEtiqueta({ t, m, u, remate, dy }: { t: number; m: Momento | undefined; u: Ubicado | null; remate: number | undefined; dy: number }) {
  const claro = useContext(Claro);
  if (!m || !u || !m.texto) return null;
  const kR = golpe(t, remate);
  const k = entra(t, m.at) * (1 - 0.6 * kR);
  const x = u.x0 + u.w + 30;
  const y = Math.min(u.y0 + 200, SUELO - 20) + dy;
  const color = mezcla(DOC.seguro, T.gris, kR);
  return (
    <g opacity={k}>
      <line x1={x} y1={y + 8} x2={x + 18} y2={y + 8} stroke={color} strokeWidth={2} />
      <text x={x + 25} y={y + (1 - k) * 8} fontFamily="Inter, sans-serif" fontWeight={600} fontSize={38} fill={color} {...halo(claro)}>
        {m.texto}
      </text>
    </g>
  );
}

// ---------- Escena completa ----------
export function EsquemaCapas({ t, rec, inicio, fin, componentes }: { t: number; rec: Recurso; inicio: number; fin: number; componentes?: Record<string, ComponenteSvg> | undefined }) {
  const c = rec.contenido as ContenidoEsquema;
  const claro = (rec.fondo ?? "claro") === "claro";
  const escenario: Escenario = c.escenario ?? "suelo";
  // Lugares base (sin movimiento) y en el segundo t (con "avanza").
  const base: Record<string, Ubicado | null> = {
    secundario: ubicar(c.secundario, "secundario", escenario, componentes),
    principal: ubicar(c.principal, "principal", escenario, componentes),
    destino: ubicar(c.destino, "destino", escenario, componentes),
  };
  encajar(base, escenario);
  const lugares: Record<string, Ubicado | null> = {};
  for (const [lugar, u] of Object.entries(base)) lugares[lugar] = u ? { ...u, x0: u.x0 + desplazamiento(t, rec, lugar, base) } : null;
  // Lupa sobre una parte sin detalle ("remaches" del Titanic): el motor no la
  // dibuja. En vez de no mostrar nada, la camara va a esa parte y la pinta.
  const lupaRota = !!c.lupa && !!base[c.lupa.objeto] && !lupaUtil(base[c.lupa.objeto]!, c.lupa.parte);
  const remate = remateAt(rec);
  const evento = momento(rec, "evento");
  const aprieta = momento(rec, "aprieta");
  const mEscudo = momento(rec, "escudo");
  const lugarEscudo = mEscudo?.objeto ?? "principal";
  const lugarEvento = evento?.objeto ?? "principal";

  // Estado de las partes de cada objeto: "parte" y "aprieta" les marcan el segundo.
  const partesDe = (lugar: string): Record<string, EstadoParte | undefined> => {
    const p: Record<string, EstadoParte | undefined> = {};
    for (const m of rec.momentos) {
      if ((m.hace === "parte" || m.hace === "aprieta") && m.objeto === lugar && m.parte) p[m.parte] = { at: m.at, significado: m.significado };
    }
    // Lupa que no se puede dibujar: la parte se pinta en foco en su palabra.
    const lupaAt = momento(rec, "lupa")?.at;
    if (lupaRota && c.lupa!.objeto === lugar && lupaAt !== undefined && !p[c.lupa!.parte]) p[c.lupa!.parte] = { at: lupaAt, significado: "foco" };
    return p;
  };
  const objetivo = aprieta?.objeto && aprieta.parte && lugares[aprieta.objeto] ? ancla(lugares[aprieta.objeto]!, aprieta.parte) : null;
  const persona = personajeX(t, rec, lugares);
  const enCuadro = escenario === "mar" || escenario === "cielo";

  // Etiquetas acomodadas una vez por escena (posiciones base, en orden de
  // aparicion): las nuevas esquivan a las anteriores, la lupa, la tarjeta y
  // los otros objetos; nunca bajan del piso.
  const ajuste = new Map<Momento, number>();
  const ocupadas: Caja[] = [];
  if (c.personaje && (escenario === "mar" || escenario === "cielo")) ocupadas.push([CUADRO.x, CUADRO.y, CUADRO.x + CUADRO.w, CUADRO.y + CUADRO.h]);
  else if (c.personaje?.tarjeta && momento(rec, "tarjeta")) ocupadas.push([Math.max(70, PERSONAJE_X - 190), 300, Math.max(70, PERSONAJE_X - 190) + 220, 392]);
  if (c.lupa && base[c.lupa.objeto] && lupaUtil(base[c.lupa.objeto]!, c.lupa.parte)) {
    const [lx, ly] = centroLupa(base[c.lupa.objeto]!, c.lupa.parte);
    // Texto largo de la lupa: va debajo del circulo, tambien ocupa lugar.
    const largo = (c.lupa.texto?.length ?? 0) > 12;
    const media = largo ? Math.max(140, anchoTexto(c.lupa.texto!, 26) / 2 + 10) : 140;
    ocupadas.push([lx - media, ly - 140, lx + media, ly + (largo ? 195 : 140)]);
  }
  const cajasObjeto = Object.entries(base).flatMap(([lugar, u]) => (u ? [{ lugar, caja: [u.x0, u.y0, u.x0 + u.w, u.y0 + u.h] as Caja }] : []));
  const piso = escenario === "mar" ? AGUA - 10 : SUELO - 10;
  const textos = rec.momentos
    .filter((m) => m.texto && (m.hace === "etiqueta" || m === mEscudo || m === evento))
    .sort((a, b) => a.at - b.at);
  for (const m of textos) {
    const lugar = m === mEscudo ? lugarEscudo : m === evento ? lugarEvento : (m.objeto ?? "principal");
    const u = base[lugar];
    if (!u) continue;
    const caja = cajaEtiqueta(m, u);
    const otros = cajasObjeto.filter((o) => o.lugar !== lugar).map((o) => o.caja);
    const dy = acomodar(caja, [...ocupadas, ...otros], piso);
    ajuste.set(m, dy);
    ocupadas.push([caja[0], caja[1] + dy, caja[2], caja[3] + dy]);
  }

  // Encuadre (camara): general, medio (sobre el principal) o detalle (sobre
  // la parte que importa). Sin zoom brusco: es el punto de vista de la escena
  // entera, con un acercamiento lento encima para que nunca quede quieta.
  const avance = Math.min(Math.max((t - inicio) / Math.max(1, fin - inicio), 0), 1);
  const principal = base.principal;
  // Detalle solo con un objeto y sin personaje: con varios cortaba al otro
  // (el Titanic en el borde); la lupa rota tampoco acerca tanto.
  const pedido = c.encuadre ?? "general";
  const varios = Object.values(base).filter(Boolean).length > 1 || !!c.personaje;
  const encuadre = lupaRota || (pedido === "detalle" && varios) ? "medio" : pedido;
  // Medio: acerca lo que permite que entren TODOS los objetos y el personaje
  // (antes dejaba el barco cortado al centrar en el iceberg, y al vigia
  // cortado al costado del armario). Detalle si recorta a proposito.
  const todos = Object.values(base).filter((u): u is Ubicado => !!u);
  const cajas: Caja[] = todos.map((u) => [u.x0, u.y0, u.x0 + u.w, u.y0 + u.h]);
  if (c.personaje && !enCuadro) cajas.push([persona.x - 120, 380, persona.x + 200, SUELO]);
  const caja = cajas.length
    ? [Math.min(...cajas.map((b) => b[0])), Math.min(...cajas.map((b) => b[1])), Math.max(...cajas.map((b) => b[2])), Math.max(...cajas.map((b) => b[3]))]
    : [0, 0, 1920, 1080];
  const zoomMedio = Math.min(1.35, (1920 * 0.9) / Math.max(1, caja[2]! - caja[0]!), (1080 * 0.8) / Math.max(1, caja[3]! - caja[1]!));
  const zoom = encuadre === "medio" ? Math.max(1, zoomMedio) : encuadre === "detalle" ? 1.6 : 1;
  let foco: [number, number] = [960, 540];
  if (encuadre === "medio" && todos.length) foco = [(caja[0]! + caja[2]!) / 2, (caja[1]! + caja[3]!) / 2];
  if (principal && encuadre === "detalle") {
    const parte = c.lupa?.objeto === "principal" ? c.lupa.parte : rec.momentos.find((m) => m.objeto === "principal" && m.parte)?.parte;
    foco = parte ? ancla(principal, parte) : [principal.x0 + principal.w / 2, principal.y0 + principal.h * 0.4];
  }
  // Que el encuadre no se salga del lienzo.
  const medio = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
  foco = [medio(foco[0], 960 / zoom, 1920 - 960 / zoom), medio(foco[1], 540 / zoom, 1080 - 540 / zoom)];
  const dx = lerp(-24, 24, avance) / zoom;
  const s = zoom * lerp(1, 1.05, avance);

  const objetos = (["principal", "destino", "secundario"] as const).map((lugar) => {
    const u = lugares[lugar];
    if (!u) return null;
    const ap = momento(rec, "aparece", (m) => m.objeto === lugar)?.at;
    // Entrada con un poco mas de cuerpo: sube, crece desde 0,9 y se asienta.
    const k = ap === undefined ? 1 : entra(t, ap, 0.6);
    const Dibujo = u.obj.Dibujo;
    const ox = u.x0 + u.w / 2;
    const oy = u.y0 + u.h;
    // Acciones sobre el objeto entero.
    const kInclina = mecanismo(t, momento(rec, "inclina", (m) => m.objeto === lugar)?.at, INCLINA_S);
    const kHunde = mecanismo(t, momento(rec, "hunde", (m) => m.objeto === lugar)?.at, HUNDE_S);
    const aParte = momento(rec, "se_parte", (m) => m.objeto === lugar)?.at;
    const ang = kInclina * INCLINA_GRADOS + kHunde * HUNDE_GRADOS;
    const baja = kHunde * u.h * 0.95;
    const dibujo = (
      <g style={claro ? undefined : { filter: u.obj.oscuro ? DIBUJO_OSCURO : DIBUJO_NOCHE }}>
        <g transform={`translate(${u.x0} ${u.y0}) scale(${u.esc})`}>
          <Dibujo t={t} partes={partesDe(lugar)} evento={evento?.objeto === lugar ? evento.at : undefined} />
        </g>
      </g>
    );
    // "inunda": el agua sube adentro del objeto (o de la parte: compartimentos).
    const inundaciones = momentos(rec, "inunda")
      .filter((m) => m.objeto === lugar && t >= m.at)
      .map((m, i) => {
        const caja = m.parte ? u.obj.cajas?.[m.parte] : undefined;
        const [x0, y0, x1, y1] = caja ? [u.x0 + caja[0] * u.esc, u.y0 + caja[1] * u.esc, u.x0 + caja[2] * u.esc, u.y0 + caja[3] * u.esc] : [u.x0 + u.w * 0.04, u.y0 + u.h * 0.3, u.x0 + u.w * 0.96, u.y0 + u.h];
        const nivel = mecanismo(t, m.at, INUNDA_S) * INUNDA_NIVEL;
        const ola = Math.sin(t * 3 + i) * 3;
        return <rect key={i} x={x0} y={y1 - (y1 - y0) * nivel + ola} width={x1 - x0} height={Math.max(0, (y1 - y0) * nivel - ola)} fill={claro ? "#3F86C6" : "#4C9BE0"} opacity={0.7} />;
      });
    // "se_parte": dos mitades que se separan y giran (sin explosion).
    const kParte = aParte === undefined ? 0 : golpe(t, aParte, 0.3) * 0.4 + mecanismo(t, aParte, 1.6) * 0.6;
    const contenido =
      kParte > 0 ? (
        <>
          <clipPath id={`izq-${lugar}`}>
            <rect x={u.x0 - 50} y={u.y0 - 200} width={u.w / 2 + 50} height={u.h + 400} />
          </clipPath>
          <clipPath id={`der-${lugar}`}>
            <rect x={u.x0 + u.w / 2} y={u.y0 - 200} width={u.w / 2 + 50} height={u.h + 400} />
          </clipPath>
          <g clipPath={`url(#izq-${lugar})`} transform={`translate(${-28 * kParte} ${10 * kParte}) rotate(${-16 * kParte} ${ox} ${oy})`}>
            {dibujo}
            {inundaciones}
          </g>
          <g clipPath={`url(#der-${lugar})`} transform={`translate(${28 * kParte} ${18 * kParte}) rotate(${18 * kParte} ${ox} ${oy})`}>
            {dibujo}
            {inundaciones}
          </g>
        </>
      ) : (
        <>
          {dibujo}
          {inundaciones}
        </>
      );
    return (
      <g key={lugar} opacity={k} transform={`translate(${ox} ${oy + (1 - k) * 40 + baja}) rotate(${ang}) scale(${lerp(0.9, 1, k)}) translate(${-ox} ${-oy})`}>
        {contenido}
      </g>
    );
  });

  return (
    <Claro.Provider value={claro}>
    <svg viewBox="0 0 1920 1080" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <g transform={`translate(960 540) scale(${s}) translate(${-foco[0] + dx} ${-foco[1]})`}>
        <Escenario t={t} escenario={escenario} claro={claro} />
        {/* Sin su texto ("insumergible") el escudo es una caja verde sin sentido. */}
        {TEXTOS_EN_DIBUJOS && <Escudo t={t} m={mEscudo} u={lugares[lugarEscudo] ?? null} remate={remate} />}
        <Evento t={t} m={evento} u={evento ? (lugares[lugarEvento] ?? null) : null} />
        <Conexion t={t} rec={rec} de={lugares.principal ?? null} a={lugares.destino ?? null} remate={remate} />
        {objetos}
        {escenario === "mar" && <AguaDelante t={t} claro={claro} />}
        {c.personaje && !enCuadro && <Personaje t={t} rec={rec} objetivo={objetivo} x={persona.x} andando={persona.andando} />}
        {!enCuadro && <Tarjeta t={t} m={momento(rec, "tarjeta")} c={c} px={persona.x} />}
        <Lupa t={t} rec={rec} u={c.lupa ? (lugares[c.lupa.objeto] ?? null) : null} c={c} apagado={golpe(t, remate, 0.3)} partes={c.lupa ? partesDe(c.lupa.objeto) : {}} />
        {TEXTOS_EN_DIBUJOS && (
          <>
            <Etiquetas t={t} rec={rec} lugares={lugares} remate={remate} ajuste={ajuste} />
            <EscudoEtiqueta t={t} m={mEscudo} u={lugares[lugarEscudo] ?? null} remate={remate} dy={mEscudo ? (ajuste.get(mEscudo) ?? 0) : 0} />
            <EventoEtiqueta t={t} m={evento} u={evento ? (lugares[lugarEvento] ?? null) : null} dy={evento ? (ajuste.get(evento) ?? 0) : 0} />
          </>
        )}
      </g>
      {/* El recuadro del personaje va fijo, fuera de la camara (quedaba cortado). */}
      {c.personaje && enCuadro && <PersonajeEnCuadro t={t} rec={rec} c={c} />}
    </svg>
    </Claro.Provider>
  );
}
