// YouTube: subtitulos, momentos, barras y quietud (sin red).
//   npx tsx --env-file=.env scripts/tests/youtubeTramo.test.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { barsCrop, frozenShare, momentsFromCues, parseVtt, subtitleKeywords } from "../../src/lib/youtubeSource.js";

const vtt = `WEBVTT

00:00:05.000 --> 00:00:07.000
el <c>canal</c> de Panamá

00:00:30.000 --> 00:00:33.000
las esclusas del canal se abrieron

00:00:35.000 --> 00:00:38.000
cada esclusa mide 300 metros

00:01:20.000 --> 00:01:22.000
otra vez el canal
`;
const cues = parseVtt(vtt);
assert.equal(cues.length, 4);
assert.equal(cues[0]!.text, "el canal de Panamá");
assert.equal(cues[3]!.start, 80);
const kw = subtitleKeywords(["las esclusas", "Canal de Panamá", undefined]);
assert.ok(kw.includes("canal") && kw.includes("esclusas") && kw.includes("panama"));
const moments = momentsFromCues(cues, kw);
assert.equal(moments[0], 30, "la ventana con mas aciertos primero");
assert.equal(moments[1], 80, "separada 20 s o mas; nada antes de 8 s");
assert.deepEqual(momentsFromCues(cues, ["dinosaurio"]), []);
console.log("subtitulos OK");

// Imagen quieta: fraccion de la ventana.
assert.equal(frozenShare("freeze_start: 1\nfreeze_end: 9", 0, 10, 10), 0.8);
assert.equal(frozenShare("freeze_start: 2", 0, 10, 10), 0.8, "sin fin: hasta el final");
assert.equal(frozenShare("", 0, 10, 10), 0);

// Barras: un video 16:9 con franjas negras arriba y abajo.
const require = createRequire(import.meta.url);
const ffmpeg = require("ffmpeg-static") as string;
const dir = mkdtempSync(path.join(tmpdir(), "yt-"));
try {
  const boxed = path.join(dir, "boxed.mp4");
  spawnSync(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc2=size=640x264:duration=3", "-vf", "pad=640:360:0:48:black", "-pix_fmt", "yuv420p", boxed]);
  const log = spawnSync(ffmpeg, ["-hide_banner", "-i", boxed, "-an", "-vf", "freezedetect=n=0.003:d=0.5,cropdetect=limit=40:round=2:reset=1", "-f", "null", "-"]).stderr.toString();
  const crop = barsCrop(log);
  assert.ok(crop && /^crop=640:26\d:0:4\d$/.test(crop), `crop detectado: ${crop}`);
  const full = path.join(dir, "full.mp4");
  spawnSync(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:duration=3", "-pix_fmt", "yuv420p", full]);
  const log2 = spawnSync(ffmpeg, ["-hide_banner", "-i", full, "-an", "-vf", "cropdetect=limit=40:round=2:reset=1", "-f", "null", "-"]).stderr.toString();
  assert.equal(barsCrop(log2), null, "sin barras no recorta");
  console.log(`barras OK (${crop})`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
