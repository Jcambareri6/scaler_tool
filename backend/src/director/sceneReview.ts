import { readFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { mapWithConcurrency } from "../lib/concurrency.js";
import type { AnimatedPlan, AnimatedScene } from "./sceneDirector.js";
import type { Phrase } from "./phrases.js";

// Control de calidad con vista: un REVISOR mira capturas reales de cada escena
// contra lo que dice la voz, y un AUDITOR controla al revisor y al video
// entero. Son lo que no ve el verificador de codigo: si algo tiene sentido.

export const REVIEWER_MODEL = "claude-sonnet-5-5";
export const AUDITOR_MODEL = "claude-opus-5-5";
const REVIEW_CONCURRENCY = 6;
export const STILLS_PER_SCENE = 4;

export interface SceneVerdict {
  scene: string;
  approved: boolean;
  problems: string[];
}

export interface VideoAudit {
  missed: SceneVerdict[];
  wrong_rejections: string[];
  video_notes: string[];
}

const CRITERIA = `Controla en este orden:
1. SENTIDO: lo que se ve demuestra lo que dice la voz. Un recurso que decora y no explica es un error.
2. RECURSO CORRECTO: una linea de tiempo solo muestra 3 o mas hitos historicos con fecha, nunca "desde tal ano hasta hoy". Un versus enfrenta dos cantidades reales. Un mapa aparece cuando el lugar importa. Una cifra grande es un dato que impacta.
3. CLARIDAD: cada dibujo se reconoce sin explicacion.
4. COMPOSICION: nada cortado, pisado, vacio ni demasiado chico.
5. DATOS: ninguna cifra, fecha o nombre fuera del guion.
No apruebes por cortesia ni rechaces por gusto: cada problema dice que esta mal y que cambiar.`;

function imageBlock(file: string): Anthropic.ImageBlockParam {
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: readFileSync(file).toString("base64") } };
}

async function askJson<T>(client: Anthropic, model: string, system: string, content: Anthropic.ContentBlockParam[], usage: Record<string, number>): Promise<T> {
  const message = await client.messages.stream({ model, max_tokens: 8000, system, messages: [{ role: "user", content }] }).finalMessage();
  usage.input = (usage.input ?? 0) + message.usage.input_tokens;
  usage.output = (usage.output ?? 0) + message.usage.output_tokens;
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as T;
}

// Momentos que se capturan: repartidos en la escena, despues de su entrada.
export function stillRequests(scenes: AnimatedScene[]): { id: string; seconds: number }[] {
  return scenes.flatMap((scene) =>
    Array.from({ length: STILLS_PER_SCENE }, (_, i) => ({
      id: `${scene.id}-${i}`,
      seconds: scene.start + ((scene.end - scene.start) * (i + 0.7)) / STILLS_PER_SCENE,
    }))
  );
}

function voiceOf(scene: AnimatedScene, phrases: Phrase[]): string {
  return phrases
    .filter((p) => p.start < scene.end && p.end > scene.start)
    .map((p) => p.text)
    .join(" ");
}

export async function reviewScenes(client: Anthropic, plan: Pick<AnimatedPlan, "scenes">, phrases: Phrase[], stillsDir: string, usage: Record<string, number>): Promise<SceneVerdict[]> {
  const system = `Sos el REVISOR de un video animado. Recibis capturas de una escena, en orden, y lo que dice la voz durante esa escena.

${CRITERIA}

Responde solo con JSON: {"approved": true|false, "problems": ["..."]}`;
  const verdicts: SceneVerdict[] = [];
  await mapWithConcurrency(plan.scenes, REVIEW_CONCURRENCY, async (scene) => {
    const images = Array.from({ length: STILLS_PER_SCENE }, (_, i) => imageBlock(path.join(stillsDir, `${scene.id}-${i}.jpg`)));
    const verdict = await askJson<{ approved: boolean; problems: string[] }>(
      client,
      REVIEWER_MODEL,
      system,
      [...images, { type: "text", text: `Escena ${scene.id}. La voz dice: "${voiceOf(scene, phrases)}"` }],
      usage
    );
    verdicts.push({ scene: scene.id, approved: verdict.approved, problems: verdict.problems ?? [] });
  });
  return verdicts.sort((a, b) => Number(a.scene.slice(1)) - Number(b.scene.slice(1)));
}

export async function auditVideo(client: Anthropic, plan: Pick<AnimatedPlan, "scenes">, phrases: Phrase[], stillsDir: string, verdicts: SceneVerdict[], usage: Record<string, number>): Promise<VideoAudit> {
  const system = `Sos el AUDITOR de un video animado. Controlas al revisor: buscas lo que aprobo mal, marcas sus rechazos sin fundamento y miras el video entero.

${CRITERIA}

Tambien busca recursos repetidos y falta de coherencia entre escenas.

Responde solo con JSON: {"missed": [{"scene": "s3", "approved": false, "problems": ["..."]}], "wrong_rejections": ["s4"], "video_notes": ["..."]}`;
  const content: Anthropic.ContentBlockParam[] = [];
  for (const scene of plan.scenes) {
    const verdict = verdicts.find((v) => v.scene === scene.id);
    content.push(
      imageBlock(path.join(stillsDir, `${scene.id}-1.jpg`)),
      imageBlock(path.join(stillsDir, `${scene.id}-3.jpg`)),
      { type: "text", text: `Escena ${scene.id}. Voz: "${voiceOf(scene, phrases)}". Revisor: ${verdict?.approved ? "aprobada" : `rechazada (${verdict?.problems.join("; ")})`}` }
    );
  }
  return askJson<VideoAudit>(client, AUDITOR_MODEL, system, content, usage);
}
