import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  StandardMessageStructure,
} from "@langchain/core/messages";
import { summarizeMessages } from "../src/agent/orchestrator";

describe("summarizeMessages", () => {
  test("collects unique tool names, merges token usage across all AI messages, and takes the last answer", () => {
    const messages = [
      new HumanMessage("What is the blood pressure of Mario Rossi?"),
      new AIMessage<StandardMessageStructure>({
        content: "",
        tool_calls: [{ name: "query_fhir_api", args: { patientName: "Mario Rossi" }, id: "call-1" }],
        usage_metadata: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
      }),
      new ToolMessage({ content: "120/80 mmHg on 2024-01-01", tool_call_id: "call-1" }),
      new AIMessage<StandardMessageStructure>({
        content: "The most recent blood pressure reading is 120/80 mmHg.",
        usage_metadata: { input_tokens: 150, output_tokens: 15, total_tokens: 165 },
      }),
    ];

    const result = summarizeMessages(messages);

    expect(result.answer).toBe("The most recent blood pressure reading is 120/80 mmHg.");
    expect(result.toolsUsed).toEqual(["query_fhir_api"]);
    expect(result.tokenUsage).toEqual({ inputTokens: 250, outputTokens: 35, totalTokens: 285 });
  });

  test("deduplicates repeated tool calls to the same tool", () => {
    const messages = [
      new AIMessage<StandardMessageStructure>({
        content: "",
        tool_calls: [{ name: "query_vector_db", args: { patientName: "A", query: "x" }, id: "call-1" }],
        usage_metadata: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      }),
      new ToolMessage({ content: "result A", tool_call_id: "call-1" }),
      new AIMessage<StandardMessageStructure>({
        content: "",
        tool_calls: [{ name: "query_vector_db", args: { patientName: "B", query: "y" }, id: "call-2" }],
        usage_metadata: { input_tokens: 12, output_tokens: 6, total_tokens: 18 },
      }),
      new ToolMessage({ content: "result B", tool_call_id: "call-2" }),
      new AIMessage<StandardMessageStructure>({
        content: "Final answer.",
        usage_metadata: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
      }),
    ];

    const result = summarizeMessages(messages);

    expect(result.toolsUsed).toEqual(["query_vector_db"]);
    expect(result.tokenUsage.totalTokens).toBe(61);
  });

  test("returns zeroed usage and empty answer/toolsUsed when there are no AI messages", () => {
    const result = summarizeMessages([new HumanMessage("hello")]);

    expect(result).toEqual({
      answer: "",
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      toolsUsed: [],
    });
  });
});
