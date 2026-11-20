// Hoja rapida de YouTube (con red).   npx tsx scripts/tests/youtubeQuick.live.ts
import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import "dotenv/config";
const { youtubeQuickSheet } = await import("../../src/lib/youtubeSource.js");

const dir = await mkdtemp(path.join(os.tmpdir(), "quick-"));
const t0 = Date.now();
const sheet = await youtubeQuickSheet({ url: "https://www.youtube.com/watch?v=_U9sSBBubh8", external_id: "_U9sSBBubh8", video_seconds: 400, provider: "youtube", type: "VIDEO" } as never, dir, "t");
assert.ok(sheet, "sin hoja");
assert.deepEqual(sheet.times, [100, 200, 300]);
assert.ok((await stat(sheet.path)).size > 5000);
console.log(`hoja rapida: OK en ${Date.now() - t0} ms -> ${sheet.path}`);
