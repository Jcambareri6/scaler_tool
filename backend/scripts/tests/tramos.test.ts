// Plan anclado a palabras y por tramos (sin red).   npx tsx --env-file=.env scripts/tests/tramos.test.ts
import assert from "node:assert/strict";
import type { Phrase } from "../../src/director/phrases.js";
import { heuristicPlan, leadOf, numberedWords, parsePlan, splitTramos, verifyPlan, wordUnits } from "../../src/director/montajista.js";
import { getDocumentalStyle } from "../../src/lib/documentalStyles.js";

// Guion sintetico: 400 s, una palabra cada 0,5 s, oraciones de 12 palabras.
const words = Array.from({ length: 800 }, (_, i) => ({ text: (i + 1) % 12 === 0 ? `fin${i}.` : `w${i}`, start: i * 0.5, end: i * 0.5 + 0.4 }));
const phrases: Phrase[] = [];
for (let i = 0; i < words.length; i += 12) {
  const ws = words.slice(i, i + 12);
  phrases.push({ id: `p${phrases.length + 1}`, text: ws.map((w) => w.text).join(" "), start: ws[0]!.start, end: ws[ws.length - 1]!.end, words: ws });
}
const units = wordUnits(phrases);
assert.equal(units.length, 800);
assert.equal(units[0]!.id, "1");
assert.equal(units[799]!.id, "800");

// Tramos: gancho de ~60 s y despues ~150 s, cortados en final de oracion.
const tramos = splitTramos(units);
const dur = (t: { desde: number; hasta: number }) => units[t.hasta]!.end - units[t.desde]!.start;
assert.ok(dur(tramos[0]!) <= 60 && dur(tramos[0]!) >= 36, `gancho ${dur(tramos[0]!)}`);
assert.match(units[tramos[0]!.hasta]!.text, /\.$/, "el gancho corta en final de oracion");
for (const t of tramos.slice(1, -1)) assert.ok(dur(t) <= 150 && dur(t) >= 90, `tramo ${dur(t)}`);
// Cubren todo, sin huecos.
assert.equal(tramos[0]!.desde, 0);
assert.equal(tramos[tramos.length - 1]!.hasta, 799);
for (let i = 1; i < tramos.length; i++) assert.equal(tramos[i]!.desde, tramos[i - 1]!.hasta + 1);
// Un resto chico se une al anterior.
const short = wordUnits([{ id: "p1", text: "", start: 0, end: 65, words: Array.from({ length: 130 }, (_, i) => ({ text: `x${i}`, start: i * 0.5, end: i * 0.5 + 0.4 })) }]);
assert.equal(splitTramos(short).length, 1, "5 s de resto se unen al gancho");
console.log(`tramos OK (${tramos.map((t) => Math.round(dur(t))).join(", ")} s)`);

// Palabras numeradas: 25 por linea con su tiempo.
const listed = numberedWords(units, 0, 49).split("\n");
assert.equal(listed.length, 2);
assert.match(listed[0]!, /^\[0\.0s\] 1:w0 2:w1/);
assert.match(listed[1]!, /^\[12\.5s\] 26:w25/);

// El plan con numeros de palabra pasa por el verificador sin huecos.
const style = getDocumentalStyle("documental");
const parsed = parsePlan(
  {
    shots: [
      { desde: "1", hasta: "20", clase: "lugar", sujeto: "puerto", query_en: "port", obligatorio: ["el puerto", ""] },
      { desde: "21", hasta: "45", clase: "persona", sujeto: "capitan", query_en: "captain" },
    ],
    chapters: [{ titulo: "Inicio", desde: "1", animo: "documental" }],
  },
  units.slice(0, 45)
);
assert.deepEqual(parsed.shots[0]!.obligatorio, ["el puerto"]);
const verified = verifyPlan(parsed, units.slice(0, 45), style);
assert.equal(verified.shots[0]!.from, 0);
assert.equal(verified.shots[verified.shots.length - 1]!.to, 44);

// Adelanto por clase.
assert.equal(leadOf({ clase: "mapa" }), 1.6);
assert.equal(leadOf({ clase: "persona" }), 0.9);
assert.equal(leadOf({ clase: "ambiente" }), 0);
assert.equal(leadOf({ clase: "persona", grafico: { type: "big_number", text: "x" } }), 0.15);

// Reserva sobre palabras: planos de 5-7 s.
const reserve = heuristicPlan(phrases, "tema", units);
for (const s of reserve.shots.slice(0, -1)) {
  const d = units[s.to]!.end - units[s.from]!.start;
  assert.ok(d >= 4.5 && d <= 7.5, `reserva ${d}`);
}
console.log("palabras, verificador y adelanto OK");

// Un plano no termina en una palabra de enlace.
{
  const { tidyBoundaries } = await import("../../src/director/montajista.js");
  const toks = ["A", "las", "23:40", "el", "vigía", "Fleet", "vio", "el", "iceberg."];
  const u = toks.map((t, i) => ({ id: String(i + 1), text: t, start: i, end: i + 0.9, words: [{ text: t, start: i, end: i + 0.9 }] }));
  const shots = [
    { from: 0, to: 3, clase: "ambiente" as const, sujeto: "", query: "" },
    { from: 4, to: 7, clase: "persona" as const, sujeto: "", query: "" },
    { from: 8, to: 8, clase: "cosa" as const, sujeto: "", query: "" },
  ];
  assert.equal(tidyBoundaries(shots, u), 2);
  assert.deepEqual(shots.map((s) => [s.from, s.to]), [[0, 2], [3, 6], [7, 8]]);
  console.log("bordes OK");
}
