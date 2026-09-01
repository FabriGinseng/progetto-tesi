import { DocumentReference } from "../models/DocumentReference";

// FHIR Attachment.data is base64-encoded per spec; the RAG pipeline needs
// the raw narrative text to chunk and embed.
export function decodeDocumentText(doc: DocumentReference): string {
  const attachment = doc.content[0]?.attachment;
  if (!attachment) {
    throw new Error(`DocumentReference '${doc.id}' has no content[0].attachment to decode.`);
  }
  return Buffer.from(attachment.data, "base64").toString("utf-8");
}
