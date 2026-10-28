// Compila los componentes una sola vez (al construir la imagen del worker)
// para que cada render no pague los ~15s de webpack. render-overlays.ts usa
// build/ si existe y si no compila al vuelo (desarrollo).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "build");
await bundle({ entryPoint: path.join(root, "src/index.ts"), outDir });
console.log(`[motion] bundle listo en ${outDir}`);
