"""Busca metraje en YouTube con los mismos filtros que Skaler (lib/youtubeSource.ts).

Uso:
  python buscar_youtube.py "Chernobyl reactor 1986 footage" [--cantidad 4] [--solo-referencia]

Por defecto busca SOLO videos con licencia Creative Commons BY (el filtro "Creative Commons"
de YouTube) y confirma la licencia leyendo la página de cada candidato: esos se pueden reusar
y publicar con crédito al autor. Los que no la confirman se descartan.

--solo-referencia: busca en todo YouTube, sin filtro de licencia. Solo para estudiar un
formato; esos videos NO se usan como metraje.

Devuelve JSON con los mejores candidatos: id, url, título, canal, duración, miniatura y licencia.
"""
import urllib.parse
import argparse
import json
import re
import unicodedata

from comun import YTDLP, correr, falta, proxy_args

RESULTADOS = 8
MIN_SEG = 60
MAX_SEG = 3 * 60 * 60
CANAL_BLOQUEADO = re.compile(
    r"\b(podcast|clips|highlights|show|talks?|radio|interviews?|entrevistas?|v?logs?|vlogger|live|studio|tertulia|charlas?|reacts?|reacciones)\b", re.I
)
TITULO_BLOQUEADO = re.compile(
    # Copia de BLOCKED_TITLE (backend/src/lib/youtubeSource.ts). Lo de 1997/Cameron viene de la prueba del Titanic.
    r"\b(react(ion|s|ing)?|reaccion|compilation|recopilaci[oó]n|podcast|#?shorts?|live|en vivo|directo|stream|gameplay|let'?s play|meme|stock footage|ai generated|generad[oa] con ia|midjourney|sora|tiktok|movie|film scene|scene|escena|trailer|tr[aá]iler|1997|cameron|dicaprio|winslet|hollywood|pel[ií]cula|series|episode|cgi|3d|animation|animated|animaci[oó]n|cartoon|simulat\w*|simulador|sandbox|game|juego|roblox|minecraft|remix|music video|amv|edit|fan ?made|tribute|lyrics|legend goes on|v?logs?|vlogger|vlogging|selfie|storytime|q ?& ?a|preguntas y respuestas|unboxing|my trip|our trip|mi viaje|nuestro viaje|day in the life|un d[ií]a (en|conmigo)|ven conmigo|come with me|conmigo|mysteries|misterios?|hidden|shutterstock|getty ?images|alamy|pond5|storyblocks|istock|dreamstime|watermark|marca de agua)\b",
    re.I,
)
METRAJE_LIMPIO = re.compile(
    r"\b(drone|dron|a[eé]reo|aerial|4k|footage|imagenes|im[aá]genes|recorrido|descenso|bajada|vuelo|timelapse|archivo|archive|hist[oó]ric[oa]s?|1[89]\d0s)\b", re.I
)
TITULO_LISTA = re.compile(r"\b(top ?\d+|los \d+|best of|lo mejor de|ranking|curiosidades|datos curiosos|you won'?t believe|no creer[aá]s)\b", re.I)


def plano(texto: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", texto.lower()) if unicodedata.category(c) != "Mn")


def puntaje(e: dict, terminos: list[str]) -> float:
    titulo = plano(e.get("title") or "")
    nombrados = sum(1 for t in terminos if t in titulo)
    d = e.get("duration") or 0
    return (
        min(nombrados, 3) * 0.7
        + (0.5 if METRAJE_LIMPIO.search(e.get("title") or "") else 0)
        + (0.6 if 120 <= d <= 1800 else 0)
        - (1 if TITULO_LISTA.search(e.get("title") or "") else 0)
    )


# Filtro "Creative Commons" del buscador de YouTube (parámetro sp).
FILTRO_CC = "EgIwAQ%3D%3D"
LICENCIA_CC = re.compile(r"creative commons", re.I)


def licencia_de(url: str) -> str | None:
    """Licencia que declara la página del video (yt-dlp, campo license). None si no se pudo leer."""
    try:
        out = correr([YTDLP, "--no-warnings", "--no-playlist", "--skip-download", "--print", "license", *proxy_args(), url], timeout=60)
    except RuntimeError:
        return None
    lic = out.strip().splitlines()[0] if out.strip() else ""
    return None if lic in ("", "NA") else lic


def buscar(query: str, cantidad: int, solo_cc: bool = True) -> list[dict]:
    falta(YTDLP)
    if solo_cc:
        url = f"https://www.youtube.com/results?search_query={urllib.parse.quote_plus(query)}&sp={FILTRO_CC}"
        raw = correr([YTDLP, url, "--flat-playlist", "--playlist-end", str(RESULTADOS * 2), "-J", "--no-warnings", *proxy_args()], timeout=90)
    else:
        raw = correr([YTDLP, f"ytsearch{RESULTADOS}:{query}", "--flat-playlist", "-J", "--no-warnings", *proxy_args()], timeout=60)
    datos = json.loads(raw[raw.index("{"):raw.rindex("}") + 1])
    entradas = [
        e
        for e in datos.get("entries") or []
        if e.get("id")
        and e.get("title")
        and not TITULO_BLOQUEADO.search(e["title"])
        and not CANAL_BLOQUEADO.search(e.get("channel") or e.get("uploader") or "")
        and (e.get("live_status") or "not_live") == "not_live"
        and MIN_SEG <= (e.get("duration") or 0) <= MAX_SEG
    ]
    terminos = sorted({w for w in re.split(r"[^a-z0-9]+", plano(query)) if len(w) >= 4})
    entradas.sort(key=lambda e: -puntaje(e, terminos))
    licencias: dict[str, str] = {}
    if solo_cc:
        # El filtro del buscador no alcanza: se confirma en la página de cada video.
        confirmadas = []
        for e in entradas:
            lic = licencia_de(f"https://www.youtube.com/watch?v={e['id']}")
            if lic and LICENCIA_CC.search(lic):
                licencias[e["id"]] = lic
                confirmadas.append(e)
            if len(confirmadas) >= cantidad:
                break
        entradas = confirmadas
    return [
        {
            "id": e["id"],
            "url": f"https://www.youtube.com/watch?v={e['id']}",
            "titulo": e["title"],
            "canal": e.get("channel") or e.get("uploader"),
            "duracion": e.get("duration"),
            "miniatura": f"https://i.ytimg.com/vi/{e['id']}/hqdefault.jpg",
            "query": query,
            "licencia": licencias.get(e["id"], "SIN LICENCIA: solo referencia, no usar como metraje"),
            "reusable": e["id"] in licencias,
        }
        for e in entradas[:cantidad]
    ]


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("query")
    ap.add_argument("--cantidad", type=int, default=4)
    ap.add_argument("--solo-referencia", action="store_true", help="sin filtro de licencia (solo para estudiar formatos)")
    a = ap.parse_args()
    print(json.dumps(buscar(a.query, a.cantidad, solo_cc=not a.solo_referencia), ensure_ascii=False, indent=2))
