import "dotenv/config";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { ChromaClient, CloudClient } from "chromadb";
import { ChunkMetadata } from "./chunking";

export interface QueryEmbedder {
  embedQuery(text: string): Promise<number[]>;
}

export interface RetrievalRow {
  id: string;
  document?: string | null;
  metadata?: ChunkMetadata | null;
  distance?: number | null;
}

export interface VectorStoreQueryCollection {
  query(args: {
    queryEmbeddings: number[][];
    nResults: number;
    include: ("documents" | "metadatas" | "distances")[];
    where?: Record<string, string | number | boolean>;
  }): Promise<{ rows(): RetrievalRow[][] }>;
}

export interface RetrievedChunk {
  id: string;
  text: string;
  patientId: string | undefined;
  documentId: string | undefined;
  distance: number | null;
}

export interface RetrievalConfig {
  queryText: string;
  topK: number;
  collectionName: string;
  embeddingModel: string;
  chromaHost?: string;
  chromaPort?: number;
  chromaApiKey?: string;
  chromaTenant?: string;
  chromaDatabase?: string;
  patientId?: string;
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Builds the retrieval config from a CLI-supplied query plus environment
// variables, mirroring ingestion.ts's loadConfigFromEnv. collectionName
// defaults to the same "fse_documents" collection ingestion.ts writes to.
export function loadRetrievalConfigFromEnv(queryText: string): RetrievalConfig {
  const config: RetrievalConfig = {
    queryText,
    topK: readNumberEnv("RAG_TOP_K", 5),
    collectionName: process.env.CHROMA_COLLECTION ?? "fse_documents",
    embeddingModel: process.env.GOOGLE_EMBEDDING_MODEL ?? "gemini-embedding-001",
  };
  if (process.env.CHROMA_HOST !== undefined) config.chromaHost = process.env.CHROMA_HOST;
  if (process.env.CHROMA_PORT !== undefined) {
    const parsedPort = Number(process.env.CHROMA_PORT);
    if (Number.isFinite(parsedPort)) config.chromaPort = parsedPort;
  }
  if (process.env.CHROMA_API_KEY !== undefined) config.chromaApiKey = process.env.CHROMA_API_KEY;
  if (process.env.CHROMA_TENANT !== undefined) config.chromaTenant = process.env.CHROMA_TENANT;
  if (process.env.CHROMA_DATABASE !== undefined) config.chromaDatabase = process.env.CHROMA_DATABASE;
  return config;
}

// Chroma Cloud (CloudClient) is used whenever an API key is configured;
// otherwise this falls back to a local/self-hosted Chroma server
// (ChromaClient) via host/port, matching the pipeline's original behavior.
function buildChromaClient(config: RetrievalConfig): ChromaClient {
  if (config.chromaApiKey !== undefined) {
    const cloudArgs: ConstructorParameters<typeof CloudClient>[0] = { apiKey: config.chromaApiKey };
    if (config.chromaTenant !== undefined) cloudArgs.tenant = config.chromaTenant;
    if (config.chromaDatabase !== undefined) cloudArgs.database = config.chromaDatabase;
    return new CloudClient(cloudArgs);
  }

  const clientArgs: ConstructorParameters<typeof ChromaClient>[0] = {};
  if (config.chromaHost !== undefined) clientArgs.host = config.chromaHost;
  if (config.chromaPort !== undefined) clientArgs.port = config.chromaPort;
  return new ChromaClient(clientArgs);
}

// Converts a Chroma query row (whose fields are optional depending on what
// was requested via `include`) into a fully-shaped RetrievedChunk for
// display, defaulting missing fields instead of propagating undefined
// through the rest of the pipeline.
function toRetrievedChunk(row: RetrievalRow): RetrievedChunk {
  return {
    id: row.id,
    text: row.document ?? "",
    patientId: row.metadata?.patientId,
    documentId: row.metadata?.documentId,
    distance: row.distance ?? null,
  };
}

// Embeds a natural-language query and returns the top-K most similar chunks.
// Kept free of any concrete Gemini/Chroma client so it can be unit-tested
// with fakes — mirrors the ingestion pipeline's DI pattern (embeddingStore.ts).
export async function runRetrievalPipeline(
  queryText: string,
  topK: number,
  queryEmbedder: QueryEmbedder,
  collection: VectorStoreQueryCollection,
  patientId?: string
): Promise<RetrievedChunk[]> {
  const queryEmbedding = await queryEmbedder.embedQuery(queryText);
  const queryArgs: Parameters<VectorStoreQueryCollection["query"]>[0] = {
    queryEmbeddings: [queryEmbedding],
    nResults: topK,
    include: ["documents", "metadatas", "distances"],
  };
  if (patientId !== undefined) queryArgs.where = { patientId };
  const result = await collection.query(queryArgs);

  const rows = result.rows()[0] ?? [];
  return rows.map(toRetrievedChunk);
}

// Real wiring: talks to a real Gemini embeddings model and a real running
// Chroma server/collection (the one populated by `npm run ingest`). Not
// unit-tested — exercised manually via `npm run retrieve`.
export async function runRetrievalQuery(config: RetrievalConfig): Promise<RetrievedChunk[]> {
  const embeddings = new GoogleGenerativeAIEmbeddings({ model: config.embeddingModel });

  const chromaClient = buildChromaClient(config);
  // embeddingFunction: null suppresses Chroma's attempt to construct its own
  // default embedding function — we always supply a pre-computed query
  // embedding ourselves, so Chroma never needs one.
  const collection = await chromaClient.getOrCreateCollection({
    name: config.collectionName,
    embeddingFunction: null,
  });

  // Collection.query() defaults its generic to the broad chromadb `Metadata`
  // type; explicitly instantiate it as ChunkMetadata via a thin adapter so
  // it satisfies the narrower VectorStoreQueryCollection interface above.
  const queryCollection: VectorStoreQueryCollection = {
    query: (args) => collection.query<ChunkMetadata>(args),
  };

  return runRetrievalPipeline(config.queryText, config.topK, embeddings, queryCollection, config.patientId);
}
