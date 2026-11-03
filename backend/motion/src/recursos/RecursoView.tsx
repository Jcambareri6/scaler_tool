import { conFechas } from "../lib/fechas";
import { DOC } from "../scenes/palette";
import { entra } from "./comun";
import { EsquemaCapas } from "./EsquemaCapas";
import type { Recurso } from "./tipos";
import { Ubicacion } from "./Ubicacion";

// Escena armada con un recurso: fondo, titulo arriba a la izquierda (debajo de
// la linea de capitulo) y el recurso. Subtitulos y capa fija los pone el video.
export function RecursoView({ t, rec, inicio, fin }: { t: number; rec: Recurso; inicio: number; fin: number }) {
  const claro = (rec.fondo ?? (rec.tipo === "esquema_capas" ? "claro" : "oscuro")) === "claro";
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: claro
            ? "radial-gradient(ellipse at 50% 45%, #F3F5F7 0%, #E8ECF0 60%, #D3D9DF 100%)"
            : `radial-gradient(ellipse at 50% 45%, #0B1424 0%, ${DOC.fondoOscuro} 75%)`,
        }}
      />
      {rec.tipo === "ubicacion" ? <Ubicacion t={t} rec={rec} inicio={inicio} fin={fin} /> : <EsquemaCapas t={t} rec={rec} inicio={inicio} fin={fin} />}
      {rec.titulo && rec.titulo.length > 0 && (
        <div style={{ position: "absolute", top: "7.6%", left: "3.3%", fontFamily: "Inter, sans-serif", fontWeight: 600, fontSize: "1.6vw", color: claro ? DOC.tintaClaro : DOC.tintaOscuro }}>
          {rec.titulo.map((p, i) => {
            const k = entra(t, p.at);
            return (
              <span key={i} style={{ opacity: k, display: "inline-block", whiteSpace: "pre", transform: `translateY(${(1 - k) * 8}px)` }}>
                {conFechas(p.texto)}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
