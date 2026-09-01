export type QuestionCategory = "structured" | "narrative" | "edge_case";

export interface DatasetEntry {
  id: string;
  category: QuestionCategory;
  question: string;
  expectedTool: "query_fhir_api" | "query_vector_db" | null;
  expectedAnswer: string;
  patientName?: string;
}

export interface RawResult extends DatasetEntry {
  actualAnswer: string;
  actualTools: string[];
  tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number };
  latencyMs: number;
  error?: string;
}

export interface GradedResult extends RawResult {
  toolMatch: boolean;
  answerCorrect: boolean;
  gradingMethod: "substring" | "llm-judge" | "error";
}
