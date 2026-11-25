"""Monta el documental desde plan.json con el look del formato (como el render documental de Skaler).

Uso:
  python montar.py plan.json --formato ../formatos/profundo.json --voz voz.mp3 --salida video.mp4 \
      [--musica musica.mp3] [--palabras palabras.json] [--sin-subtitulos] [--vertical] [--borrador]

plan.json: el plan de la skill. Cada plano necesita "inicio" (segundo de la voz) y "archivo"
(foto o clip local, ya limpio con bajar_tramo.py). Opcional: "movimiento" (zoom_in, zoom_out,
pan_left, pan_right, push) para fotos.

palabras.json: [{"palabra": "El", "inicio": 0.0, "fin": 0.2}, ...] para los subtítulos.

Qué hace:
  - Cada plano dura hasta que arranca el siguiente (sin huecos); el último, hasta el final de la voz.
  - Fotos: movimiento de cámara que nunca repite el del plano anterior (zoom máximo 1,12).
  - Clips: encuadre que alterna abierto y cerrado cada zoomCutEvery s; si el clip es corto, se repite.
  - Look del formato: contraste, saturación, brillo, viñeta, capa (bn, old_movie, paper) y destello cálido cada flashEvery planos.
  - Cortes secos, subtítulos de N palabras, música con ducking bajo la voz y volumen final a -14 LUFS.
  - Control de calidad: negros, imagen congelada y volumen.
Los gráficos animados del plan NO se dibujan acá (los dibuja Skaler con Remotion).
"""
import argparse
import json
import os
import re
import sys
import tempfile

from comun import FFMPEG, correr, duracion, es_imagen, falta

FPS = 30
FLASH_SEG = 0.35
FLASH_FUERZA = 0.22
MOVIMIENTOS = ["zoom_in", "pan_right", "zoom_out", "pan_left", "push"]
ZOOM_MAX = 1.12
ZOOM_PAN = 1.1


def look(l: dict, indice: int) -> str:
    destello = l.get("flashEvery", 0) > 0 and indice > 0 and indice % l["flashEvery"] == 0
    brillo = f"'{l['brightness']}+{FLASH_FUERZA}*max(0\\,1-t/{FLASH_SEG})'" if destello else f"{l['brightness']}"
    partes = [f"eq=contrast={l['contrast']}:saturation={l['saturation']}:brightness={brillo}" + (":eval=frame" if destello else "")]
    if destello:
        partes.append("colorbalance=rh=0.06:gh=0.03:bh=-0.04")
    capa = l.get("layer")
    if capa == "bn":
        partes.append("noise=alls=10:allf=t")
    if capa == "old_movie":
        partes += ["noise=alls=14:allf=t", "eq=gamma=0.95"]
    if capa == "paper":
        partes.append("colorbalance=rs=0.06:gs=0.03:bs=-0.06:rm=0.04:bm=-0.04")
    if l.get("vignette"):
        partes.append("vignette=angle=PI/5")
    return ",".join(partes)


def movimiento(indice: int, anterior: str | None) -> str:
    m = MOVIMIENTOS[indice % len(MOVIMIENTOS)]
    return MOVIMIENTOS[(indice + 1) % len(MOVIMIENTOS)] if m == anterior else m


def zoompan(m: str, cuadros: int) -> tuple[str, str, str]:
    n = max(1, cuadros - 1)
    cx, cy = "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"
    paso = (ZOOM_MAX - 1) / n
    if m == "zoom_in":
        return f"1+{paso:.8f}*on", cx, cy
    if m == "zoom_out":
        return f"{ZOOM_MAX}-{paso:.8f}*on", cx, cy
    if m == "pan_left":
        return f"{ZOOM_PAN}", f"(iw-iw/zoom)*(1-on/{n})", cy
    if m == "pan_right":
        return f"{ZOOM_PAN}", f"(iw-iw/zoom)*on/{n}", cy
    return f"1+{(ZOOM_MAX + 0.04 - 1) / n:.8f}*on", cx, "max(0\\,ih/3-ih/zoom/2)"


def segmento(p: dict, indice: int, dur: float, anterior: str | None, fmt: dict, W: int, H: int, salida: str, rapido: bool) -> str | None:
    l = fmt["look"]
    cuadros = max(1, round(dur * FPS))
    cubrir = f"scale={{w}}:{{h}}:force_original_aspect_ratio=increase:flags=lanczos,crop={{w}}:{{h}}"
    preset = ["-preset", "ultrafast", "-crf", "26"] if rapido else ["-preset", "veryfast", "-crf", "18"]
    usado = None
    if es_imagen(p["archivo"]):
        usado = p.get("movimiento") or movimiento(indice, anterior)
        z, x, y = zoompan(usado, cuadros)
        vf = (cubrir.format(w=W * 2, h=H * 2) + f",zoompan=z='{z}':x='{x}':y='{y}':d={cuadros}:s={W}x{H}:fps={FPS}," + look(l, indice))
        entrada = ["-loop", "1", "-framerate", str(FPS), "-i", p["archivo"]]
    else:
        cada = l.get("zoomCutEvery", 0)
        if cada and dur > cada:
            z = f"if(lt(mod(it\\,{2 * cada})\\,{cada})\\,1.06\\,1.24)"
            vf = cubrir.format(w=round(W * 1.3), h=round(H * 1.3)) + f",fps={FPS},zoompan=z='{z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={round(W * 1.3)}x{round(H * 1.3)}:fps={FPS},scale={W}:{H}:flags=lanczos"
        else:
            vf = cubrir.format(w=W, h=H) + f",fps={FPS}"
        vf += "," + look(l, indice)
        entrada = ["-stream_loop", "-1", "-i", p["archivo"]]
    correr([FFMPEG, "-y", "-hide_banner", "-loglevel", "error", *entrada, "-t", f"{dur:.3f}", "-an", "-vf", vf + ",format=yuv420p",
            "-r", str(FPS), "-c:v", "libx264", *preset, salida], timeout=600)
    return usado


def ass_tiempo(t: float) -> str:
    cs = round(t * 100)
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def subtitulos(palabras: list[dict], cap: dict, W: int, H: int, destino: str) -> None:
    escala = H / 1080
    tam = round(cap.get("size", 54) * escala)
    cab = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Doc,{cap.get('font', 'Roboto Condensed')},{tam},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,{max(2, round(3 * escala))},{max(1, round(2 * escala))},2,60,60,{round(70 * escala)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    n = max(1, cap.get("words", 5))
    lineas = []
    for i in range(0, len(palabras), n):
        grupo = palabras[i:i + n]
        texto = " ".join(w["palabra"] for w in grupo).replace("{", "(").replace("}", ")")
        if cap.get("uppercase"):
            texto = texto.upper()
        fin = palabras[i + n]["inicio"] if i + n < len(palabras) else grupo[-1]["fin"]
        lineas.append(f"Dialogue: 0,{ass_tiempo(grupo[0]['inicio'])},{ass_tiempo(min(fin, grupo[-1]['fin'] + 0.4))},Doc,,0,0,0,,{texto}")
    with open(destino, "w", encoding="utf-8") as f:
        f.write(cab + "\n".join(lineas) + "\n")


def qc(archivo: str) -> dict:
    log = correr([FFMPEG, "-hide_banner", "-i", archivo, "-vf", "blackdetect=d=0.5:pix_th=0.10,freezedetect=n=-60dB:d=2", "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"], timeout=1200)
    lufs = re.findall(r"I:\s+(-?[\d.]+) LUFS", log)
    return {
        "negros": len(re.findall(r"black_start", log)),
        "congelados": len(re.findall(r"freeze_start", log)),
        "lufs": float(lufs[-1]) if lufs else None,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("plan")
    ap.add_argument("--formato", required=True)
    ap.add_argument("--voz", required=True)
    ap.add_argument("--salida", required=True)
    ap.add_argument("--musica")
    ap.add_argument("--palabras")
    ap.add_argument("--sin-subtitulos", action="store_true")
    ap.add_argument("--vertical", action="store_true", help="9:16 en vez de 16:9")
    ap.add_argument("--borrador", action="store_true", help="720p y codificación rápida para revisar")
    a = ap.parse_args()
    falta(FFMPEG)

    with open(a.plan, encoding="utf-8") as f:
        plan = json.load(f)
    with open(a.formato, encoding="utf-8") as f:
        fmt = json.load(f)
    planos = sorted(plan["planos"] if isinstance(plan, dict) else plan, key=lambda p: p["inicio"])
    base = os.path.dirname(os.path.abspath(a.plan))
    faltan = []
    for p in planos:
        if not os.path.isabs(p.get("archivo", "")):
            p["archivo"] = os.path.join(base, p.get("archivo", ""))
        if not os.path.isfile(p["archivo"]):
            faltan.append(f"plano {p.get('n', '?')}: {p['archivo']}")
    if faltan:
        sys.exit("Faltan archivos:\n" + "\n".join(faltan))

    W, H = (1920, 1080) if not a.borrador else (1280, 720)
    if a.vertical:
        W, H = H, W
    total = duracion(a.voz)
    planos[0]["inicio"] = 0.0

    with tempfile.TemporaryDirectory(prefix="montar-") as tmp:
        lista, anterior = [], None
        for i, p in enumerate(planos):
            fin = planos[i + 1]["inicio"] if i + 1 < len(planos) else total
            dur = max(0.5, fin - p["inicio"])
            seg = os.path.join(tmp, f"{i:04d}.mp4")
            anterior = segmento(p, i, dur, anterior, fmt, W, H, seg, a.borrador)
            lista.append(seg)
            print(f"plano {i + 1}/{len(planos)} listo ({dur:.1f} s)", file=sys.stderr)
        concat = os.path.join(tmp, "lista.txt")
        with open(concat, "w") as f:
            f.writelines(f"file '{s}'\n" for s in lista)
        video = os.path.join(tmp, "video.mp4")
        correr([FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", concat, "-c", "copy", video])

        filtros_v = []
        if a.palabras and not a.sin_subtitulos:
            with open(a.palabras, encoding="utf-8") as f:
                palabras = json.load(f)
            ass = os.path.join(tmp, "subs.ass")
            subtitulos(palabras, fmt.get("captions", {}), W, H, ass)
            filtros_v.append(f"subtitles={ass.replace(chr(92), '/').replace(':', chr(92) + ':')}")

        snd = fmt.get("sound", {})
        entradas = ["-i", video, "-i", a.voz]
        if a.musica:
            mv, duck = snd.get("musicVolume", 0.22), snd.get("duckTo", 0.35)
            entradas += ["-stream_loop", "-1", "-i", a.musica]
            # Ducking: la voz comprime la música hasta ~duckTo de su volumen.
            ratio = max(2, min(20, round(1 / max(duck, 0.05) * 2)))
            audio = (f"[1:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit=2[voz][llave];"
                     f"[2:a]aformat=sample_rates=48000:channel_layouts=stereo,volume={mv},atrim=0:{total:.3f}[mus];"
                     f"[mus][llave]sidechaincompress=threshold=0.03:ratio={ratio}:attack=30:release=400[musd];"
                     f"[voz][musd]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-14:TP=-1.5:LRA=11[a]")
        else:
            audio = "[1:a]aformat=sample_rates=48000:channel_layouts=stereo,loudnorm=I=-14:TP=-1.5:LRA=11[a]"
        filtro = audio + (f";[0:v]{','.join(filtros_v)}[v]" if filtros_v else "")
        correr([FFMPEG, "-y", "-hide_banner", "-loglevel", "error", *entradas, "-filter_complex", filtro,
                "-map", "[v]" if filtros_v else "0:v", "-map", "[a]",
                "-c:v", "libx264", "-preset", "ultrafast" if a.borrador else "medium", "-crf", "26" if a.borrador else "19",
                "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-t", f"{total:.3f}", "-movflags", "+faststart", a.salida], timeout=3600)

    resultado = {"salida": a.salida, "planos": len(planos), "duracion": round(total, 2), "qc": qc(a.salida)}
    print(json.dumps(resultado, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as e:
        sys.exit(str(e))
