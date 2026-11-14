// Estilos del formato documental (video_projects.video_format = "documental").
// Como en Make a Videos, cada estilo es un PRESET de datos sobre el mismo
// motor (montajista -> buscadores -> juez -> render), no un pipeline propio.
// Fuentes: solo material con licencia (sin metraje ni entrevistas de YouTube,
// por eso Leyenda y Cancha de MaV no estan).

export type ShotClass = "metraje" | "persona" | "cosa" | "lugar" | "ambiente" | "mapa" | "grafico";

export const SHOT_CLASSES: ShotClass[] = ["metraje", "persona", "cosa", "lugar", "ambiente", "mapa", "grafico"];

export type MusicMood = "documental" | "tension" | "triste" | "epico" | "misterio" | "esperanza";

export interface DocumentalStyle {
  id: string;
  name: string;
  // Para la galeria del front.
  description: string;
  idealFor: string;
  examples: string[];
  category: "historia" | "misterio" | "biografias" | "datos" | "geografia" | "general";
  // Guion: esqueleto y tono que se suman al prompt de generate_script.
  script: {
    skeleton: string;
    tone: string;
  };
  plan: {
    // Duracion de plano por clase (segundos).
    durations: Record<ShotClass | "normal", [number, number]>;
    // Clases que el montajista prefiere cuando dudan (orden de preferencia).
    prefer: ShotClass[];
    // Graficos (metricas animadas): por minuto, en el primer minuto, % del
    // tiempo y separacion minima entre graficos.
    graphicsPerMinute: number;
    graphicsPerMinuteHook: number;
    maxGraphicShare: number;
    minGraphicGapSeconds: number;
  };
  sources: {
    // Material de archivo antes que stock (estilos historicos).
    archiveFirst: boolean;
    // Archivo en blanco y negro / de epoca.
    epochHint?: string;
  };
  graphics: {
    favor: string[];
    forbid: string[];
    // Paleta de motion/niches.json ("nicho:paleta"); sin esto, la del canal.
    palette?: string;
  };
  look: {
    contrast: number;
    saturation: number;
    brightness: number;
    vignette: boolean;
    // Capa encima del video.
    layer?: "old_movie" | "bn" | "paper";
    // Cada cuantos planos un destello calido (0 = nunca).
    flashEvery: number;
    // Cortes de zoom dentro de los clips (segundos; 0 = sin cortes).
    zoomCutEvery: number;
  };
  captions: {
    font: string;
    size: number; // px a 1080p
    words: number;
    uppercase: boolean;
  };
  sound: {
    mood: MusicMood;
    musicVolume: number; // 0-1 sin voz
    duckTo: number; // fraccion del volumen de musica mientras hay voz
    sfxVolume: number;
  };
}

const BASE_DURATIONS: DocumentalStyle["plan"]["durations"] = {
  normal: [2.5, 9],
  metraje: [2.5, 9],
  persona: [3.2, 6],
  cosa: [2.5, 8],
  lugar: [3, 9],
  ambiente: [2.5, 9],
  mapa: [4, 7],
  grafico: [3, 9],
};

const DOC_SKELETON =
  "Gancho inicial (3-5%), contexto (8-12%), desarrollo que acumula tension (20-25%), el hecho central contado en secuencia (30-35%), consecuencias (10-15%), resolucion (5-8%), cierre (2-3%). Cada seccion termina con un enganche a la siguiente. No escribas titulos, marcas ni acotaciones: todo el texto se narra en voz alta.";

function style(overrides: Partial<DocumentalStyle> & Pick<DocumentalStyle, "id" | "name" | "description" | "idealFor" | "examples" | "category">): DocumentalStyle {
  const base: Omit<DocumentalStyle, "id" | "name" | "description" | "idealFor" | "examples" | "category"> = {
    script: { skeleton: DOC_SKELETON, tone: "Narrador de documental: sobrio, preciso, con datos concretos." },
    plan: {
      durations: BASE_DURATIONS,
      prefer: ["persona", "lugar", "cosa", "metraje", "ambiente"],
      graphicsPerMinute: 3,
      graphicsPerMinuteHook: 6,
      maxGraphicShare: 0.3,
      minGraphicGapSeconds: 4.5,
    },
    sources: { archiveFirst: false },
    graphics: {
      favor: ["big_number", "person_card", "timeline", "milestone", "line_chart", "map_marker", "lower_third", "title_card"],
      forbid: ["subscribe_cta", "strike_word"],
    },
    look: { contrast: 1.04, saturation: 0.94, brightness: -0.01, vignette: true, flashEvery: 9, zoomCutEvery: 4 },
    // 5 palabras como MaV (con 7 la linea era muy larga).
    captions: { font: "Roboto Condensed", size: 54, words: 5, uppercase: false },
    // Valores de MaV: musica al 22% sin voz, al 35% de eso bajo la voz,
    // efectos ~11 dB por debajo de la voz.
    sound: { mood: "documental", musicVolume: 0.22, duckTo: 0.35, sfxVolume: 0.28 },
  };
  return {
    ...base,
    ...overrides,
    script: { ...base.script, ...overrides.script },
    plan: { ...base.plan, ...overrides.plan },
    sources: { ...base.sources, ...overrides.sources },
    graphics: { ...base.graphics, ...overrides.graphics },
    look: { ...base.look, ...overrides.look },
    captions: { ...base.captions, ...overrides.captions },
    sound: { ...base.sound, ...overrides.sound },
  };
}

export const DOCUMENTAL_STYLES: DocumentalStyle[] = [
  style({
    id: "documental",
    name: "Documental",
    description: "Como un documental de plataforma: material real, personas, mapas y métricas sobrias.",
    idealFor: "Cualquier tema contado con rigor",
    examples: ["El hundimiento del Titanic", "Cómo se construyó el Canal de Panamá", "La carrera espacial"],
    category: "general",
    // Mas metricas animadas que el valor de MaV (3/min salia con ~2/min reales).
    plan: { ...BASE_PLAN(), graphicsPerMinute: 5, graphicsPerMinuteHook: 8, maxGraphicShare: 0.4, minGraphicGapSeconds: 3 },
  }),
  style({
    id: "clasico",
    name: "Clásico",
    description: "Archivo y biografías con fotografía real; pocos gráficos.",
    idealFor: "Biografías y hechos históricos",
    examples: ["Quién fue Marie Curie", "La vida de Nikola Tesla", "El día que cayó el Muro"],
    category: "biografias",
    plan: { ...BASE_PLAN(), prefer: ["persona", "cosa", "lugar", "metraje", "ambiente"], graphicsPerMinute: 2, graphicsPerMinuteHook: 4 },
    captions: { font: "Roboto Condensed", size: 56, words: 6, uppercase: false },
  }),
  style({
    id: "profundo",
    name: "Profundo",
    description: "Historia militar, espionaje, aviación y espacio, con archivo antes que stock.",
    idealFor: "Guerras, operaciones, misiones",
    examples: ["La Operación Overlord", "El espía que engañó a Hitler", "Apolo 13"],
    category: "historia",
    sources: { archiveFirst: true, epochHint: "material de archivo de la época" },
    look: { contrast: 1.08, saturation: 0.85, brightness: -0.02, vignette: true, flashEvery: 0, zoomCutEvery: 4 },
    sound: { mood: "tension", musicVolume: 0.2, duckTo: 0.35, sfxVolume: 0.38 },
  }),
  style({
    id: "expediente",
    name: "Expediente",
    description: "Sucesos y misterios contados como un informe: citas, fechas y documentos.",
    idealFor: "Crímenes, desapariciones, casos sin resolver",
    examples: ["El caso Dyatlov", "La desaparición del vuelo MH370", "El asesino del Zodiaco"],
    category: "misterio",
    graphics: { favor: ["milestone", "kinetic_quote", "timeline", "person_card", "map_marker", "big_number"], forbid: ["subscribe_cta", "scale_compare"] },
    look: { contrast: 1.06, saturation: 0.8, brightness: -0.03, vignette: true, flashEvery: 0, zoomCutEvery: 5 },
    captions: { font: "Special Elite", size: 50, words: 6, uppercase: false },
    sound: { mood: "misterio", musicVolume: 0.18, duckTo: 0.35, sfxVolume: 0.4 },
  }),
  style({
    id: "horizonte",
    name: "Horizonte",
    description: "Demografía y economía con gráficos de datos reales.",
    idealFor: "Países, población, economía",
    examples: ["Por qué Japón se queda sin gente", "La economía de Argentina en 50 años", "El ascenso de China"],
    category: "datos",
    plan: { ...BASE_PLAN(), graphicsPerMinute: 4, graphicsPerMinuteHook: 6, maxGraphicShare: 0.45, prefer: ["lugar", "metraje", "ambiente", "cosa", "persona"] },
    graphics: { favor: ["line_chart", "data_viz_single", "big_number", "versus", "map_marker", "map_globe", "scale_compare"], forbid: ["subscribe_cta", "kinetic_quote"] },
  }),
  style({
    id: "locomotoras",
    name: "Locomotoras",
    description: "Máquinas, ingeniería y rutas con mapas y fichas técnicas.",
    idealFor: "Trenes, barcos, aviones, megaproyectos",
    examples: ["El tren más rápido del mundo", "El Transiberiano", "Cómo funciona un portaaviones"],
    category: "geografia",
    plan: { ...BASE_PLAN(), prefer: ["cosa", "lugar", "metraje", "ambiente", "persona"] },
    graphics: { favor: ["map_marker", "big_number", "versus", "layers_diagram", "scale_compare", "timeline"], forbid: ["subscribe_cta"] },
  }),
  style({
    id: "almanaque",
    name: "Almanaque",
    description: "Quién fue alguien o qué fue algo, en formato cromo y con pocos gráficos.",
    idealFor: "Fichas de personajes, objetos y lugares",
    examples: ["Qué fue la Ruta de la Seda", "Quién fue Cleopatra", "Qué es el Área 51"],
    category: "biografias",
    plan: { ...BASE_PLAN(), graphicsPerMinute: 1.2, graphicsPerMinuteHook: 3, maxGraphicShare: 0.2 },
    sources: { archiveFirst: true },
    look: { contrast: 1.05, saturation: 0.9, brightness: 0, vignette: true, flashEvery: 12, zoomCutEvery: 5 },
  }),
  style({
    id: "noticiero",
    name: "Noticiero",
    description: "Actualidad contada como un parte de noticias: cronologías y cifras.",
    idealFor: "Hechos recientes y explicaciones de actualidad",
    examples: ["Qué pasó en el apagón de España", "La crisis del Mar Rojo", "Por qué sube el oro"],
    category: "general",
    plan: { ...BASE_PLAN(), graphicsPerMinute: 3.5, graphicsPerMinuteHook: 6 },
    graphics: { favor: ["milestone", "big_number", "map_marker", "timeline", "lower_third", "versus"], forbid: ["subscribe_cta"] },
    look: { contrast: 1.03, saturation: 1, brightness: 0, vignette: false, flashEvery: 0, zoomCutEvery: 4 },
    // 5 palabras como MaV (con 7 la linea era muy larga).
    captions: { font: "Roboto Condensed", size: 54, words: 5, uppercase: false },
  }),
  style({
    id: "historia",
    name: "Historia",
    description: "Imperios y dinastías desde su fundación, con mapas, fechas y archivo.",
    idealFor: "Imperios, civilizaciones, dinastías",
    examples: ["El Imperio Romano", "La dinastía Ming", "El auge y caída de los mongoles"],
    category: "historia",
    sources: { archiveFirst: true, epochHint: "pinturas, grabados y mapas antiguos" },
    graphics: { favor: ["timeline", "milestone", "map_marker", "map_globe", "person_card", "title_card"], forbid: ["subscribe_cta", "line_chart"] },
    look: { contrast: 1.04, saturation: 0.8, brightness: -0.01, vignette: true, layer: "paper", flashEvery: 0, zoomCutEvery: 0 },
    sound: { mood: "epico", musicVolume: 0.2, duckTo: 0.35, sfxVolume: 0.35 },
  }),
  style({
    id: "mapa",
    name: "Mapa interactivo",
    description: "El relato se apoya en mapas: rutas, fronteras y lugares.",
    idealFor: "Geografía, rutas, guerras, exploraciones",
    examples: ["La ruta de Magallanes", "Por qué Rusia quiere salida al mar", "La frontera más larga del mundo"],
    category: "geografia",
    plan: { ...BASE_PLAN(), prefer: ["mapa", "lugar", "metraje", "ambiente", "cosa"], graphicsPerMinute: 4, maxGraphicShare: 0.45 },
    graphics: { favor: ["map_marker", "map_globe", "timeline", "big_number"], forbid: ["subscribe_cta", "kinetic_quote"] },
  }),
  style({
    id: "collage",
    name: "Collage",
    description: "Estética de papel recortado e hilo rojo para historias y cultura.",
    idealFor: "Historias, cultura, conspiraciones",
    examples: ["La historia secreta del Tarot", "El misterio de Voynich", "Quién inventó el dinero"],
    category: "misterio",
    look: { contrast: 1.05, saturation: 0.85, brightness: 0, vignette: true, layer: "paper", flashEvery: 0, zoomCutEvery: 0 },
    sound: { mood: "misterio", musicVolume: 0.2, duckTo: 0.35, sfxVolume: 0.42 },
  }),
  style({
    id: "nocturno",
    name: "Nocturno",
    description: "Guerra y espías como un tráiler: archivo en blanco y negro y tono oscuro.",
    idealFor: "Guerra fría, espionaje, conflictos",
    examples: ["La crisis de los misiles", "El muro de Berlín", "Los espías de Cambridge"],
    category: "historia",
    sources: { archiveFirst: true, epochHint: "noticiarios en blanco y negro" },
    look: { contrast: 1.12, saturation: 0, brightness: -0.03, vignette: true, layer: "bn", flashEvery: 0, zoomCutEvery: 4 },
    sound: { mood: "tension", musicVolume: 0.22, duckTo: 0.35, sfxVolume: 0.4 },
  }),
];

function BASE_PLAN(): DocumentalStyle["plan"] {
  return {
    durations: BASE_DURATIONS,
    prefer: ["persona", "lugar", "cosa", "metraje", "ambiente"],
    graphicsPerMinute: 3,
    graphicsPerMinuteHook: 6,
    maxGraphicShare: 0.3,
    minGraphicGapSeconds: 4.5,
  };
}

export const DEFAULT_DOCUMENTAL_STYLE = "documental";

export function getDocumentalStyle(id: unknown): DocumentalStyle {
  return DOCUMENTAL_STYLES.find((s) => s.id === id) ?? DOCUMENTAL_STYLES[0]!;
}

export function isDocumentalStyleId(id: unknown): boolean {
  return typeof id === "string" && DOCUMENTAL_STYLES.some((s) => s.id === id);
}
