import { decodeDocumentText } from "../src/rag/textDecoding";
import { DocumentReference } from "../src/models/DocumentReference";

function buildDoc(text: string): DocumentReference {
  return {
    id: "doc-1",
    resourceType: "DocumentReference",
    subject: { reference: "Patient/patient-1" },
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

describe("decodeDocumentText", () => {
  test("decodes base64 attachment data back to the original narrative text", () => {
    const doc = buildDoc("Chief complaint: chest pain.");
    expect(decodeDocumentText(doc)).toBe("Chief complaint: chest pain.");
  });

  test("throws a descriptive error when content[0].attachment is missing", () => {
    const doc = buildDoc("irrelevant");
    doc.content = [];
    expect(() => decodeDocumentText(doc)).toThrow("doc-1");
  });
});
