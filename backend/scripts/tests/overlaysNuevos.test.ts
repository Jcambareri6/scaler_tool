// Validacion de los graficos estilo GoMotion.   npx tsx scripts/tests/overlaysNuevos.test.ts
import assert from "node:assert/strict";
import { generateOverlayTool } from "../../src/tools/generateOverlay.tool.js";

const guion = "Lo que arrastra el río: botellas, llantas y troncos. El historiador Jan de Vos desmontó el mito de un supuesto suicidio colectivo. Pequeñas grietas, la lluvia y las raíces, y el bloque se suelta. Identidad, resistencia y algo sagrado.";
const run = (overlay: Record<string, unknown>) => generateOverlayTool.execute({ scene_id: "x", script_text: guion, full_text: guion, overlay: { source: "script", ...overlay } as never }, {} as never);

// Libreta: titulo y entradas literales.
const lista = await run({ type: "checklist", text: "Lo que arrastra el río", items: [{ label: "", text: "botellas" }, { label: "", text: "llantas" }, { label: "", text: "troncos" }] });
assert.equal(lista.overlay.items?.length, 3);

// Frase con resaltado: hasta 10 palabras; no inventa.
const frase = await run({ type: "highlight_phrase", text: "desmontó el mito de un supuesto suicidio colectivo", label: "desmontó el mito" });
assert.equal(frase.overlay.label, "desmontó el mito");
await assert.rejects(run({ type: "highlight_phrase", text: "una frase que no esta en el guion" }));

// Curva: 3 pasos minimo.
const curva = await run({ type: "process_wave", items: [{ label: "", text: "Pequeñas grietas" }, { label: "", text: "la lluvia y las raíces" }, { label: "", text: "el bloque se suelta" }], text: "Pequeñas grietas" });
assert.equal(curva.overlay.items?.length, 3);
await assert.rejects(run({ type: "process_wave", text: "x", items: [{ label: "", text: "Pequeñas grietas" }, { label: "", text: "el bloque se suelta" }] }));

// Foto sobre papel: sin foto no va; con foto pasa la URL.
await assert.rejects(run({ type: "photo_frame", text: "Cañón del Sumidero" }));
const marco = await run({ type: "photo_frame", text: "Cañón del Sumidero", image: "https://upload.wikimedia.org/x.jpg" });
assert.equal(marco.overlay.image, "https://upload.wikimedia.org/x.jpg");

// Arbol: conserva la foto de cada nodo.
const arbol = await run({ type: "photo_tree", text: "Lo que arrastra el río", items: [{ label: "", text: "botellas", image: "https://a.org/b.jpg" }, { label: "", text: "troncos" }] });
assert.equal(arbol.overlay.items?.[0]?.image, "https://a.org/b.jpg");

// Expediente y circulos.
const exp = await run({ type: "dossier", text: "Jan de Vos", label: "El historiador" });
assert.equal(exp.overlay.text, "Jan de Vos");
const circ = await run({ type: "concept_circles", items: [{ label: "", text: "Identidad" }, { label: "", text: "resistencia" }, { label: "", text: "sagrado" }], text: "Identidad" });
assert.equal(circ.overlay.items?.length, 3);
console.log("overlays nuevos: OK");
