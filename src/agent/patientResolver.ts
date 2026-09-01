import { Patient } from "../models/Patient";
import { fetchPatients } from "../rag/fetchDocuments";

// Splits a name into lowercase words for tolerant matching — handles
// "Mario Rossi", "Rossi", "Rossi Mario", extra whitespace, mixed case.
function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

// Scores every patient against the query name and returns every patient
// tied for the highest score (empty array if nothing matches at all).
// Shared by resolvePatientByName (single-best-match) and the
// ambiguity-aware lookupPatientByName (used by the agent tools).
function findTopMatches(patients: Patient[], name: string): Patient[] {
  const queryWords = new Set(nameWords(name));
  if (queryWords.size === 0) return [];

  let bestScore = 0;
  let bestMatches: Patient[] = [];

  for (const patient of patients) {
    const patientName = patient.name[0];
    if (!patientName) continue;
    const candidateWords = nameWords(`${patientName.given.join(" ")} ${patientName.family}`);
    const score = candidateWords.filter((word) => queryWords.has(word)).length;
    if (score === 0) continue;
    if (score > bestScore) {
      bestScore = score;
      bestMatches = [patient];
    } else if (score === bestScore) {
      bestMatches.push(patient);
    }
  }

  return bestMatches;
}

// Scores each patient by how many words of the query name match words in
// their given/family name, then returns the highest-scoring patient (ties
// broken by patient list order). Not a general fuzzy-matching library —
// good enough for this dataset size; typos are not specifically handled.
export function resolvePatientByName(patients: Patient[], name: string): Patient | undefined {
  return findTopMatches(patients, name)[0];
}

// Real wiring: fetches the full patient list and resolves by name to a
// single best guess.
export async function resolvePatientId(baseUrl: string, name: string): Promise<Patient | undefined> {
  const patients = await fetchPatients(baseUrl);
  return resolvePatientByName(patients, name);
}

export type PatientLookupResult =
  | { status: "found"; patient: Patient }
  | { status: "not_found" }
  | { status: "ambiguous"; candidates: Patient[] };

// Formats a patient's given+family name for display, falling back to the
// original query string if the patient somehow has no HumanName entry
// (defensive — callers only reach this after already resolving a patient,
// so this should be unreachable in practice, but noUncheckedIndexedAccess
// requires the guard).
export function patientDisplayName(patient: Patient, fallback: string): string {
  const patientName = patient.name[0];
  return patientName ? `${patientName.given.join(" ")} ${patientName.family}`.trim() : fallback;
}

// Real wiring: fetches the full patient list and resolves by name,
// distinguishing "no match" from "more than one equally-good match" so
// callers can ask for clarification instead of silently guessing a patient
// — critical for a system whose core safety property is per-patient
// isolation.
export async function lookupPatientByName(baseUrl: string, name: string): Promise<PatientLookupResult> {
  const patients = await fetchPatients(baseUrl);
  const matches = findTopMatches(patients, name);
  if (matches.length === 0) return { status: "not_found" };
  if (matches.length > 1) return { status: "ambiguous", candidates: matches };
  return { status: "found", patient: matches[0]! };
}
