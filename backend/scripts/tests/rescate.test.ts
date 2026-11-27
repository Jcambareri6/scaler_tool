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
  assert.deepEqual([...RESCUE_STEPS], ["toma_aprobada", "busqueda_tema", "wikipedia_articulo", "recorte", "mapa"]);
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

// Lugar solo como NOMBRE PROPIO (Malvinas, 26/11: mapa de "argentina" en el 96).
{
  assert.equal(placeInPhrase("uno de los personajes más discutidos de la historia argentina.", ["Argentina"]), null, "adjetivo: no es un lugar");
  assert.equal(placeInPhrase("un hombre que no había nacido en la Argentina.", ["Argentina"]), "Argentina");
  assert.equal(placeInPhrase("Usted está en la isla Martín García, en medio del río.", ["isla Martín García"]), "isla Martín García");
  console.log("lugar como nombre propio OK");
}

// FASE 2 del rescate: decide en orden, mirando a los vecinos ya decididos.
{
  const { pickOption, cropCandidates, cropSpecFor, cropFilter, cropOffset, CROP_MIN_GAP } = await import("../../src/pipeline/rescueAssign.js");
  type Opt = { base: string; key: string; step: "toma_aprobada" | "busqueda_tema" | "wikipedia_articulo"; maxUses: number; payload: null };
  const opt = (base: string, key = base): Opt => ({ base, key, step: "busqueda_tema", maxUses: 3, payload: null });

  // Dos planos vacios SEGUIDOS (4 y 5) no se bloquean entre si: los dos terminan con imagen.
  const origin = new Map<number, string>([[0, "commons:x"], [1, "commons:y"], [2, "commons:z"], [3, "commons:w"], [6, "commons:v"]]);
  const uses = new Map<string, number>();
  const taken = new Set<string>();
  const decide = (i: number, options: Opt[]) => {
    const o = pickOption(i, options, (j) => origin.get(j), (b) => uses.get(b) ?? 0, (k) => taken.has(k));
    if (o) {
      origin.set(i, o.base);
      uses.set(o.base, (uses.get(o.base) ?? 0) + 1);
      taken.add(o.key);
    }
    return o;
  };
  const a = decide(4, [opt("youtube:A"), opt("commons:B")]);
  const b = decide(5, [opt("youtube:A", "youtube:A@t30"), opt("commons:B")]);
  assert.equal(a?.base, "youtube:A", "el 4 toma el primero del juez");
  assert.equal(b?.base, "commons:B", "el 5 no repite el video del 4 (a 1 plano) y toma el siguiente");
  // El mismo video vuelve recien a mas de 3 planos.
  assert.equal(decide(8, [opt("youtube:A", "youtube:A@t90")])?.base, "youtube:A");
  assert.equal(decide(9, [opt("youtube:A", "youtube:A@t120")]), null, "a 1 plano del 8: no");

  // Sin candidatos: RECORTES. Los planos 14 y 15, vacios y seguidos, salen de fuentes distintas.
  const sources = [
    { index: 9, key: "img-9", tema: "Darwin", type: "IMAGE" as const },
    { index: 20, key: "img-20", tema: "Darwin", type: "IMAGE" as const },
  ];
  const state = { bySource: new Map<string, number[]>() };
  const cropAt = new Map<number, string>();
  const crop = (i: number) => {
    const c = cropCandidates(i, "Darwin", sources, state, (j) => cropAt.get(j))[0];
    if (c) {
      cropAt.set(i, c.key);
      state.bySource.set(c.key, [...(state.bySource.get(c.key) ?? []), i]);
    }
    return c?.key;
  };
  assert.equal(crop(14), "img-9", "el 14 recorta la del 9 (a 5 planos)");
  assert.equal(crop(15), "img-20", "el 15 no repite la fuente del 14 seguido: recorta la del 20");
  assert.ok(cropCandidates(12, "Darwin", sources, state, (j) => cropAt.get(j)).every((s) => Math.abs(s.index - 12) >= CROP_MIN_GAP), "a 5 planos o mas del original");
  // Tope: 2 recortes por fuente.
  crop(4);
  assert.equal(state.bySource.get("img-9")?.length, 2);
  assert.ok(!cropCandidates(3, "Darwin", sources, state, (j) => cropAt.get(j)).some((s) => s.key === "img-9"), "img-9 ya tiene 2 recortes");

  // Encuadres distintos entre recortes y distintos del original (centrado y entero).
  const c0 = cropSpecFor(0, "IMAGE");
  const c1 = cropSpecFor(1, "IMAGE");
  assert.ok(c0.zoom >= 1.5 && c0.zoom <= 2 && c1.zoom >= 1.5 && c1.zoom <= 2);
  assert.notDeepEqual([c0.x, c0.y], [c1.x, c1.y]);
  assert.notEqual(c0.motion, c1.motion);
  assert.ok(!(c0.x === 0.5 && c0.y === 0.5), "nunca el centro");
  // Clip: otro momento del archivo.
  assert.ok((cropSpecFor(0, "VIDEO", 12, 5).t ?? 0) > 0);
  // Zona arriba a la izquierda: la ventana queda pegada a esa esquina.
  assert.equal(cropFilter({ x: 0.25, y: 0.3, zoom: 1.6 }), "crop=iw/1.6:ih/1.6:(iw-iw/1.6)*0.0000:(ih-ih/1.6)*0.0000");
  assert.equal(cropFilter({ x: 0.5, y: 0.5, zoom: 2 }), "crop=iw/2:ih/2:(iw-iw/2)*0.5000:(ih-ih/2)*0.5000", "centro");
  assert.equal(cropOffset({ x: 0.75, y: 0.7, zoom: 1.9 }).fx, 1, "zona derecha: pegada al borde derecho");
  console.log("fase 2 y recortes OK");
}

// El render aplica el recorte (imagen: zona y movimiento; clip: zona y otro momento).
{
  const { buildFfmpegArgsForBatch } = await import("../../src/tools/renderVideo.tool.js");
  const { getDocumentalStyle } = await import("../../src/lib/documentalStyles.js");
  const segs = [
    { storageKey: "a", start: 0, end: 4, duration: 4, isImage: true, crop: { x: 0.25, y: 0.3, zoom: 1.6, motion: "pan_left" as const } },
    { storageKey: "b", start: 4, end: 8, duration: 4, isImage: false, crop: { x: 0.75, y: 0.7, zoom: 1.9, t: 3 } },
    { storageKey: "c", start: 8, end: 11, duration: 3, isImage: true, crop: { x: 0.5, y: 0.5, zoom: 1.3, blur: true } },
  ];
  const { inputArgs, filterComplex } = buildFfmpegArgsForBatch(segs, ["a.png", "b.mp4", "c.png"], false, { width: 640, height: 360 }, { style: getDocumentalStyle("documental"), firstIndex: 0 }, [null, 10, null]);
  assert.match(filterComplex, /\[0:v\]crop=iw\/1\.6/);
  assert.match(filterComplex, /\[1:v\]crop=iw\/1\.9/);
  assert.ok(filterComplex.includes("boxblur=18:2"), "fondo desenfocado de la falla");
  assert.deepEqual(inputArgs.slice(inputArgs.indexOf("b.mp4") - 5, inputArgs.indexOf("b.mp4") + 1), ["-ss", "3.000", "-t", "4.000", "-i", "b.mp4"]);
  console.log("render con recortes OK");
}
