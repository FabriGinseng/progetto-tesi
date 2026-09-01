import { Patient } from "../models/Patient";
import { DocumentReference } from "../models/DocumentReference";

interface Bundle<T> {
  resourceType: "Bundle";
  total: number;
  entry: T[];
}

export async function fetchPatients(baseUrl: string): Promise<Patient[]> {
  const res = await fetch(`${baseUrl}/api/Patient`);
  if (!res.ok) {
    throw new Error(`Failed to fetch patients from ${baseUrl}/api/Patient: HTTP ${res.status}`);
  }
  const bundle = (await res.json()) as Bundle<Patient>;
  return bundle.entry;
}

async function fetchDocumentsForPatient(baseUrl: string, patientId: string): Promise<DocumentReference[]> {
  const res = await fetch(`${baseUrl}/api/DocumentReference?patientId=${encodeURIComponent(patientId)}`);
  // documentController.ts returns 404 when a patient has no documents — that's
  // a valid, expected outcome for ingestion, not a failure.
  if (res.status === 404) {
    return [];
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch documents for patient '${patientId}': HTTP ${res.status}`);
  }
  const bundle = (await res.json()) as Bundle<DocumentReference>;
  return bundle.entry;
}

// Fetches every DocumentReference across every patient in the Mock FSE. This
// mimics an ETL job pulling from a real regional FHIR gateway one patient at
// a time, since the Mock FSE has no "get all documents" endpoint.
export async function fetchAllDocumentReferences(baseUrl: string): Promise<DocumentReference[]> {
  const patients = await fetchPatients(baseUrl);
  const documentsByPatient = await Promise.all(
    patients.map((patient) => fetchDocumentsForPatient(baseUrl, patient.id))
  );
  return documentsByPatient.flat();
}
