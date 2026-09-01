import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { runIngestionPipeline } from "../src/rag/ingestion";
import { EmbeddingsClient, VectorStoreCollection } from "../src/rag/embeddingStore";
import { DocumentReference } from "../src/models/DocumentReference";

function buildDocumentReference(
  id: string,
  patientId: string,
  text: string
): DocumentReference {
  return {
    id,
    resourceType: "DocumentReference",
    subject: { reference: `Patient/${patientId}` },
    date: "2024-01-01T00:00:00.000Z",
    type: {
      text: "Anamnesis",
      coding: [{ system: "http://loinc.org", code: "34133-9", display: "Anamnesis" }],
    },
    content: [
      {
        attachment: {
          title: "t",
          contentType: "text/plain",
          data: Buffer.from(text).toString("base64"),
        },
      },
    ],
  };
}

class FakeEmbeddings implements EmbeddingsClient {
  async embedDocuments(texts: string[]): Promise<number[][]> {
    return texts.map((_, i) => [i]);
  }
}

class FakeCollection implements VectorStoreCollection {
  public upsertCalls: Parameters<VectorStoreCollection["upsert"]>[0][] = [];
  async upsert(args: Parameters<VectorStoreCollection["upsert"]>[0]): Promise<void> {
    this.upsertCalls.push(args);
  }
}

describe("runIngestionPipeline", () => {
  test("chunks, embeds, and upserts every document, returning accurate metrics", async () => {
    const documents = [
      buildDocumentReference("doc-1", "patient-1", "Short narrative for patient one."),
      buildDocumentReference("doc-2", "patient-2", "Short narrative for patient two."),
    ];
    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 500, chunkOverlap: 50 });
    const embeddings = new FakeEmbeddings();
    const collection = new FakeCollection();

    const metrics = await runIngestionPipeline(documents, splitter, embeddings, collection);

    expect(metrics.documentCount).toBe(2);
    expect(metrics.chunkCount).toBe(2); // one short chunk per document at this chunk size
    expect(metrics.durationMs).toBeGreaterThanOrEqual(0);
    expect(collection.upsertCalls).toHaveLength(1);
    expect(collection.upsertCalls[0]?.ids).toEqual(["doc-1::chunk-0", "doc-2::chunk-0"]);
  });

  test("returns zero metrics when there are no documents to ingest", async () => {
    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 500, chunkOverlap: 50 });
    const embeddings = new FakeEmbeddings();
    const collection = new FakeCollection();

    const metrics = await runIngestionPipeline([], splitter, embeddings, collection);

    expect(metrics.documentCount).toBe(0);
    expect(metrics.chunkCount).toBe(0);
    expect(collection.upsertCalls).toHaveLength(0);
  });
});
