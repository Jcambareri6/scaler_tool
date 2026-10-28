// Baja el Chrome Headless Shell que usa Remotion (al construir la imagen,
// para no bajarlo en el primer render).
import { ensureBrowser } from "@remotion/renderer";

await ensureBrowser();
console.log("[motion] navegador listo");
