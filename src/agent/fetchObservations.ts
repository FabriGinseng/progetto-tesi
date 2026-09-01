import { Observation } from "../models/Observation";

interface Bundle<T> {
  resourceType: "Bundle";
  total: number;
  entry: T[];
}

// Fetches all Observations for a single patient. Mirrors fetchDocuments.ts's
// pattern: observationController.ts returns 404 when a patient has no
// observations — that's a valid "no data" outcome, not a failure.
export async function fetchObservationsForPatient(
  baseUrl: string,
  patientId: string
): Promise<Observation[]> {
  const res = await fetch(`${baseUrl}/api/Observation?patientId=${encodeURIComponent(patientId)}`);
  if (res.status === 404) {
    return [];
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch observations for patient '${patientId}': HTTP ${res.status}`);
  }
  const bundle = (await res.json()) as Bundle<Observation>;
  return bundle.entry;
}
