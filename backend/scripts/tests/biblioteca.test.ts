// Biblioteca del video: que video le toca a cada frase (sin red).
//   npx tsx --require dotenv/config scripts/tests/biblioteca.test.ts
import assert from "node:assert/strict";
import { libraryCandidates, terms } from "../../src/lib/documentalLibrary.js";

const v = (id: string, frames: [string, boolean][]) => ({
  candidate: { provider: "youtube", external_id: id, type: "VIDEO" as const, url: `https://www.youtube.com/watch?v=${id}`, license: "", source_page: "", query: "" },
  frames: frames.map(([desc, ok], i) => ({ t: 10 + i * 20, desc, ok })),
  sheetPath: `/tmp/${id}.jpg`,
});
const lib = [
  v("trenes", [["locomotoras oxidadas en el desierto", true], ["vagones abandonados cementerio de trenes", true]]),
  v("espejo", [["salar inundado reflejando el cielo", true], ["camioneta sobre el espejo de agua", true]]),
  v("vlog", [["mujer hablando a camara en el salar", false], ["selfie de turistas", false]]),
  v("hotel", [["hotel construido con bloques de sal", true]]),
];
const none = () => false;
assert.deepEqual(libraryCandidates(lib, "Decenas de locomotoras y vagones oxidados", none).map((c) => c.external_id), ["trenes"]);
assert.equal(libraryCandidates(lib, "el cielo se refleja en el suelo, efecto espejo", none)[0]!.external_id, "espejo");
assert.equal(libraryCandidates(lib, "mujer hablando a camara", none).length, 0, "los cuadros no aptos no cuentan");
assert.equal(libraryCandidates(lib, "hoteles hechos de bloques de sal", (c) => c.external_id === "hotel").length, 0, "lo ya usado se excluye");
assert.equal(libraryCandidates(lib, "hoteles hechos de bloques de sal", none)[0]!.sheet_path, "/tmp/hotel.jpg", "lleva la hoja ya armada");
assert.ok(terms("Las rocas y la montaña").includes(terms("roca montañas")[0]!));
console.log("biblioteca OK");
