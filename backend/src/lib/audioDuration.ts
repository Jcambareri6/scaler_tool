import { spawn } from "node:child_process";
import { createRequire } from "module";

// ffmpeg-static es CJS puro -- mismo patron que renderVideo.tool.ts /
// transcribeAudio.tool.ts.
const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static") as string | null;

// Mide la duracion REAL de un archivo de audio local con ffmpeg (parseando
// la linea "Duration: HH:MM:SS.ms" que imprime en stderr, sin necesidad de
// ffprobe) -- se usa para no depender de la duracion que "dice" tener un
// proveedor de TTS (ai33.pro/Edge TTS), que puede no coincidir con el
// archivo real (visto en produccion: la UI mostraba una duracion mayor a la
// del video final, porque el timeline se armaba con la duracion reportada
// por el proveedor en vez de la real). Devuelve null si no se pudo medir
// (ffmpeg-static ausente, archivo invalido, etc.) para que el caller pueda
// caer a su propio fallback en vez de romper la generacion de voz por esto.
export function getAudioDurationSeconds(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    if (!ffmpegPath) {
      resolve(null);
      return;
    }
    const proc = spawn(ffmpegPath, ["-i", filePath]);
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", () => resolve(null));
    proc.on("close", () => {
      const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!match) {
        resolve(null);
        return;
      }
      const [, hh, mm, ss] = match;
      resolve(Number(hh) * 3600 + Number(mm) * 60 + Number(ss));
    });
  });
}
