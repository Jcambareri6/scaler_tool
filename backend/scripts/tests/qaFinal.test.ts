// QA final: tandas, ajustes en codigo y obras repetidas (sin red).
//   npx tsx scripts/tests/qaFinal.test.ts
import assert from "node:assert/strict";
import { shotEpochs } from "../../src/lib/epoca.js";
import { adjustVerdict, batches, parseQaVerdicts, repeatedWorks, sameWork, type QaItem, type QaVerdict } from "../../src/pipeline/qaFinal.js";

// Tandas: hasta 6 planos o 18 imagenes.
const sizes = (b: { images: number }[][]) => b.map((x) => x.length);
assert.deepEqual(sizes(batches(Array.from({ length: 13 }, () => ({ images: 1 })))), [6, 6, 1]);
assert.deepEqual(sizes(batches(Array.from({ length: 8 }, () => ({ images: 3 })))), [6, 2]);
assert.deepEqual(sizes(batches([{ images: 3 }, { images: 3 }, { images: 3 }, { images: 3 }, { images: 3 }, { images: 1 }, { images: 3 }])), [6, 1]);
console.log("tandas OK");

// Lectura: ignora planos que no se pidieron y codigos raros.
const parsed = parseQaVerdicts(
  [
    { plano: 3, codigo: "equivocado", obra: "Eiffel Tower", sitio: true, por: "otra torre" },
    { plano: 9, codigo: "ok" },
    { plano: 4, codigo: "inventado", hoy: false },
  ],
  [3, 4]
);
assert.equal(parsed.length, 2);
assert.equal(parsed[0]!.code, "equivocado");
assert.equal(parsed[1]!.code, "ok");
assert.equal(parsed[1]!.hoy, false);

// Ajustes en codigo.
const verdict = (code: QaVerdict["code"], extra: Partial<QaVerdict> = {}): QaVerdict => ({ order: 1, code, stock: false, obra: null, sitio: false, hoy: null, habla: null, lugar: null, por: "", ...extra });
const item = (text: string, extra: Partial<QaItem> = {}): QaItem => ({
  sceneId: "s",
  order: 1,
  shot: { frase: text, clase: "lugar", sujeto: "x", epoca: shotEpochs([text])[0]! },
  url: "u",
  type: "IMAGE",
  rescue: false,
  ...extra,
});
assert.equal(adjustVerdict(verdict("epoca"), item("Tulum es una playa hermosa.")), "ok", "sin linea Era no hay epoca");
assert.equal(adjustVerdict(verdict("epoca"), item("En 1912 zarpó el barco.")), "epoca");
assert.equal(adjustVerdict(verdict("epoca", { hoy: false }), item("En el 79 d.C. Pompeya quedó sepultada.")), "ok", "antes del cine sin nada de hoy");
assert.equal(adjustVerdict(verdict("presentador", { habla: false }), item("x")), "ok");
assert.equal(adjustVerdict(verdict("generico"), item("x", { rescue: true })), "ok", "rescate acepta el tema");
assert.equal(adjustVerdict(verdict("ok", { stock: true }), item("En 1912 zarpó el barco.")), "epoca", "foto de stock en historia");
assert.equal(adjustVerdict(verdict("ok", { stock: true }), item("En 1912 zarpó el barco.", { type: "VIDEO" })), "ok", "solo fotos");
console.log("ajustes OK");

// Obras repetidas.
assert.ok(sameWork("Eiffel Tower", "the Eiffel Tower Paris"));
assert.ok(!sameWork("Eiffel Tower", "Tower Bridge London"));
const rep = repeatedWorks([
  { order: 1, obra: "Mona Lisa painting", sitio: false, text: "la obra más famosa" },
  { order: 2, obra: "Mona Lisa", sitio: false, text: "fue robada en 1911" },
  { order: 20, obra: "Mona Lisa", sitio: false, text: "la Mona Lisa volvió al Louvre" },
  { order: 5, obra: "Louvre Museum", sitio: true, text: "el museo" },
  { order: 6, obra: "Louvre Museum", sitio: true, text: "sus salas" },
  { order: 7, obra: "Louvre Museum", sitio: true, text: "los guardias" },
  { order: 8, obra: "Louvre Museum", sitio: true, text: "de noche" },
]);
assert.ok(rep.has(2), "la misma obra cerca se rechaza");
assert.ok(!rep.has(20), "vuelve lejos si la frase la nombra");
assert.ok(!rep.has(6) && !rep.has(7), "un sitio puede repetirse cerca");
assert.ok(rep.has(8), "pero hasta 3 usos");
console.log("obras OK");
