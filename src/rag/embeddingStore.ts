import { Document } from "@langchain/core/documents";
import { ChunkMetadata } from "./chunking";

// Minimal structural interfaces (rather than importing the concrete Gemini/
// Chroma classes) so tests can inject lightweight fakes without hitting the
// network. A real GoogleGenerativeAIEmbeddings / chromadb Collection instance
// satisfies these structurally.
export interface EmbeddingsClient {
  embedDocuments(texts: string[]): Promise<number[][]>;
}

export interface VectorStoreCollection {
  upsert(args: {
    ids: string[];
    embeddings: number[][];
    metadatas: Record<string, string | number | boolean>[];
    documents: string[];
  }): Promise<void>;
}

export interface UpsertChunksResult {
  chunkCount: number;
}

// Builds a Chroma-safe, globally unique id per chunk. documentId is unique
// per FHIR DocumentReference, so pairing it with the chunk's local index is
// sufficient without a separate UUID generator.
function buildChunkId(metadata: ChunkMetadata): string {
  return `${metadata.documentId}::chunk-${metadata.chunkIndex}`;
}

// Embeds every chunk's text and upserts it into the vector store, tagged
// with the metadata needed to scope retrieval to a single patient.
export async function upsertChunks(
  chunks: Document<ChunkMetadata>[],
  embeddings: EmbeddingsClient,
  collection: VectorStoreCollection
): Promise<UpsertChunksResult> {
  if (chunks.length === 0) {
    return { chunkCount: 0 };
  }

  const texts = chunks.map((chunk) => chunk.pageContent);
  const vectors = await embeddings.embedDocuments(texts);

  await collection.upsert({
    ids: chunks.map((chunk) => buildChunkId(chunk.metadata)),
    embeddings: vectors,
    metadatas: chunks.map((chunk) => ({ ...chunk.metadata })),
    documents: texts,
  });

  return { chunkCount: chunks.length };
}
