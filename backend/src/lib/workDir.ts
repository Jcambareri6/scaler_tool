import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Directorio de trabajo temporal (clips descargados, tandas intermedias,
// audio para Whisper...). En Render /tmp tiene un tope de 2GB que ya tiro
// la instancia en produccion ("Size of temporary storage volume /tmp
// exceeded the limit"); en el servidor del worker WORK_DIR apunta al disco
// NVMe grande (ver docker-compose.worker.yml). Sin WORK_DIR se usa el temp
// del sistema, igual que antes.
export async function makeWorkDir(prefix: string): Promise<string> {
  const base = process.env.WORK_DIR?.trim() || tmpdir();
  await mkdir(base, { recursive: true });
  return mkdtemp(path.join(base, prefix));
}
