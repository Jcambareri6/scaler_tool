import { registerTool } from "./toolRegistry.js";
import { generateScriptTool } from "./generateScript.tool.js";
import { generateScriptStyleTool } from "./generateScriptStyle.tool.js";
import { generateVoiceTool } from "./generateVoice.tool.js";
import { listVoicesTool } from "./listVoices.tool.js";
import { previewVoiceTool } from "./previewVoice.tool.js";
import { transcribeAudioTool } from "./transcribeAudio.tool.js";
import { searchStockTool } from "./searchStock.tool.js";
import { generateStockKeywordsTool } from "./generateStockKeywords.tool.js";
import { generateVisualContextTool } from "./generateVisualContext.tool.js";
import { generateVideoTool } from "./generateVideo.tool.js";
import { generateImagePromptSequenceTool } from "./generateImagePromptSequence.tool.js";
import { generateOverlayTool } from "./generateOverlay.tool.js";
import { planOverlaysTool } from "./planOverlays.tool.js";
import { renderVideoTool } from "./renderVideo.tool.js";
import { buildTimelineTool } from "./buildTimeline.tool.js";
import { buildScenesTool } from "./buildScenes.tool.js";

export { runTool, listTools, getTool } from "./toolRegistry.js";
export type { ToolContext, ToolDefinition } from "./tool.types.js";
export { ProviderNotConfiguredError, ToolUserError } from "./tool.errors.js";

registerTool(generateScriptTool);
registerTool(generateScriptStyleTool);
registerTool(generateVoiceTool);
registerTool(listVoicesTool);
registerTool(previewVoiceTool);
registerTool(transcribeAudioTool);
registerTool(searchStockTool);
registerTool(generateStockKeywordsTool);
registerTool(generateVisualContextTool);
// generate_video (SnapGen) se registra pero solo lo usan el pipeline y la
// regeneracion de escenas, y solo para admins (ver isAdmin en
// orchestrator.ts y scene.service.ts). Sus prompts salen de
// generate_image_prompt_sequence con target "video" (como los de Flow).
// generate_image y generate_video_prompt siguen sin registrarse.
registerTool(generateVideoTool);
registerTool(generateImagePromptSequenceTool);
registerTool(generateOverlayTool);
registerTool(planOverlaysTool);
registerTool(renderVideoTool);
registerTool(buildTimelineTool);
registerTool(buildScenesTool);
