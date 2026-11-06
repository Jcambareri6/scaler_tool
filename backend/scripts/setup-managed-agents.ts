// Crea o actualiza en Claude Platform los agentes del director de escenas y
// guarda sus IDs en src/director/managedAgents.config.ts. Correrlo una vez, y
// de nuevo cuando cambien los prompts o las herramientas (crea una version
// nueva del agente).
//   npx tsx scripts/setup-managed-agents.ts
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { getActiveProvider } from "../src/lib/providers.js";
import { MANAGED_AGENTS } from "../src/director/managedAgents.config.js";
import { artistAgentConfig, designerAgentConfig, directorAgentConfig } from "../src/director/managedSceneDirector.js";

const provider = await getActiveProvider("anthropic");
if (!provider?.api_key) throw new Error("No hay proveedor anthropic activo");
const client = new Anthropic({ apiKey: provider.api_key });

type AgentConfig = ReturnType<typeof designerAgentConfig> | ReturnType<typeof artistAgentConfig> | ReturnType<typeof directorAgentConfig>;

const here = path.dirname(fileURLToPath(import.meta.url));

// Sube la skill de backend/skills/<nombre>: crea la version nueva si ya existe.
async function uploadSkill(name: string, id: string): Promise<string> {
  const file = await toFile(readFileSync(path.join(here, "../skills", name, "SKILL.md")), `${name}/SKILL.md`);
  if (id) {
    await client.beta.skills.versions.create(id, { files: [file] });
    return id;
  }
  return (await client.beta.skills.create({ display_name: `Skaler ${name}`, files: [file] })).id;
}

const skill = (id: string) => [{ type: "custom" as const, skill_id: id, version: "latest" }];
const visualSkill = await uploadSkill("direccion-visual", MANAGED_AGENTS.visualSkillId);
const drawingSkill = await uploadSkill("dibujo", MANAGED_AGENTS.drawingSkillId);
const animationSkill = await uploadSkill("animacion", MANAGED_AGENTS.animationSkillId);

async function upsert(id: string, config: AgentConfig & { multiagent?: null; skills: ReturnType<typeof skill> }) {
  if (!id) return client.beta.agents.create(config);
  const { version } = await client.beta.agents.retrieve(id);
  return client.beta.agents.update(id, { ...config, version });
}

const environmentId =
  MANAGED_AGENTS.environmentId ||
  (await client.beta.environments.create({
    name: "skaler-director-escenas",
    config: { type: "cloud", networking: { type: "limited", allow_package_managers: false, allow_mcp_servers: false } },
  })).id;

const designer = await upsert(MANAGED_AGENTS.designerAgentId, { ...designerAgentConfig(), skills: skill(animationSkill) });
const artist = await upsert(MANAGED_AGENTS.artistAgentId, { ...artistAgentConfig(), skills: skill(drawingSkill) });
// El reparto lo hace nuestro codigo: el director ya no es coordinador.
const director = await upsert(MANAGED_AGENTS.directorAgentId, { ...directorAgentConfig(), multiagent: null, skills: skill(visualSkill) });

writeFileSync(
  path.join(here, "../src/director/managedAgents.config.ts"),
  `// IDs de los agentes en Claude Platform (Managed Agents). Los escribe
// scripts/setup-managed-agents.ts; no son secretos. Sin IDs, el director de
// escenas corre con el esquema paso a paso de sceneDirector.ts.
export const MANAGED_AGENTS = {
  directorAgentId: "${director.id}",
  artistAgentId: "${artist.id}",
  designerAgentId: "${designer.id}",
  environmentId: "${environmentId}",
  visualSkillId: "${visualSkill}",
  drawingSkillId: "${drawingSkill}",
  animationSkillId: "${animationSkill}",
};
`
);
console.log(`director ${director.id} v${director.version} · dibujante ${artist.id} v${artist.version} · disenador ${designer.id} v${designer.version} · entorno ${environmentId}`);
process.exit(0);
