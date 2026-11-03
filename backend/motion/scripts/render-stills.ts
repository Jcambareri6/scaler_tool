// Capturas reales de un video animado para que las vea el Revisor: una imagen
// por cada segundo pedido, con la misma composicion que el render.
// Uso:
//   npx tsx scripts/render-stills.ts <props.json> <pedidos.json> <carpeta>
// pedidos.json: [{ "id": "s1-0", "seconds": 3.2 }, ...]
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import type { AnimatedVideoProps } from "../src/scenes/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const [propsPath, requestsPath, outDir] = process.argv.slice(2);
if (!propsPath || !requestsPath || !outDir) {
  console.error("Uso: npx tsx scripts/render-stills.ts <props.json> <pedidos.json> <carpeta>");
  process.exit(1);
}
const inputProps = JSON.parse(readFileSync(propsPath, "utf8")) as AnimatedVideoProps;
const requests = JSON.parse(readFileSync(requestsPath, "utf8")) as { id: string; seconds: number }[];
const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || null;
mkdirSync(outDir, { recursive: true });

const serveUrl = await bundle({ entryPoint: path.join(here, "../src/index.ts") });
// Sin audio: las capturas no lo necesitan y no dependen de la red.
const { audioSrc: _audio, ...stillProps } = inputProps;
const composition = await selectComposition({ serveUrl, id: "AnimatedVideo", inputProps: stillProps, browserExecutable });
for (const [i, request] of requests.entries()) {
  await renderStill({
    composition,
    serveUrl,
    inputProps: stillProps,
    frame: Math.min(composition.durationInFrames - 1, Math.round(request.seconds * composition.fps)),
    output: path.join(outDir, `${request.id}.jpg`),
    imageFormat: "jpeg",
    jpegQuality: 70,
    scale: 0.5,
    browserExecutable,
  });
  console.log(`PROGRESS ${i + 1} ${requests.length}`);
}
