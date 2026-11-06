// Recursos del formato documental (docs/formato-documental/INFORME.md).
// Un recurso es un PATRON que se repite en la referencia (Ciencia y Vida):
// el codigo resuelve lugares, tiempos y colores; el JSON trae solo lo que
// cambia de un video a otro (contenido) y en que segundo pasa cada cosa
// (momentos, atados al inicio de la palabra como el resto del motor).
// La IA nunca da coordenadas, colores ni duraciones.

export type Significado = "seguro" | "peligro" | "foco" | "neutro";

export interface Momento {
  // Segundo del video (inicio de la palabra).
  at: number;
  // Que pasa: depende del recurso (ver cada uno).
  hace: string;
  // Lugar del escenario o parte de un objeto a la que aplica.
  objeto?: string;
  parte?: string;
  texto?: string;
  significado?: Significado;
  // Etiqueta: "arriba" del objeto (nombre del objeto); si no, pegada a su parte.
  posicion?: "arriba";
  // La palabra del giro: antes de este momento no puede haber "peligro".
  remate?: boolean;
  // "avanza": lugar del escenario hacia el que se mueve el objeto.
  hacia?: string;
}

// Ubicacion: mapa con capas (AVE, Control mental, Chernobyl).
export interface ContenidoUbicacion {
  lugar: string;
  subtitulo?: string;
  region?: string;
  geo: { lat: number; lon: number };
  fecha?: { dia?: number; mes?: number; anio?: number };
  hora?: string;
  hora_nota?: string;
}

// Lugares fijos del esquema por capas (de izquierda a derecha, sobre el suelo).
export type Lugar = "personaje" | "secundario" | "principal" | "destino";

// Esquema por capas: escenario de perfil al que se le suman capas con la voz
// (vagon, rueda y carril, cerebro, reactor).
// Donde pasa la escena. Como en la referencia (via bajo el tren, vagon en
// corte, pasto de noche): un escenario esquematico, plano, de perfil.
//   suelo: linea de piso (por defecto) · mar: linea de agua con oleaje leve,
//   los objetos flotan y lo sumergido se ve a traves del agua · interior: piso
//   y pared del fondo · cielo: sin piso, objetos en el aire.
export type Escenario = "suelo" | "mar" | "interior" | "cielo";

export interface ContenidoEsquema {
  escenario?: Escenario;
  // Punto de vista: general (todo), medio (el principal) o detalle (su parte clave).
  encuadre?: "general" | "medio" | "detalle";
  // Objetos de la biblioteca (biblioteca/index.ts) en cada lugar.
  secundario?: string;
  principal: string;
  destino?: string;
  personaje?: { tarjeta?: string; rol?: string };
  // Detalle ampliado de una parte (lupa), sin mover el encuadre.
  lupa?: { objeto: Exclude<Lugar, "personaje">; parte: string; texto?: string; nota?: string };
}

// Pictogramas (catalogo #6, grilla con cambio de estado): cantidades de
// personas o lugares y proporciones ("28 de 65", "1 de cada 4"). Uno o dos
// grupos lado a lado; en la palabra clave las marcadas cambian de color.
export interface GrupoPictogramas {
  etiqueta?: string;
  total: number;
  marcados: number;
  // Cifra o frase corta que aparece con el cambio ("28 de 65").
  texto?: string;
  significado?: Significado;
}
export interface ContenidoPictogramas {
  figura?: "persona" | "lugar";
  grupos: GrupoPictogramas[];
}

// Fase 5: recursos de la referencia (catalogo #14, #8, #15, #4 y el reloj).
// Documento a maquina: hoja beige que se escribe; renglon resaltado y sello.
export interface ContenidoDocumento {
  titulo: string;
  lineas: string[];
  resaltar?: number;
  sello?: string;
}
// Reloj: hora (y opcional hasta que hora corren las agujas).
export interface ContenidoReloj {
  hora: string;
  hasta?: string;
  nota?: string;
}
// Contador: 1 o 2 cifras que suben desde 0 y una frase de relacion.
export interface ContenidoContador {
  valores: { valor: number; unidad?: string; etiqueta?: string; significado?: Significado }[];
  relacion?: string;
}
// Tarjeta de leccion: etiqueta azul y la frase en dos tiempos.
export interface ContenidoLeccion {
  etiqueta: string;
  frase: string;
  segunda?: string;
}
// A/B lado a lado: dos opciones con su resultado.
export interface ContenidoAB {
  titulo?: string;
  opciones: { titulo: string; resultado: string; bien: boolean }[];
}

export interface Recurso {
  tipo: "ubicacion" | "esquema_capas" | "pictogramas" | "documento" | "reloj" | "contador" | "leccion" | "ab";
  fondo?: "claro" | "oscuro";
  // Titulo de la escena arriba a la izquierda; cada parte entra en su palabra.
  titulo?: { texto: string; at: number }[];
  contenido: ContenidoUbicacion | ContenidoEsquema | ContenidoPictogramas | ContenidoDocumento | ContenidoReloj | ContenidoContador | ContenidoLeccion | ContenidoAB;
  momentos: Momento[];
}
