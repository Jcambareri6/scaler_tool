"""Baja SOLO un tramo de un video y lo deja limpio para un plano (como downloadYouTubeSegment + cleanSegment de Skaler).

Sirve para:
  - una URL de YouTube (u otro sitio que soporte yt-dlp): baja solo el tramo;
  - un archivo local (los clips que pasa el usuario): corta el tramo.

Uso:
  python bajar_tramo.py URL_O_ARCHIVO --momento 95 --dur 4.5 --salida planos/03.mp4 [--logo br]

  --momento  segundo del video donde está lo que se quiere mostrar (si no se pasa: 30 % del video)
  --dur      lo que dura el plano (2,5 a 12 s)
  --logo     esquina con un logo chico de canal para recortar: tl, tr, bl o br

Qué hace:
  1. Baja (o corta) min(dur*1,25+6, 24) s alrededor del momento, nunca en la intro.
  2. Detecta cortes de plano y negros, y se queda con el pedazo continuo más largo cerca del centro.
  3. Descarta el tramo si más del 80 % está quieto.
  4. Recorta barras negras y el logo de la esquina.
  5. Si el pedazo limpio es corto, lo ralentiza hasta 0,5x.
  6. Sin audio, H.264 CRF 20, yuv420p.
Escribe un JSON con lo que hizo en la salida estándar.
"""
import argparse
import json
import os
import re
import sys
import tempfile
from collections import Counter

from comun import FFMPEG, YTDLP, correr, duracion, es_url, falta, proxy_args

MARGEN = 0.15


def ventana(total: float, necesario: float, momento: float | None) -> tuple[float, float]:
    largo = min(necesario * 1.25 + 6, 24)
    intro = min(30, max(10, total * 0.06)) if total > 40 else 0
    deseado = momento - 2 if momento is not None else total * 0.3
    inicio = max(intro, min(deseado, total - largo - 2))
    return max(0.0, inicio), min(largo, total)


def duracion_remota(url: str) -> float:
    out = correr([YTDLP, "--no-warnings", "--no-playlist", "--print", "duration", *proxy_args(), url], timeout=60)
    return float(out.strip().splitlines()[0])


def bajar(url: str, inicio: float, largo: float, salida: str) -> None:
    correr(
        [
            YTDLP, url,
            "-f", "bv*[height<=1080][ext=mp4]/bv*[height<=1080]/b[height<=1080]/b",
            "--download-sections", f"*{inicio:.1f}-{inicio + largo:.1f}",
            "--force-keyframes-at-cuts", "--remux-video", "mp4",
            "--no-warnings", "--no-playlist", *proxy_args(),
            "-o", salida,
        ],
        timeout=180,
    )


def cortar(archivo: str, inicio: float, largo: float, salida: str) -> None:
    correr([FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{inicio:.2f}", "-i", archivo, "-t", f"{largo:.2f}", "-an",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", salida], timeout=180)


def quieto(log: str, a: float, b: float, dur: float) -> float:
    """Fracción de [a, b] que freezedetect marcó como imagen quieta."""
    total = 0.0
    inicios = [float(x) for x in re.findall(r"freeze_start: ([\d.]+)", log)]
    fines = [float(x) for x in re.findall(r"freeze_end: ([\d.]+)", log)]
    for i, s in enumerate(inicios):
        e = fines[i] if i < len(fines) else dur
        total += max(0.0, min(b, e) - max(a, s))
    return total / max(0.01, b - a)


def barras(log: str) -> str | None:
    crops = re.findall(r"crop=(\d+:\d+:\d+:\d+)", log)
    if len(crops) < 5:
        return None
    mejor, n = Counter(crops).most_common(1)[0]
    w, h, _, _ = (int(v) for v in mejor.split(":"))
    tam = re.search(r"Stream.*Video.* (\d{2,5})x(\d{2,5})", log)
    if n / len(crops) < 0.6 or not tam:
        return None
    W, H = int(tam.group(1)), int(tam.group(2))
    # Solo si saca algo de verdad (más del 3 % de un lado).
    if w >= W * 0.97 and h >= H * 0.97:
        return None
    return f"crop={mejor}"


def recorte_logo(esquina: str | None) -> str | None:
    if not esquina:
        return None
    x = "iw*0.16" if esquina in ("tl", "bl") else "0"
    y = "ih*0.16" if esquina in ("tl", "tr") else "0"
    return f"crop=trunc(iw*0.84/2)*2:trunc(ih*0.84/2)*2:{x}:{y}"


def limpiar(crudo: str, necesario: float, salida: str, logo: str | None) -> dict:
    sonda = correr([FFMPEG, "-hide_banner", "-i", crudo, "-an", "-vf", "blackdetect=d=0.03:pix_th=0.10,select='gt(scene,0.22)',showinfo", "-f", "null", "-"])
    try:
        quietud = correr([FFMPEG, "-hide_banner", "-i", crudo, "-an", "-vf", "freezedetect=n=0.003:d=0.5,cropdetect=limit=40:round=2:reset=1", "-f", "null", "-"])
    except RuntimeError:
        quietud = ""
    dur = duracion(crudo)
    cortes = [float(x) for x in re.findall(r"pts_time:([\d.]+)", sonda)]
    negros = [(float(a), float(b)) for a, b in re.findall(r"black_start:([\d.]+)\s+black_end:([\d.]+)", sonda)]
    bordes = sorted([0.0, *cortes, *[v for par in negros for v in par], dur])
    piezas = []
    for i in range(len(bordes) - 1):
        a = bordes[i] + (0 if i == 0 else MARGEN)
        b = bordes[i + 1] - (0 if i + 1 == len(bordes) - 1 else MARGEN)
        en_negro = any(a >= s - 0.01 and b <= e + 0.01 for s, e in negros)
        if b - a > 0.5 and not en_negro:
            piezas.append((a, b))
    centro = dur / 2
    utiles = [p for p in piezas if p[1] - p[0] >= necesario * 0.5]
    if not utiles:
        raise RuntimeError("sin tramo limpio (demasiados cortes de plano)")
    elegido = next((p for p in utiles if p[0] <= centro <= p[1] and p[1] - p[0] >= necesario), None) or max(utiles, key=lambda p: p[1] - p[0])
    largo = elegido[1] - elegido[0]
    toma = min(largo, necesario)
    desde = max(elegido[0], min(centro - necesario / 2, elegido[1] - necesario)) if largo > necesario else elegido[0]
    lento = min(2.0, necesario / toma) if toma < necesario else 1.0
    if quieto(quietud, desde, desde + toma, dur) > 0.8:
        raise RuntimeError("el tramo es una imagen fija (más del 80 % quieto)")
    filtros = [f for f in (barras(quietud), recorte_logo(logo)) if f]
    if lento > 1:
        filtros.append(f"setpts={lento:.3f}*PTS")
    correr([FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{desde:.2f}", "-i", crudo, "-t", f"{toma:.2f}", "-an",
            *(["-vf", ",".join(filtros)] if filtros else []),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", salida])
    if os.path.getsize(salida) < 30_000:
        raise RuntimeError("el tramo limpio quedó vacío")
    return {"desde_en_tramo": round(desde, 2), "toma": round(toma, 2), "ralentizado": round(lento, 2), "filtros": filtros, "cortes_detectados": len(cortes)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("fuente")
    ap.add_argument("--momento", type=float)
    ap.add_argument("--dur", type=float, required=True)
    ap.add_argument("--salida", required=True)
    ap.add_argument("--logo", choices=["tl", "tr", "bl", "br"])
    a = ap.parse_args()
    falta(FFMPEG)
    necesario = min(max(a.dur, 2.5), 12)
    os.makedirs(os.path.dirname(os.path.abspath(a.salida)), exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="tramo-") as tmp:
        crudo = os.path.join(tmp, "crudo.mp4")
        if es_url(a.fuente):
            falta(YTDLP)
            total = duracion_remota(a.fuente)
            inicio, largo = ventana(total, necesario, a.momento)
            bajar(a.fuente, inicio, largo, crudo)
        else:
            total = duracion(a.fuente)
            inicio, largo = ventana(total, necesario, a.momento)
            cortar(a.fuente, inicio, largo, crudo)
        info = limpiar(crudo, necesario, a.salida, a.logo)
    print(json.dumps({"fuente": a.fuente, "salida": a.salida, "inicio_tramo": round(inicio, 2), "largo_tramo": round(largo, 2), **info}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(1)
