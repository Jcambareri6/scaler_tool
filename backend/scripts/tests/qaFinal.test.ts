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

// QA: alguien a camara o marca de agua nunca pasa, ni en un rescate.
{
  const { adjustVerdict: adj } = await import("../../src/pipeline/qaFinal.js");
  const base = { order: 1, code: "ok" as const, stock: false, obra: null, sitio: false, hoy: null, habla: false, lugar: null, por: "" };
  const item = { sceneId: "s", order: 1, url: "u", type: "VIDEO" as const, rescue: true, shot: { frase: "x", clase: "ambiente" as const, sujeto: "" } };
  if (adj({ ...base, camara: true, marca: null }, item as never) !== "presentador") throw new Error("selfie paso");
  if (adj({ ...base, camara: null, marca: true }, item as never) !== "texto") throw new Error("marca de agua paso");
  if (adj({ ...base, camara: false, marca: false }, item as never) !== "ok") throw new Error("limpio no paso");
  console.log("QA vloggers y marcas OK");
}

// El tema del video no cuenta como obra repetida (piloto del Caminito del Rey:
// 10 planos buenos rechazados por "obra repetida: Caminito del Rey").
{
  const { repeatedWorks } = await import("../../src/pipeline/qaFinal.js");
  const e = [1, 2, 3, 4].map((order) => ({ order, obra: "Caminito del Rey", sitio: true, text: "la pasarela cuelga sobre el rio" }));
  if (repeatedWorks(e).size === 0) throw new Error("sin tema deberia marcar repetidos");
  const r = repeatedWorks(e, ["PILOTO 3 · Caminito del Rey (3 min)", "Desfiladero de los Gaitanes, provincia de Málaga, España"]);
  if (r.size !== 0) throw new Error(`el tema del video no es obra repetida: ${[...r]}`);
  const other = repeatedWorks([...e, { order: 5, obra: "Mona Lisa painting", sitio: false, text: "x" }, { order: 6, obra: "Mona Lisa painting", sitio: false, text: "x" }], ["Caminito del Rey"]);
  if (!other.has(6) || other.size !== 1) throw new Error("otra obra si cuenta como repetida");
  console.log("obra del tema OK");
}

// En otro idioma: "Iguazu Falls" es el tema "Cataratas del Iguazu" (piloto de Iguazu).
{
  const { repeatedWorks } = await import("../../src/pipeline/qaFinal.js");
  const subjects = ["PILOTO 5 · Cataratas del Iguazú (2 min)", "Cataratas del Iguazú, Misiones, Argentina y Paraná, Brasil"];
  const e = ["Iguazu Falls", "Iguazú Falls", "Devil's Throat, Iguazú", "Iguazu Falls"].map((obra, i) => ({ order: i + 1, obra, sitio: true, text: "x" }));
  if (repeatedWorks(e, subjects).size !== 0) throw new Error("Iguazu Falls es el tema del video");
  const niagara = [1, 2].map((order) => ({ order: order * 20, obra: "Niagara Falls", sitio: false, text: "x" }));
  if (repeatedWorks(niagara, subjects).size !== 1) throw new Error("otra catarata si cuenta como repetida");
  console.log("obra del tema en otro idioma OK");
}
