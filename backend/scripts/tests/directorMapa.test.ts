// Director de mapas: planos, validacion y vuelo de camara (sin red).
//   npx tsx --env-file=.env scripts/tests/directorMapa.test.ts
import assert from "node:assert/strict";
import { continuar, cortarEnPlanos, valida, volar, type Escena } from "../../src/director/directorMapa.js";
import type { Phrase } from "../../src/director/phrases.js";

// 60 palabras, una cada 0,4 s, oracion cada 10 palabras.
const words = Array.from({ length: 60 }, (_, i) => ({ text: (i + 1) % 10 === 0 ? `fin${i}.` : `w${i}`, start: i * 0.4, end: i * 0.4 + 0.35 }));
const phrases: Phrase[] = [{ id: "p1", text: "", start: 0, end: 24, words }];
const shots = cortarEnPlanos(phrases, 2.5, 6.5);
assert.equal(shots[0]!.start, 0);
for (let i = 0; i < shots.length - 1; i++) {
  assert.equal(shots[i]!.end, shots[i + 1]!.start, "contiguos");
  const d = shots[i]!.end - shots[i]!.start;
  assert.ok(d >= 2.4 && d <= 6.9, `duracion ${d}`);
  assert.match(shots[i]!.line, /\.$/, "corta en final de oracion");
}
assert.equal(shots[0]!.from, 0);
assert.equal(shots[shots.length - 1]!.to, 59);
console.log(`planos OK (${shots.length})`);

assert.ok(valida({ centro: { lat: 1, lon: 2 }, km: 3000, paises: [{ nombre: "China" }] }));
assert.ok(!valida({ centro: { lat: 1, lon: 2 }, km: 3000, paises: [] }), "sin pais");
assert.ok(!valida({ km: 3000, paises: [{ nombre: "China" }] }), "sin centro");

const a: Escena = { centro: { lat: 35, lon: 104 }, km: 7500, paises: [{ nombre: "China", color: "#E8312A", en: 0.2 }, { nombre: "Iran", color: "#2F7FE0", en: 0.5 }] };
const b: Escena = { centro: { lat: 26, lon: 56 }, km: 2000, paises: [{ nombre: "China", en: 0.3 }, { nombre: "Saudi Arabia", en: 0.6 }], cifra: { texto: "12M" } };
const c: Escena = { centro: { lat: 26.05, lon: 56.05 }, km: 2010, paises: [{ nombre: "Saudi Arabia", en: 0.2 }] };
const [, vb, vc] = volar([a, b, c]);
const cb = vb!.camara as { desde: { km: number }; vuelo: number; deriva: number[] };
assert.equal(cb.desde.km, 7500, "vuela desde el encuadre anterior");
assert.equal(cb.vuelo, 1.4);
assert.deepEqual(cb.deriva, [0, 0], "con cifra casi quieto");
assert.equal(vb!.paises!.find((p) => p.nombre === "China")!.en, -1, "el que sigue no vuelve a subir");
assert.ok(vb!.paises!.some((p) => p.nombre === "Iran" && p.hasta === 0.45), "el que se va se desvanece");
assert.equal((vc!.camara as { desde: { mantener?: boolean } }).desde.mantener, true, "mismo encuadre: sigue sin volver atras");
assert.equal(continuar(a).paises!.every((p) => p.en === -1), true);
console.log("vuelo OK");
