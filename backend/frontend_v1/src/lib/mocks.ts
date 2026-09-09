import type { VideoProject, Script, Scene, Job } from "@/types";

export const mockProjects: VideoProject[] = [
  {
    id: "1",
    title: "Historia de River Plate",
    status: "IN_PROGRESS",
    description: "Documental sobre los 120 años de historia del Club Atlético River Plate.",
    createdAt: "2026-08-18T10:00:00Z",
    updatedAt: "2026-08-20T08:30:00Z",
    visualSource: "stock",
  },
  {
    id: "2",
    title: "El futuro de la inteligencia artificial",
    status: "DRAFT",
    description: "Exploración de los avances en IA y su impacto en la sociedad.",
    createdAt: "2026-08-15T14:20:00Z",
    updatedAt: "2026-08-19T16:45:00Z",
    visualSource: "stock",
  },
  {
    id: "3",
    title: "Travesía por la Patagonia",
    status: "DONE",
    description: "Video de viaje por los paisajes más remotos del sur argentino.",
    createdAt: "2026-08-01T09:00:00Z",
    updatedAt: "2026-08-10T11:00:00Z",
    visualSource: "stock",
  },
  {
    id: "4",
    title: "Arquitectura modernista en Buenos Aires",
    status: "GENERATING",
    description: "Recorrido visual por los edificios más representativos del modernismo porteño.",
    createdAt: "2026-08-19T08:00:00Z",
    updatedAt: "2026-08-20T09:15:00Z",
    visualSource: "stock",
  },
];

export const mockScripts: Record<string, Script> = {
  "1": {
    id: "s1",
    projectId: "1",
    title: "Historia de River Plate — Guion final",
    content: `INTRODUCCIÓN

En 1901, un grupo de jóvenes inmigrantes y criollos de La Boca fundaron un club que cambiaría para siempre la historia del fútbol argentino. Hoy, más de 120 años después, el Club Atlético River Plate es sinónimo de gloria, pasión y millones de hinchas alrededor del mundo.

CAPÍTULO 1 — LOS ORÍGENES (1901–1930)

El 25 de mayo de 1901 nace River Plate en el barrio porteño de La Boca. Los primeros años fueron humildes: un puñado de jugadores, canchas prestadas y la ilusión de crecer. En 1923, el club se traslada a Palermo y comienza su ascenso definitivo.

CAPÍTULO 2 — LA MÁQUINA (1941–1947)

Conocida como "La Máquina", la delantera conformada por Muñoz, Moreno, Pedernera, Labruna y Loustau dominó el fútbol sudamericano con un juego asociado y elegante que dejó huella en generaciones.

CAPÍTULO 3 — EL MONUMENTAL

La inauguración del estadio Monumental en 1938 marcó un antes y un después. Hoy, con capacidad para más de 84.000 espectadores, es el estadio más grande de América del Sur.

CAPÍTULO 4 — LA COPA LIBERTADORES

El momento más épico llegó en 1986, cuando River Plate conquistó su primera Copa Libertadores. Luego vendrían 1996, 2015 y la histórica final en Madrid de 2018, la Libertadores más recordada de la historia.

CIERRE

River Plate no es solo un club de fútbol. Es una institución que conecta generaciones, une familias y trasciende las fronteras del deporte. Su historia es la historia de Argentina.`,
    status: "FINAL",
    updatedAt: "2026-08-19T20:00:00Z",
  },
};

export const mockScenes: Record<string, Scene[]> = {
  "1": [
    {
      id: "sc1",
      projectId: "1",
      order: 1,
      title: "Apertura — Estadio Monumental",
      timeStart: "00:00",
      timeEnd: "00:25",
      duration: "25s",
      narrativeContent: "En 1901, un grupo de jóvenes inmigrantes y criollos fundaron un club que cambiaría para siempre la historia del fútbol argentino.",
      visualPrompt: "Aerial drone shot over Estadio Monumental at dusk, crowds filling the stands, dramatic golden light",
      visualStatus: "DONE",
    },
    {
      id: "sc2",
      projectId: "1",
      order: 2,
      title: "Los orígenes — La Boca, 1901",
      timeStart: "00:25",
      timeEnd: "01:10",
      duration: "45s",
      narrativeContent: "El 25 de mayo de 1901 nace River Plate en el barrio porteño de La Boca. Los primeros años fueron humildes pero llenos de ilusión.",
      visualPrompt: "Black and white archival footage style, cobblestone streets of La Boca, early 1900s Buenos Aires port",
      visualStatus: "DONE",
    },
    {
      id: "sc3",
      projectId: "1",
      order: 3,
      title: "La Máquina — La delantera legendaria",
      timeStart: "01:10",
      timeEnd: "02:00",
      duration: "50s",
      narrativeContent: "Muñoz, Moreno, Pedernera, Labruna y Loustau. Cinco nombres que definieron una era y un estilo de juego que el mundo admiró.",
      visualPrompt: "Vintage sepia-toned footage of football players in white and red jerseys, stadium cheering crowd",
      visualStatus: "GENERATING",
    },
    {
      id: "sc4",
      projectId: "1",
      order: 4,
      title: "Copa Libertadores 2018 — Madrid",
      timeStart: "02:00",
      timeEnd: "03:00",
      duration: "60s",
      narrativeContent: "El 9 de diciembre de 2018, en el Santiago Bernabéu de Madrid, River Plate venció a Boca Juniors 3-1 en la final más esperada de la historia.",
      visualPrompt: "Confetti falling over celebrating players in white jerseys, Bernabeu stadium at night, trophy lifted",
      visualStatus: "PENDING",
    },
    {
      id: "sc5",
      projectId: "1",
      order: 5,
      title: "Cierre — La institución",
      timeStart: "03:00",
      timeEnd: "03:30",
      duration: "30s",
      narrativeContent: "River Plate no es solo un club de fútbol. Es una institución que conecta generaciones, une familias y trasciende las fronteras del deporte.",
      visualPrompt: "Montage of fans of all ages wearing River Plate jerseys, emotional faces, multigenerational families",
      visualStatus: "PENDING",
    },
  ],
};

export const mockJobs: Record<string, Job> = {
  "4": {
    id: "j1",
    projectId: "4",
    type: "VIDEO_RENDER",
    status: "RUNNING",
    progress: 65,
    message: "Generando assets visuales...",
    createdAt: "2026-08-20T09:00:00Z",
    updatedAt: "2026-08-20T09:15:00Z",
  },
};

export function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Justo ahora";
  if (diffMins < 60) return `Hace ${diffMins} min`;
  if (diffHours < 24) return `Hace ${diffHours} h`;
  if (diffDays === 1) return "Ayer";
  return `Hace ${diffDays} días`;
}
