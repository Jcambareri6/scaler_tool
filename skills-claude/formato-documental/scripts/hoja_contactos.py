"""Hoja de contactos de un video: N cuadros numerados con su segundo, para que el juez elija momentos.

Uso:
  python hoja_contactos.py video.mp4 hoja.jpg [--cuadros 16] [--desde 0] [--hasta 0]
  python hoja_contactos.py planos/ hoja_video.jpg   (una carpeta: el cuadro del medio de cada plano, en orden)

Imprime JSON con el segundo de cada cuadro (cuadro 0, 1, 2...).
"""
import argparse
import json
import math
import os
import tempfile

from comun import FFMPEG, correr, duracion, es_imagen, falta


def cuadro(archivo: str, t: float, salida: str, etiqueta: str) -> None:
    texto = etiqueta.replace(":", r"\:")
    vf = f"scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2,drawtext=text='{texto}':x=8:y=8:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.6"
    entrada = ["-i", archivo] if es_imagen(archivo) else ["-ss", f"{t:.2f}", "-i", archivo]
    correr([FFMPEG, "-y", "-hide_banner", "-loglevel", "error", *entrada, "-frames:v", "1", "-vf", vf, salida])


def armar(cuadros: list[str], salida: str) -> None:
    cols = 4
    filas = math.ceil(len(cuadros) / cols)
    entradas = []
    for c in cuadros:
        entradas += ["-i", c]
    n = len(cuadros)
    # Relleno negro para completar la grilla.
    faltan = cols * filas - n
    filtro = "".join(f"[{i}:v]" for i in range(n))
    if faltan:
        filtro = f"color=black:s=480x270:d=1[neg];[neg]split={faltan}" + "".join(f"[n{i}]" for i in range(faltan)) + ";" + filtro + "".join(f"[n{i}]" for i in range(faltan))
    filtro += f"xstack=inputs={cols * filas}:layout=" + "|".join(f"{(i % cols) * 480}_{(i // cols) * 270}" for i in range(cols * filas)) + "[out]"
    correr([FFMPEG, "-y", "-hide_banner", "-loglevel", "error", *entradas, "-filter_complex", filtro, "-map", "[out]", "-frames:v", "1", "-q:v", "3", salida])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("fuente")
    ap.add_argument("salida")
    ap.add_argument("--cuadros", type=int, default=16)
    ap.add_argument("--desde", type=float, default=0)
    ap.add_argument("--hasta", type=float, default=0)
    a = ap.parse_args()
    falta(FFMPEG)
    with tempfile.TemporaryDirectory(prefix="hoja-") as tmp:
        cuadros, tiempos = [], []
        if os.path.isdir(a.fuente):
            archivos = sorted(f for f in os.listdir(a.fuente) if not f.startswith("."))
            for i, f in enumerate(archivos):
                ruta = os.path.join(a.fuente, f)
                t = 0 if es_imagen(ruta) else duracion(ruta) / 2
                c = os.path.join(tmp, f"{i:03d}.jpg")
                cuadro(ruta, t, c, f"{i} {os.path.splitext(f)[0]}")
                cuadros.append(c)
                tiempos.append({"cuadro": i, "archivo": f})
        else:
            total = duracion(a.fuente)
            fin = a.hasta or total
            # Sin la intro ni el final (créditos): del 6 % al 94 %.
            ini = a.desde or min(30, total * 0.06)
            fin = min(fin, total * 0.94 if not a.hasta else fin)
            paso = (fin - ini) / a.cuadros
            for i in range(a.cuadros):
                t = ini + paso * (i + 0.5)
                c = os.path.join(tmp, f"{i:03d}.jpg")
                cuadro(a.fuente, t, c, f"{i}  {int(t // 60)}:{int(t % 60):02d}")
                cuadros.append(c)
                tiempos.append({"cuadro": i, "segundo": round(t, 1)})
        for lote in range(0, len(cuadros), 24):
            destino = a.salida if len(cuadros) <= 24 else a.salida.replace(".jpg", f"_{lote // 24 + 1}.jpg")
            armar(cuadros[lote:lote + 24], destino)
    print(json.dumps(tiempos, ensure_ascii=False))


if __name__ == "__main__":
    main()
