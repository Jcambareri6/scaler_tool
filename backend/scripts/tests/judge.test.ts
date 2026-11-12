// Juez visual: lectura del veredicto (sin red) y miniaturas de candidatos
// reales (con red).   npx tsx scripts/tests/judge.test.ts
import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { candidateThumbnail, parseVerdict } from "../../src/director/visualJudge.js";
import { searchCommonsImages } from "../../src/lib/documentalSources.js";

// El elegido tiene que haber sido visto y no rechazado.
let r = parseVerdict({ elegido: 2, veredictos: [{ i: 1, codigo: "generico", motivo: "relleno" }, { i: 2, codigo: "ok", motivo: "es el reactor" }] }, 3, new Set([0, 1]));
assert.equal(r.chosen, 1);
r = parseVerdict({ elegido: 3, veredictos: [] }, 3, new Set([0, 1]));
assert.equal(r.chosen, null, "no vio el 3");
r = parseVerdict({ elegido: 1, veredictos: [{ i: 1, codigo: "epoca", motivo: "moderno" }] }, 2, new Set([0, 1]));
assert.equal(r.chosen, null, "elegido rechazado");
r = parseVerdict({ elegido: null, veredictos: [{ i: 1, codigo: "raro" }] }, 1, new Set([0]));
assert.equal(r.verdicts[0]!.code, "generico");
console.log("veredictos OK");

if (process.env.LIVE) {
  const dir = await mkdtemp(path.join(tmpdir(), "juez-"));
  const photos = await searchCommonsImages("Chernobyl nuclear power plant");
  const photo = photos.find((p) => (p.thumb_url ?? p.url).includes("upload.wikimedia.org")) ?? photos[0];
  assert.ok(photo, "commons sin resultados");
  const thumb = await candidateThumbnail(photo!, dir, "foto");
  assert.ok(thumb, "sin miniatura");
  console.log("miniatura foto", (await stat(thumb!)).size, "bytes", thumb);
}
