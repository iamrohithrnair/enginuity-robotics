// Bundles the browser simulation player into a minified standalone script.
 
 
import { rolldown } from "rolldown";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "public", "sim-viewer", "sim-viewer.js");
mkdirSync(path.dirname(out), { recursive: true });
const bundle = await rolldown({ input: path.join(root, "src", "viewer", "simViewer.ts"), platform: "browser", treeshake: true });
await bundle.write({ file: out, format: "iife", minify: true, comments: { legal: true }, banner: "/* Enginuity simulation player. Includes three.js (MIT License, Copyright 2010-2025 three.js authors). */" });
await bundle.close();
console.log(`wrote ${path.relative(root, out)}`);
