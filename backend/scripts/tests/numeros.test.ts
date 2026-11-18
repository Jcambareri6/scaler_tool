// Cifras en letras -> digitos y graficos casi literales (sin red).
//   npx tsx --require dotenv/config scripts/tests/numeros.test.ts
import assert from "node:assert/strict";
import { numbersIn, numerizar } from "../../src/lib/numerosEs.js";
import { generateOverlayTool, nearLiteral, titleFromScript } from "../../src/tools/generateOverlay.tool.js";

// Casos del guion de La Rumorosa.
assert.equal(numerizar("Hoy se registran alrededor de ciento setenta accidentes al año"), "Hoy se registran alrededor de 170 accidentes al año");
assert.equal(numerizar("pierde más de novecientos metros de altura"), "pierde más de 900 metros de altura");
assert.equal(numerizar("pueden superar los cuarenta y cinco grados"), "pueden superar los 45 grados");
assert.equal(numerizar("en apenas unos dieciséis kilómetros"), "en apenas unos 16 kilómetros");
assert.equal(numerizar("un rascacielos de trescientos pisos"), "un rascacielos de 300 pisos");
assert.equal(numerizar("unos once kilómetros de la frontera"), "unos 11 kilómetros de la frontera");
assert.equal(numerizar("Hoy te cuento cuatro datos"), "Hoy te cuento cuatro datos", "menos de 10 queda en letras");
assert.equal(numerizar("Hoy te cuento cuatro datos", 0), "Hoy te cuento 4 datos");
assert.equal(numerizar("una mujer vestida de blanco", 0), "una mujer vestida de blanco", "un/una son articulos");
assert.equal(numerizar("más de dos millones de personas", 0), "más de 2 millones de personas");
assert.equal(numerizar("un millón de dólares", 0), "1 millón de dólares");
assert.equal(numerizar("en mil novecientos noventa y seis"), "en 1996");
assert.equal(numerizar("doce mil soldados"), "12.000 soldados");
assert.equal(numerizar("mil doscientos cincuenta metros"), "1.250 metros", "con unidad: punto de miles");
assert.equal(numerizar("bajan más de mil metros de altura"), "bajan más de 1.000 metros de altura");
assert.equal(numerizar("en mil novecientos noventa y seis se inauguró"), "en 1996 se inauguró", "anio: sin punto");
assert.equal(numerizar("veintiún días"), "21 días");
assert.equal(numerizar("Y por eso nacieron leyendas"), "Y por eso nacieron leyendas");
assert.deepEqual(numbersIn("ciento setenta accidentes y 1.250 metros"), [170, 1250]);
console.log("cifras OK");

const guion =
  "De ese rumor nació el nombre. La Rumorosa es, literalmente, la que murmura. Hoy se registran alrededor de ciento setenta accidentes al año, y la mayoría son volcaduras de tractocamiones. El camino nacional unió Mexicali con Tijuana atravesando La Rumorosa.";
assert.ok(nearLiteral(guion, "La Rumorosa es la que murmura"), "saltea la muletilla");
assert.ok(nearLiteral(guion, "170 accidentes al año"), "cifra en digitos contra letras");
assert.ok(!nearLiteral(guion, "180 accidentes al año"), "otra cifra no");
assert.ok(!nearLiteral(guion, "La Rumorosa murmura de noche"), "inventado no");
assert.ok(titleFromScript(guion, "El camino de La Rumorosa"));
assert.ok(!titleFromScript(guion, "Los secretos del desierto de Sonora"));
assert.ok(!titleFromScript(guion, "Los 170 accidentes"), "un titulo con cifra no pasa por esta via");
console.log("casi literal OK");

const run = (overlay: Record<string, unknown>, scene = guion) =>
  generateOverlayTool.execute({ scene_id: "x", script_text: scene, full_text: guion, overlay: overlay as never }, {} as never);
const q = await run({ type: "kinetic_quote", text: "La Rumorosa es la que murmura", source: "script" });
assert.equal(q.overlay.text, "La Rumorosa es la que murmura");
const n = await run({ type: "big_number", text: "ciento setenta accidentes al año", source: "script" });
assert.equal(n.overlay.text, "170 accidentes al año", "en pantalla, digitos");
const k = await run({ type: "kinetic_quote", text: "ciento setenta accidentes al año", source: "script" });
assert.equal(k.overlay.text, "170 accidentes al año");
await assert.rejects(run({ type: "kinetic_quote", text: "La montaña habla de noche", source: "script" }), /no aparece/);
console.log("graficos OK");
