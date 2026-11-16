// Datos abiertos: formato y validaciones (sin red).   npx tsx scripts/tests/datos.test.ts
import assert from "node:assert/strict";
import { countryCode, formatValue, indicatorCode, samplePoints } from "../../src/lib/datosAbiertos.js";

assert.equal(formatValue(1234567), "1234567");
assert.equal(formatValue(72.456), "72,5");
assert.equal(formatValue(1.914), "1,91");
assert.equal(countryCode("mex"), "MEX");
assert.equal(countryCode("Quintana Roo"), null, "una region no tiene codigo");
assert.equal(indicatorCode("fertilidad")?.code, "SP.DYN.TFRT.IN");
assert.equal(indicatorCode("NY.GDP.PCAP.CD")?.code, "NY.GDP.PCAP.CD");
assert.equal(indicatorCode("algo inventado"), null);
const pts = Array.from({ length: 64 }, (_, i) => i);
const s = samplePoints(pts, 8);
assert.equal(s.length, 8);
assert.equal(s[0], 0);
assert.equal(s[7], 63);
console.log("datos OK");
