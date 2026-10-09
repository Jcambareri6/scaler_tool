// Empareja archivos generados afuera (ej: Google Flow) con escenas:
// 1) si el nombre trae el numero de escena ("escena_07.png", "Scene 7.jpg",
//    "07.png"), va a esa escena;
// 2) el resto se reparte en orden natural de nombre (2 antes que 10) sobre
//    las escenas que quedaron libres, desde `startOrder` hasta la ultima.
// Con `ignoreNumbers` todos van por orden: descargadores como Viral DNA
// numeran por orden de descarga (0, 1, 2...) y no por escena, y cada lote
// nuevo vuelve a empezar en 0.
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
  // "shifted": venia por orden y se corrio con reflowFrom.
  reason: "number" | "order" | "shifted" | "manual" | "none";
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
  options: { onlyMissing: boolean; ignoreNumbers?: boolean; startOrder?: number }
): FileMatch[] {
  const byOrder = new Map(scenes.map((s) => [s.order, s]));
  const taken = new Set<string>();
  const matches: FileMatch[] = [];
  const unnumbered: File[] = [];

  for (const file of [...files].sort((a, b) => naturalCompare(a.name, b.name))) {
    const number = options.ignoreNumbers ? null : sceneNumberFromName(file.name);
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
    .filter((s) => s.order >= (options.startOrder ?? 1) && !taken.has(s.id) && (!options.onlyMissing || !s.hasVisual));
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

// Archivos que se pueden correr en cadena: los repartidos por orden (y los
// que sobraron sin escena). Con `includeNumbered` tambien los que van por
// numero: hay descargadores de Flow que numeran por orden de descarga, no
// por escena, asi que si una falla el numero tambien queda corrido.
function inChain(m: FileMatch, includeNumbered: boolean): boolean {
  if (m.reason === "order" || m.reason === "shifted") return true;
  if (m.reason === "number") return includeNumbered;
  return m.reason === "none" && (includeNumbered || sceneNumberFromName(m.file.name) === null);
}

// Cuando Flow falla una imagen del lote, los archivos que bajan quedan sin
// hueco: desde ahi cada uno cae una escena antes de la suya. Esto lo arregla
// de un toque: el archivo `key` pasa a `target` y todos los que venian
// despues se corren a las escenas libres siguientes. Los anteriores, los
// asignados a mano y los `locked` (ya cargados) no se tocan. Si `key` no
// esta en la cadena, es una asignacion manual comun.
// target "next": la primera escena libre despues de la actual (boton +1).
export function reflowFrom(
  matches: FileMatch[],
  scenes: SceneSlot[],
  key: string,
  target: string | null | { next: true },
  options: { onlyMissing: boolean; locked: Set<string>; includeNumbered?: boolean }
): FileMatch[] {
  const file = matches.find((m) => m.key === key);
  if (!file) return matches;
  const includeNumbered = options.includeNumbered ?? false;
  const orderOf = new Map(scenes.map((s) => [s.id, s.order]));
  const sorted = [...scenes].sort((a, b) => a.order - b.order);
  const usable = (s: SceneSlot) => !options.onlyMissing || !s.hasVisual;

  const inFileChain = inChain(file, includeNumbered) && !options.locked.has(key);
  const chain = inFileChain
    ? matches
        .filter((m) => inChain(m, includeNumbered) && !options.locked.has(m.key))
        .sort((a, b) => naturalCompare(a.file.name, b.file.name))
    : [];
  const tail = chain.slice(chain.findIndex((m) => m.key === key) + 1);
  const tailKeys = new Set(tail.map((m) => m.key));
  const taken = new Set(
    matches.filter((m) => m.key !== key && !tailKeys.has(m.key) && m.sceneId).map((m) => m.sceneId!)
  );

  let targetSceneId: string | null;
  if (target && typeof target === "object") {
    const current = file.sceneId ? orderOf.get(file.sceneId) : undefined;
    if (current === undefined) return matches;
    targetSceneId = sorted.find((s) => s.order > current && !taken.has(s.id) && usable(s))?.id ?? null;
  } else {
    targetSceneId = target;
  }

  const assigned: FileMatch = { ...file, sceneId: targetSceneId, reason: "manual" };
  if (!inFileChain) return matches.map((m) => (m.key === key ? assigned : m));

  // Sin escena destino, el resto arranca donde estaba este archivo.
  const startOrder =
    (targetSceneId ? orderOf.get(targetSceneId) : undefined) ?? (file.sceneId ? orderOf.get(file.sceneId)! - 1 : 0);
  if (targetSceneId) taken.add(targetSceneId);
  const free = sorted.filter((s) => s.order > startOrder && !taken.has(s.id) && usable(s));

  const moved = new Map<string, FileMatch>([[key, assigned]]);
  tail.forEach((m, i) => {
    const scene = free[i];
    moved.set(m.key, { ...m, sceneId: scene?.id ?? null, reason: scene ? "shifted" : "none" });
  });

  return matches
    .map((m) => moved.get(m.key) ?? m)
    .sort((a, b) => {
      const ao = a.sceneId ? orderOf.get(a.sceneId)! : Number.MAX_SAFE_INTEGER;
      const bo = b.sceneId ? orderOf.get(b.sceneId)! : Number.MAX_SAFE_INTEGER;
      return ao - bo || naturalCompare(a.file.name, b.file.name);
    });
}
