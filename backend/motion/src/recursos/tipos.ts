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
export interface ContenidoEsquema {
  // Objetos de la biblioteca (biblioteca/index.ts) en cada lugar.
  secundario?: string;
  principal: string;
  destino?: string;
  personaje?: { tarjeta?: string; rol?: string };
  // Detalle ampliado de una parte (lupa), sin mover el encuadre.
  lupa?: { objeto: Exclude<Lugar, "personaje">; parte: string; texto?: string; nota?: string };
}

export interface Recurso {
  tipo: "ubicacion" | "esquema_capas";
  fondo?: "claro" | "oscuro";
  // Titulo de la escena arriba a la izquierda; cada parte entra en su palabra.
  titulo?: { texto: string; at: number }[];
  contenido: ContenidoUbicacion | ContenidoEsquema;
  momentos: Momento[];
}
