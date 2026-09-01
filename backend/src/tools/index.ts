import { registerTool } from "./toolRegistry.js";
import { generateScriptTool } from "./generateScript.tool.js";
import { generateScriptStyleTool } from "./generateScriptStyle.tool.js";
import { generateVoiceTool } from "./generateVoice.tool.js";
import { transcribeAudioTool } from "./transcribeAudio.tool.js";
import { searchStockTool } from "./searchStock.tool.js";
import { generateImageTool } from "./generateImage.tool.js";
import { generateVideoTool } from "./generateVideo.tool.js";
import { generateOverlayTool } from "./generateOverlay.tool.js";
import { renderVideoTool } from "./renderVideo.tool.js";
import { buildTimelineTool } from "./buildTimeline.tool.js";

export { runTool, listTools, getTool } from "./toolRegistry.js";
export type { ToolContext, ToolDefinition } from "./tool.types.js";
export { ProviderNotConfiguredError } from "./tool.errors.js";

registerTool(generateScriptTool);
registerTool(generateScriptStyleTool);
registerTool(generateVoiceTool);
registerTool(transcribeAudioTool);
registerTool(searchStockTool);
registerTool(generateImageTool);
registerTool(generateVideoTool);
registerTool(generateOverlayTool);
registerTool(renderVideoTool);
registerTool(buildTimelineTool);
