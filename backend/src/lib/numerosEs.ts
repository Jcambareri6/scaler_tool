// Cifras en letras -> digitos, en castellano ("ciento setenta" -> 170,
// "cuarenta y cinco" -> 45, "dos millones" -> 2 millones). Sin modelo.
//
// Para que sirve: el guion escribe las cifras en letras (asi las lee bien la
// voz) y los graficos copiaban las letras ("ciento setenta accidentes" en una
// frase cinetica). En pantalla una cifra va en digitos. Tambien sirve para
// validar: "170 accidentes" en un grafico es lo que dice la voz si el guion
// dice "ciento setenta accidentes".

const UNIDADES: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24,
  veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const DECENAS: Record<string, number> = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
const CENTENAS: Record<string, number> = {
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300,
  cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600,
  setecientos: 700, setecientas: 700, ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900,
};

function plain(word: string): string {
  return word.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function isNumberWord(w: string): boolean {
  return w in UNIDADES || w in DECENAS || w in CENTENAS || w === "mil" || w === "millon" || w === "millones";
}

// Valor de una secuencia de palabras numericas ya separadas ("ciento",
// "setenta", "y", "cinco"). null si no forma un numero valido.
function parseWords(words: string[]): { value: number; millions: boolean } | null {
  let total = 0;
  let current = 0;
  let millions = false;
  let any = false;
  // "millones" solo no es un numero (es la unidad de una cifra en digitos:
  // "130 millones" daba "130 0 millones").
  let valued = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (w === "y") {
      // "cuarenta y cinco": solo entre una decena y una unidad.
      const prev = words[i - 1];
      const next = words[i + 1];
      if (!prev || !next || !(prev in DECENAS) || !(next in UNIDADES) || UNIDADES[next]! > 9) return null;
      continue;
    }
    if (w in UNIDADES) current += UNIDADES[w]!;
    else if (w in DECENAS) current += DECENAS[w]!;
    else if (w in CENTENAS) current += CENTENAS[w]!;
    else if (w === "mil") {
      total += (current || 1) * 1000;
      current = 0;
      valued = true;
    } else if (w === "millon" || w === "millones") {
      // "dos millones" -> se muestra "2 millones": el numero queda chico.
      millions = true;
      if (i !== words.length - 1) return null;
    } else return null;
    if (w in UNIDADES || w in DECENAS || w in CENTENAS) valued = true;
    any = true;
  }
  if (!any || !valued) return null;
  return { value: total + current, millions };
}

// Formato de pantalla: 1.250 / 12.000. Un anio (1000-2099 sin unidad detras:
// "en 1996 se inauguro") va sin punto; con unidad ("1.000 metros") con punto.
const UNIT_AFTER = /^\s*(metros?|m\b|km|kil[oó]metros?|millas?|kg|kilos?|toneladas?|litros?|grados?|personas?|habitantes?|trabajadores?|soldados?|hombres?|mujeres?|ni[ñn]os?|muertos?|v[ií]ctimas?|accidentes?|pasajeros?|veh[ií]culos?|camiones|autos?|casas?|d[oó]lares?|euros?|pesos?|libras?|a[ñn]os|d[ií]as|horas|minutos|segundos|pies|hect[aá]reas?|%|por ciento|veces|cruces|curvas|pisos)\b/i;
function format(value: number, rest: string): string {
  if (value >= 1000 && value <= 2099 && !UNIT_AFTER.test(rest)) return String(value);
  return value.toLocaleString("es-AR").replace(/\s/g, ".");
}

const TOKEN = /([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)|([^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)/g;

// Reemplaza cada cifra en letras por digitos. `min`: las cifras menores no se
// tocan ("los dos hermanos" queda en letras). "un"/"una" solos nunca (son
// articulos); "un millon" si.
export function numerizar(text: string, min = 10): string {
  const tokens = [...text.matchAll(TOKEN)].map((m) => m[0]);
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const w = plain(tokens[i]!);
    if (!isNumberWord(w) || w === "y") {
      out.push(tokens[i]!);
      i += 1;
      continue;
    }
    // Junta la secuencia mas larga: palabra (espacio palabra | espacio y espacio palabra)*
    let j = i;
    const words = [w];
    let end = i;
    while (j + 2 < tokens.length && /^\s+$/.test(tokens[j + 1]!)) {
      const next = plain(tokens[j + 2]!);
      if (isNumberWord(next) && next !== "y") {
        words.push(next);
        j += 2;
        end = j;
      } else if (next === "y" && j + 4 < tokens.length && /^\s+$/.test(tokens[j + 3]!) && isNumberWord(plain(tokens[j + 4]!))) {
        words.push("y", plain(tokens[j + 4]!));
        j += 4;
        end = j;
      } else break;
    }
    const parsed = parseWords(words);
    const article = words.length === 1 && (w === "un" || w === "una" || w === "uno");
    // "132 mil millones": "mil"/"millones" detras de una cifra en digitos son
    // su unidad, no otro numero (daba "132 1000 millones").
    const afterDigits = (w === "mil" || w === "millon" || w === "millones") && /\d\s*$/.test(tokens.slice(Math.max(0, i - 2), i).join(""));
    if (!parsed || article || afterDigits || (parsed.value < min && !parsed.millions)) {
      out.push(tokens[i]!);
      i += 1;
      continue;
    }
    const last = tokens[end]!;
    const millionsWord = parsed.millions ? ` ${plain(last) === "millon" ? "millón" : "millones"}` : "";
    out.push(`${format(parsed.value, tokens.slice(end + 1, end + 3).join(""))}${millionsWord}`);
    i = end + 1;
  }
  return out.join("");
}

// Los numeros que aparecen en un texto (en digitos o en letras), como valores.
export function numbersIn(text: string): number[] {
  const asDigits = numerizar(text, 0);
  return [...asDigits.matchAll(/\d[\d.,]*/g)].map((m) => Number(m[0].replace(/\.(?=\d{3}\b)/g, "").replace(",", "."))).filter((n) => Number.isFinite(n));
}
