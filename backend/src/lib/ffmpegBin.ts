import { createRequire } from "node:module";

// ffmpeg para leer de la RED (URLs https o el rele local de YouTube). En el
// worker (Linux) el binario estatico de ffmpeg-static se cae al resolver
// nombres o conectarse ("Segmentation fault" con cualquier https): ahi
// FFMPEG_NETWORK_PATH apunta al ffmpeg de Debian (ver Dockerfile). En local
// (Windows) no hace falta y se usa el de ffmpeg-static.
const require = createRequire(import.meta.url);
const ffmpegStatic = require("ffmpeg-static") as string | null;

export const ffmpegForNetwork: string | null = process.env.FFMPEG_NETWORK_PATH?.trim() || ffmpegStatic;
