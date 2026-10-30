// Crea o actualiza en Claude Platform los agentes del director de escenas y
// guarda sus IDs en src/director/managedAgents.config.ts. Correrlo una vez, y
// de nuevo cuando cambien los prompts o las herramientas (crea una version
// nueva del agente).
//   npx tsx scripts/setup-managed-agents.ts
import "dotenv/config";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { getActiveProvider } from "../src/lib/providers.js";
import { MANAGED_AGENTS } from "../src/director/managedAgents.config.js";
import { designerAgentConfig, directorAgentConfig } from "../src/director/managedSceneDirector.js";

const provider = await getActiveProvider("anthropic");
if (!provider?.api_key) throw new Error("No hay proveedor anthropic activo");
const client = new Anthropic({ apiKey: provider.api_key });

async function upsert(id: string, config: ReturnType<typeof designerAgentConfig> & { multiagent?: Anthropic.Beta.Sessions.BetaManagedAgentsMultiagentParams }) {
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

const designer = await upsert(MANAGED_AGENTS.designerAgentId, designerAgentConfig());
const director = await upsert(MANAGED_AGENTS.directorAgentId, {
  ...directorAgentConfig(),
  multiagent: { type: "coordinator", agents: [{ type: "agent", id: designer.id, version: designer.version }] },
});

const here = path.dirname(fileURLToPath(import.meta.url));
writeFileSync(
  path.join(here, "../src/director/managedAgents.config.ts"),
  `// IDs de los agentes en Claude Platform (Managed Agents). Los escribe
// scripts/setup-managed-agents.ts; no son secretos. Sin IDs, el director de
// escenas corre con el esquema paso a paso de sceneDirector.ts.
export const MANAGED_AGENTS = {
  directorAgentId: "${director.id}",
  designerAgentId: "${designer.id}",
  environmentId: "${environmentId}",
};
`
);
console.log(`director ${director.id} v${director.version} · disenador ${designer.id} v${designer.version} · entorno ${environmentId}`);
process.exit(0);
