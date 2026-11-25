"""Utilidades compartidas: ffmpeg, ffprobe y yt-dlp."""
import json
import os
import re
import shutil
import subprocess
import sys

FFMPEG = os.environ.get("FFMPEG", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE", "ffprobe")
YTDLP = os.environ.get("YTDLP", "yt-dlp")
# Proxy residencial si YouTube bloquea la IP (ej: http://usuario:clave@host:7777).
PROXY = os.environ.get("YTDLP_PROXY", "").strip()

IMAGEN = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def falta(binario: str) -> None:
    if not shutil.which(binario):
        sys.exit(f"Falta {binario}. Instalalo y volvé a correr el comando.")


def correr(args: list[str], timeout: int = 300) -> str:
    """Corre un comando y devuelve stdout + stderr. Falla con el final de stderr."""
    p = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError(f"{os.path.basename(args[0])} {p.returncode}: {p.stderr[-600:]}")
    return p.stdout + p.stderr


def duracion(archivo: str) -> float:
    out = correr([FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "json", archivo])
    return float(json.loads(out[out.index("{"):])["format"]["duration"])


def es_imagen(archivo: str) -> bool:
    return os.path.splitext(archivo)[1].lower() in IMAGEN


def es_url(texto: str) -> bool:
    return bool(re.match(r"^https?://", texto))


def proxy_args() -> list[str]:
    return ["--proxy", PROXY] if PROXY else []
