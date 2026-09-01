import { Document } from "@langchain/core/documents";
import { upsertChunks, EmbeddingsClient, VectorStoreCollection } from "../src/rag/embeddingStore";
import { ChunkMetadata } from "../src/rag/chunking";

function buildChunk(overrides: Partial<ChunkMetadata> = {}): Document<ChunkMetadata> {
  return new Document<ChunkMetadata>({
    pageContent: "Chief complaint: chest pain.",
    metadata: {
      patientId: "p1",
      documentId: "d1",
      documentType: "Anamnesis",
      documentDate: "2024-01-01T00:00:00.000Z",
      chunkIndex: 0,
      ...overrides,
    },
  });
}

class FakeEmbeddings implements EmbeddingsClient {
  public receivedTexts: string[][] = [];
  async embedDocuments(texts: string[]): Promise<number[][]> {
    this.receivedTexts.push(texts);
    return texts.map((_, i) => [i, i + 1, i + 2]);
  }
}

class FakeCollection implements VectorStoreCollection {
  public upsertCalls: Parameters<VectorStoreCollection["upsert"]>[0][] = [];
  async upsert(args: Parameters<VectorStoreCollection["upsert"]>[0]): Promise<void> {
    this.upsertCalls.push(args);
  }
}

describe("upsertChunks", () => {
  test("embeds chunk text and upserts ids/embeddings/metadata/documents into the collection", async () => {
    const chunks = [buildChunk({ chunkIndex: 0 }), buildChunk({ chunkIndex: 1 })];
    const embeddings = new FakeEmbeddings();
    const collection = new FakeCollection();

    const result = await upsertChunks(chunks, embeddings, collection);

    expect(result.chunkCount).toBe(2);
    expect(collection.upsertCalls).toHaveLength(1);
    const call = collection.upsertCalls[0];
    expect(call?.ids).toEqual(["d1::chunk-0", "d1::chunk-1"]);
    expect(call?.embeddings).toEqual([
      [0, 1, 2],
      [1, 2, 3],
    ]);
    expect(call?.metadatas?.[0]?.patientId).toBe("p1");
    expect(call?.documents).toEqual(chunks.map((c) => c.pageContent));
  });

  test("skips embedding and upsert calls entirely when there are no chunks", async () => {
    const embeddings = new FakeEmbeddings();
    const collection = new FakeCollection();

    const result = await upsertChunks([], embeddings, collection);

    expect(result.chunkCount).toBe(0);
    expect(embeddings.receivedTexts).toHaveLength(0);
    expect(collection.upsertCalls).toHaveLength(0);
  });
});
