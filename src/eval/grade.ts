import * as fs from "fs";
import * as path from "path";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { loadAgentConfigFromEnv } from "../agent/orchestrator";
import { GradedResult, RawResult } from "./types";

// Extracts the leading numeric token from an expected structured answer
// (e.g. "14.9" from "14.9 g/dL") and checks it appears in the actual
// answer. Safe for structured questions specifically because numbers/units
// pass through the agent's Italian phrasing untranslated — confirmed by
// observing real agent output throughout development. The decimal point is
// matched against either "." or "," since the agent answers in Italian and
// sometimes renders the same value with a comma decimal separator (e.g.
// "14,1" for an expected "14.1") — confirmed against a real batch run.
export function gradeStructured(expectedAnswer: string, actualAnswer: string): boolean {
  const expectedValue = expectedAnswer.split(" ")[0];
  if (!expectedValue) return false;
  const escaped = expectedValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\./g, "[.,]");
  return new RegExp(`\\b${escaped}\\b`).test(actualAnswer);
}

// true when there's no specific tool to check against (edge cases), or when
// the expected tool is among those the agent actually called — extra tools
// called on top are not a routing failure (project owner's ruling).
export function computeToolMatch(
  expectedTool: "query_fhir_api" | "query_vector_db" | null,
  actualTools: string[]
): boolean {
  if (expectedTool === null) return true;
  return actualTools.includes(expectedTool);
}

export function buildJudgePrompt(question: string, expectedAnswer: string, actualAnswer: string): string {
  return [
    "You are grading whether an AI assistant's answer is correct.",
    "Reply with exactly one word: YES or NO. No explanation.",
    "",
    `QUESTION: ${question}`,
    `EXPECTED (reference): ${expectedAnswer}`,
    `ACTUAL (to grade): ${actualAnswer}`,
    "",
    "Does ACTUAL correctly and faithfully address QUESTION given EXPECTED as the reference? " +
      "The wording, language, and level of detail may differ — judge the substance only.",
  ].join("\n");
}

export async function gradeWithLlmJudge(
  judge: ChatGoogleGenerativeAI,
  question: string,
  expectedAnswer: string,
  actualAnswer: string
): Promise<boolean> {
  const prompt = buildJudgePrompt(question, expectedAnswer, actualAnswer);
  const response = await judge.invoke(prompt);
  return response.text.trim().toUpperCase().startsWith("YES");
}

export function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsvRow(result: GradedResult): string {
  const fields = [
    result.id,
    result.category,
    result.question,
    result.expectedTool ?? "",
    result.actualTools.join("; "),
    String(result.toolMatch),
    result.expectedAnswer,
    result.actualAnswer,
    String(result.answerCorrect),
    result.gradingMethod,
    String(result.latencyMs),
    String(result.tokenUsage.inputTokens),
    String(result.tokenUsage.outputTokens),
    String(result.tokenUsage.totalTokens),
  ];
  return fields.map((field) => escapeCsvField(field)).join(",");
}

const CSV_HEADER =
  "id,category,question,expectedTool,actualTools,toolMatch,expectedAnswer,actualAnswer,answerCorrect,gradingMethod,latencyMs,inputTokens,outputTokens,totalTokens";

function findLatestRawFile(resultsDir: string): string {
  if (!fs.existsSync(resultsDir)) {
    throw new Error(`No results directory found at ${resultsDir}. Run \`npm run eval:run\` first.`);
  }
  const files = fs
    .readdirSync(resultsDir)
    .filter((name) => name.startsWith("raw-") && name.endsWith(".json"))
    .map((name) => ({ name, mtime: fs.statSync(path.join(resultsDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  const latest = files[0];
  if (!latest) {
    throw new Error(`No raw-*.json files found in ${resultsDir}. Run \`npm run eval:run\` first.`);
  }
  return path.join(resultsDir, latest.name);
}

async function gradeResults(results: RawResult[]): Promise<GradedResult[]> {
  const config = loadAgentConfigFromEnv();
  let judge: ChatGoogleGenerativeAI | undefined;
  const graded: GradedResult[] = [];

  for (const result of results) {
    if (result.error !== undefined) {
      graded.push({ ...result, toolMatch: false, answerCorrect: false, gradingMethod: "error" });
      continue;
    }

    const toolMatch = computeToolMatch(result.expectedTool, result.actualTools);

    if (result.category === "structured") {
      const answerCorrect = gradeStructured(result.expectedAnswer, result.actualAnswer);
      graded.push({ ...result, toolMatch, answerCorrect, gradingMethod: "substring" });
    } else {
      if (!judge) {
        judge = new ChatGoogleGenerativeAI({ model: config.chatModel, temperature: 0 });
      }
      const answerCorrect = await gradeWithLlmJudge(
        judge,
        result.question,
        result.expectedAnswer,
        result.actualAnswer
      );
      graded.push({ ...result, toolMatch, answerCorrect, gradingMethod: "llm-judge" });
    }
  }

  return graded;
}

if (require.main === module) {
  (async () => {
    try {
      const resultsDir = path.join(__dirname, "results");
      const rawPath = process.argv[2] ?? findLatestRawFile(resultsDir);
      const results: RawResult[] = JSON.parse(fs.readFileSync(rawPath, "utf-8"));
      const graded = await gradeResults(results);
      const rows = [CSV_HEADER, ...graded.map((result) => toCsvRow(result))];
      const outPath = path.join(resultsDir, `graded-${Date.now()}.csv`);
      // Leading BOM so Excel opens the Italian (accented) text as UTF-8
      // instead of mojibake-ing it under a locale-default encoding.
      fs.writeFileSync(outPath, "﻿" + rows.join("\n"));
      console.log(`Graded ${graded.length} results from ${rawPath}`);
      console.log(`Wrote ${outPath}`);
    } catch (error: unknown) {
      console.error("Grading failed:", error);
      process.exitCode = 1;
    }
  })();
}
