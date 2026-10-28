// Prueba de la Fase 0: renderiza un grafico con fondo transparente
// (ProRes 4444) y lo superpone con ffmpeg sobre un video base, midiendo
// cuanto tarda cada paso. Uso:
//   npm run render:sample -- <dir-salida> <video-base.mp4> [inicio-en-segundos]
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { OverlayProps } from "../src/spec";

const here = path.dirname(fileURLToPath(import.meta.url));
const [outDir = "out", baseVideo, startArg = "1"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || null;
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";

const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const t0 = performance.now();
  const result = await fn();
  console.log(`[render-sample] ${label}: ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  return result;
};

const inputProps: OverlayProps = {
  spec: { type: "big_number", text: "más de 1.000 km por hora", label: "viento hacia el este" },
  theme: "documental",
  durationSeconds: Number(process.env.SAMPLE_SECONDS ?? 4.5),
};

const serveUrl = await timed("bundle", () => bundle({ entryPoint: path.join(here, "../src/index.ts") }));
const composition = await timed("selectComposition", () =>
  selectComposition({ serveUrl, id: "Overlay", inputProps, browserExecutable })
);

const overlayPath = path.resolve(outDir, "overlay.mov");
await timed(`renderMedia (${composition.durationInFrames} frames)`, () =>
  renderMedia({
    composition,
    serveUrl,
    inputProps,
    codec: "prores",
    proResProfile: "4444",
    pixelFormat: "yuva444p10le",
    imageFormat: "png",
    outputLocation: overlayPath,
    browserExecutable,
    // Default de Remotion = la mitad de los nucleos.
    ...(process.env.REMOTION_CONCURRENCY ? { concurrency: Number(process.env.REMOTION_CONCURRENCY) } : {}),
  })
);

if (baseVideo) {
  const start = Number(startArg);
  const finalPath = path.resolve(outDir, "composited.mp4");
  await timed("ffmpeg overlay", async () => {
    const result = spawnSync(
      ffmpeg,
      [
        "-hide_banner", "-loglevel", "error",
        "-i", baseVideo,
        "-itsoffset", String(start), "-i", overlayPath,
        "-filter_complex", `[0:v]scale=1920:1080,setsar=1[base];[base][1:v]overlay=eof_action=pass:format=auto[v]`,
        "-map", "[v]", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-y", finalPath,
      ],
      { stdio: "inherit" }
    );
    if (result.status !== 0) throw new Error("ffmpeg fallo");
  });
  console.log(`[render-sample] listo: ${finalPath}`);
}
