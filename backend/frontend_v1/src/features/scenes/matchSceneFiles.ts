// Empareja archivos generados afuera (ej: Google Flow) con escenas:
// 1) si el nombre trae el numero de escena ("escena_07.png", "Scene 7.jpg",
//    "07.png"), va a esa escena;
// 2) el resto se reparte en orden natural de nombre (2 antes que 10) sobre
//    las escenas que quedaron libres, de la primera a la ultima.
// Archivos que sobran (o con un numero que no existe) quedan sin escena.

export interface SceneSlot {
  id: string;
  order: number;
  hasVisual: boolean;
}

export interface FileMatch {
  key: string;
  file: File;
  sceneId: string | null;
  // Como se eligio la escena -- se muestra en la tabla de revision.
  reason: "number" | "order" | "manual" | "none";
}

const naturalCompare = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

export function sceneNumberFromName(fileName: string): number | null {
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  const tagged = base.match(/(?:escena|scene|esc|sc)[\s_\-#.]*0*(\d{1,4})(?!\d)/i);
  if (tagged) return Number(tagged[1]);
  const bare = base.match(/^0*(\d{1,4})$/);
  if (bare) return Number(bare[1]);
  return null;
}

export function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function isVisualFile(file: File): boolean {
  return file.type.startsWith("image/") || file.type.startsWith("video/");
}

// Variantes de JPEG que algunos navegadores/descargas usan (Chrome en
// Windows guarda imagenes como .jfif) y que el navegador a veces informa sin
// tipo. Son JPEG comunes: se renombran a .jpg con tipo image/jpeg para que
// el resto (backend, Storage, render) las trate como cualquier JPG.
const JPEG_VARIANTS = /\.(jfif|jpe|pjpeg|pjp)$/i;
const TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

export function normalizeVisualFile(file: File): File {
  if (JPEG_VARIANTS.test(file.name)) {
    return new File([file], file.name.replace(JPEG_VARIANTS, ".jpg"), { type: "image/jpeg", lastModified: file.lastModified });
  }
  if (!file.type) {
    const type = TYPE_BY_EXTENSION[file.name.split(".").pop()?.toLowerCase() ?? ""];
    if (type) return new File([file], file.name, { type, lastModified: file.lastModified });
  }
  return file;
}

export function matchFilesToScenes(
  files: File[],
  scenes: SceneSlot[],
  options: { onlyMissing: boolean }
): FileMatch[] {
  const byOrder = new Map(scenes.map((s) => [s.order, s]));
  const taken = new Set<string>();
  const matches: FileMatch[] = [];
  const unnumbered: File[] = [];

  for (const file of [...files].sort((a, b) => naturalCompare(a.name, b.name))) {
    const number = sceneNumberFromName(file.name);
    if (number === null) {
      unnumbered.push(file);
      continue;
    }
    // Numero explicito que no existe o que ya tomo otro archivo: no se
    // reubica solo en otra escena (seria una sorpresa), queda para asignar
    // a mano en la tabla de revision.
    const scene = byOrder.get(number);
    if (scene && !taken.has(scene.id)) {
      taken.add(scene.id);
      matches.push({ key: fileKey(file), file, sceneId: scene.id, reason: "number" });
    } else {
      matches.push({ key: fileKey(file), file, sceneId: null, reason: "none" });
    }
  }

  const free = [...scenes]
    .sort((a, b) => a.order - b.order)
    .filter((s) => !taken.has(s.id) && (!options.onlyMissing || !s.hasVisual));
  unnumbered.forEach((file, i) => {
    const scene = free[i];
    matches.push({ key: fileKey(file), file, sceneId: scene?.id ?? null, reason: scene ? "order" : "none" });
  });

  const orderOf = new Map(scenes.map((s) => [s.id, s.order]));
  return matches.sort((a, b) => {
    const ao = a.sceneId ? orderOf.get(a.sceneId)! : Number.MAX_SAFE_INTEGER;
    const bo = b.sceneId ? orderOf.get(b.sceneId)! : Number.MAX_SAFE_INTEGER;
    return ao - bo || naturalCompare(a.file.name, b.file.name);
  });
}
