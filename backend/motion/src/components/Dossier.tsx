import { AbsoluteFill } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { useMotion } from "../lib/anim";

// Expediente de investigacion (GoMotion: "Jan de Vos"): papeles viejos de
// fondo, una ficha encima y el nombre encerrado con un trazo rojo de marcador.
// Para presentar a una persona clave cuando no hay foto, o un documento.
// Pantalla entera (catalog: full). `text` = el nombre, `label` = el rol o dato.
export function Dossier({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { s, enter, draw, exit } = useMotion(withExit);
  const card = enter(0, 20);
  const circle = draw(18, 38);
  const red = "#c8231e";
  const bar = (w: number, k: number) => <div key={k} style={{ height: 16 * s, width: w * s, background: "#1b1b1b", marginBottom: 14 * s, opacity: enter(30 + k * 3, 10) }} />;

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      {/* Papeles viejos: renglones, manchas y bordes oscuros. */}
      <AbsoluteFill
        style={{
          background: [
            "radial-gradient(ellipse 75% 65% at 50% 50%, transparent, rgba(60,40,15,0.55))",
            "repeating-linear-gradient(-3deg, transparent 0px, transparent 34px, rgba(70,50,25,0.18) 34px, rgba(70,50,25,0.18) 36px)",
            "linear-gradient(135deg, #d9c9a6, #c8b287 50%, #b39b6c)",
          ].join(","),
        }}
      />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            width: 1050 * s,
            padding: `${50 * s}px ${70 * s}px`,
            background: "linear-gradient(180deg, #f3e6c4, #e8d6aa)",
            boxShadow: `0 ${26 * s}px ${60 * s}px rgba(40,25,5,0.5)`,
            transform: `translateY(${(1 - card) * 70 * s}px) rotate(${-1.5 + (1 - card) * -3}deg)`,
            opacity: card,
            position: "relative",
          }}
        >
          <div style={{ fontFamily: theme.fontSans, fontWeight: 600, fontSize: 20 * s, letterSpacing: 6 * s, textTransform: "uppercase", color: "#6b5634", marginBottom: 30 * s }}>Expediente</div>
          <div style={{ position: "relative", display: "inline-block", padding: `${10 * s}px ${36 * s}px` }}>
            <span style={{ fontFamily: theme.fontSans, fontWeight: 800, fontSize: 82 * s, letterSpacing: 2 * s, textTransform: "uppercase", color: "#1d1a14" }}>{spec.text}</span>
            {/* Trazo de marcador alrededor del nombre (se dibuja). */}
            {/* Ovalo a mano: arranca arriba al centro, da la vuelta entera y se pasa un poco. */}
            <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ position: "absolute", left: -34 * s, top: -26 * s, width: `calc(100% + ${68 * s}px)`, height: `calc(100% + ${52 * s}px)`, overflow: "visible" }}>
              <path d="M52 2 C 80 1, 99 8, 98 20 C 97 33, 74 39, 48 38 C 20 37, 1 31, 2 19 C 3 8, 24 2, 46 3 C 58 3, 66 5, 70 7" fill="none" stroke={red} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - circle} strokeWidth={1.3} />
            </svg>
          </div>
          {spec.label && (
            <div style={{ marginTop: 26 * s, fontFamily: theme.fontSerif, fontStyle: "italic", fontWeight: 600, fontSize: 38 * s, color: "#3b2f1d", opacity: enter(24) }}>{spec.label}</div>
          )}
          <div style={{ marginTop: 40 * s }}>{[620, 520, 700, 380].map(bar)}</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
