// Render the social card for a stored run: `npx tsx scripts/og-preview.ts <runId> <out.png>`
import { readFile, writeFile } from "node:fs/promises";
import { renderOgPng } from "../server/og.js";
import type { Run } from "../shared/types.js";

const [runId, out = "og-preview.png"] = process.argv.slice(2);
if (!runId) throw new Error("usage: og-preview <runId> [out.png]");
const run = JSON.parse(await readFile(new URL(`../data/runs/${runId}.json`, import.meta.url), "utf8")) as Run;
await writeFile(out, await renderOgPng(run));
console.log(`wrote ${out}`);
