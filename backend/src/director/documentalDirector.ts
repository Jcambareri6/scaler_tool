import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { mapWithConcurrency } from "../lib/concurrency.js";
import { makeWorkDir } from "../lib/workDir.js";
import { motionCatalog, renderAnimatedStills, supportedOverlayIcons } from "../lib/motion.js";
import { placeNavHeaders, type PlacedOverlay } from "../lib/overlayTiming.js";
import { getActiveProvider } from "../lib/providers.js";
import { normalize } from "../tools/generateOverlay.tool.js";
import { TYPE_GUIDE, plannableTypes, toOverlaySpec } from "../tools/planOverlays.tool.js";
import { asList, callTool, clock, type Usage } from "./director.js";
import { validateComponent, type DrawingComponent } from "./drawings.js";
import type { Phrase } from "./phrases.js";
import { wordTime, type AnimatedPlan, type AnimatedScene } from "./sceneDirector.js";

// FORMATO DOCUMENTAL (docs/formato-documental/INFORME.md, fases 3 y 4).
// La IA decide QUE se muestra; el codigo decide DONDE y COMO se ve.
//
// Hub and spoke: este archivo es el ORQUESTADOR. Cada agente recibe su
// entrada solo de aca y devuelve su salida solo aca; ningun agente llama a
// otro ni lee su salida:
//   1. DIRECTOR (Opus, 1 llamada): plan de recursos (sin coordenadas, colores
//      ni duraciones). Si el codigo lo rechaza, a lo sumo 1 correccion.
//   2. DIBUJANTES (Sonnet, en paralelo): solo los objetos que no estan en la
//      biblioteca base. El orquestador les arma el pedido.
//   3. VERIFICADOR (codigo): datos del guion, nada rojo antes del remate,
//      objetos existentes, cobertura completa.
//   4. REVISOR (Sonnet, configurable): 1 pasada sobre capturas reales. Lo que
//      rechaza pasa a un recurso seguro: no hay rondas de ida y vuelta.
// Modelos por rol en provider.configuration: documental_director_model,
// documental_artist_model, documental_reviewer_model. "documental: false"
// apaga este camino y vuelve al formato anterior.

const DEFAULTS = {
  director: "claude-opus-5-5",
  // Opus tambien en dibujantes y revisor: con Sonnet el revisor dejaba pasar
  // escenas que no tenian sentido (0 de 49 rechazadas en el Titanic).
  artist: "claude-opus-5-5",
  reviewer: "claude-opus-5-5",
};
// ~70 escenas de 6-9 s en un video de 9 min: el plan es largo (streaming).
const DIRECTOR_MAX_TOKENS = 64000;
// En Sonnet 5.5 el razonamiento cuenta dentro de max_tokens: con 8000 un
// objeto detallado (el Titanic) se quedaba sin svg o sin entregar.
const ARTIST_MAX_TOKENS = 24000;
const ARTIST_INTENTOS = 3;
const ARTISTS = 6;
const REVIEW_BATCH = 12;
const TAIL_SECONDS = 0.8;
// Ritmo (como la referencia: algo cambia cada pocos segundos).
// Escenas de 6-9 s: con 9-13 s se veia la animacion terminar y habia que
// esperar la escena siguiente (aburria).
const TRAMO_MIN_S = 6;
const TRAMO_MAX_S = 9;
const TRAMO_RESTO_S = 3.5;
const TRAMO_CORTA_S = 4;
const MAX_ESCENA_S = TRAMO_MAX_S;
const MAX_SEGURA_S = 7;
// Nunca mas de esto sin que cambie algo en pantalla, tampoco al final.
const QUIETUD_MAX_S = 3.5;
const CAPTION_WORDS = 7;
// Escenas de menos de esto no se arman (quedaban de 2 s).
const ESCENA_MIN_S = 4;
// Primeras palabras de una frase que abre otro momento: "El 10 de abril de
// 1912", "A las 23:40", "Recién en 1985", "Durante 73 años".
const ABRE_MOMENTO = /^(\S+\s+){0,3}(\d{1,2} de [a-záéíóú]+|\d{1,2}:\d{2}|\d{4}\b|\d+ (años|horas|minutos|días))/i;
// Capitulos: a lo sumo esto y separados por al menos MIN_CAPITULO_S.
const MAX_CAPITULOS = 7;
const MIN_CAPITULO_S = 40;
// El contenedor de la escena entra enseguida (habia escenas 5 s vacias).
const ENTRADA_MAX_S = 1;
const ENTRADA_S = 0.4;

// Biblioteca base del motor (backend/motion/src/biblioteca). Mantener igual.
const BIBLIOTECA_BASE: Record<string, { nombre: string; partes: string[] }> = {
  consola: { nombre: "consola o tablero de control, con un boton", partes: ["boton"] },
  reactor_corte: { nombre: "reactor o deposito en corte, con barras que bajan y nucleo", partes: ["barras", "nucleo"] },
  ciudad: { nombre: "ciudad (edificios con ventanas que se encienden)", partes: ["ventanas"] },
};

const HACE_UBICACION = ["fecha", "hora", "hora_nota", "pais", "lugar", "region"];
const HACE_ESQUEMA = ["aparece", "tarjeta", "aprieta", "parte", "lupa", "lupa_accion", "lupa_texto", "lupa_nota", "etiqueta", "escudo", "conectar", "flujo", "evento", "avanza", "camina", "inclina", "hunde", "inunda", "se_parte"];
// Un esquema tiene que tener al menos una de estas (no solo textos ni "parte").
const ACCIONES = ["avanza", "camina", "aprieta", "inclina", "hunde", "inunda", "se_parte", "evento", "conectar", "flujo"];
const ENCUADRES = ["general", "medio", "detalle"];
const HACE_PICTOGRAMAS = ["aparece", "marca"];
// Recursos de datos de la referencia (fase 5): momentos de cada uno.
const HACE_DATOS: Record<string, string[]> = {
  documento: ["aparece", "linea", "resalta", "sello"],
  reloj: ["aparece", "avanza", "nota"],
  contador: ["aparece", "relacion"],
  leccion: ["aparece", "segunda"],
  ab: ["aparece", "resultado"],
};
const LUGARES = ["secundario", "principal", "destino"];
const ESCENARIOS = ["suelo", "mar", "interior", "cielo"];
const SIGNIFICADOS = ["seguro", "peligro", "foco", "neutro"];
const GRAFICOS = ["big_number", "versus", "data_viz_single", "timeline", "list", "kinetic_quote", "pivot_question", "card_grid", "myth_fact", "number_phrase", "person_card", "line_chart", "scale_compare", "map_globe"];

type Raw = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function directorSystem(types: string[]): string {
  const base = Object.entries(BIBLIOTECA_BASE)
    .map(([id, o]) => `- ${id}: ${o.nombre} · partes: ${o.partes.join(", ")}`)
    .join("\n");
  return `Sos el DIRECTOR de un video documental animado (estilo Ciencia y Vida). Recibis el guion en frases con id y decidis QUE se muestra en cada tramo. El codigo decide donde y como se ve: nunca des coordenadas, colores, tamanos ni duraciones.

Reglas del formato:
- Demostrar, no ilustrar: la imagen cambiaria si la afirmacion fuera falsa.
- RITMO: el video ya viene cortado en ESCENAS numeradas de 6 a 9 segundos. Entregas UNA escena por cada ESCENA, en orden, con "escena": su numero (no des desde/hasta). Cada una tiene que moverse: algo entra, avanza, camina, se pinta o se rompe en su tramo. NUNCA mas de 3,5 segundos sin que cambie algo, tampoco al final de la escena: reparti los momentos en palabras a lo largo de todo el tramo (no todos juntos al principio). Si un tema sigue en la escena siguiente, retomalo con otro encuadre u otra capa (el mismo objeto puede volver), o con otro recurso. Nunca dos escenas seguidas del mismo tipo de grafico.
- Fondo claro para mecanismos ("como funciona"); oscuro para datos, lugares y giros.
- Significados: seguro (verde), peligro (rojo), foco (naranja), neutro. NADA "peligro" antes del momento con remate=true. Un color no cambia de significado en la misma escena: lo que se CREIA o se PROMETIA (insumergible, a salvo) y despues se rompe va en neutro, nunca en verde. Verde solo para lo que de verdad salio bien.
- POCO TEXTO: en pantalla solo cifras, fechas, nombres propios o la frase remate de un bloque. Si la voz describe una accion que un dibujo puede mostrar (gira, choca, se inunda, se parte, se hunde, llega), va como esquema con esa accion, NUNCA como cita. Una cita (kinetic_quote) solo para el remate de un capitulo: como mucho 1 cada 8 escenas.
- Todo texto, cifra, fecha o nombre en pantalla sale literal del guion.
- Cada momento va atado a una palabra exacta de una frase: {"frase": "p7", "palabra": "apagar"}. El cambio fuerte (remate) cae en la palabra clave.

RECURSOS (tipo de cada escena):
1. "ubicacion": mapa con capas. contenido: {lugar, subtitulo?, region?, geo:{lat,lon}, fecha?:{dia,mes,anio}, hora?, hora_nota?}. momentos (hace): fecha (parte: dia|mes|anio), hora, hora_nota, pais, lugar, region.
2. "esquema_capas": escenario de perfil con lugares fijos de izquierda a derecha: personaje (pictograma), secundario, principal, destino. contenido: {escenario, principal, secundario?, destino?, personaje?:{tarjeta?, rol?}, lupa?:{objeto: "secundario"|"principal"|"destino", parte, texto?, nota?}}. Los objetos son ids de la biblioteca base o de objetos_nuevos. momentos (hace): aparece (objeto: lugar o "personaje"), tarjeta, aprieta (objeto + parte), parte (objeto + parte + significado: la parte se mueve, se pinta o se enciende), lupa, lupa_accion, lupa_texto (significado), lupa_nota, etiqueta (objeto + texto + significado, con parte o posicion "arriba"), escudo (objeto + texto + significado "seguro": promesa que se rompe en el remate), conectar (de principal a destino), flujo, evento (objeto + texto + remate: true; reemplaza a cualquier explosion: grietas, halo rojo y etiqueta), avanza (objeto + hacia: otro lugar; el objeto se mueve hasta quedar pegado al otro: el barco que se acerca al iceberg, el tren que llega a la estacion), camina (objeto: un lugar; el personaje camina hasta ese objeto), inclina (objeto: se ladea, la proa baja), hunde (objeto: baja y desaparece bajo el agua/suelo), inunda (objeto + parte opcional: el agua sube adentro; con varias partes, compartimento por compartimento en sus palabras), se_parte (objeto: se rompe en dos mitades que se separan).
   ENCUADRE (opcional): "general" (todo el escenario), "medio" (el principal grande) o "detalle" (la parte que importa, sin lupa). Alterna: dos escenas seguidas del mismo objeto no repiten encuadre.
   "parte" pinta un PEDAZO del objeto (un compartimento, la proa); nunca uses como parte el objeto entero. La lupa solo para una parte con detalle que se entienda ampliada.
   ESCENARIO (obligatorio): donde pasa la escena, para que tenga contexto y no sea un fondo vacio. "mar" (linea de agua: barcos, icebergs, botes flotan y se ve lo sumergido), "suelo" (tierra, vias, edificios), "interior" (una sala, un puente de mando, una cabina), "cielo" (aviones, objetos en el aire). Si la historia pasa en el mar, el escenario es "mar" y en el mar solo van cosas que flotan (nunca una ciudad, un edificio o una consola). Fondo "oscuro" para escenas de noche.
   CONTINUIDAD: la escena cuenta lo que dice la voz. Ubica los objetos como estan en la historia (lo que se acerca va a la izquierda y avanza hacia lo que esta a la derecha). Cada esquema tiene al menos una ACCION (avanza, camina, aprieta, inclina, hunde, inunda, se_parte, evento, conectar o flujo) ademas de etiquetas y partes: una escena que solo suma textos o pinta partes no sirve. Las acciones cuentan la historia (el barco avanza, choca, se inclina, se inunda compartimento por compartimento, se parte y se hunde).
3. "grafico": grafico del catalogo a pantalla completa para datos (una cifra, una comparacion, una lista, una linea de tiempo). grafico: {type, text, label?, items?, lat?, lon?, frase, palabra}. Tipos:
${types.map((t) => `- ${t}: ${TYPE_GUIDE[t as keyof typeof TYPE_GUIDE] ?? ""}`).join("\n")}
4. "pictogramas": grilla de figuras con cambio de estado, a pantalla completa. Para CANTIDADES DE PERSONAS O LUGARES y PROPORCIONES. contenido: {figura: "persona"|"lugar", grupos: [{etiqueta?, total, marcados, texto?, significado}]} con 1 grupo, o 2 grupos lado a lado para comparar proporciones. total de 1 a 100 (si el numero real es enorme, usa la proporcion: "1 de cada 4" = total 4, marcados 1). texto = la cifra literal del guion ("28 de 65"). momentos (hace): aparece (uno por grupo, en orden), marca (uno por grupo: las marcadas se pintan en esa palabra).
5. "documento": hoja a maquina (informe, telegrama, mensaje, ley, fuente oficial). contenido: {titulo, lineas: [hasta 9 renglones literales del guion], resaltar?: indice del renglon clave, sello?: palabra corta en rojo}. momentos: aparece, linea (uno por renglon, en orden), resalta, sello.
6. "reloj": la hora como protagonista (cuando importa cuanto tiempo paso). contenido: {hora: "23:40", hasta?: "02:20", nota?}. momentos: aparece, avanza (las agujas corren hasta "hasta"), nota.
7. "contador": 1 o 2 cifras que suben desde 0 (magnitudes, totales, comparaciones de cantidad). contenido: {valores: [{valor (numero), unidad?, etiqueta?, significado?}], relacion?: frase corta literal}. momentos: aparece (uno por valor), relacion.
8. "leccion": la conclusion de un caso o de un bloque, en fondo claro. contenido: {etiqueta: "La leccion del Titanic", frase, segunda?}. momentos: aparece, segunda.
9. "ab": dos opciones lado a lado con su resultado (lo que se hizo y lo que se podia hacer, antes y despues de una regla). contenido: {titulo?, opciones: [{titulo, resultado, bien: true|false}, {...}]}. momentos: aparece (una por opcion), resultado (uno por opcion).
Como mucho un tercio de las escenas son graficos y nunca dos seguidos. Variá: usa los recursos 4 a 9 cuando el dato lo pide, no todo en citas.
CITAS (kinetic_quote): la frase entera o un pedazo con sentido completo, de 4 a 8 palabras y como mucho 45 caracteres, que se entienda sola sin la voz (sujeto y verbo: "Nadie lo vio venir"), que nunca termine en "que", "y", "el", "de".
- big_number: "text" tiene que ser una CIFRA con su unidad ("1.500 personas", "22 nudos"). Algo sin cifra ("dos grados bajo cero") va en contador o en la escena del esquema.
- Toda cifra de muertos o victimas que diga la voz lleva su grafico (big_number, contador o pictogramas) en esa misma escena: es el dato mas importante.
- ubicacion: "lugar" es un lugar geografico (ciudad, puerto, pais, punto del mar); "region" es una zona geografica. Nunca un barco, una persona ni una empresa.
- scale_compare: solo con un icono de la lista ICONOS; si ninguno representa el objeto, usa otro recurso.
METRICAS (elegirlas mal confunde; cada una tiene que entenderse sin la voz):
- reloj: SOLO en la escena donde la voz dice esa hora; "hasta" solo si la voz dice la hora final; nota = algo sobre el tiempo ("dos horas y cuarenta minutos despues").
- contador: etiqueta = QUE es el numero ("toneladas", "personas a bordo"), nunca el comienzo de la frase ("Pesaba mas de"). valor = el numero que se dice; unidad corta.
- pictogramas: etiqueta = que representa el grupo ("lugares en los botes", "pasajeros de tercera"); significado "peligro" si es una falta o una perdida (lugares que faltan, muertos), "seguro" si es lo que se salvo.
- versus: los dos lados del mismo tipo y comparables (dos cifras con la misma unidad, o dos situaciones). Nunca una cifra contra una frase.
- list: UNA sola en todo el video, para la enumeracion que cierra (la cadena de causas). Titulo que nombra lo que se enumera ("La cadena"), nunca un conector ("Peor todavía"); renglones copiados literal de la voz.
- documento: SOLO para algo escrito de verdad que la voz CITA despues de dos puntos ("…con una frase: cállate, estoy ocupado"). La narracion ("seis mensajes avisaban de hielo") o una enumeracion de causas o pasos va en list o en el esquema, no en documento.

QUE RECURSO PARA CADA DATO (como en la referencia; elegir mal confunde):
- Personas o lugares ocupados de un total ("salio con 28, tenia lugar para 65", "20 botes para 1.178 personas"): pictogramas (figura "lugar" o "persona"). NO barras.
- Proporcion en un grupo ("1 de cada 4", "mas de la mitad") o dos grupos comparados ("primera clase: mas de la mitad; tercera: 1 de cada 4"): pictogramas con 1 o 2 grupos. NO versus.
- Una cifra que golpea sola ("murieron mas de 1.500"): big_number.
- 3 a 5 valores de la misma magnitud y unidad: data_viz_single (barras). Nunca para 2 valores donde uno es capacidad y otro lo ocupado.
- Dos cosas opuestas de distinta naturaleza (antes/despues, mito/realidad, lo que se creia vs lo que paso): ab o myth_fact. versus SOLO con dos cifras de la misma unidad.
- Cosas que pasaron en orden (fechas, horas): timeline. Pasos o causas que se suman: list.
- Un lugar o una fecha+hora: ubicacion. Como funciona o como paso algo fisico: esquema_capas.
- Un mensaje, telegrama, informe o ley: documento. Una hora o el tiempo que pasa ("dos horas y cuarenta minutos despues"): reloj.
- Una magnitud que impresiona o dos cantidades comparadas ("46 mil toneladas", "705 rescatados"): contador. La conclusion de un bloque: leccion. Lo que se hizo vs lo que habia que hacer: ab.

BIBLIOTECA BASE (dibujos que ya existen; usalos cuando sirvan):
${base}
Si hace falta otro objeto, pedilo en objetos_nuevos con id corto, nombre, descripcion de como se ve de perfil, sus partes con nombre y, si flota, calado: fraccion de su alto que queda bajo el agua (barco 0.25, bote 0.2, iceberg 0.85; la mayor parte de un iceberg esta sumergida). Cada objeto existe una sola vez y se reutiliza.
SIN TEXTOS SOBRE LOS DIBUJOS: en los esquemas no uses etiqueta, ni texto en escudo, evento o lupa (no se muestran). El esquema cuenta con imagen y acciones; el titulo es opcional y SOLO un nombre propio (una persona, un barco, una empresa: "Frederick Fleet", "Californian"); nunca un pedazo de la frase.

Ejemplo de escena (resumido; con escenas de 6-9 s esta seria la union de dos): {"escena":4,"tipo":"esquema_capas","fondo":"claro","titulo":[{"texto":"Sala de control","frase":"p3","palabra":"sala"}],"contenido":{"escenario":"interior","secundario":"consola","principal":"reactor_corte","destino":"ciudad","personaje":{"tarjeta":"25 años","rol":"el ingeniero"},"lupa":{"objeto":"secundario","parte":"boton","texto":"APAGAR"}},"momentos":[{"hace":"aprieta","objeto":"secundario","parte":"boton","frase":"p4","palabra":"pulsa"},{"hace":"parte","objeto":"principal","parte":"barras","frase":"p6","palabra":"apagar"},{"hace":"escudo","objeto":"principal","texto":"último recurso","significado":"seguro","frase":"p7","palabra":"último"},{"hace":"evento","objeto":"principal","texto":"explota","remate":true,"frase":"p8","palabra":"explota"}]}

ICONOS (campo "icon", solo scale_compare): ${supportedOverlayIcons().join(", ")}.
CAPITULOS: de 5 a 7 en todo el video, cada uno empieza en la PRIMERA frase de una ESCENA. El titulo es un nombre de 2 a 4 palabras que resume el bloque ("El barco", "Las advertencias", "Los botes", "La cadena de errores"), no un pedazo cortado de una frase.

Entrega con la herramienta plan_documental: capitulos (titulo y frase donde empieza), escenas (una por ESCENA numerada, con "escena": n, todas, en orden) y objetos_nuevos.`;
}

const directorTool: Anthropic.Tool = {
  name: "plan_documental",
  description: "Entrega el plan de recursos del video.",
  input_schema: {
    type: "object",
    properties: {
      capitulos: { type: "array", items: { type: "object" } },
      escenas: { type: "array", items: { type: "object" } },
      objetos_nuevos: { type: "array", items: { type: "object" } },
    },
    required: ["capitulos", "escenas"],
  },
};

// Guia de estilo FIJA del dibujante (fase 4): cuanto mas descriptiva, mas
// parejos salen los dibujos entre videos.
const artistSystem = `Sos el DIBUJANTE de un video documental animado (estilo Ciencia y Vida: infografia editorial). Dibujas UN objeto en SVG.

GUIA DE ESTILO (obligatoria):
- Vista de PERFIL estricta, sin perspectiva ni 3/4. El objeto apoya su base en el borde inferior del lienzo (y = height).
- Lienzo: width y height ajustados al objeto (entre 300 y 900 de ancho); el objeto ocupa todo el lienzo, sin margenes grandes.
- Paleta: rellenos planos claros #DFE5EB (cuerpo) y #D5DCE3 (segundo plano); detalles #B9C3CE; linea #2A3340 de 3 px en todos los contornos. NUNCA relleno negro ni oscuro: un relleno oscuro desaparece en las escenas de noche. Ventanas u ojos de buey: #9AA6B2, chicos.
- Nivel de detalle MEDIO, como un pictograma grande: la silueta se reconoce de lejos (un barco: casco, cubiertas, chimeneas, mastiles; un iceberg: parte emergida con caras planas y la masa sumergida mas grande debajo). Sin texturas, sin rayado, sin sombras, sin degradados, sin texto.
- Solo el objeto: sin agua, piso, cielo, olas ni linea de horizonte (el escenario lo pone el video).
- Cada parte pedida va en su propio <g data-part="nombre"> sin transform (si hace falta, ponelo en un <g> de adentro). Una parte es un pedazo del objeto (el casco, la proa, un compartimento, la antena), nunca el objeto entero.
- Solo formas: g, path, rect, circle, ellipse, line, polyline, polygon. Coordenadas absolutas.
MAL: perspectiva, relleno negro, una ventana como unica parte, olas dibujadas, texto. BIEN: silueta de perfil clara, partes que se reconocen, rellenos claros con linea oscura.
Entrega con la herramienta.`;

// Revisor: mira capturas reales; su motivo vuelve al director para corregir.
const REVISOR_SYSTEM = `Sos el REVISOR de un video documental animado. Mira cada captura como la veria alguien que no escucha la voz. Rechaza la escena si:
- algo esta cortado en el borde (un objeto, una persona) o encimado sobre un texto;
- la pantalla esta vacia o casi vacia;
- la imagen contradice a la voz o no tiene que ver con lo que dice;
- un objeto esta donde no puede estar (una ciudad o un edificio flotando en el mar) o con un tamaño absurdo (un bote mas grande que el barco);
- hay texto que no se entiende solo: un pedazo de frase cortada ("Pero los operadores de radio trabajaban", "no había luna", "Peor todavía"), una nota o lista sin contexto ("temía que se partieran": ¿quien?);
- pone lado a lado datos que no se comparan ("1.000 personas" junto a "2 grados bajo cero").
El motivo se lo va a leer el director para corregir la escena: decí en una frase que esta mal y que habria que hacer ("la cita esta cortada y no dice nada: usar el esquema del barco o una frase completa"). No rechaces por gusto de estilo. Responde solo JSON: {"rechazadas": [{"escena": "s3", "motivo": "..."}]}`;

const artistTool: Anthropic.Tool = {
  name: "entregar_dibujo",
  description: "Entrega el componente dibujado.",
  input_schema: {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      width: { type: "number" },
      height: { type: "number" },
      svg: { type: "string" },
      parts: { type: "object" },
    },
    required: ["id", "name", "width", "height", "svg", "parts"],
  },
};

// ---------- Verificador (codigo) ----------

interface Ctx {
  phrases: Phrase[];
  index: Map<string, number>;
  fullNorm: string;
  objetos: Set<string>;
  // Objetos que no flotan (biblioteca base: ciudad, consola, reactor): no van en el mar.
  noFlotan: Set<string>;
  types: string[];
}

function at(ctx: Ctx, raw: Raw): number | null {
  const i = ctx.index.get(String(raw.frase ?? ""));
  if (i === undefined) return null;
  return wordTime(ctx.phrases[i]!, str(raw.palabra));
}

// Cada cifra de un texto tiene que estar en el guion (datos inventados =
// rechazo). "Reactor 4" pasa si el guion dice "reactor numero 4"; "3 millones"
// no pasa si el 3 no aparece.
const CIFRA = /\d+(?:[.,]\d+)*/g;
const MUERTES = /\b(murieron|muertos|muertes|v[ií]ctimas|fallecieron|perdieron la vida)\b/i;
// "uno de cada cuatro" en el guion vale como "1 de cada 4" en pantalla.
const EN_LETRAS: Record<string, string> = {
  uno: "1", una: "1", dos: "2", tres: "3", cuatro: "4", cinco: "5", seis: "6", siete: "7", ocho: "8", nueve: "9", diez: "10",
  once: "11", doce: "12", veinte: "20", treinta: "30", cuarenta: "40", cincuenta: "50", cien: "100", mil: "1000",
};
function textoValido(ctx: Ctx, texto: string | undefined): boolean {
  if (!texto) return true;
  const cifras = texto.match(CIFRA) ?? [];
  if (cifras.length === 0) return true;
  const delGuion = new Set(ctx.fullNorm.match(CIFRA) ?? []);
  // hasOwnProperty: "constructor" (Thomas Andrews, el constructor) devolvia
  // una funcion heredada del objeto y rompia el verificador.
  for (const palabra of ctx.fullNorm.split(/[^a-z0-9]+/)) if (Object.prototype.hasOwnProperty.call(EN_LETRAS, palabra)) delGuion.add(EN_LETRAS[palabra]!);
  // "2224" en pantalla vale si el guion dice "2.224" (separador de miles).
  const sinSep = new Set([...delGuion].map((c) => c.replace(/[.,]/g, "")));
  return cifras.every((c) => delGuion.has(c) || sinSep.has(c.replace(/[.,]/g, "")));
}

// Texto citado por la voz: la frase que sigue a una que termina en ":".
function esCita(ctx: Ctx, linea: string): boolean {
  const l = normalize(linea);
  return ctx.phrases.some((p, i) => i > 0 && /:\s*$/.test(ctx.phrases[i - 1]!.text) && (normalize(p.text).includes(l) || l.includes(normalize(p.text))));
}

// Titulo de un recurso: solo un nombre propio ("Marconi", "Frederick Fleet").
// Los pedazos de la voz ("no había luna", "Uno por uno") no se entendian.
const UNIONES = new Set(["de", "del", "la", "el", "los", "las", "y"]);
function esNombre(texto: string): boolean {
  const palabras = texto.split(/\s+/).filter(Boolean);
  if (palabras.length === 0 || palabras.length > 4 || /\d/.test(texto)) return false;
  return palabras.every((w, i) => (i > 0 && UNIONES.has(w)) || /^[A-ZÁÉÍÓÚÑ]/.test(w)) && palabras.some((w) => /^[A-ZÁÉÍÓÚÑ]/.test(w) && w.length > 2) && (palabras.length > 1 || palabras[0]!.length > 3);
}

// Reglas de cada grafico (no rompen la escena: piden la correccion).
const MIN_PALABRAS_CITA = 4;
const MAX_LISTAS = 1;
// Una cita se lee de un vistazo: mas larga no entra o queda cortada.
const MAX_CARACTERES_CITA = 45;
const CONECTOR_INICIAL = /^(peor|además|ademas|pero|y|o|entonces|mientras|tambi[eé]n|incluso|encima|sin embargo)\b/i;
function reglasGrafico(spec: Raw, n: number, voz: string): string[] {
  const p: string[] = [];
  const text = String(spec.text ?? "");
  const cifra = (x: unknown) => /\d/.test(String(x ?? ""));
  if (spec.type === "big_number" && !cifra(text)) p.push(`escena ${n}: big_number sin cifra ("${text}"); usa una cifra o el esquema`);
  if (spec.type === "versus") {
    const items = (spec.items as Raw[] | undefined) ?? [];
    if (items.length === 2 && cifra(items[0]!.text) !== cifra(items[1]!.text)) p.push(`escena ${n}: versus de una cifra contra una frase; usa ab o dos cifras`);
  }
  if (spec.type === "scale_compare" && (!str(spec.icon) || !supportedOverlayIcons().includes(String(spec.icon)))) {
    delete spec.icon;
    p.push(`escena ${n}: scale_compare sin un icono de la lista ICONOS`);
  }
  if (spec.type === "kinetic_quote" && text.split(/\s+/).filter(Boolean).length < MIN_PALABRAS_CITA) p.push(`escena ${n}: cita de menos de ${MIN_PALABRAS_CITA} palabras ("${text}")`);
  if (spec.type === "kinetic_quote" && text.length > MAX_CARACTERES_CITA) p.push(`escena ${n}: cita de mas de ${MAX_CARACTERES_CITA} caracteres ("${text}"); quedate con la parte que tiene sentido sola`);
  // Lista: un titulo que nombra la lista ("La cadena"), no un conector
  // ("Peor todavía"), y renglones literales de la voz (no resumidos).
  if (spec.type === "list") {
    if (CONECTOR_INICIAL.test(text)) p.push(`escena ${n}: el titulo de la lista ("${text}") no nombra lo que enumera`);
    const sueltos = ((spec.items as Raw[] | undefined) ?? []).filter((i) => !voz.includes(normalize(String(i.text ?? ""))));
    if (sueltos.length) p.push(`escena ${n}: renglones de la lista que no son literales de la voz: ${sueltos.map((i) => `"${String(i.text)}"`).join(", ")}`);
  }
  return p;
}

interface Verificada {
  scene: Omit<AnimatedScene, "id" | "start" | "end">;
  desde: number;
  hasta: number;
  problemas: string[];
}

function verificarEscena(ctx: Ctx, raw: Raw, n: number): Verificada {
  const problemas: string[] = [];
  const desde = ctx.index.get(String(raw.desde ?? ""));
  const hasta = ctx.index.get(String(raw.hasta ?? ""));
  if (desde === undefined || hasta === undefined || hasta < desde) {
    return { scene: { elements: [], steps: [] }, desde: desde ?? 0, hasta: hasta ?? desde ?? 0, problemas: [`escena ${n}: desde/hasta invalidos`] };
  }
  const tipo = str(raw.tipo);
  if (tipo === "faltante") return { scene: { elements: [], steps: [] }, desde, hasta, problemas: [`escena ${n}: faltante (entrega una escena para cada ESCENA numerada)`] };

  if (tipo === "grafico") {
    const g = (raw.grafico ?? {}) as Raw;
    const spec = toOverlaySpec(g, ctx.types as never);
    if (!spec) return { scene: { elements: [], steps: [] }, desde, hasta, problemas: [`escena ${n}: grafico invalido`] };
    if (!textoValido(ctx, spec.text) || !textoValido(ctx, spec.label) || (spec.items ?? []).some((i) => !textoValido(ctx, i.text))) {
      problemas.push(`escena ${n}: el grafico tiene cifras que no estan en el guion`);
    }
    problemas.push(...reglasGrafico(spec as unknown as Raw, n, normalize(ctx.phrases.slice(desde, hasta + 1).map((p) => p.text).join(" "))));
    const t = at(ctx, g) ?? ctx.phrases[desde]!.start;
    return { scene: { elements: [{ id: "g", kind: "graphic", slot: "full", spec }], steps: [{ action: "show", target: "g", at: t }] } as never, desde, hasta, problemas };
  }

  if (tipo && HACE_DATOS[tipo]) {
    const c = (raw.contenido ?? {}) as Raw;
    const textos: (string | undefined)[] = [];
    let ok = true;
    if (tipo === "documento") {
      const lineas = asList(c.lineas ?? [], "lineas").map(String).filter(Boolean).slice(0, 9);
      ok = !!str(c.titulo) && lineas.length > 0;
      c.lineas = lineas;
      textos.push(str(c.titulo), str(c.sello), ...lineas);
      // Un documento muestra algo ESCRITO que la voz cita ("…con una frase:
      // cállate, estoy ocupado"); la narracion pegada en una hoja ("Avisos de
      // hielo: al menos seis mensajes…") no tiene sentido: pasa a lista.
      if (ok && !lineas.some((l) => esCita(ctx, l))) {
        problemas.push(`escena ${n}: el documento no muestra un texto escrito que la voz cite (usa list o el esquema)`);
        const spec = { type: "list", text: str(c.titulo)!, items: lineas.slice(0, 5).map((l) => ({ text: l, label: "" })), source: "script" };
        const t = at(ctx, (asList(raw.momentos ?? [], "momentos")[0] ?? {}) as Raw) ?? ctx.phrases[desde]!.start;
        return { scene: { elements: [{ id: "g", kind: "graphic", slot: "full", spec }], steps: [{ action: "show", target: "g", at: t }] } as never, desde, hasta, problemas };
      }
    } else if (tipo === "reloj") {
      ok = /\d{1,2}[:.h]\d{2}/.test(String(c.hora ?? ""));
      textos.push(str(c.hora), str(c.hasta), str(c.nota));
      // El reloj va donde la voz dice la hora (estaba a los 0:21 con una nota
      // que no tenia nada que ver).
      const voz = ctx.phrases.slice(desde, hasta + 1).map((p) => p.text).join(" ");
      if (ok && !voz.includes(String(c.hora).trim())) problemas.push(`escena ${n}: reloj fuera de lugar (la voz no dice "${String(c.hora)}" en esta escena)`);
    } else if (tipo === "contador") {
      const valores = asList(c.valores ?? [], "valores").map((v) => v as Raw).filter((v) => Number.isFinite(Number(v.valor))).slice(0, 2);
      ok = valores.length > 0;
      c.valores = valores.map((v) => ({ ...v, valor: Number(v.valor) }));
      // Dos cifras solo si se comparan (misma unidad): "1.000 personas" al
      // lado de "2 grados bajo cero" no tenia sentido. Queda la primera.
      if (valores.length === 2 && normalize(String(valores[0]!.unidad ?? "")) !== normalize(String(valores[1]!.unidad ?? ""))) {
        problemas.push(`escena ${n}: contador con dos cifras que no se comparan (distinta unidad); usa una sola cifra o dos de la misma unidad`);
        c.valores = (c.valores as Raw[]).slice(0, 1);
        delete c.relacion;
      }
      textos.push(str(c.relacion), ...valores.flatMap((v) => [String(v.valor), str(v.etiqueta)]));
    } else if (tipo === "leccion") {
      ok = !!str(c.etiqueta) && !!str(c.frase);
      textos.push(str(c.etiqueta), str(c.frase), str(c.segunda));
    } else if (tipo === "ab") {
      const opciones = asList(c.opciones ?? [], "opciones").map((o) => o as Raw).filter((o) => str(o.titulo) && str(o.resultado)).slice(0, 2);
      ok = opciones.length === 2;
      c.opciones = opciones.map((o) => ({ titulo: str(o.titulo), resultado: str(o.resultado), bien: o.bien === true }));
      textos.push(str(c.titulo), ...opciones.flatMap((o) => [str(o.titulo), str(o.resultado)]));
    }
    // Reloj y contador estan dibujados para fondo oscuro (cifras blancas).
    if (tipo === "reloj" || tipo === "contador") raw.fondo = "oscuro";
    if (!ok) problemas.push(`escena ${n}: ${tipo} invalido (revisa el contenido)`);
    if (textos.some((x) => !textoValido(ctx, x))) problemas.push(`escena ${n}: el ${tipo} tiene cifras que no estan en el guion`);
    raw.contenido = c;
  }
  if (tipo !== "ubicacion" && tipo !== "esquema_capas" && tipo !== "pictogramas" && !(tipo && HACE_DATOS[tipo])) {
    return { scene: { elements: [], steps: [] }, desde, hasta, problemas: [`escena ${n}: tipo "${String(tipo)}" desconocido`] };
  }
  if (tipo === "pictogramas") {
    const grupos = asList((raw.contenido as Raw | undefined)?.grupos ?? [], "grupos").map((g) => g as Raw);
    const validos = grupos.slice(0, 2).filter((g) => {
      const total = Number(g.total);
      const marcados = Number(g.marcados);
      return Number.isFinite(total) && total >= 1 && total <= 100 && Number.isFinite(marcados) && marcados >= 0 && marcados <= total;
    });
    if (validos.length === 0) problemas.push(`escena ${n}: pictogramas invalidos (1 o 2 grupos con total de 1 a 100 y marcados <= total)`);
    for (const g of validos) if (!textoValido(ctx, str(g.texto)) || !textoValido(ctx, str(g.etiqueta))) problemas.push(`escena ${n}: el texto de los pictogramas no esta en el guion`);
    (raw.contenido as Raw).grupos = validos;
  }
  const permitidos = tipo === "ubicacion" ? HACE_UBICACION : tipo === "pictogramas" ? HACE_PICTOGRAMAS : HACE_DATOS[tipo] ?? HACE_ESQUEMA;
  const contenido = (raw.contenido ?? {}) as Raw;
  const momentos = asList(raw.momentos, "momentos")
    .map((m) => m as Raw)
    .flatMap((m) => {
      const t = at(ctx, m);
      const hace = str(m.hace);
      if (t === null || !hace || !permitidos.includes(hace)) {
        problemas.push(`escena ${n}: momento invalido (${String(m.hace)} en ${String(m.frase)})`);
        return [];
      }
      if (!textoValido(ctx, str(m.texto))) {
        problemas.push(`escena ${n}: "${String(m.texto)}" no esta en el guion`);
        return [];
      }
      const sig = str(m.significado);
      return [
        {
          at: t,
          hace,
          ...(str(m.objeto) ? { objeto: str(m.objeto) } : {}),
          ...(str(m.parte) ? { parte: str(m.parte) } : {}),
          ...(str(m.texto) ? { texto: str(m.texto) } : {}),
          ...(sig && SIGNIFICADOS.includes(sig) ? { significado: sig } : {}),
          ...(m.posicion === "arriba" ? { posicion: "arriba" } : {}),
          ...(m.remate === true ? { remate: true } : {}),
          ...(str(m.hacia) && LUGARES.includes(str(m.hacia)!) ? { hacia: str(m.hacia) } : {}),
        },
      ];
    })
    .sort((a, b) => a.at - b.at);

  // Nada rojo antes del remate: se baja a neutro (y se avisa). Y nada verde
  // que despues se rompe: el escudo "insumergible" salia verde y a los dos
  // segundos todo era rojo (el color cambiaba de significado).
  const remate = momentos.find((m) => m.remate)?.at;
  for (const m of momentos) {
    if (m.significado === "peligro" && (remate === undefined || m.at < remate)) {
      m.significado = "neutro";
      problemas.push(`escena ${n}: "peligro" antes del remate (pasado a neutro)`);
    }
    if (m.significado === "seguro" && remate !== undefined && m.at < remate) m.significado = "neutro";
  }

  // Quietud: entre el comienzo, cada momento y el final del tramo nunca mas de
  // QUIETUD_MAX_S sin cambios (la animacion terminaba y quedaba quieta).
  const inicioTramo = ctx.phrases[desde]!.start;
  const finTramo = ctx.phrases[hasta + 1]?.start ?? ctx.phrases[hasta]!.end;
  const marcas = [inicioTramo, ...momentos.map((m) => m.at).filter((t) => t > inicioTramo && t < finTramo), finTramo];
  const huecos = marcas.slice(1).flatMap((t, i) => (t - marcas[i]! > QUIETUD_MAX_S ? [[marcas[i]!, t] as const] : []));
  if (huecos.length) problemas.push(`escena ${n}: ${huecos.map(([a, b]) => `${(b - a).toFixed(1)} s sin cambios (${clock(a)}–${clock(b)})`).join(", ")}; agrega momentos en palabras de ese tramo`);

  if (tipo === "ubicacion") {
    const geo = contenido.geo as { lat?: unknown; lon?: unknown } | undefined;
    if (!str(contenido.lugar) || typeof geo?.lat !== "number" || typeof geo?.lon !== "number") problemas.push(`escena ${n}: ubicacion sin lugar o coordenadas`);
    // "lugar: Titanic": un barco no es un lugar.
    const lugar = normalize(String(contenido.lugar ?? ""));
    if (lugar && [...ctx.objetos].some((o) => normalize(o) === lugar)) problemas.push(`escena ${n}: el lugar de la ubicacion tiene que ser geografico, no "${String(contenido.lugar)}"`);
    const f = contenido.fecha as { anio?: unknown } | undefined;
    if (f?.anio !== undefined && !ctx.fullNorm.includes(String(f.anio))) problemas.push(`escena ${n}: el año ${String(f.anio)} no esta en el guion`);
  } else if (tipo === "esquema_capas") {
    for (const lugar of ["principal", "secundario", "destino"]) {
      const id = str(contenido[lugar]);
      if (id && !ctx.objetos.has(id)) problemas.push(`escena ${n}: el objeto "${id}" no existe ni se pidio en objetos_nuevos`);
    }
    if (!str(contenido.principal)) problemas.push(`escena ${n}: falta el objeto principal`);
    // En el mar solo lo que flota: la ciudad salia con los edificios en el agua.
    if (contenido.escenario === "mar") {
      for (const lugar of ["principal", "secundario", "destino"]) {
        const id = str(contenido[lugar]);
        if (id && ctx.noFlotan.has(id)) problemas.push(`escena ${n}: "${id}" no flota y la escena es en el mar (usa otro escenario u otro objeto)`);
      }
    }
    if (contenido.escenario !== undefined && !ESCENARIOS.includes(String(contenido.escenario))) delete contenido.escenario;
    if (contenido.encuadre !== undefined && !ENCUADRES.includes(String(contenido.encuadre))) delete contenido.encuadre;
    // Movimiento: un esquema que solo suma textos o pinta partes no sirve.
    if (!momentos.some((m) => ACCIONES.includes(m.hace))) problemas.push(`escena ${n}: el esquema no tiene ninguna accion (${ACCIONES.join(", ")}); agrega al menos una`);
  }

  const titulo = asList(raw.titulo ?? [], "titulo")
    .map((p) => p as Raw)
    .flatMap((p) => (str(p.texto) && esNombre(str(p.texto)!) ? [{ texto: str(p.texto)!, at: at(ctx, p) ?? ctx.phrases[desde]!.start }] : []));
  const fondo = raw.fondo === "claro" || raw.fondo === "oscuro" ? raw.fondo : undefined;
  return {
    scene: { elements: [], steps: [], recurso: { tipo, ...(fondo ? { fondo } : {}), ...(titulo.length ? { titulo } : {}), contenido, momentos } } as never,
    desde,
    hasta,
    problemas: problemas.filter((p) => !p.includes("pasado a neutro")),
  };
}

// Recurso seguro: la frase del tramo como cita (dato del guion).
// Palabras con las que una cita no puede terminar ("…EDWARD SMITH QUE EL").
const CONECTORES = new Set(["que", "y", "e", "o", "u", "el", "la", "los", "las", "lo", "un", "una", "de", "del", "a", "al", "en", "con", "por", "para", "su", "sus", "se", "ni", "pero", "como", "mas", "más", "muy"]);

// Cita legible: hasta 8 palabras, cortando en una pausa natural si la hay y
// sin terminar en un conector.
function cita(texto: string): string[] {
  const todas = texto.split(/\s+/).filter(Boolean);
  let words = todas.slice(0, 8);
  const pausa = words.findIndex((w, i) => i >= 2 && /[,;:.!?]$/.test(w));
  if (todas.length > 8 && pausa >= 0) words = words.slice(0, pausa + 1);
  while (words.length > 2 && CONECTORES.has(words[words.length - 1]!.toLowerCase().replace(/[.,;:!?¿¡]/g, ""))) words.pop();
  return words;
}

function escenaSegura(ctx: Ctx, desde: number): Verificada["scene"] {
  const words = cita(ctx.phrases[desde]!.text);
  const label = [...words].sort((a, b) => b.length - a.length)[0] ?? words[0] ?? "";
  const spec = { type: "kinetic_quote", text: words.join(" ").replace(/[.,;:]+$/, ""), label: label.replace(/[.,;:]+$/, ""), source: "script" };
  return { elements: [{ id: "g", kind: "graphic", slot: "full", spec }], steps: [{ action: "show", target: "g", at: ctx.phrases[desde]!.start }] } as never;
}

// Un tramo largo en recurso seguro no puede ser UNA cita fija (quedaba 1:23
// la misma frase): se parte en citas de hasta MAX_SEGURA_S, una por frase.
function trozosSeguros(ctx: Ctx, desde: number, hasta: number): Pieza[] {
  const piezas: Pieza[] = [];
  let i = desde;
  while (i <= hasta) {
    let j = i;
    while (j < hasta && ctx.phrases[j + 1]!.end - ctx.phrases[i]!.start <= MAX_SEGURA_S) j++;
    piezas.push({ desde: i, hasta: j, scene: escenaSegura(ctx, i), segura: true });
    i = j + 1;
  }
  // Un resto corto se une a la cita anterior (quedaba "Y la clase importó" 2 s).
  const ultima = piezas[piezas.length - 1];
  if (ultima && piezas.length > 1 && ctx.phrases[ultima.hasta]!.end - ctx.phrases[ultima.desde]!.start < ESCENA_MIN_S) {
    piezas.pop();
    piezas[piezas.length - 1]!.hasta = ultima.hasta;
  }
  return piezas;
}

interface Pieza {
  desde: number;
  hasta: number;
  scene: Verificada["scene"];
  segura: boolean;
}

function sinDibujosFaltantes(rec: { contenido: Raw; momentos: Raw[] }, disponible: (id: unknown) => boolean): void {
  const c = rec.contenido;
  const faltan = ["principal", "secundario", "destino"].filter((l) => str(c[l]) && !disponible(c[l]));
  if (faltan.length === 0) return;
  for (const l of faltan) delete c[l];
  // Principal vacio: sube el secundario o el destino (con sus momentos).
  let renombre: [string, string] | null = null;
  if (!str(c.principal)) {
    const reemplazo = ["secundario", "destino"].find((l) => str(c[l]));
    if (reemplazo) {
      c.principal = c[reemplazo];
      delete c[reemplazo];
      renombre = [reemplazo, "principal"];
    }
  }
  const lugar = (v: unknown) => (renombre && v === renombre[0] ? renombre[1] : v);
  rec.momentos = rec.momentos
    .map((m) => ({ ...m, ...(m.objeto !== undefined ? { objeto: lugar(m.objeto) } : {}), ...(m.hacia !== undefined ? { hacia: lugar(m.hacia) } : {}) }))
    // Fuera los momentos de objetos que ya no estan en la escena (y un
    // "avanza" que quedo apuntando a si mismo).
    .filter((m) => m.hacia === undefined || m.hacia !== m.objeto)
    .filter((m) => (m.hacia === undefined || str(c[String(m.hacia)])) && (m.objeto === undefined || m.objeto === "personaje" || str(c[String(m.objeto)])));
  const lupa = c.lupa as Raw | undefined;
  if (lupa && !str(c[String(lupa.objeto)])) delete c.lupa;
}

// Ultima frase que entra en MAX_ESCENA_S desde `desde`.
function corte(phrases: Phrase[], desde: number, hasta: number): number {
  let c = desde;
  while (c < hasta && phrases[c + 1]!.end - phrases[desde]!.start <= MAX_ESCENA_S) c++;
  return c;
}

// Menos texto: un tramo de recurso seguro se suma a la escena buena de al
// lado (la anterior y si no la siguiente; el dibujo sigue en pantalla) si no
// queda demasiado larga. Con tope MAX_ESCENA_S + 4 y escenas de 6-9 s casi
// nada entraba y quedaban 25 citas.
const ABSORBE_MAX_S = 16;
function absorberSeguras<T extends Pieza>(piezas: T[], phrases: Phrase[]): T[] {
  const dura = (desde: number, hasta: number) => phrases[hasta]!.end - phrases[desde]!.start;
  const hacia: T[] = [];
  for (const p of piezas) {
    const previa = hacia[hacia.length - 1];
    if (p.segura && previa && !previa.segura && dura(previa.desde, p.hasta) <= ABSORBE_MAX_S) previa.hasta = p.hasta;
    else hacia.push(p);
  }
  const out: T[] = [];
  for (let i = hacia.length - 1; i >= 0; i--) {
    const p = hacia[i]!;
    const siguiente = out[0];
    if (p.segura && siguiente && !siguiente.segura && dura(p.desde, siguiente.hasta) <= ABSORBE_MAX_S) siguiente.desde = p.desde;
    else out.unshift(p);
  }
  return continuarDibujo(out);
}

// Lo que quedo sin escena NO pasa a texto (la cita salia cortada: "Pero los
// operadores de radio trabajaban"): repite el dibujo mas cercano (el anterior
// y si no el siguiente) con otro encuadre. Sus momentos ya pasaron, asi que
// muestra como quedo despues de la animacion. Cita solo si no hay ningun dibujo.
const OTRO_ENCUADRE: Record<string, string> = { general: "medio", medio: "general", detalle: "general" };
function continuarDibujo<T extends Pieza>(piezas: T[]): T[] {
  const dibujo = (p: T | undefined) => !!p && !p.segura && !!(p.scene as unknown as { recurso?: unknown }).recurso;
  return piezas.map((p, i) => {
    if (!p.segura) return p;
    const cerca = [...piezas.slice(0, i)].reverse().find(dibujo) ?? piezas.slice(i + 1).find(dibujo);
    if (!cerca) return p;
    const scene = JSON.parse(JSON.stringify(cerca.scene)) as { recurso: { tipo: string; contenido: Raw } };
    if (scene.recurso.tipo === "esquema_capas") scene.recurso.contenido.encuadre = OTRO_ENCUADRE[String(scene.recurso.contenido.encuadre ?? "general")] ?? "medio";
    return { ...p, scene: scene as unknown as Pieza["scene"] };
  });
}

// Ritmo dentro de la escena: solo el CONTENEDOR sin texto (la hoja del
// documento, la grilla de pictogramas, el dibujo del esquema) entra enseguida
// para que no haya pantalla vacia. Nada con texto ni ningun cambio se adelanta
// a su palabra: adelantarlos hacia que todo llegara antes que la voz.
const ENTRADA_SIN_TEXTO = ["documento", "pictogramas", "esquema_capas"];
function ajustarRitmo(scene: AnimatedScene): AnimatedScene {
  const { start } = scene;
  const rec = scene.recurso as { tipo?: string; momentos?: { at: number; hace: string }[] } | undefined;
  if (!rec?.momentos?.length || !ENTRADA_SIN_TEXTO.includes(String(rec.tipo))) return scene;
  const momentos = rec.momentos.map((m) => ({ ...m })).sort((a, b) => a.at - b.at);
  const primero = momentos[0]!;
  if (primero.hace === "aparece" && primero.at > start + ENTRADA_MAX_S) primero.at = start + ENTRADA_S;
  return { ...scene, recurso: { ...scene.recurso, momentos } };
}

// Ids y tiempos de las piezas, en orden: cada una dura hasta que empieza la siguiente.
function cronometrar(piezas: (Pieza & { id: string })[], phrases: Phrase[], videoEnd: number): AnimatedScene[] {
  const inicio = (i: number) => (i === 0 ? 0 : Math.max(0, phrases[i]!.start - 0.15));
  return piezas.map((p, k) => ajustarRitmo({ id: p.id, start: inicio(p.desde), end: piezas[k + 1] ? inicio(piezas[k + 1]!.desde) : videoEnd, ...p.scene } as AnimatedScene));
}

// Subtitulos por frase en tramos de CAPTION_WORDS; un tramo de 1 o 2 palabras
// ("A", "de") se suma al anterior de la misma frase o al siguiente.
type Tramo = { start: number; end: number; words: { text: string; start: number; end: number }[] };
export function armarSubtitulos(phrases: Phrase[], videoEnd: number): Tramo[] {
  const captions: (Tramo & { frase: number })[] = [];
  phrases.forEach((p, f) => {
    for (let i = 0; i < p.words.length; i += CAPTION_WORDS) captions.push({ start: p.words[i]!.start, end: 0, words: p.words.slice(i, i + CAPTION_WORDS), frase: f });
  });
  const unidos: (Tramo & { frase: number })[] = [];
  for (let k = 0; k < captions.length; k++) {
    const c = captions[k]!;
    const previo = unidos[unidos.length - 1];
    if (c.words.length <= 2 && previo && previo.frase === c.frase) previo.words.push(...c.words);
    else if (c.words.length <= 2 && captions[k + 1]) captions[k + 1] = { ...captions[k + 1]!, start: c.start, words: [...c.words, ...captions[k + 1]!.words] };
    else unidos.push(c);
  }
  unidos.forEach((c, i) => (c.end = unidos[i + 1]?.start ?? videoEnd));
  return unidos.map(({ frase: _f, ...c }) => c);
}

// ---------- Verificacion y armado (codigo puro, sin IA: se puede probar) ----------

export function verificarPlan(r: Raw | undefined, phrases: Phrase[]) {
  const types = plannableTypes().filter((t) => GRAFICOS.includes(t));
  const ctx: Ctx = {
    phrases,
    index: new Map(phrases.map((p, i) => [p.id, i])),
    fullNorm: normalize(phrases.map((p) => p.text).join(" ")),
    objetos: new Set([...Object.keys(BIBLIOTECA_BASE), ...asList(r?.objetos_nuevos ?? [], "objetos_nuevos").flatMap((o) => (str((o as Raw).id) ? [str((o as Raw).id)!] : []))]),
    noFlotan: new Set(Object.keys(BIBLIOTECA_BASE)),
    types,
  };
  const escenas = asList(r?.escenas ?? [], "escenas").map((e, i) => verificarEscena(ctx, e as Raw, i + 1));
  const problemas = escenas.flatMap((e) => e.problemas);
  // Cobertura: escenas seguidas sin huecos desde la primera frase a la ultima.
  let next = 0;
  for (const e of escenas) {
    if (e.desde !== next) problemas.push(`hueco o solape: la escena que empieza en ${phrases[e.desde]?.id} deberia empezar en ${phrases[next]?.id}`);
    next = e.hasta + 1;
  }
  if (next !== phrases.length) problemas.push(`faltan frases al final: desde ${phrases[next]?.id ?? "?"}`);
  // Poco texto: las citas son para remates, no para cualquier frase.
  const citas = escenas.filter((e) => JSON.stringify(e.scene).includes('"kinetic_quote"')).length;
  const maxCitas = Math.ceil(escenas.length / 8);
  if (citas > maxCitas) problemas.push(`demasiadas citas (${citas}); como mucho ${maxCitas}: lo que el dibujo puede mostrar va como esquema`);
  // Una sola lista por video (la cadena de causas del cierre): las demas eran
  // pedazos de la voz sin contexto ("temía que se partieran").
  const listas = escenas.filter((e) => JSON.stringify(e.scene).includes('"type":"list"')).length;
  if (listas > MAX_LISTAS) problemas.push(`demasiadas listas (${listas}); como mucho ${MAX_LISTAS}, para la enumeracion que cierra el video: lo demas va como esquema o como dato`);
  // La cifra de muertos lleva su grafico (en el Titanic, "murieron mas de
  // 1.500" pasaba con una cita de otra cosa en pantalla).
  for (const e of escenas) {
    const enEscena = JSON.stringify(e.scene).replace(/(\d)[.,](\d)/g, "$1$2");
    for (let i = e.desde; i <= e.hasta; i++) {
      const texto = phrases[i]?.text ?? "";
      if (!MUERTES.test(texto)) continue;
      const cifras = (texto.match(CIFRA) ?? []).map((c) => c.replace(/[.,]/g, ""));
      if (cifras.length && !cifras.some((c) => enEscena.includes(c))) problemas.push(`la cifra de muertos de ${phrases[i]!.id} ("${texto}") no tiene su grafico en esa escena`);
    }
  }
  return { ctx, escenas, problemas };
}

// ---------- Tramos: el CODIGO corta las escenas, no la IA ----------
// Misma logica que build_scenes (buildScenes.tool.ts): se agrupan frases de
// la transcripcion, cortando siempre al final de una frase, hasta llegar a
// TRAMO_MIN_S sin pasar TRAMO_MAX_S; un resto corto al final se une al
// anterior. Asi ninguna pantalla queda fija un minuto (pasaba con 1:23).
export function armarTramos(phrases: Phrase[]): { desde: number; hasta: number }[] {
  const tramos: { desde: number; hasta: number }[] = [];
  let desde = 0;
  for (let i = 0; i < phrases.length; i++) {
    const dur = phrases[i]!.end - phrases[desde]!.start;
    const conSiguiente = phrases[i + 1] ? phrases[i + 1]!.end - phrases[desde]!.start : Infinity;
    // Corta al llegar a TRAMO_MIN_S, o antes si la frase siguiente pasa
    // TRAMO_MAX_S, salvo que la escena sea todavia muy corta (< TRAMO_CORTA_S).
    // Tambien antes de una frase que abre otro momento (fecha, hora, año): el
    // mapa de Southampton entraba 5 s despues de "El 10 de abril de 1912".
    const abre = !!phrases[i + 1] && ABRE_MOMENTO.test(phrases[i + 1]!.text);
    if (i === phrases.length - 1 || dur >= TRAMO_MIN_S || (conSiguiente > TRAMO_MAX_S && dur >= TRAMO_CORTA_S) || (abre && dur >= TRAMO_CORTA_S)) {
      tramos.push({ desde, hasta: i });
      desde = i + 1;
    }
  }
  const ultimo = tramos[tramos.length - 1];
  if (ultimo && tramos.length > 1 && phrases[ultimo.hasta]!.end - phrases[ultimo.desde]!.start < TRAMO_RESTO_S) {
    tramos.pop();
    tramos[tramos.length - 1]!.hasta = ultimo.hasta;
  }
  return tramos;
}

// Las escenas del director se ubican en sus tramos por numero ("escena": n);
// los desde/hasta los pone el codigo. Un tramo sin escena queda "faltante".
export function alinearATramos(r: Raw | undefined, phrases: Phrase[], tramos: { desde: number; hasta: number }[]): Raw | undefined {
  if (!r) return r;
  const porNumero = new Map<number, Raw>();
  asList(r.escenas ?? [], "escenas").forEach((e, i) => {
    const n = Number((e as Raw).escena);
    porNumero.set(Number.isInteger(n) && n >= 1 ? n : i + 1, e as Raw);
  });
  const escenas = tramos.map((t, k) => ({
    ...(porNumero.get(k + 1) ?? { tipo: "faltante" }),
    desde: phrases[t.desde]!.id,
    hasta: phrases[t.hasta]!.id,
  }));
  return { ...r, escenas };
}

export function armarPlan(
  raw: Raw,
  v: ReturnType<typeof verificarPlan>,
  phrases: Phrase[],
  components: Record<string, DrawingComponent>,
  navCtx: { channel: string | null; topic: string | null; locale: string | null },
  models: { director: string; designer: string },
  usage: Usage
): { plan: AnimatedPlan; seguras: string[]; piezas: (Pieza & { id: string })[] } {
  const videoEnd = phrases[phrases.length - 1]!.end + TAIL_SECONDS;
  const disponible = (id: unknown) => !str(id) || !!BIBLIOTECA_BASE[str(id)!] || !!components[str(id)!];
  const seguras: string[] = [];
  // Cada escena del director da una o mas piezas: rota -> citas cortas; mas
  // larga que MAX_ESCENA_S -> el recurso hasta el corte y citas cortas el resto.
  const todas = v.escenas.flatMap((e, i) => {
    const rec = (e.scene as unknown as { recurso?: { tipo: string; contenido: Raw } }).recurso;
    // Un dibujo que fallo no tira la escena: se saca ese objeto (y sus
    // momentos); si era el principal, lo reemplaza otro objeto de la escena.
    // Solo sin ningun objeto la escena pasa a recurso seguro.
    // Si la correccion no lo arreglo, lo que no flota sale de una escena en el mar.
    const enMar = rec?.tipo === "esquema_capas" && rec.contenido.escenario === "mar";
    if (rec?.tipo === "esquema_capas") sinDibujosFaltantes(rec as unknown as { contenido: Raw; momentos: Raw[] }, (id) => disponible(id) && (!enMar || !v.ctx.noFlotan.has(String(id))));
    const faltaDibujo = rec?.tipo === "esquema_capas" && !str(rec.contenido.principal);
    const roto = e.problemas.some((p) => /invalid|desconocido|no existe|falta el objeto|sin lugar|faltante/.test(p)) || faltaDibujo;
    if (roto) seguras.push(`s${i + 1}`);
    let c = corte(phrases, e.desde, e.hasta);
    // Un resto mas corto que ESCENA_MIN_S queda en el recurso (antes, cita de 2 s).
    if (c < e.hasta && phrases[e.hasta]!.end - phrases[c + 1]!.start < ESCENA_MIN_S) c = e.hasta;
    const propias: Pieza[] = roto
      ? trozosSeguros(v.ctx, e.desde, e.hasta)
      : [{ desde: e.desde, hasta: c, scene: e.scene, segura: false }, ...(c < e.hasta ? trozosSeguros(v.ctx, c + 1, e.hasta) : [])];
    return propias.map((p, k) => ({ ...p, id: k === 0 ? `s${i + 1}` : `s${i + 1}-${k + 1}` }));
  });
  const piezas = absorberSeguras(todas, phrases);
  // Variedad de plano: nunca dos esquemas seguidos con el mismo encuadre sobre
  // el mismo objeto (eran ~20 escenas del barco chico al centro).
  const CICLO = ["general", "medio", "detalle", "medio"];
  let previo: { principal?: unknown; encuadre?: unknown } = {};
  let vuelta = 0;
  for (const p of piezas) {
    const rec = (p.scene as unknown as { recurso?: { tipo: string; contenido: Raw } }).recurso;
    if (rec?.tipo !== "esquema_capas") continue;
    const c = rec.contenido;
    if (!c.encuadre) c.encuadre = CICLO[vuelta++ % CICLO.length];
    if (c.encuadre === previo.encuadre && c.principal === previo.principal) c.encuadre = ENCUADRES.find((e) => e !== c.encuadre);
    previo = { principal: c.principal, encuadre: c.encuadre };
  }
  const scenes = cronometrar(piezas, phrases, videoEnd);

  // Capa fija: capitulos -> linea de capitulo; subtitulos palabra por palabra.
  const capitulos = asList(raw.capitulos ?? [], "capitulos").map((c) => c as Raw);
  // Cada capitulo empieza con la escena que lo contiene (la linea de capitulo
  // cambiaba 5 s antes o despues que la imagen); pocos y separados.
  const marks: PlacedOverlay[] = [];
  for (const c of capitulos) {
    const i = v.ctx.index.get(String(c.frase ?? c.desde ?? ""));
    if (i === undefined || !str(c.titulo)) continue;
    const escena = scenes.find((s) => s.start <= phrases[i]!.start && phrases[i]!.start < s.end);
    const start = escena ? escena.start : phrases[i]!.start;
    const previo = marks[marks.length - 1];
    if (marks.length >= MAX_CAPITULOS || (previo && start - previo.start < MIN_CAPITULO_S)) continue;
    marks.push({ spec: { type: "title_card", text: str(c.titulo)!, source: "script" }, start, end: start + 1 } as PlacedOverlay);
  }
  const nav = placeNavHeaders(marks, videoEnd, navCtx);
  const captions = armarSubtitulos(phrases, videoEnd);

  return {
    seguras,
    piezas,
    plan: {
      scenes,
      components,
      nav,
      captions,
      durationSeconds: videoEnd,
      storyboard: {
        chapters: marks.map((m) => ({ title: m.spec.text, start: m.start })),
        scenes: v.escenas.map((e, i) => ({ from: phrases[e.desde]!.id, to: phrases[e.hasta]!.id, intent: (e.scene as unknown as { recurso?: { tipo: string } }).recurso?.tipo ?? "grafico", idea: seguras.includes(`s${i + 1}`) ? "recurso seguro" : "", dropped: e.problemas })),
        models,
        usage,
      },
    },
  };
}

// ---------- Orquestador ----------

export async function directDocumental(input: {
  phrases: Phrase[];
  videoTopic?: string;
  nav: { channel: string | null; topic: string | null; locale: string | null };
}): Promise<AnimatedPlan | null> {
  const { phrases } = input;
  if (phrases.length === 0) return null;
  const provider = await getActiveProvider("anthropic");
  if (!provider?.api_key) return null;
  const config = (provider.configuration ?? {}) as Record<string, unknown>;
  if (config.documental === false) return null;
  const models = {
    director: str(config.documental_director_model) ?? DEFAULTS.director,
    artist: str(config.documental_artist_model) ?? DEFAULTS.artist,
    reviewer: str(config.documental_reviewer_model) ?? DEFAULTS.reviewer,
  };
  const client = new Anthropic({ apiKey: provider.api_key, timeout: 600_000 });
  const usage: Usage = {};
  const types = plannableTypes().filter((t) => GRAFICOS.includes(t));
  // El codigo corta las escenas (6-9 s); el director decide que va en cada una.
  const tramos = armarTramos(phrases);
  const script = tramos
    .map((t, k) => `ESCENA ${k + 1} [${clock(phrases[t.desde]!.start)}–${clock(phrases[t.hasta]!.end)}]\n${phrases.slice(t.desde, t.hasta + 1).map((p) => `  [${p.id}] ${p.text}`).join("\n")}`)
    .join("\n");
  const user = `${input.videoTopic ? `Tema del video: ${input.videoTopic}\n` : ""}Duracion: ${clock(phrases[phrases.length - 1]!.end)}\n\nGUION EN ${tramos.length} ESCENAS (con sus frases):\n${script}`;

  // 1. Director (+ a lo sumo 1 correccion, armada por el orquestador).
  let raw = await callTool(client, models.director, DIRECTOR_MAX_TOKENS, directorSystem(types), directorTool, user, usage);
  const verificar = (r: Raw | undefined) => verificarPlan(alinearATramos(r, phrases, tramos), phrases);
  let v = verificar(raw);
  if (v.problemas.length > 0) {
    console.log(`[documental] correccion del director (${v.problemas.length} problemas)`);
    const corregido = await callTool(
      client,
      models.director,
      DIRECTOR_MAX_TOKENS,
      directorSystem(types),
      directorTool,
      `${user}\n\nTU PLAN ANTERIOR:\n${JSON.stringify(raw)}\n\nPROBLEMAS QUE HAY QUE CORREGIR (entrega el plan completo otra vez):\n${v.problemas.join("\n")}`,
      usage
    );
    if (corregido) {
      const v2 = verificar(corregido);
      if (v2.problemas.length <= v.problemas.length) {
        raw = corregido;
        v = v2;
      }
    }
  }
  if (!raw || v.escenas.length === 0) return null;

  // 2. Dibujantes: solo objetos que faltan, en paralelo, pedido armado aca.
  const pedidos = asList(raw.objetos_nuevos ?? [], "objetos_nuevos")
    .map((o) => o as Raw)
    .filter((o) => str(o.id) && !BIBLIOTECA_BASE[str(o.id)!]);
  const components: Record<string, DrawingComponent> = {};
  await mapWithConcurrency(pedidos, ARTISTS, async (o) => {
    const pedido = `Objeto: ${str(o.id)} · ${str(o.nombre) ?? ""}\nComo se ve: ${str(o.descripcion) ?? ""}\nPartes: ${asList(o.partes ?? [], "partes").map(String).join(", ") || "ninguna"}`;
    for (let intento = 0; intento < ARTIST_INTENTOS; intento++) {
      try {
        const out = await callTool(client, models.artist, ARTIST_MAX_TOKENS, artistSystem, artistTool, intento === 0 ? pedido : `${pedido}\n\nEl anterior fue rechazado, corregilo.`, usage);
        const comp = out ? validateComponent({ ...out, id: str(o.id) }) : "sin respuesta";
        if (typeof comp !== "string") {
          const calado = Number(o.calado);
          components[comp.id] = Number.isFinite(calado) && calado >= 0 && calado <= 0.95 ? { ...comp, calado } : comp;
          return;
        }
        console.warn(`[documental] dibujo ${String(o.id)} rechazado: ${comp}`);
      } catch (err) {
        console.warn(`[documental] dibujante ${String(o.id)}:`, (err as Error).message);
      }
    }
  });

  // 3. Armado: escenas invalidas o con objetos sin dibujo -> dibujo de al lado.
  let { plan, seguras, piezas } = armarPlan(raw, v, phrases, components, input.nav, { director: models.director, designer: models.artist }, usage);
  const videoEnd = plan.durationSeconds;
  const words = phrases.flatMap((p) => p.words);

  // 4. Revisor con capturas reales. Lo que rechaza VUELVE AL DIRECTOR con su
  // motivo (antes el codigo lo reemplazaba por una cita cortada y nadie lo
  // revisaba); lo corregido pasa otra vez por el Revisor, y solo lo que sigue
  // mal queda cubierto por el dibujo de al lado.
  if (motionCatalog() && config.documental_review !== false) {
    const motivos: { escena: string; motivo: string }[] = [];
    try {
      const revisar = async (ids: Set<string> | null): Promise<Map<string, string>> => {
        const escenas = plan.scenes.filter((s) => !ids || ids.has(s.id));
        const rechazos = new Map<string, string>();
        if (escenas.length === 0) return rechazos;
        const dir = await makeWorkDir("skaler-doc-review-");
        try {
          // Casi al final: al 75 % la segunda columna del A/B o la grilla todavia
          // no habian entrado y el Revisor las daba por vacias.
          const pedidosStills = escenas.map((s) => ({ id: s.id, seconds: Math.max(s.start + (s.end - s.start) * 0.75, s.end - 0.4) }));
          await renderAnimatedStills({ scenes: plan.scenes, components, nav: plan.nav, captions: plan.captions, durationSeconds: videoEnd, locale: input.nav.locale ?? "es-AR" }, pedidosStills, dir);
          const lotes: (typeof escenas)[] = [];
          for (let i = 0; i < escenas.length; i += REVIEW_BATCH) lotes.push(escenas.slice(i, i + REVIEW_BATCH));
          await mapWithConcurrency(lotes, 3, async (lote) => {
            const content: Anthropic.ContentBlockParam[] = lote.flatMap((s) => [
              { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: readFileSync(path.join(dir, `${s.id}.jpg`)).toString("base64") } },
              { type: "text" as const, text: `Escena ${s.id}. La voz dice: "${phrases.filter((p) => p.start < s.end && p.end > s.start).map((p) => p.text).join(" ")}"` },
            ]);
            const msg = await client.messages.create({ model: models.reviewer, max_tokens: 2000, system: REVISOR_SYSTEM, messages: [{ role: "user", content }] });
            const spent = (usage[models.reviewer] ??= { input: 0, output: 0 });
            spent.input += msg.usage.input_tokens;
            spent.output += msg.usage.output_tokens;
            const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
            try {
              const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { rechazadas?: { escena: string; motivo: string }[] };
              for (const r of json.rechazadas ?? []) {
                if (!escenas.some((s) => s.id === r.escena)) continue;
                rechazos.set(r.escena, String(r.motivo ?? ""));
                motivos.push({ escena: r.escena, motivo: String(r.motivo ?? "") });
                console.log(`[documental] revisor rechaza ${r.escena}: ${String(r.motivo ?? "")}`);
              }
            } catch {
              /* respuesta ilegible: no se rechaza nada */
            }
          });
        } finally {
          await rm(dir, { recursive: true, force: true }).catch(() => undefined);
        }
        return rechazos;
      };
      const numero = (id: string) => Number(/^s(\d+)/.exec(id)?.[1]);

      let rechazos = await revisar(null);
      console.log(`[documental] revisor: ${rechazos.size} de ${plan.scenes.length} escenas rechazadas`);
      // Si la correccion falla (sin saldo, red), lo rechazado igual queda
      // cubierto por el dibujo de al lado en vez de quedar como estaba.
      if (rechazos.size > 0) try {
        // De vuelta al director: solo esas escenas, con el motivo del Revisor.
        const nums = new Set([...rechazos.keys()].map(numero).filter((n) => Number.isInteger(n)));
        const lista = [...rechazos].map(([id, motivo]) => `- escena ${numero(id)}: ${motivo}`).join("\n");
        const corregido = await callTool(
          client,
          models.director,
          DIRECTOR_MAX_TOKENS,
          directorSystem(types),
          directorTool,
          `${user}\n\nTU PLAN:\n${JSON.stringify(raw)}\n\nEl REVISOR miro capturas reales y rechazo estas escenas:\n${lista}\n\nCorregi SOLO esas escenas, con su mismo numero ("escena": n), usando los objetos que ya existen (sin objetos_nuevos). Entregalas con plan_documental: capitulos iguales que antes y en escenas solo las corregidas.`,
          usage
        );
        if (corregido) {
          const nuevas = new Map(asList(corregido.escenas ?? [], "escenas").map((e) => [Number((e as Raw).escena), e as Raw] as const));
          const raw2: Raw = {
            ...raw,
            escenas: asList(raw.escenas ?? [], "escenas").map((e, i) => {
              const n = Number((e as Raw).escena) || i + 1;
              return nums.has(n) && nuevas.has(n) ? { ...nuevas.get(n)!, escena: n } : e;
            }),
          };
          const v2 = verificar(raw2);
          raw = raw2;
          v = v2;
          ({ plan, seguras, piezas } = armarPlan(raw, v, phrases, components, input.nav, { director: models.director, designer: models.artist }, usage));
          console.log(`[documental] director corrigio ${nuevas.size} escenas; el revisor las mira otra vez`);
          rechazos = await revisar(new Set(piezas.filter((p) => nums.has(numero(p.id))).map((p) => p.id)));
        }
      } catch (err) {
        console.warn("[documental] la correccion de lo rechazado fallo, va el dibujo de al lado:", (err as Error).message);
      }
      // Lo que sigue mal despues de la correccion: el dibujo de al lado (nunca texto).
      if (rechazos.size > 0) {
        for (const id of rechazos.keys()) seguras.push(id);
        piezas = absorberSeguras(piezas.map((p) => (rechazos.has(p.id) ? { ...p, segura: true } : p)), phrases);
        plan.scenes = cronometrar(piezas, phrases, videoEnd);
      }
      console.log(`[documental] revisor: ${rechazos.size} siguen mal despues de la correccion`);
    } catch (err) {
      console.warn("[documental] la revision visual fallo, sigo sin ella:", (err as Error).message);
    }
    plan.storyboard.revisor = motivos;
  }

  console.log(`[documental] ${plan.scenes.length} escenas · ${Object.keys(components).length} dibujos nuevos · ${seguras.length} seguras · ${words.length} palabras`);
  return plan;
}
