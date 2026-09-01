import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { chunkDocumentReference, chunkDocumentReferences } from "../src/rag/chunking";
import { DocumentReference } from "../src/models/DocumentReference";

function buildDoc(id: string, patientId: string, text: string): DocumentReference {
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

describe("chunkDocumentReference", () => {
  test("splits long narrative text into multiple overlapping chunks, each tagged with patient/document metadata", async () => {
    const longText = "Sentence one about the patient. ".repeat(50);
    const doc = buildDoc("doc-1", "patient-1", longText);
    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 200, chunkOverlap: 20 });

    const chunks = await chunkDocumentReference(doc, splitter);

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk, index) => {
      expect(chunk.metadata.patientId).toBe("patient-1");
      expect(chunk.metadata.documentId).toBe("doc-1");
      expect(chunk.metadata.documentType).toBe("Anamnesis");
      expect(chunk.metadata.chunkIndex).toBe(index);
      expect(chunk.pageContent.length).toBeGreaterThan(0);
    });
  });

  test("short narrative text fits in a single chunk", async () => {
    const doc = buildDoc("doc-2", "patient-2", "Short note.");
    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 500, chunkOverlap: 50 });

    const chunks = await chunkDocumentReference(doc, splitter);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.metadata.chunkIndex).toBe(0);
  });
});

describe("chunkDocumentReferences", () => {
  test("flattens chunks across multiple documents while preserving each document's own patientId", async () => {
    const docs = [
      buildDoc("doc-1", "patient-1", "Note for patient one."),
      buildDoc("doc-2", "patient-2", "Note for patient two."),
    ];
    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 500, chunkOverlap: 50 });

    const chunks = await chunkDocumentReferences(docs, splitter);

    expect(chunks).toHaveLength(2);
    expect(chunks.map((c) => c.metadata.patientId)).toEqual(["patient-1", "patient-2"]);
  });
});
