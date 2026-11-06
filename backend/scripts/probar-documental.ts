// Prueba SIN IA del formato documental: un plan con la forma exacta del
// director (frase + palabra) pasa por el verificador y el armado, y deja
// props.json para renderizar con motion/scripts/render-animated.ts.
// Errores a proposito: rojo antes del remate y un dato inventado.
// Uso (desde backend/): npx tsx scripts/probar-documental.ts <carpeta-salida>
import { readFileSync, writeFileSync } from "node:fs";
import { armarPlan, verificarPlan } from "../src/director/documentalDirector.js";

const S = process.argv[2] ?? ".";
const phrases = JSON.parse(readFileSync("../pruebas-video/guion-30s-palabras.json", "utf8"));
// Salida con la forma exacta que pide plan_documental (frase + palabra, sin segundos ni coordenadas).
const m = (frase: string, palabra: string, hace: string, extra: Record<string, unknown> = {}) => ({ frase, palabra, hace, ...extra });
const raw = {
  capitulos: [{ titulo: "El botón final", frase: "p1" }],
  escenas: [
    { desde: "p1", hasta: "p2", tipo: "ubicacion",
      contenido: { lugar: "Chernobyl", subtitulo: "central nuclear", region: "Ucrania Soviética", geo: { lat: 51.389, lon: 30.099 }, fecha: { dia: 26, mes: 4, anio: 1986 }, hora: "01:23", hora_nota: "de la madrugada" },
      momentos: [m("p1","26","fecha",{parte:"dia"}), m("p1","abril","fecha",{parte:"mes"}), m("p1","1986,","fecha",{parte:"anio"}), m("p1","1","hora"), m("p1","madrugada,","hora_nota"), m("p2","Central","pais"), m("p2","Chernobyl,","lugar"), m("p2","Ucrania","region")] },
    { desde: "p3", hasta: "p8", tipo: "esquema_capas", fondo: "claro",
      titulo: [{ texto: "Sala de control", frase: "p3", palabra: "sala" }],
      contenido: { secundario: "consola", principal: "reactor_corte", destino: "ciudad", personaje: { tarjeta: "25 años", rol: "el ingeniero" }, lupa: { objeto: "secundario", parte: "boton", texto: "APAGAR", nota: "en caso de emergencia" } },
      momentos: [
        m("p3","sala","aparece",{objeto:"secundario"}), m("p3","reactor","aparece",{objeto:"principal"}),
        m("p3","número","etiqueta",{objeto:"principal",texto:"Reactor 4",posicion:"arriba"}),
        m("p4","ingeniero","aparece",{objeto:"personaje"}), m("p4","25","tarjeta"),
        m("p4","pulsa","aprieta",{objeto:"secundario",parte:"boton"}),
        m("p5","botón","lupa"), m("p5","existe","lupa_accion"),
        m("p6","apagar","lupa_texto",{significado:"seguro"}), m("p6","apagar","parte",{objeto:"principal",parte:"barras"}),
        m("p6","reactor","parte",{objeto:"principal",parte:"nucleo",significado:"peligro"}),   // error a proposito: rojo antes del remate
        m("p6","emergencia.","lupa_nota"),
        m("p7","último","escudo",{objeto:"principal",texto:"último recurso",significado:"seguro"}),
        m("p7","freno","etiqueta",{objeto:"principal",parte:"barras",texto:"freno de mano",significado:"seguro"}),
        m("p7","abastecer","aparece",{objeto:"destino"}), m("p7","abastecer","conectar",{objeto:"destino"}),
        m("p7","electricidad","flujo"), m("p7","ciudad","parte",{objeto:"destino",parte:"ventanas"}),
        m("p7","ciudad","etiqueta",{objeto:"destino",texto:"3 millones de casas",posicion:"arriba"}), // error a proposito: dato inventado
        m("p8","explota.","evento",{objeto:"principal",texto:"explota",remate:true}),
      ] },
  ],
};
const v = verificarPlan(raw, phrases);
console.log("problemas que detecta el verificador:", v.problemas.length ? v.problemas : "ninguno");
const peligro = v.escenas[1]!.scene as any;
console.log("nucleo quedo como:", peligro.recurso.momentos.find((x: any) => x.parte === "nucleo")?.significado);
const { plan, seguras } = armarPlan(raw, v, phrases, {}, { channel: null, topic: "Chernobyl: la prueba fatal", locale: "es-AR" }, { director: "-", designer: "-" }, {});
console.log("escenas:", plan.scenes.map((s) => `${s.id} ${s.start.toFixed(2)}-${s.end.toFixed(2)} ${(s as any).recurso?.tipo ?? "grafico"}`).join(" | "), "· seguras:", seguras.length);
console.log("momentos convertidos a segundos (muestra):", (plan.scenes[1] as any).recurso.momentos.slice(4, 9).map((x: any) => `${x.hace}@${x.at}`).join(", "));
writeFileSync(`${S}/props.json`, JSON.stringify(plan));
