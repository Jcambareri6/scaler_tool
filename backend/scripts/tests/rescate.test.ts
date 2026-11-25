// Rescate con menu fijo, fuentes sin stock y datos del montajista (sin red).
//   npx tsx --require dotenv/config scripts/tests/rescate.test.ts
import assert from "node:assert/strict";
import { articleImageAllowed, isStockResult, sourceChain } from "../../src/lib/documentalSources.js";
import { parsePlan } from "../../src/director/montajista.js";

const pipeline = await import("../../src/pipeline/documentalPipeline.js");
const { literalSpan, placeInPhrase, neighbourHas, overlayKinds, rescueAnimationTypes, RESCUE_STEPS, assertMotionReady, normTema } = pipeline;

// A. Sin animaciones el documental no arranca; con motion instalado, la lista completa.
{
  const types = assertMotionReady();
  assert.ok(types.length >= 20, `plannableTypes() trae ${types.length} tipos`);
  for (const t of ["big_number", "milestone", "map_marker", "person_card", "highlight_phrase", "process_wave"]) assert.ok(types.includes(t as never), `falta ${t}`);
  console.log(`motion OK: ${types.length} graficos`);
}

// B. Ninguna cadena tiene stock; Wikipedia entra solo con articulo.
{
  const clases = ["persona", "lugar", "cosa", "metraje", "ambiente", "grafico", "mapa"] as const;
  for (const clase of clases) {
    for (const anio of [undefined, 1900]) {
      const chain = sourceChain({ clase, query: "x", ...(anio ? { anio } : {}), articulo: "Mesosaurus" }, false, true) as string[];
      assert.ok(!chain.includes("stock"), `${clase}: sin stock`);
      if (clase !== "mapa") assert.ok(chain.includes("wikipedia"), `${clase}: con articulo entra wikipedia`);
    }
    assert.ok(!(sourceChain({ clase, query: "x" }, false, true) as string[]).includes("wikipedia"), `${clase}: sin articulo no hay wikipedia`);
  }
  assert.ok(isStockResult({ source: "stocksnap" }));
  assert.ok(isStockResult({ source: "rawpixel" }));
  assert.ok(isStockResult({ source: "flickr", url: "https://images.unsplash.com/photo-123.jpg" }));
  assert.ok(isStockResult({ source: "flickr", foreign_landing_url: "https://www.pexels.com/photo/desk-1/" }));
  assert.ok(!isStockResult({ source: "flickr", url: "https://live.staticflickr.com/1/2.jpg", foreign_landing_url: "https://www.flickr.com/photos/x/2" }));
  assert.ok(!isStockResult({ source: "wikimedia", url: "https://upload.wikimedia.org/a.jpg" }));
  console.log("fuentes sin stock OK");
}

// D. Imagenes del articulo: fuera iconos, banderas, logos, mapas de ubicacion y audio.
{
  for (const bad of ["Flag of Argentina.svg", "Commons-logo.svg", "Escudo de Uruguay.svg", "Argentina location map.svg", "Wikispecies-logo.svg", "Symbol support vote.svg", "Ambox important.svg", "Mapa de localización de Uruguay.svg", "Pronunciation.ogg", "Question book-new.svg", "Crystal Clear app kedit.svg", "Blue pencil.svg", "Red pog.svg", "OOjs UI icon edit-ltr.svg"]) {
    assert.ok(!articleImageAllowed(bad), `deberia excluir ${bad}`);
  }
  for (const good of ["Mesosaurus tenuidens fossil.jpg", "Alfred Wegener ca.1924-30.jpg", "Snider-Pellegrini Wegener fossil map.svg", "Rio de la Plata BA 2.JPG", "Pangaea continents.svg"]) {
    assert.ok(articleImageAllowed(good), `deberia aceptar ${good}`);
  }
  console.log("imagenes de articulo OK");
}

// C. El montajista deja tema_bloque y articulo en cada plano.
{
  const phrases = [
    { text: "Hace", start: 0, end: 0.3 },
    { text: "130", start: 0.3, end: 0.8 },
    { text: "millones", start: 0.8, end: 1.2 },
    { text: "de", start: 1.2, end: 1.3 },
    { text: "años", start: 1.3, end: 1.8 },
  ];
  const { shots } = parsePlan(
    { shots: [{ desde: "1", hasta: "5", clase: "cosa", sujeto: "fosil de mesosaurio", query_en: "Mesosaurus fossil", tema_bloque: "Mesosaurus", articulo: "Mesosaurus" }], chapters: [] },
    phrases as never
  );
  assert.equal(shots[0]!.temaBloque, "Mesosaurus");
  assert.equal(shots[0]!.articulo, "Mesosaurus");
  const { shots: sin } = parsePlan({ shots: [{ desde: "1", hasta: "5", clase: "cosa", sujeto: "x", query_en: "y" }], chapters: [] }, phrases as never);
  assert.equal(sin[0]!.temaBloque, undefined);
  console.log("montajista tema_bloque/articulo OK");
}

// E. Menu del rescate: orden fijo, vecinos, lugar literal.
{
  assert.deepEqual([...RESCUE_STEPS], ["toma_aprobada", "busqueda_tema", "wikipedia_articulo", "animacion", "mapa"]);
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const kinds = new Map([
    ["a", overlayKinds(["milestone"])],
    ["b", overlayKinds([])],
    ["c", overlayKinds([])],
    ["d", overlayKinds(["map_marker"])],
  ]);
  assert.equal(neighbourHas(kinds, rows, 1, "anim"), true, "b: el anterior (a) tiene animacion");
  assert.equal(neighbourHas(kinds, rows, 2, "anim"), true, "c: el siguiente (d) es un mapa, y un mapa es animacion");
  assert.equal(neighbourHas(kinds, rows, 2, "mapa"), true);
  assert.equal(neighbourHas(kinds, rows, 1, "mapa"), false, "b: ningun vecino es mapa");
  // Reserva de otro plano en paralelo: cuenta.
  kinds.get("b")!.add("anim");
  assert.equal(neighbourHas(kinds, rows, 2, "anim"), true);

  assert.equal(literalSpan("así nació el Río de la Plata, hace miles de años", "Rio de la Plata"), "Río de la Plata");
  assert.equal(literalSpan("el río más ancho", "Rio de la Plata"), null);
  assert.equal(placeInPhrase("El agua llega a Buenos Aires desde el Paraná.", [undefined, "Buenos Aires", "Argentina"]), "Buenos Aires");
  assert.equal(placeInPhrase("Wegener tenía razón.", ["Río de la Plata", "Argentina"]), null);
  assert.equal(normTema("Formación del Río de la Plata"), "formacion del rio de la plata");

  const types = rescueAnimationTypes([]);
  for (const t of ["map_marker", "map_globe", "kinetic_quote", "title_card", "photo_frame", "cta"]) assert.ok(!types.includes(t), `el paso 4 no usa ${t}`);
  assert.ok(types.includes("highlight_phrase") && types.includes("big_number"));
  assert.ok(!rescueAnimationTypes(["big_number"]).includes("big_number"), "respeta los prohibidos del estilo");
  console.log("menu del rescate OK");
}
