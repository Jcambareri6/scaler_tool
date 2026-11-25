# Skills para Claude

Skills que reproducen partes de Skaler fuera del backend, para probar formatos en Claude.

## `formato-documental`

Documental con material real y el look de un formato (los 12 de Skaler + los que se sumen). Descripción completa del formato en `formato-documental/referencia/formato.md`.

### Instalarla

- **claude.ai o app de escritorio**: comprimir la carpeta `formato-documental` en un `.zip` (la carpeta adentro del zip) y subirla en Configuración → Capacidades → Skills.
- **Claude Code**: copiar la carpeta a `~/.claude/skills/formato-documental` (o a `.claude/skills/` de un proyecto).

```bash
cd skills-claude && zip -r formato-documental.zip formato-documental -x "*/__pycache__/*"
```

### Probarla

Pedirle a Claude, por ejemplo: "Hacé un documental de 90 segundos sobre el desastre de Chernóbil con el formato Profundo. Acá está la voz." Con un formato nuevo: "Sumá este formato" y pasar el JSON, la descripción o un video de referencia.

Necesita Python 3.10+, ffmpeg y yt-dlp (y `pip install faster-whisper` para los tiempos por palabra). Desde servidores, YouTube suele bloquear yt-dlp: usar `YTDLP_PROXY` o bajar los tramos en la PC.
