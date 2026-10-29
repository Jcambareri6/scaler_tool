import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/800.css";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/500-italic.css";
import { continueRender, delayRender, getRemotionEnvironment } from "remotion";

const FONTS = [
  "400 40px Inter",
  "600 40px Inter",
  "800 40px Inter",
  "500 40px 'Cormorant Garamond'",
  "italic 500 40px 'Cormorant Garamond'",
];

// Las fuentes de @fontsource se bajan recien cuando algo las usa: sin esto
// los primeros frames salen con la fuente de fallback. Solo al renderizar
// se frena el frame: en el preview del front (@remotion/player, ver
// frontend_v1 OverlayLayer) se piden igual pero sin bloquear la reproduccion.
if (getRemotionEnvironment().isRendering) {
  const handle = delayRender("Cargando fuentes");
  Promise.all(FONTS.map((f) => document.fonts.load(f)))
    .then(() => continueRender(handle))
    .catch(() => continueRender(handle));
} else if (typeof document !== "undefined") {
  void Promise.all(FONTS.map((f) => document.fonts.load(f))).catch(() => {});
}
