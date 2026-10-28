import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/800.css";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/500-italic.css";
import { continueRender, delayRender } from "remotion";

// Las fuentes de @fontsource se bajan recien cuando algo las usa: sin esto
// los primeros frames salen con la fuente de fallback.
const handle = delayRender("Cargando fuentes");
Promise.all([
  document.fonts.load("400 40px Inter"),
  document.fonts.load("600 40px Inter"),
  document.fonts.load("800 40px Inter"),
  document.fonts.load("500 40px 'Cormorant Garamond'"),
  document.fonts.load("italic 500 40px 'Cormorant Garamond'"),
])
  .then(() => continueRender(handle))
  .catch(() => continueRender(handle));
