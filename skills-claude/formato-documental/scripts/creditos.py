"""Arma los créditos para la descripción de YouTube con los .credito.json de los planos.

Uso:
  python creditos.py planos/ [creditos.txt]

Para fotos bajadas a mano, crear al lado un <foto>.credito.json:
  {"titulo": "...", "autor": "...", "url": "https://commons.wikimedia.org/...", "licencia": "CC BY-SA 4.0"}
Avisa qué planos no tienen crédito: hay que completarlo o cambiar el material antes de publicar.
"""
import json
import os
import sys


def main() -> None:
    carpeta = sys.argv[1]
    destino = sys.argv[2] if len(sys.argv) > 2 else None
    archivos = sorted(f for f in os.listdir(carpeta) if not f.endswith(".json") and not f.startswith("."))
    vistos, lineas, sin = set(), [], []
    for f in archivos:
        ruta = os.path.join(carpeta, f + ".credito.json")
        if not os.path.isfile(ruta):
            sin.append(f)
            continue
        with open(ruta, encoding="utf-8") as fh:
            c = json.load(fh)
        clave = c.get("url") or c.get("titulo")
        if clave in vistos:
            continue
        vistos.add(clave)
        partes = [f'"{c.get("titulo", "")}"']
        if c.get("autor"):
            partes.append(f'de {c["autor"]}')
        if c.get("licencia"):
            partes.append(f'({c["licencia"]})')
        if c.get("url"):
            partes.append(c["url"])
        lineas.append("- " + " ".join(partes))
    texto = "Material de archivo usado en este video:\n" + "\n".join(lineas) + "\n"
    if destino:
        with open(destino, "w", encoding="utf-8") as fh:
            fh.write(texto)
    print(texto)
    if sin:
        print("SIN CRÉDITO (completar o cambiar antes de publicar): " + ", ".join(sin), file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
