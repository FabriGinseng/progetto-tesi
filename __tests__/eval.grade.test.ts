import { computeToolMatch, escapeCsvField, gradeStructured, toCsvRow, buildJudgePrompt } from "../src/eval/grade";
import { GradedResult } from "../src/eval/types";

describe("gradeStructured", () => {
  test("matches when the leading numeric value appears in the actual answer", () => {
    expect(gradeStructured("14.9 g/dL", "L'emoglobina più recente è 14.9 g/dL.")).toBe(true);
  });

  test("does not match when the value is absent", () => {
    expect(gradeStructured("14.9 g/dL", "Non ho trovato dati.")).toBe(false);
  });

  test("returns false for an empty expected answer", () => {
    expect(gradeStructured("", "anything")).toBe(false);
  });

  test("does not match when the expected number is only a substring of a longer number", () => {
    expect(gradeStructured("15 mg/dL", "Il valore rilevato è 115.8 mg/dL.")).toBe(false);
  });

  test("matches an Italian comma decimal against a period-formatted expected value", () => {
    expect(gradeStructured("14.1 g/dL", "il valore è di 14,1 g/dL")).toBe(true);
  });
});

describe("computeToolMatch", () => {
  test("is not applicable (true) when there is no expected tool", () => {
    expect(computeToolMatch(null, [])).toBe(true);
    expect(computeToolMatch(null, ["query_fhir_api"])).toBe(true);
  });

  test("passes when the expected tool is among those called, even with extras", () => {
    expect(computeToolMatch("query_fhir_api", ["query_fhir_api", "query_vector_db"])).toBe(true);
  });

  test("fails when the expected tool was never called", () => {
    expect(computeToolMatch("query_fhir_api", ["query_vector_db"])).toBe(false);
    expect(computeToolMatch("query_fhir_api", [])).toBe(false);
  });
});

describe("buildJudgePrompt", () => {
  test("includes the question, expected answer, and actual answer", () => {
    const prompt = buildJudgePrompt("Q?", "expected text", "actual text");
    expect(prompt).toContain("Q?");
    expect(prompt).toContain("expected text");
    expect(prompt).toContain("actual text");
    expect(prompt).toContain("YES");
    expect(prompt).toContain("NO");
  });
});

describe("escapeCsvField", () => {
  test("leaves plain fields unchanged", () => {
    expect(escapeCsvField("simple text")).toBe("simple text");
  });

  test("quotes and escapes fields containing commas, quotes, or newlines", () => {
    expect(escapeCsvField("a, b")).toBe('"a, b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("toCsvRow", () => {
  test("flattens actualTools and tokenUsage into the expected CSV columns", () => {
    const result: GradedResult = {
      id: "q-1",
      category: "structured",
      question: "Q?",
      expectedTool: "query_fhir_api",
      expectedAnswer: "127 mmHg",
      actualAnswer: "127 mmHg, rilevato ieri",
      actualTools: ["query_fhir_api", "query_vector_db"],
      tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      latencyMs: 1234,
      toolMatch: true,
      answerCorrect: true,
      gradingMethod: "substring",
    };

    const row = toCsvRow(result);

    expect(row).toBe(
      "q-1,structured,Q?,query_fhir_api,query_fhir_api; query_vector_db,true,127 mmHg,\"127 mmHg, rilevato ieri\",true,substring,1234,10,5,15"
    );
  });

  test("renders a null expectedTool as an empty field", () => {
    const result: GradedResult = {
      id: "q-2",
      category: "edge_case",
      question: "Q?",
      expectedTool: null,
      expectedAnswer: "No patient found",
      actualAnswer: "Non ho trovato il paziente.",
      actualTools: [],
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      latencyMs: 500,
      toolMatch: true,
      answerCorrect: true,
      gradingMethod: "llm-judge",
    };

    expect(toCsvRow(result).split(",")[3]).toBe("");
  });
});
