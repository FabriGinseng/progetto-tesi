// FHIR simplified Observation resource interface.
// Represents structured clinical data (lab results, vital signs).
export interface ObservationCode {
  text: string; // Human-readable name of the exam (e.g. "Blood Glucose")
  coding: { system: string; code: string; display: string }[];
}

export interface ValueQuantity {
  value: number;
  unit: string;
}

export interface Observation {
  id: string;
  resourceType: "Observation";
  subject: { reference: string }; // e.g. "Patient/abc-123"
  code: ObservationCode;
  valueQuantity: ValueQuantity;
  effectiveDateTime: string; // ISO 8601 datetime
}
