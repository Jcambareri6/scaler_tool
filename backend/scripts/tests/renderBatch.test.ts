// Una tanda del render en formato documental (foto + clip) con el mismo
// constructor de filtros que usa render_video.   npx tsx scripts/tests/renderBatch.test.ts
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { buildFfmpegArgsForBatch, type RenderSegment } from "../../src/tools/renderVideo.tool.js";
import { getDocumentalStyle } from "../../src/lib/documentalStyles.js";

const ffmpeg = createRequire(import.meta.url)("ffmpeg-static") as string;
const dir = mkdtempSync(path.join(tmpdir(), "batch-"));
const run = (args: string[]) => {
  const r = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", ...args], { encoding: "utf-8" });
  if (r.status !== 0) throw new Error(r.stderr.slice(-2000));
};
run(["-y", "-f", "lavfi", "-i", "testsrc2=size=1600x1200:duration=1", "-frames:v", "1", path.join(dir, "a.png")]);
run(["-y", "-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=25:duration=5", "-c:v", "libx264", "-preset", "ultrafast", path.join(dir, "b.mp4")]);
run(["-y", "-f", "lavfi", "-i", "smptebars=size=1280x720:duration=1", "-frames:v", "1", path.join(dir, "c.png")]);
const segs: RenderSegment[] = [
  { storageKey: "a", start: 0, end: 4, duration: 4, isImage: true },
  { storageKey: "b", start: 4, end: 11, duration: 7, isImage: false },
  { storageKey: "c", start: 11, end: 14, duration: 3, isImage: true },
];
for (const id of ["documental", "nocturno"]) {
  const { inputArgs, filterComplex } = buildFfmpegArgsForBatch(segs, [path.join(dir, "a.png"), path.join(dir, "b.mp4"), path.join(dir, "c.png")], false, { width: 1280, height: 720 }, { style: getDocumentalStyle(id), firstIndex: 8 });
  const out = path.join(dir, `${id}.mp4`);
  run([...inputArgs, "-filter_complex", filterComplex, "-map", "[outv]", "-c:v", "libx264", "-preset", "ultrafast", "-y", out]);
  const probe = spawnSync(ffmpeg, ["-i", out], { encoding: "utf-8" }).stderr.match(/Duration: ([\d:.]+)/)?.[1];
  console.log(`${id}: OK duracion ${probe} (esperada 00:00:14)`);
}
console.log(dir);
