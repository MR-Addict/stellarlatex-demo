import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const demoRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceDir = join(demoRoot, "node_modules", "pdfjs-dist", "cmaps");
const targetDir = join(demoRoot, "public", "pdfjs", "cmaps");

await mkdir(targetDir, { recursive: true });
await cp(sourceDir, targetDir, { recursive: true, force: true });

console.log("PDF.js packed CMaps are ready in public/pdfjs/cmaps.");
