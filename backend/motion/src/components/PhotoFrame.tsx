import { AbsoluteFill, Img, interpolate } from "remotion";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { useMotion } from "../lib/anim";

// Foto enmarcada sobre papel antiguo (GoMotion: su recurso mas usado). La
// foto del plano, con borde blanco y sombra, apoyada sobre un papel envejecido,
// y la leyenda abajo. Convierte una foto fija en una pieza "de archivo".
// Ocupa todo el cuadro (catalog: full). `text` = leyenda (opcional).
export function PhotoFrame({ spec, theme, exit: withExit }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined }) {
  const { s, frame, enter, exit } = useMotion(withExit);
  if (!spec.image) return null;
  const photo = enter(4, 22);
  const caption = enter(16, 16);
  // Acercamiento lento dentro del marco (se congela al final de la entrada).
  const zoom = interpolate(frame, [0, 75], [1.08, 1.0], { extrapolateRight: "clamp" });
  const tilt = interpolate(photo, [0, 1], [-4, -1.2]);

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      {/* Papel: crema con bordes tostados, vetas y manchas suaves. */}
      <AbsoluteFill
        style={{
          background: [
            "radial-gradient(ellipse 70% 60% at 50% 45%, rgba(255,250,235,0.0), rgba(120,90,50,0.35) 100%)",
            "repeating-linear-gradient(2deg, rgba(120,95,60,0.05) 0px, rgba(120,95,60,0.05) 2px, transparent 2px, transparent 9px)",
            "radial-gradient(circle at 18% 22%, rgba(150,110,60,0.18), transparent 22%)",
            "radial-gradient(circle at 82% 78%, rgba(150,110,60,0.16), transparent 26%)",
            "linear-gradient(160deg, #e9dec4, #d8c7a2 55%, #c9b48a)",
          ].join(","),
        }}
      />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
        <div
          style={{
            width: 1180 * s,
            height: 700 * s,
            padding: 16 * s,
            background: "#f7f3ea",
            boxShadow: `0 ${24 * s}px ${60 * s}px rgba(40,25,10,0.45), 0 ${4 * s}px ${10 * s}px rgba(40,25,10,0.3)`,
            transform: `translateY(${(1 - photo) * 60 * s}px) rotate(${tilt}deg)`,
            opacity: photo,
            boxSizing: "border-box",
          }}
        >
          <div style={{ width: "100%", height: "100%", overflow: "hidden", background: "#222" }}>
            <Img
              src={spec.image}
              style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${zoom})`, filter: "sepia(0.18) contrast(1.04)" }}
              onError={() => undefined}
            />
          </div>
        </div>
        {spec.text && (
          <div
            style={{
              marginTop: 46 * s,
              fontFamily: theme.fontSans,
              fontWeight: 700,
              fontSize: 30 * s,
              letterSpacing: 6 * s,
              textTransform: "uppercase",
              color: "#3b2f20",
              opacity: caption,
              transform: `translateY(${(1 - caption) * 14 * s}px)`,
              maxWidth: 1200 * s,
              textAlign: "center",
            }}
          >
            {spec.text}
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
