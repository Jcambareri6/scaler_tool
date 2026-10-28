// CLI que usa el worker (backend/src/lib/motion.ts): renderiza la entrada
// animada de cada grafico de un video como clip con transparencia, con un
// solo navegador para todos. Uso:
//   node --import tsx scripts/render-overlays.ts <job.json>
// job.json: { outDir, width, height, theme, locale, items: [{ id, spec }] }
// Escribe <outDir>/manifest.json: [{ id, path, durationSeconds }] y va
// imprimiendo "PROGRESS <hechos> <total>" para el progreso del Job.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { openBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { CATALOG } from "../src/catalog";
import type { OverlayProps, OverlaySpec } from "../src/spec";

interface Job {
  outDir: string;
  width: number;
  height: number;
  theme?: string;
  locale?: string;
  items: { id: string; spec: OverlaySpec }[];
}

interface ManifestEntry {
  id: string;
  path: string;
  durationSeconds: number;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jobPath = process.argv[2];
if (!jobPath) throw new Error("Uso: render-overlays.ts <job.json>");
const job = JSON.parse(readFileSync(jobPath, "utf-8")) as Job;

const prebuilt = path.join(root, "build");
const serveUrl = existsSync(path.join(prebuilt, "index.html"))
  ? prebuilt
  : await bundle({ entryPoint: path.join(root, "src/index.ts") });

const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || null;
const concurrency = process.env.REMOTION_CONCURRENCY ? Number(process.env.REMOTION_CONCURRENCY) : null;
const browser = await openBrowser("chrome", { browserExecutable });

const manifest: ManifestEntry[] = [];
try {
  for (const [i, item] of job.items.entries()) {
    const entry = CATALOG[item.spec.type];
    if (!entry) {
      console.warn(`[motion] tipo sin componente, se saltea: ${item.spec.type}`);
      continue;
    }
    const inputProps: OverlayProps = {
      spec: item.spec,
      theme: job.theme,
      durationSeconds: entry.introSeconds,
      exit: false,
      ...(job.locale ? { locale: job.locale } : {}),
      width: job.width,
      height: job.height,
    };
    const composition = await selectComposition({ serveUrl, id: "Overlay", inputProps, puppeteerInstance: browser });
    const outPath = path.join(job.outDir, `${item.id}.mov`);
    await renderMedia({
      composition,
      serveUrl,
      inputProps,
      codec: "prores",
      proResProfile: "4444",
      pixelFormat: "yuva444p10le",
      imageFormat: "png",
      outputLocation: outPath,
      puppeteerInstance: browser,
      ...(concurrency ? { concurrency } : {}),
    });
    manifest.push({ id: item.id, path: outPath, durationSeconds: composition.durationInFrames / composition.fps });
    console.log(`PROGRESS ${i + 1} ${job.items.length}`);
  }
} finally {
  await browser.close({ silent: true });
}

writeFileSync(path.join(job.outDir, "manifest.json"), JSON.stringify(manifest));
