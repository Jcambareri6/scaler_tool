// Prueba del verificador del montajista con las frases reales de Chernobyl
// (pruebas-video/) y un plan simulado con errores a proposito.
//   npx tsx scripts/tests/montajista.test.ts
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { parsePlan, verifyPlan, textOf } from "../../src/director/montajista.js";
import { getDocumentalStyle } from "../../src/lib/documentalStyles.js";
import type { Phrase } from "../../src/director/phrases.js";

const phrases = JSON.parse(readFileSync(new URL("../../../pruebas-video/guion-30s-palabras.json", import.meta.url), "utf-8")) as Phrase[];
console.log(phrases.map((p) => `${p.id} [${p.start.toFixed(1)}-${p.end.toFixed(1)}] ${p.text}`).join("\n"));
const n = phrases.length;
const style = getDocumentalStyle("documental");

const raw = {
  chapters: [{ titulo: "La explosion", desde: "p1", animo: "tension" }, { titulo: "x", desde: "p1", animo: "nope" }],
  shots: [
    // arranca en p2 (hueco al inicio)
    { desde: "p2", hasta: "p2", clase: "lugar", sujeto: "Central de Chernobyl", query_en: "Chernobyl power plant 1986", anio: 1986,
      grafico: { type: "milestone", text: "1986" } },
    { desde: "p3", hasta: "p3", clase: "grafico", sujeto: "cifra", query_en: "x", grafico: { type: "big_number", text: "25" } },
    // lower_third fuera de persona
    { desde: "p4", hasta: `p${n}`, clase: "metraje", sujeto: "sala de control", query_en: "nuclear control room 1980s",
      rotulo: { type: "lower_third", text: "Ingeniero" } },
  ],
};
const parsed = parsePlan(raw, phrases);
const { shots, chapters, issues } = verifyPlan(parsed, phrases, style);
console.log("\nISSUES:\n- " + issues.join("\n- "));
for (const s of shots) console.log(`p${s.from + 1}-p${s.to + 1} ${s.clase} ${s.sujeto} ${s.grafico ? `[${s.grafico.type}]` : ""} ${s.capitulo ? `cap${s.capitulo}` : ""} :: ${textOf(phrases, s).slice(0, 60)}`);

// Cobertura completa y contigua
assert.equal(shots[0]!.from, 0);
assert.equal(shots[shots.length - 1]!.to, n - 1);
for (let i = 1; i < shots.length; i++) assert.equal(shots[i]!.from, shots[i - 1]!.to + 1);
// Nunca dos graficos seguidos
for (let i = 1; i < shots.length; i++) assert.ok(!(shots[i]!.grafico && shots[i - 1]!.grafico), "dos graficos seguidos");
// lower_third solo en persona
assert.ok(shots.every((s) => !s.rotulo || s.rotulo.type !== "lower_third" || s.clase === "persona"));
// Ningun plano mas largo que 9 s * 1.15 salvo de una sola frase
const end = (i: number) => (shots[i + 1] ? phrases[shots[i + 1]!.from]!.start : phrases[shots[i]!.to]!.end);
shots.forEach((s, i) => assert.ok(s.from === s.to || end(i) - phrases[s.from]!.start <= 9 * 1.15 + 0.01, `plano ${i} largo`));
assert.equal(chapters.length, 1);
console.log("\nOK: verificador");
