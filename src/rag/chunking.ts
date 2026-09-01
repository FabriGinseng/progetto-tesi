import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { DocumentReference } from "../models/DocumentReference";
import { decodeDocumentText } from "./textDecoding";

// Flat, Chroma-compatible metadata attached to every chunk. Chroma metadata
// values must be scalars (string | number | boolean), so nested FHIR
// structures (subject, type) are flattened here. The index signature is
// required for ChunkMetadata to satisfy chromadb's `Metadata` generic
// constraint when used as `Collection.query<ChunkMetadata>()` (Task 7) —
// LangChain's `Document<T>` constraint is looser and would work without it,
// but keeping one shape everywhere is simpler.
export interface ChunkMetadata {
  patientId: string;
  documentId: string;
  documentType: string;
  documentDate: string;
  chunkIndex: number;
  [key: string]: string | number;
}

function extractPatientId(doc: DocumentReference): string {
  return doc.subject.reference.replace("Patient/", "");
}

// Splits a single DocumentReference's narrative text into overlapping chunks,
// tagging every chunk with the metadata needed to prevent patient data leaks
// during retrieval — patientId is the critical isolation key.
export async function chunkDocumentReference(
  doc: DocumentReference,
  splitter: RecursiveCharacterTextSplitter
): Promise<Document<ChunkMetadata>[]> {
  const text = decodeDocumentText(doc);
  const chunkTexts = await splitter.splitText(text);

  return chunkTexts.map(
    (chunkText, index) =>
      new Document<ChunkMetadata>({
        pageContent: chunkText,
        metadata: {
          patientId: extractPatientId(doc),
          documentId: doc.id,
          documentType: doc.type.text,
          documentDate: doc.date,
          chunkIndex: index,
        },
      })
  );
}

// Chunks every DocumentReference in the corpus and flattens the result into
// a single list of chunks ready for embedding.
export async function chunkDocumentReferences(
  docs: DocumentReference[],
  splitter: RecursiveCharacterTextSplitter
): Promise<Document<ChunkMetadata>[]> {
  const chunkedPerDoc = await Promise.all(docs.map((doc) => chunkDocumentReference(doc, splitter)));
  return chunkedPerDoc.flat();
}
