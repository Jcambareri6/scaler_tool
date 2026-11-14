// Ensayo en seco del documental con el guion de Chernobyl (pruebas-video/):
// plan como el del montajista -> verificador -> cadena de fuentes por plano,
// con red real (Wikidata, Commons, Openverse, archive.org). Sin base de datos
// ni juez: toma el primer candidato de cada fuente. El stock (Pexels/Pixabay)
// necesita las keys de la base y se saltea.
//   npx tsx scripts/tests/documental.dryrun.ts
import { readFileSync } from "node:fs";
import { parsePlan, verifyPlan, textOf } from "../../src/director/montajista.js";
import { getDocumentalStyle } from "../../src/lib/documentalStyles.js";
import { searchArchiveVideos, searchCommonsImages, searchOpenverseImages, searchWikidataImage, sourceChain } from "../../src/lib/documentalSources.js";
import type { Phrase } from "../../src/director/phrases.js";

const phrases = JSON.parse(readFileSync(new URL("../../../pruebas-video/guion-30s-palabras.json", import.meta.url), "utf-8")) as Phrase[];
const style = getDocumentalStyle(process.argv[2] ?? "documental");
const raw = {
  chapters: [{ titulo: "26 de abril de 1986", desde: "p1", animo: "tension" }],
  shots: [
    { desde: "p1", hasta: "p1", clase: "lugar", sujeto: "Pripyat de noche", query_en: "Pripyat city 1986", anio: 1986, rotulo: { type: "milestone", text: "1986", label: "26 de abril" } },
    { desde: "p2", hasta: "p2", clase: "lugar", sujeto: "Central nuclear de Chernobyl", query_en: "Chernobyl nuclear power plant", entidad: "Chernobyl Nuclear Power Plant", anio: 1986 },
    { desde: "p3", hasta: "p3", clase: "cosa", sujeto: "Sala de control del reactor 4", query_en: "Chernobyl control room reactor 4" },
    { desde: "p4", hasta: "p5", clase: "metraje", sujeto: "Ingeniero en una sala de control", query_en: "nuclear power plant control room engineer", anio: 1986, grafico: { type: "big_number", text: "25 años" } },
    { desde: "p6", hasta: "p7", clase: "cosa", sujeto: "Reactor RBMK", query_en: "RBMK reactor", entidad: "RBMK" },
    { desde: "p8", hasta: "p8", clase: "metraje", sujeto: "Explosion nuclear", query_en: "atomic explosion test", anio: 1955 },
  ],
};
const { shots, issues } = verifyPlan(parsePlan(raw, phrases), phrases, style);
console.log(`Estilo ${style.name} · ${shots.length} planos · avisos: ${issues.join("; ") || "ninguno"}\n`);
const used = new Set<string>();
for (const shot of shots) {
  const chain = sourceChain(shot, style.sources.archiveFirst);
  let picked = "";
  for (const source of chain) {
    if (source === "stock" || source === "ai_image") continue;
    try {
      const list =
        source === "wikidata" ? (shot.entidad ? await searchWikidataImage(shot.entidad) : [])
        : source === "commons" ? await searchCommonsImages(shot.entidad ?? shot.query)
        : source === "openverse" ? await searchOpenverseImages(shot.query)
        : await searchArchiveVideos(shot.query, shot.anio);
      const c = list.find((x) => !used.has(`${x.provider}:${x.external_id}`));
      if (c) {
        used.add(`${c.provider}:${c.external_id}`);
        picked = `${source} → ${c.type} "${(c.title ?? "").slice(0, 55)}" [${c.license}]`;
        break;
      }
    } catch (e) {
      console.log(`   (${source} fallo: ${(e as Error).message.slice(0, 80)})`);
    }
  }
  console.log(`p${shot.from + 1}-p${shot.to + 1} ${shot.clase.padEnd(8)} ${shot.grafico ? `[${shot.grafico.type}] ` : ""}${shot.rotulo ? `[${shot.rotulo.type}] ` : ""}"${textOf(phrases, shot).slice(0, 45)}..."\n   cadena: ${chain.join(" > ")}\n   elegido: ${picked || "nada (iria a stock / imagen IA)"}`);
}
