// Copies MediaPipe's WASM runtime from node_modules into public/ so the app serves it itself
// (no third-party CDN at runtime, and the files always match the installed package version).
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const dest = join(root, "public", "mediapipe", "wasm");

if (!existsSync(src)) {
  console.warn("[copy-mediapipe-wasm] @mediapipe/tasks-vision isn't installed; skipping.");
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
// FilesetResolver picks vision_wasm_internal.* (SIMD) or vision_wasm_nosimd_internal.*.
const files = readdirSync(src).filter((f) => f.startsWith("vision_wasm_internal") || f.startsWith("vision_wasm_nosimd_internal"));
for (const f of files) cpSync(join(src, f), join(dest, f));
console.log(`[copy-mediapipe-wasm] copied ${files.length} files to public/mediapipe/wasm`);
