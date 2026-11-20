// Corrector de lugares sin red.   npx tsx scripts/tests/geocode.test.ts
import assert from "node:assert/strict";
import { WATER_BODY, correctPlace, pickPlace, satelliteKm, type GeoResult } from "../../src/lib/geocode.js";

// PILOTO 7 (Titanic): "Atlantico Norte" termino en Nicaragua (la Region
// Autonoma del Atlantico Norte). Oceanos y mares: manda la coordenada del modelo.
const naufragio = { lat: 41.73, lon: -49.95 };
assert.ok(WATER_BODY.test("Atlántico Norte"));
assert.ok(WATER_BODY.test("Mar Mediterráneo"));
assert.ok(WATER_BODY.test("Golfo de México"));
assert.ok(WATER_BODY.test("North Atlantic Ocean"));
assert.ok(!WATER_BODY.test("Belfast"));
assert.ok(!WATER_BODY.test("Terranova"));
assert.deepEqual(await correctPlace("Atlántico Norte", naufragio), { ...naufragio, corrected: false });
assert.equal(await correctPlace("Océano Atlántico", undefined), null);

// Tocayo administrativo a miles de km: se queda la coordenada del modelo.
const raan: GeoResult = { lat: 14.0, lon: -84.3, km: 200, name: "Región Autónoma de la Costa Caribe Norte, Nicaragua", kind: "state" };
assert.deepEqual(pickPlace([raan], naufragio), { ...naufragio, corrected: false });

// Error real del modelo (pueblo corrido unos cientos de km): se corrige.
const tulum: GeoResult = { lat: 20.21, lon: -87.46, km: 3, name: "Tulum, Quintana Roo, México", kind: "town" };
const fixed = pickPlace([tulum], { lat: 21.16, lon: -86.85 });
assert.equal(fixed?.corrected, true);
assert.equal(fixed?.lat, tulum.lat);

// Region administrativa cercana (menos de 1.500 km): se sigue corrigiendo.
const santaCruz: GeoResult = { lat: -48.8, lon: -69.9, km: 400, name: "Santa Cruz, Argentina", kind: "state" };
assert.equal(pickPlace([santaCruz], { lat: -45, lon: -65 })?.corrected, true);

console.log("geocode: OK");

// Mapa de rescate sobre un oceano: abierto hasta ver costas, no agua azul a 2 km.

for (let k = 0; k < 5; k++) assert.ok(satelliteKm(k, "Atlántico Norte") >= 1200, `oceano, encuadre ${k}`);
assert.equal(satelliteKm(0, "Tulum", 3), 4); // pueblo: los encuadres cercanos de siempre
assert.equal(satelliteKm(3, "Tulum"), 2);
assert.ok(satelliteKm(0, "Santa Cruz", 400) >= 400); // provincia: acompana su tamano
console.log("satelital: OK");
