// FHIR simplified DocumentReference resource interface.
// Represents unstructured clinical documents (discharge letters, visit notes, anamnesis).

// Each content item wraps an Attachment — the primary carrier of the clinical narrative text.
export interface DocumentReferenceAttachment {
  // 'title' is used as the human-readable label for the document
  title: string;
  // 'data' holds the base64-encoded narrative text — the RAG pipeline will decode this
  data: string;
  contentType: string; // MIME type, e.g. "text/plain"
}

export interface DocumentReferenceContent {
  attachment: DocumentReferenceAttachment;
}

export interface DocumentReferenceType {
  text: string;
  coding: { system: string; code: string; display: string }[];
}

export interface DocumentReference {
  id: string;
  resourceType: "DocumentReference";
  subject: { reference: string }; // e.g. "Patient/abc-123"
  date: string; // ISO 8601 datetime
  // 'type' is a CodeableConcept describing the document category
  type: DocumentReferenceType;
  // 'content' is an array of content items, each wrapping an Attachment
  // The free-text clinical narrative lives in content[0].attachment.data (base64)
  content: DocumentReferenceContent[];
}
