#!/usr/bin/env python3
"""Mide el movimiento de un video segundo a segundo, sin IA.

Uso:
    python3 medir-movimiento.py video.mp4 [desde_seg] [duracion_seg]

Imprime:
  - congelados: segundos en los que la imagen no cambia nada (meta: <= 2 cada 30 s)
  - pico/media: intensidad del remate (referencia Ciencia y Vida: 8-9)
  - la curva de movimiento por segundo

Requiere ffmpeg y numpy.
"""
import subprocess
import sys

import numpy as np


def energia(path: str, desde: float = 0, dur: float | None = None) -> np.ndarray:
    cmd = ["ffmpeg", "-loglevel", "error", "-ss", str(desde)]
    if dur:
        cmd += ["-t", str(dur)]
    cmd += ["-i", path, "-vf", "fps=10,scale=160:90,format=gray", "-f", "rawvideo", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    f = np.frombuffer(raw, np.uint8).reshape(-1, 90, 160).astype(np.int16)
    d = np.abs(np.diff(f, axis=0)).mean(axis=(1, 2))
    return np.array([d[i * 10 : (i + 1) * 10].mean() for i in range(len(d) // 10)])


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    path = sys.argv[1]
    desde = float(sys.argv[2]) if len(sys.argv) > 2 else 0
    dur = float(sys.argv[3]) if len(sys.argv) > 3 else None
    e = energia(path, desde, dur)
    congelados = int((e < 0.15).sum())
    print(f"segundos medidos: {len(e)}")
    print(f"congelados: {congelados}  ({congelados * 30 / max(len(e), 1):.1f} cada 30 s; meta <= 2)")
    print(f"pico/media: {e.max() / max(e.mean(), 1e-3):.1f}  (referencia 8-9)")
    print("curva:", " ".join(f"{x:.1f}" for x in e))
