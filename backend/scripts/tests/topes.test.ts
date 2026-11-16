// Topes de pantalla (sin red).   npx tsx scripts/tests/topes.test.ts
import assert from "node:assert/strict";
import { capFor, cutPoint, neighbourMax, planExtension } from "../../src/pipeline/topes.js";

// Que tiene tope.
assert.equal(capFor({ provider: "textura", via: "rotulo", type: "IMAGE" }), 3);
assert.equal(capFor({ provider: "pexels", via: "stock", type: "IMAGE" }), 4);
assert.equal(capFor({ provider: "commons", via: "commons_tema", type: "IMAGE" }), 4);
assert.equal(capFor({ provider: "commons", via: "commons", type: "IMAGE", stock: true }), 4, "el QA la marco como stock");
assert.equal(capFor({ provider: "commons", via: "commons", type: "IMAGE" }), null, "foto propia del tema: sin tope");
assert.equal(capFor({ provider: "pexels", via: "stock", type: "VIDEO" }), null, "un clip se mueve: sin tope");

// Corte: comienzo de palabra mas cercano al tope, dejando 2,2 s a cada lado.
const words = [0, 0.6, 1.4, 2.5, 3.3, 4.1, 4.9, 6.0, 7.2, 8.0].map((start) => ({ start }));
assert.equal(cutPoint(words, 0, 9, 4), 4.1 - 0.12);
assert.equal(cutPoint(words, 0, 4.5, 4), null, "no quedan 2,2 s para la segunda parte");
assert.equal(cutPoint(words, 0, 5.5, 4), 3.3 - 0.12, "con 5,5 s corta donde quedan 2,2 s");
assert.equal(cutPoint([{ start: 0 }, { start: 8 }], 0, 12, 3), null, "ninguna palabra en la ventana");

// Lo que aguanta un vecino.
assert.equal(neighbourMax({ graphic: true, cap: null }), 8);
assert.equal(neighbourMax({ type: "IMAGE", graphic: false, cap: null }), 7);
assert.equal(neighbourMax({ type: "IMAGE", graphic: false, cap: 4 }), 4);
assert.equal(neighbourMax({ type: "VIDEO", graphic: false, cap: null, clipSeconds: 3 }), 5);
assert.equal(neighbourMax({ type: "VIDEO", graphic: false, cap: null, clipSeconds: 30 }), 9);

// Reparto: primero el siguiente, despues el anterior; nada si ceden < 0,4 s.
assert.deepEqual(planExtension(3, 1, 2), { next: 2, prev: 1 });
assert.deepEqual(planExtension(3, 5, 5), { next: 3, prev: 0 });
assert.equal(planExtension(3, 0.1, 0.2), null);
console.log("topes OK");
