import { tool } from "langchain";
import { z } from "zod";
import { Patient } from "../../models/Patient";
import { lookupPatientByName, patientDisplayName } from "../patientResolver";
import { loadRetrievalConfigFromEnv, runRetrievalQuery, RetrievalConfig, RetrievedChunk } from "../../rag/retrieval";

function formatChunks(patientName: string, chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return `No matching clinical documents found for ${patientName}.`;
  }
  const lines = chunks.map((chunk, index) => `${index + 1}. (distance ${chunk.distance ?? "n/a"}) ${chunk.text}`);
  return `Document excerpts for ${patientName}:\n${lines.join("\n")}`;
}

// Pure: builds a patient-scoped retrieval config from an already-resolved
// patient. Extracted so the safety-critical patientId assignment — the
// mechanism that prevents this tool from ever searching another patient's
// documents — has direct unit-test coverage, not just coverage-by-composition
// with the rest of the handler.
export function buildPatientScopedRetrievalConfig(patient: Patient, query: string): RetrievalConfig {
  const config = loadRetrievalConfigFromEnv(query);
  config.patientId = patient.id;
  return config;
}

// Builds the vector-search tool bound to a specific Mock FSE base URL.
// Chroma Cloud / embedding configuration is loaded from the environment,
// same as `npm run retrieve`; patientId scoping (added in retrieval.ts) is
// always applied here so this tool can never search across patients.
export function buildQueryVectorDbTool(baseUrl: string) {
  return tool(
    async ({ patientName, query }: { patientName: string; query: string }): Promise<string> => {
      const lookup = await lookupPatientByName(baseUrl, patientName);
      if (lookup.status === "not_found") {
        return `No patient found matching '${patientName}'.`;
      }
      if (lookup.status === "ambiguous") {
        return `Multiple patients match '${patientName}'; please specify the full name.`;
      }
      const patient = lookup.patient;
      const config = buildPatientScopedRetrievalConfig(patient, query);
      const chunks = await runRetrievalQuery(config);
      const displayName = patientDisplayName(patient, patientName);
      return formatChunks(displayName, chunks);
    },
    {
      name: "query_vector_db",
      description:
        "Semantic search over a named patient's unstructured clinical narrative documents " +
        "(discharge letters, visit notes, anamnesis). Always requires a specific patient.",
      schema: z.object({
        patientName: z.string().describe("The patient's full name, as mentioned in the question"),
        query: z.string().describe("The natural-language search query"),
      }),
    }
  );
}
