import * as fs from "fs";
import * as path from "path";
import { loadAgentConfigFromEnv, runAgentQuery } from "../agent/orchestrator";
import { DatasetEntry, RawResult } from "./types";

function parseIntArg(flag: string): number | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  const raw = process.argv[index + 1];
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`Warning: ignoring invalid value for ${flag}: '${raw}'`);
    return undefined;
  }
  return parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sends every dataset entry through the real agent, sequentially and with a
// pause between calls — the free-tier Gemini quota has a real
// requests-per-minute cap, confirmed by hitting it during earlier
// development, so this deliberately does not run in parallel. Writes
// `outPath` after every entry (not just at the end) so a partially
// completed batch — realistic given the free tier's ~20 requests/day cap
// for a ~39-entry dataset — never loses already-completed results to an
// interruption or crash.
export async function runEvalBatch(
  entries: DatasetEntry[],
  delayMs: number,
  outPath: string
): Promise<RawResult[]> {
  const config = loadAgentConfigFromEnv();
  const results: RawResult[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;

    try {
      const result = await runAgentQuery(entry.question, config);
      results.push({
        ...entry,
        actualAnswer: result.answer,
        actualTools: result.toolsUsed,
        tokenUsage: result.tokenUsage,
        latencyMs: result.latencyMs,
      });
      console.log(`[${results.length}/${entries.length}] ${entry.id} (${entry.category}) done`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        ...entry,
        actualAnswer: "",
        actualTools: [],
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        latencyMs: 0,
        error: message,
      });
      console.log(`[${results.length}/${entries.length}] ${entry.id} (${entry.category}) FAILED: ${message}`);
    }

    fs.writeFileSync(outPath, JSON.stringify(results, null, 2));

    if (delayMs > 0 && i < entries.length - 1) {
      await sleep(delayMs);
    }
  }

  return results;
}

if (require.main === module) {
  const limit = parseIntArg("--limit");
  const delayMs = parseIntArg("--delay-ms") ?? 1000;

  const datasetPath = path.join(__dirname, "dataset.json");
  const dataset: DatasetEntry[] = JSON.parse(fs.readFileSync(datasetPath, "utf-8"));
  const entries = limit !== undefined ? dataset.slice(0, limit) : dataset;

  const resultsDir = path.join(__dirname, "results");
  fs.mkdirSync(resultsDir, { recursive: true });
  const outPath = path.join(resultsDir, `raw-${Date.now()}.json`);

  runEvalBatch(entries, delayMs, outPath)
    .then((results) => {
      console.log(`\nWrote ${results.length} results to ${outPath}`);
    })
    .catch((error: unknown) => {
      console.error("Eval run failed:", error);
      process.exitCode = 1;
    });
}
