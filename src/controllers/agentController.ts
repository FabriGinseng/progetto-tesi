import { Request, Response } from "express";
import { loadAgentConfigFromEnv, runAgentQuery } from "../agent/orchestrator";

// POST /api/agent/query
// Accepts a natural-language question and routes it through the LangGraph
// agent (FHIR structured-data tool + patient-scoped vector-search tool),
// returning the answer plus latency/token/tool-usage metrics for thesis
// evaluation.
export const postAgentQuery = async (req: Request, res: Response): Promise<void> => {
  try {
    const { question } = req.body as { question?: unknown };

    if (!question || typeof question !== "string") {
      res.status(400).json({ error: "Missing required body field: question." });
      return;
    }

    const result = await runAgentQuery(question, loadAgentConfigFromEnv());
    res.status(200).json(result);
  } catch (error) {
    console.error("Agent query failed:", error);
    res.status(500).json({ error: "Internal server error." });
  }
};
