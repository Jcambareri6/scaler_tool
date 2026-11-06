import { AbsoluteFill, Easing, interpolate } from "remotion";
import { Bell, MousePointer2 } from "lucide-react";
import type { OverlaySpec } from "../spec";
import type { Theme } from "../theme";
import { TEXT_SHADOW, uiText, useMotion } from "../lib/anim";

// Rojo de YouTube: el boton se reconoce por el color, no por la paleta.
const YT_RED = "#FF0033";
// Frame del click en "Suscribirse" y en la campana.
const CLICK_SUB = 26;
const CLICK_BELL = 46;

// CTA simulado (Como Funciona El Mundo): una tarjeta tipo YouTube abajo al
// centro; el cursor entra, toca "Suscribirse" (pasa a "Suscrito") y despues
// la campana, que se sacude. `text` = el pedido de la narracion, arriba.
export function SubscribeCard({ spec, theme, exit: withExit, locale }: { spec: OverlaySpec; theme: Theme; exit?: boolean | undefined; locale?: string | undefined }) {
  const { s, frame, enter, exit } = useMotion(withExit);
  const t = enter(0, 16);
  const subscribed = frame >= CLICK_SUB;
  const press = (at: number) =>
    1 - 0.08 * interpolate(frame, [at - 2, at, at + 4], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const ring = interpolate(frame, [CLICK_BELL, CLICK_BELL + 24], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const bellAngle = frame >= CLICK_BELL ? Math.sin((frame - CLICK_BELL) * 0.9) * 24 * ring : 0;
  // Recorrido del cursor (px a 1080p, relativo a la tarjeta): entra desde
  // abajo a la derecha, toca el boton y despues la campana.
  const ease = Easing.inOut(Easing.cubic);
  const clamp = { easing: ease, extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
  const cx = interpolate(frame, [8, CLICK_SUB - 2, CLICK_BELL - 12, CLICK_BELL - 2], [560, 170, 170, 330], clamp);
  const cy = interpolate(frame, [8, CLICK_SUB - 2], [200, 50], clamp);

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 120 * s, display: "flex", flexDirection: "column", alignItems: "center", gap: 22 * s }}>
        <div style={{ fontFamily: theme.fontSans, fontWeight: 800, fontSize: 36 * s, letterSpacing: 2 * s, textTransform: "uppercase", color: theme.text, textShadow: TEXT_SHADOW, opacity: t }}>
          {spec.text}
        </div>
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: 26 * s,
            padding: `${22 * s}px ${30 * s}px`,
            borderRadius: 18 * s,
            background: "rgba(18,18,18,0.92)",
            boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
            opacity: t,
            transform: `translateY(${(1 - t) * 40 * s}px)`,
          }}
        >
          <div
            style={{
              padding: `${16 * s}px ${36 * s}px`,
              borderRadius: 999,
              fontFamily: theme.fontSans,
              fontWeight: 700,
              fontSize: 32 * s,
              whiteSpace: "nowrap",
              background: subscribed ? "rgba(255,255,255,0.14)" : YT_RED,
              color: "#fff",
              transform: `scale(${press(CLICK_SUB)})`,
            }}
          >
            {uiText(locale, subscribed ? "subscribed" : "subscribe")}
          </div>
          <div
            style={{
              width: 76 * s,
              height: 76 * s,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(255,255,255,0.14)",
              transform: `scale(${press(CLICK_BELL)})`,
            }}
          >
            <Bell
              size={38 * s}
              strokeWidth={2.4}
              color="#fff"
              fill={frame >= CLICK_BELL ? "#fff" : "none"}
              style={{ transform: `rotate(${bellAngle}deg)`, transformOrigin: "50% 10%" }}
            />
          </div>
          <MousePointer2
            size={52 * s}
            strokeWidth={1.6}
            color="#111"
            fill="#fff"
            style={{ position: "absolute", left: cx * s, top: cy * s, opacity: enter(8, 8), filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.6))" }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
}
