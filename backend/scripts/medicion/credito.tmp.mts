import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { getActiveProvider } from "../../src/lib/providers.js";
const p = await getActiveProvider("anthropic");
if (!p) { console.log("sin provider anthropic activo"); process.exit(1); }
const client = new Anthropic({ apiKey: p.api_key });
for (const model of ["claude-haiku-5-5", "claude-sonnet-5-5"]) {
  try {
    const r = await client.messages.create({ model, max_tokens: 1, messages: [{ role: "user", content: "ok" }] });
    console.log(model, "OK", r.usage.input_tokens);
  } catch (e) { console.log(model, "FALLA", (e as Error).message.slice(0, 200)); }
}
process.exit(0);
