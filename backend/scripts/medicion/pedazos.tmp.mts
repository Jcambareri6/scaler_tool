import "dotenv/config";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { downloadYouTubeSegment } from "../../src/lib/youtubeSource.js";
import { esperaSlots, type EsperaSlots } from "../../src/lib/youtubeGuard.js";
const dir = mkdtempSync(path.join(tmpdir(), "pedazos-"));
const id = process.argv[2] ?? "cN5uEsM5Txc";
const at = Number(process.argv[3] ?? 916);
const cand = { provider: "youtube", external_id: id, type: "VIDEO" as const, url: `https://www.youtube.com/watch?v=${id}`, video_seconds: 1500, duration_seconds: 1500, license: "x", source_page: "", query: "x" };
for (const [k, t] of [[1, at], [2, at + 90]] as const) {
  const m: EsperaSlots = { ms: 0, por: {} };
  const t0 = Date.now();
  try {
    const out = await esperaSlots.run(m, () => downloadYouTubeSegment(cand, 6, dir, 0.3, t));
    console.log(`tramo ${k} @${t}s: ${Math.round((Date.now() - t0) / 1000)} s, ${Math.round(statSync(out).size / 1024)} KB, via ${JSON.stringify(m.tramos)}`);
  } catch (e) { console.log(`tramo ${k} FALLO ${(e as Error).message.slice(0, 200)}`, JSON.stringify(m.tramos)); }
}
process.exit(0);
