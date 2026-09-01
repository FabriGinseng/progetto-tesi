// FHIR simplified Patient resource interface.
// Represents a patient's demographic record in the FSE system.
export interface HumanName {
  family: string; // Last name
  given: string[]; // First name(s)
}

export interface Patient {
  id: string;
  resourceType: "Patient";
  name: HumanName[];
  gender: "male" | "female" | "other" | "unknown";
  birthDate: string; // ISO 8601 date: YYYY-MM-DD
}
