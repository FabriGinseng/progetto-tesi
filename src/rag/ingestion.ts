import "dotenv/config";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { ChromaClient, CloudClient } from "chromadb";
import { DocumentReference } from "../models/DocumentReference";
import { fetchAllDocumentReferences } from "./fetchDocuments";
import { chunkDocumentReferences } from "./chunking";
import { upsertChunks, EmbeddingsClient, VectorStoreCollection } from "./embeddingStore";

export interface IngestionConfig {
  baseUrl: string;
  chunkSize: number;
  chunkOverlap: number;
  collectionName: string;
  embeddingModel: string;
  chromaHost?: string;
  chromaPort?: number;
  chromaApiKey?: string;
  chromaTenant?: string;
  chromaDatabase?: string;
}

export interface IngestionMetrics {
  documentCount: number;
  chunkCount: number;
  durationMs: number;
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Builds the ingestion config from environment variables, applying sensible
// defaults so the pipeline runs against a local Mock FSE + local Chroma
// server out of the box (see .env.example).
export function loadConfigFromEnv(): IngestionConfig {
  const config: IngestionConfig = {
    baseUrl: process.env.MOCK_FSE_BASE_URL ?? "http://localhost:3000",
    chunkSize: readNumberEnv("RAG_CHUNK_SIZE", 500),
    chunkOverlap: readNumberEnv("RAG_CHUNK_OVERLAP", 50),
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
function buildChromaClient(config: IngestionConfig): ChromaClient {
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

// Pure orchestration: chunk already-fetched documents, embed them, and
// upsert into the vector store. Kept free of any concrete network client so
// it can be unit-tested with fakes. Returns metrics for thesis evaluation
// (corpus size, latency).
export async function runIngestionPipeline(
  documents: DocumentReference[],
  splitter: RecursiveCharacterTextSplitter,
  embeddings: EmbeddingsClient,
  collection: VectorStoreCollection
): Promise<IngestionMetrics> {
  const startedAt = Date.now();
  const chunks = await chunkDocumentReferences(documents, splitter);
  const { chunkCount } = await upsertChunks(chunks, embeddings, collection);

  return {
    documentCount: documents.length,
    chunkCount,
    durationMs: Date.now() - startedAt,
  };
}

// Real wiring: fetches from the live Mock FSE and talks to real Gemini /
// ChromaDB services. Not unit-tested — exercised manually via `npm run
// ingest` against a running Mock FSE (`npm run dev`) and a running Chroma
// server.
export async function runIngestion(config: IngestionConfig): Promise<IngestionMetrics> {
  const documents = await fetchAllDocumentReferences(config.baseUrl);

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
  });
  const embeddings = new GoogleGenerativeAIEmbeddings({ model: config.embeddingModel });

  const chromaClient = buildChromaClient(config);
  // Each ingestion run should fully refresh the collection rather than
  // accumulate orphaned chunks: DocumentReference IDs are freshly
  // randomized on every Mock FSE restart (see dataGenerator.ts), so a
  // second `npm run ingest` run would otherwise write entirely new chunk
  // IDs alongside stale ones from the previous run. Deleting first (a
  // no-op via .catch if the collection doesn't exist yet) keeps the
  // collection's contents in sync with the current Mock FSE dataset.
  await chromaClient.deleteCollection({ name: config.collectionName }).catch(() => {});
  // embeddingFunction: null suppresses Chroma's attempt to construct its own
  // default embedding function — we always supply pre-computed embeddings
  // ourselves via upsertChunks, so Chroma never needs one.
  const collection = await chromaClient.getOrCreateCollection({
    name: config.collectionName,
    embeddingFunction: null,
  });

  return runIngestionPipeline(documents, splitter, embeddings, collection);
}

if (require.main === module) {
  runIngestion(loadConfigFromEnv())
    .then((metrics) => {
      console.log("RAG ingestion complete:");
      console.log(`  Documents processed : ${metrics.documentCount}`);
      console.log(`  Chunks embedded     : ${metrics.chunkCount}`);
      console.log(`  Duration            : ${metrics.durationMs}ms`);
    })
    .catch((error: unknown) => {
      console.error("RAG ingestion failed:", error);
      process.exitCode = 1;
    });
}
