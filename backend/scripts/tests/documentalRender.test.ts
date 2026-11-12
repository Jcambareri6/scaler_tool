// Filtros del look documental contra ffmpeg real (material sintetico).
//   npx tsx scripts/tests/documentalRender.test.ts
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { audioMixArgs, lookFilter, motionFor, parseQc, QC_FILTER_ARGS, sfxCues, zoomCutFilter, zoompanExpr, type Motion } from "../../src/lib/documentalRender.js";
import { getDocumentalStyle } from "../../src/lib/documentalStyles.js";

const ffmpeg = createRequire(import.meta.url)("ffmpeg-static") as string;
const dir = mkdtempSync(path.join(tmpdir(), "docrender-"));
const run = (args: string[]) => {
  const r = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "info", ...args], { encoding: "utf-8" });
  if (r.status !== 0) throw new Error(r.stderr.slice(-1500));
  return r.stderr;
};
const out = { width: 1280, height: 720 };

for (const id of ["documental", "nocturno", "historia"]) {
  const style = getDocumentalStyle(id);
  // Video: look + destello + cortes de zoom.
  const vf = `scale=1280:720,fps=30,${zoomCutFilter(style.look.zoomCutEvery || 4, out)},${lookFilter(style.look, 9)}`;
  run(["-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30:duration=6", "-vf", vf, "-c:v", "libx264", "-preset", "ultrafast", path.join(dir, `${id}-clip.mp4`)]);
  console.log(`video ${id} OK`);
}

// Fotos: los 5 movimientos, sin repetir el anterior.
run(["-y", "-f", "lavfi", "-i", "testsrc2=size=1600x1200:duration=1", "-frames:v", "1", path.join(dir, "foto.png")]);
let prev: Motion | null = null;
for (let i = 0; i < 6; i++) {
  const m = motionFor(i, prev);
  assert.notEqual(m, prev);
  prev = m;
  const frames = 90;
  const e = zoompanExpr(m, frames);
  run(["-y", "-i", path.join(dir, "foto.png"), "-vf", `scale=1792:1008:force_original_aspect_ratio=increase,crop=1792:1008,zoompan=z='${e.z}':x='${e.x}':y='${e.y}':d=${frames}:s=1792x1008:fps=30,scale=1280:720,${lookFilter(getDocumentalStyle("documental").look, i)}`, "-c:v", "libx264", "-preset", "ultrafast", path.join(dir, `foto-${i}.mp4`)]);
  console.log(`foto ${m} OK`);
}

// Audio: voz con pausas + musica + efectos -> -14 LUFS.
run(["-y", "-f", "lavfi", "-i", "sine=f=220:d=3,apad=pad_dur=2,volume=0.3", "-f", "lavfi", "-i", "sine=f=300:d=3", "-filter_complex", "[0][1]concat=n=2:v=0:a=1", path.join(dir, "voz.wav")]);
run(["-y", "-f", "lavfi", "-i", "sine=f=440:d=2,volume=0.5", path.join(dir, "musica.mp3")]);
const sfx = sfxCues([{ start: 1, type: "big_number" }, { start: 2, type: "title_card" }, { start: 4.5, type: "timeline" }, { start: 5, type: "kinetic_quote" }]);
assert.equal(sfx.length, 2, "separacion minima y tipos sin efecto");
run(audioMixArgs({ voicePath: path.join(dir, "voz.wav"), musicPath: path.join(dir, "musica.mp3"), duration: 8, sound: getDocumentalStyle("documental").sound, sfx, outPath: path.join(dir, "mix.flac") }));
run(audioMixArgs({ voicePath: path.join(dir, "voz.wav"), musicPath: null, duration: 8, sound: getDocumentalStyle("documental").sound, sfx: [], outPath: path.join(dir, "mix-solo.flac") }));
console.log("mezcla OK");

// QC: video con 1 s negro y 3 s congelado + el audio mezclado.
run(["-y", "-f", "lavfi", "-i", "color=black:size=320x180:d=1", "-f", "lavfi", "-i", "testsrc2=size=320x180:d=2", "-f", "lavfi", "-i", "color=gray:size=320x180:d=3",
  "-i", path.join(dir, "mix.flac"), "-filter_complex", "[0][1][2]concat=n=3:v=1:a=0[v]", "-map", "[v]", "-map", "3:a", "-shortest", "-c:v", "libx264", "-preset", "ultrafast", path.join(dir, "qc.mp4")]);
const qc = parseQc(run(["-i", path.join(dir, "qc.mp4"), ...QC_FILTER_ARGS]));
console.log("QC", JSON.stringify(qc));
assert.ok(qc.black_segments.length >= 1, "detecta negro");
assert.ok(qc.frozen_segments.length >= 1, "detecta congelado");
assert.ok(qc.integrated_lufs !== null && Math.abs(qc.integrated_lufs + 14) < 2.5, "loudness cerca de -14");
console.log("\nOK: filtros documentales", dir);
