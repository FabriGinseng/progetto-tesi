import "dotenv/config";
import { createAgent } from "langchain";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { BaseMessage, isAIMessage, mergeUsageMetadata, UsageMetadata } from "@langchain/core/messages";
import { buildQueryFhirApiTool } from "./tools/fhirQueryTool";
import { buildQueryVectorDbTool } from "./tools/vectorQueryTool";

export interface AgentResult {
  answer: string;
  latencyMs: number;
  tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number };
  toolsUsed: string[];
}

export interface AgentConfig {
  baseUrl: string;
  chatModel: string;
}

// Builds the agent config from environment variables, mirroring
// loadConfigFromEnv/loadRetrievalConfigFromEnv in src/rag/.
export function loadAgentConfigFromEnv(): AgentConfig {
  return {
    baseUrl: process.env.MOCK_FSE_BASE_URL ?? "http://localhost:3000",
    chatModel: process.env.GOOGLE_CHAT_MODEL ?? "gemini-3.5-flash",
  };
}

// Pure: turns a finished agent run's message transcript into the metrics the
// thesis evaluation needs, minus latency (added by the real-wiring caller —
// timing belongs to the caller, not this pure summarization step). Uses
// LangChain's own isAIMessage/mergeUsageMetadata rather than hand-rolled
// summation across the (possibly multiple) LLM calls in one run.
export function summarizeMessages(messages: BaseMessage[]): Omit<AgentResult, "latencyMs"> {
  const toolNames = new Set<string>();
  let usage: UsageMetadata | undefined;
  let answer = "";

  for (const message of messages) {
    if (isAIMessage(message)) {
      for (const call of message.tool_calls ?? []) toolNames.add(call.name);
      usage = mergeUsageMetadata(usage, message.usage_metadata);
      const text = message.text;
      if (text.length > 0) {
        answer = text;
      }
    }
  }

  return {
    answer,
    tokenUsage: {
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
    },
    toolsUsed: [...toolNames],
  };
}

// Real wiring: builds a real Gemini chat model and the two real tools,
// invokes the agent, and times the whole run. Not unit-tested — exercised
// manually via `npm run agent` and the HTTP endpoint, same convention as
// runIngestion/runRetrievalQuery.
export async function runAgentQuery(question: string, config: AgentConfig): Promise<AgentResult> {
  const startedAt = Date.now();
  const chatModel = new ChatGoogleGenerativeAI({ model: config.chatModel });
  const agent = createAgent({
    model: chatModel,
    tools: [buildQueryFhirApiTool(config.baseUrl), buildQueryVectorDbTool(config.baseUrl)],
  });

  const result = await agent.invoke({
    messages: [{ role: "user", content: question }],
  });

  const summary = summarizeMessages(result.messages);
  return { ...summary, latencyMs: Date.now() - startedAt };
}
