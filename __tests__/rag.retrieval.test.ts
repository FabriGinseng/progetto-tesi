import {
  runRetrievalPipeline,
  QueryEmbedder,
  VectorStoreQueryCollection,
  RetrievalRow,
} from "../src/rag/retrieval";

class FakeQueryEmbedder implements QueryEmbedder {
  public receivedQueries: string[] = [];
  async embedQuery(text: string): Promise<number[]> {
    this.receivedQueries.push(text);
    return [1, 2, 3];
  }
}

class FakeQueryCollection implements VectorStoreQueryCollection {
  public receivedArgs: Parameters<VectorStoreQueryCollection["query"]>[0][] = [];
  constructor(private readonly rows: RetrievalRow[]) {}
  async query(
    args: Parameters<VectorStoreQueryCollection["query"]>[0]
  ): Promise<{ rows(): RetrievalRow[][] }> {
    this.receivedArgs.push(args);
    const rows = this.rows;
    return { rows: () => [rows] };
  }
}

describe("runRetrievalPipeline", () => {
  test("embeds the query and returns top-K chunks ranked by the collection, mapped to RetrievedChunk", async () => {
    const embedder = new FakeQueryEmbedder();
    const collection = new FakeQueryCollection([
      {
        id: "doc-1::chunk-0",
        document: "Adjusted antihypertensive therapy; follow-up in 4 weeks.",
        metadata: {
          patientId: "patient-1",
          documentId: "doc-1",
          documentType: "Cardiology Visit Note",
          documentDate: "2024-01-01",
          chunkIndex: 0,
        },
        distance: 0.12,
      },
      {
        id: "doc-2::chunk-0",
        document: "Ordered HbA1c and lipid panel; dietary counselling recommended.",
        metadata: {
          patientId: "patient-2",
          documentId: "doc-2",
          documentType: "General Practitioner Report",
          documentDate: "2024-01-02",
          chunkIndex: 0,
        },
        distance: 0.45,
      },
    ]);

    const results = await runRetrievalPipeline(
      "Quali sono le indicazioni per la terapia antipertensiva?",
      2,
      embedder,
      collection
    );

    expect(embedder.receivedQueries).toEqual(["Quali sono le indicazioni per la terapia antipertensiva?"]);
    expect(collection.receivedArgs).toHaveLength(1);
    expect(collection.receivedArgs[0]?.nResults).toBe(2);
    expect(collection.receivedArgs[0]?.queryEmbeddings).toEqual([[1, 2, 3]]);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      id: "doc-1::chunk-0",
      text: "Adjusted antihypertensive therapy; follow-up in 4 weeks.",
      patientId: "patient-1",
      documentId: "doc-1",
      distance: 0.12,
    });
  });

  test("defaults missing document/metadata/distance fields instead of leaving them undefined", async () => {
    const embedder = new FakeQueryEmbedder();
    const collection = new FakeQueryCollection([{ id: "doc-3::chunk-0" }]);

    const results = await runRetrievalPipeline("any query", 1, embedder, collection);

    expect(results).toEqual([
      { id: "doc-3::chunk-0", text: "", patientId: undefined, documentId: undefined, distance: null },
    ]);
  });

  test("returns an empty array when the collection has no results", async () => {
    const embedder = new FakeQueryEmbedder();
    const collection = new FakeQueryCollection([]);

    const results = await runRetrievalPipeline("any query", 5, embedder, collection);

    expect(results).toEqual([]);
  });

  test("scopes the query to a single patient via a where clause when patientId is provided", async () => {
    const embedder = new FakeQueryEmbedder();
    const collection = new FakeQueryCollection([]);

    await runRetrievalPipeline("any query", 5, embedder, collection, "patient-1");

    expect(collection.receivedArgs).toHaveLength(1);
    expect(collection.receivedArgs[0]?.where).toEqual({ patientId: "patient-1" });
  });

  test("omits the where clause entirely when patientId is not provided", async () => {
    const embedder = new FakeQueryEmbedder();
    const collection = new FakeQueryCollection([]);

    await runRetrievalPipeline("any query", 5, embedder, collection);

    expect(collection.receivedArgs[0]?.where).toBeUndefined();
  });
});
