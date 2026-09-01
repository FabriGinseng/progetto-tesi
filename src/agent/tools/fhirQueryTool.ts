import { tool } from "langchain";
import { z } from "zod";
import { Observation } from "../../models/Observation";
import { lookupPatientByName, patientDisplayName } from "../patientResolver";
import { fetchObservationsForPatient } from "../fetchObservations";

const MAX_RESULTS = 10;

// Filters to observations whose exam name matches examType (case-insensitive
// substring match in either direction, against the catalogue's English
// labels), then sorts newest-first so "most recent" is always index 0.
export function selectObservations(observations: Observation[], examType?: string): Observation[] {
  const filtered = examType
    ? observations.filter((obs) => {
        const text = obs.code.text.toLowerCase();
        const query = examType.toLowerCase();
        return text.includes(query) || query.includes(text);
      })
    : observations;

  return [...filtered].sort(
    (a, b) => new Date(b.effectiveDateTime).getTime() - new Date(a.effectiveDateTime).getTime()
  );
}

function formatObservations(patientName: string, observations: Observation[]): string {
  if (observations.length === 0) {
    return `No observations found for ${patientName}.`;
  }
  const lines = observations.slice(0, MAX_RESULTS).map((obs, index) => {
    const date = obs.effectiveDateTime.split("T")[0];
    return `${index + 1}. ${date} — ${obs.code.text}: ${obs.valueQuantity.value} ${obs.valueQuantity.unit}`;
  });
  const truncationNote =
    observations.length > MAX_RESULTS ? ` (showing ${MAX_RESULTS} of ${observations.length})` : "";
  return `Observations for ${patientName} (most recent first)${truncationNote}:\n${lines.join("\n")}`;
}

// Builds the FHIR-query tool bound to a specific Mock FSE base URL.
export function buildQueryFhirApiTool(baseUrl: string) {
  return tool(
    async ({ patientName, examType }: { patientName: string; examType?: string }): Promise<string> => {
      const lookup = await lookupPatientByName(baseUrl, patientName);
      if (lookup.status === "not_found") {
        return `No patient found matching '${patientName}'.`;
      }
      if (lookup.status === "ambiguous") {
        return `Multiple patients match '${patientName}'; please specify the full name.`;
      }
      const patient = lookup.patient;
      const observations = await fetchObservationsForPatient(baseUrl, patient.id);
      const selected = selectObservations(observations, examType);
      const displayName = patientDisplayName(patient, patientName);
      return formatObservations(displayName, selected);
    },
    {
      name: "query_fhir_api",
      description:
        "Query structured FHIR observations (vital signs, lab results) for a named patient. " +
        "examType, if given, should be one of: Blood Glucose, Blood Pressure, Total Cholesterol, Hemoglobin, Blood Urea Nitrogen.",
      schema: z.object({
        patientName: z.string().describe("The patient's full name, as mentioned in the question"),
        examType: z.string().optional().describe("The type of exam to filter by, e.g. 'Blood Pressure'"),
      }),
    }
  );
}
