// Renderiza un video del formato todo animado (composicion AnimatedVideo)
// desde un JSON con las props (escenas, capa fija, audio). Lo usa render_video
// (lib/motion.ts) y sirve a mano para medir: aca se renderiza cada cuadro, no
// solo la entrada de los graficos.
// Uso:
//   npx tsx scripts/render-animated.ts <props.json> <salida.mp4> [escala]
// escala: 1 = 1080p, 0.6667 = 720p.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { AnimatedVideoProps } from "../src/scenes/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const [propsPath, outPath = "animated.mp4", scale = "1"] = process.argv.slice(2);
if (!propsPath) {
  console.error("Uso: npx tsx scripts/render-animated.ts <props.json> <salida.mp4> [escala]");
  process.exit(1);
}
const inputProps = JSON.parse(readFileSync(propsPath, "utf8")) as AnimatedVideoProps;
const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || null;

const t0 = performance.now();
const serveUrl = await bundle({ entryPoint: path.join(here, "../src/index.ts") });
const composition = await selectComposition({ serveUrl, id: "AnimatedVideo", inputProps, browserExecutable });
const t1 = performance.now();
let lastLogged = -1;
await renderMedia({
  composition,
  serveUrl,
  inputProps,
  codec: "h264",
  crf: 18,
  scale: Number(scale),
  outputLocation: path.resolve(outPath),
  browserExecutable,
  ...(process.env.REMOTION_CONCURRENCY ? { concurrency: Number(process.env.REMOTION_CONCURRENCY) } : {}),
  onProgress: ({ progress }) => {
    const pct = Math.floor(progress * 100);
    if (pct !== lastLogged) {
      lastLogged = pct;
      console.log(`PROGRESS ${pct} 100`);
    }
  },
});
const seconds = (performance.now() - t1) / 1000;
console.log(
  `[render-animated] listo: ${composition.durationInFrames} cuadros (${(composition.durationInFrames / composition.fps).toFixed(1)} s de video) en ${seconds.toFixed(1)} s ` +
    `(${(composition.durationInFrames / seconds).toFixed(1)} cuadros/s), bundle ${((t1 - t0) / 1000).toFixed(1)} s`
);
