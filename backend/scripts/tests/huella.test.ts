// Huella dHash (sin red: genera imagenes con ffmpeg).   npx tsx scripts/tests/huella.test.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { HuellaRegistry, distance, fingerprint, sameVisual } from "../../src/lib/huella.js";

const require = createRequire(import.meta.url);
const ffmpeg = require("ffmpeg-static") as string;
const dir = await mkdtemp(path.join(tmpdir(), "huella-"));
const make = (name: string, filter: string) => {
  const out = path.join(dir, name);
  const r = spawnSync(ffmpeg, ["-y", "-f", "lavfi", "-i", filter, "-frames:v", "1", out], { windowsHide: true });
  assert.equal(r.status, 0, r.stderr.toString().slice(-300));
  return out;
};

try {
  const a = make("a.png", "testsrc2=size=640x360");
  const aSmall = make("a-small.jpg", "testsrc2=size=640x360,scale=320:180");
  const b = make("b.png", "mandelbrot=size=640x360");
  const flat = make("flat.png", "color=c=black:size=640x360");
  const clip = path.join(dir, "clip.mp4");
  spawnSync(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:duration=4", "-pix_fmt", "yuv420p", clip], { windowsHide: true });

  const ha = (await fingerprint(a, "IMAGE"))!;
  const haSmall = (await fingerprint(aSmall, "IMAGE"))!;
  const hb = (await fingerprint(b, "IMAGE"))!;
  const hflat = (await fingerprint(flat, "IMAGE"))!;
  const hclip = (await fingerprint(clip, "VIDEO", 4))!;

  assert.equal(ha.frames.length, 1);
  assert.equal(hflat.frames.length, 0, "un cuadro liso no deja huella");
  assert.equal(hclip.frames.length, 3, "tres cuadros por clip");
  console.log("distancias: misma reescalada", distance(ha.frames[0]!, haSmall.frames[0]!), "distinta", distance(ha.frames[0]!, hb.frames[0]!));
  assert.ok(sameVisual(ha, haSmall), "la misma imagen reescalada es igual");
  assert.ok(!sameVisual(ha, hb), "otra imagen es distinta");

  const reg = new HuellaRegistry();
  assert.equal(reg.claim("commons:1", ha), null);
  assert.equal(reg.claim("openverse:9", haSmall), "commons:1", "la segunda copia se rechaza");
  assert.equal(reg.claim("x:liso", hflat), null, "sin huella pasa siempre");
  assert.equal(reg.claim("otra", hb), null);
  reg.release("commons:1");
  assert.equal(reg.claim("openverse:9", haSmall), null, "liberada, se puede volver a usar");
  console.log("huella OK");
} finally {
  await rm(dir, { recursive: true, force: true });
}
