// Epoca por reglas (sin red).   npx tsx scripts/tests/epoca.test.ts
import assert from "node:assert/strict";
import { epochLine, isToday, shotEpochs, yearOf } from "../../src/lib/epoca.js";

// Anios de 4 cifras, sin confundir cantidades.
assert.equal(yearOf("En 1912 el Titanic zarpó de Southampton"), 1912);
assert.equal(yearOf("trabajaron 1500 trabajadores en la obra"), undefined);
assert.equal(yearOf("recorrió 1914 km por la costa"), undefined);
assert.equal(yearOf("vivían 1.881 personas"), undefined);
assert.equal(yearOf("la década de 1990 cambió todo"), 1990);
// Antiguos y siglos.
assert.equal(yearOf("Roma fue fundada en el 753 a. C."), -753);
assert.equal(yearOf("la batalla del 146 BC"), -146);
assert.equal(yearOf("el Vesubio entró en erupción en el 79 d.C."), 79);
assert.equal(yearOf("en el año 509 se proclamó la república"), 509);
assert.equal(yearOf("durante el siglo XIX el puerto creció"), 1850);
assert.equal(yearOf("en el siglo III a. C. ya existía"), -250);
assert.equal(yearOf("in the 19th century the city grew"), 1850);
assert.equal(yearOf("la ciudad es enorme"), undefined);
// Hoy.
assert.ok(isToday("Hoy Tulum recibe millones de turistas"));
assert.ok(isToday("actualmente el canal sigue en uso"));
assert.ok(!isToday("la historia de Tulum"));
console.log("anios OK");

// Por plano: el propio, el anterior, el siguiente; hoy gana.
const e = shotEpochs(
  ["En 1912 zarpó el barco.", "Cuatro días después chocó.", "Hoy sus restos están en el fondo.", "Nadie lo vio venir."],
  [undefined, undefined, undefined, undefined]
);
assert.equal(e[0]!.anio, 1912);
assert.equal(e[1]!.anio, 1912, "toma el anio dicho antes");
assert.equal(e[2]!.hoy, true);
assert.equal(e[2]!.anio, undefined, "hoy deja el plano sin anio");
assert.equal(e[3]!.anio, 1912);
assert.ok(e[0]!.historico && !e[0]!.preCine);
// Sin anio antes: NO toma el que se dice despues.
const f = shotEpochs(["El barco era enorme.", "En 1912 zarpó."]);
assert.equal(f[0]!.anio, undefined);
// Pero no uno que se dice mucho despues (La Rumorosa: 23 planos de hoy
// quedaban "Era: 1915"), ni uno dicho hace muchos planos.
const presente = ["La cuesta es peligrosa.", "Hay cruces al costado.", "Los camiones vuelcan.", "Nacieron leyendas.", "Entre 1915 y 1920 se abrió el camino.", "Era de terracería.", "Unió tres ciudades.", "Era estrecho.", "Y polvoriento.", "Hoy es autopista.", "Esta montaña murmura.", "Comentá abajo."];
const r = shotEpochs(presente);
assert.equal(r[0]!.anio, undefined, "4 planos antes del anio: sin epoca");
assert.equal(r[1]!.anio, undefined, "3 planos antes: sin epoca");
assert.equal(r[2]!.anio, undefined, "2 planos antes: tampoco");
assert.equal(r[3]!.anio, undefined, "ni el inmediato anterior");
assert.equal(r[8]!.anio, 1915, "4 planos despues del anio: todavia lo arrastra");
assert.equal(r[10]!.anio, undefined, "6 planos despues: ya no");
assert.equal(r[11]!.anio, undefined);
// El anio del plan vale si es historico y no cae lejos del relato.
const g = shotEpochs(["Nadie sabía nada.", "Las tribus vivían ahí."], [1850, 2020]);
assert.equal(g[0]!.anio, 1850);
assert.equal(g[1]!.anio, undefined, "2020 del plan no es historico y solo se arrastra lo que dice la voz");
// Tema actual: sin anio ni historico.
const h = shotEpochs(["Tulum es un destino de playa.", "Sus ruinas miran al mar."]);
assert.equal(h[0]!.historico, false);
assert.equal(epochLine(h[0]!), null);
assert.match(epochLine(shotEpochs(["Hoy está lleno."])[0]!) ?? "", /TODAY/);
assert.match(epochLine(shotEpochs(["En el 79 d.C. Pompeya quedó sepultada."])[0]!) ?? "", /before cinema/);
console.log("epoca por plano OK");
