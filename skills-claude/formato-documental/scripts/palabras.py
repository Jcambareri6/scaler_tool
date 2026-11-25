"""Tiempos por palabra de la voz, alineados al guion (como transcribeAudio + wordAlignment de Skaler).

Uso:
  python palabras.py voz.mp3 guion.txt palabras.json [--modelo small] [--idioma es]

Necesita: pip install faster-whisper
Salida: [{"i": 0, "palabra": "El", "inicio": 0.12, "fin": 0.25}, ...] con las palabras DEL GUION
(ortografía del guion, no la de Whisper). Las que Whisper no reconoce se interpolan.
"""
import argparse
import difflib
import json
import re
import subprocess
import unicodedata

from comun import FFMPEG


def norm(w: str) -> str:
    w = "".join(c for c in unicodedata.normalize("NFD", w.lower()) if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]", "", w)


def transcribir(voz: str, modelo: str, idioma: str) -> list[dict]:
    import numpy as np
    from faster_whisper import WhisperModel

    # Decodificar con ffmpeg a f32 16 kHz (evita errores de PyAV con metadatos raros).
    pcm = subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-i", voz, "-f", "f32le", "-ac", "1", "-ar", "16000", "-"], capture_output=True, check=True).stdout
    audio = np.frombuffer(pcm, dtype=np.float32)
    segs, _ = WhisperModel(modelo, compute_type="int8").transcribe(audio, language=idioma, word_timestamps=True)
    return [{"w": w.word.strip(), "s": w.start, "e": w.end} for s in segs for w in s.words]


def alinear(guion: list[str], asr: list[dict]) -> list[dict]:
    a = [norm(w) for w in guion]
    b = [norm(w["w"]) for w in asr]
    tiempos: list[tuple[float, float] | None] = [None] * len(guion)
    for blk in difflib.SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks():
        for k in range(blk.size):
            x = asr[blk.b + k]
            tiempos[blk.a + k] = (x["s"], x["e"])
    # Interpolar huecos entre los vecinos con tiempo.
    i = 0
    fin_total = asr[-1]["e"] if asr else 0.0
    while i < len(tiempos):
        if tiempos[i] is not None:
            i += 1
            continue
        j = i
        while j < len(tiempos) and tiempos[j] is None:
            j += 1
        desde = tiempos[i - 1][1] if i > 0 else 0.0
        hasta = tiempos[j][0] if j < len(tiempos) else fin_total
        paso = max(0.01, (hasta - desde) / (j - i))
        for k in range(i, j):
            tiempos[k] = (desde + paso * (k - i), desde + paso * (k - i + 1))
        i = j
    return [{"i": k, "palabra": w, "inicio": round(t[0], 3), "fin": round(t[1], 3)} for k, (w, t) in enumerate(zip(guion, tiempos))]


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("voz")
    ap.add_argument("guion")
    ap.add_argument("salida")
    ap.add_argument("--modelo", default="small")
    ap.add_argument("--idioma", default="es")
    a = ap.parse_args()
    with open(a.guion, encoding="utf-8") as f:
        guion = f.read().split()
    res = alinear(guion, transcribir(a.voz, a.modelo, a.idioma))
    with open(a.salida, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    print(f"{len(res)} palabras -> {a.salida}")
