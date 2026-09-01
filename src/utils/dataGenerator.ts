import { faker } from "@faker-js/faker";
import { Patient } from "../models/Patient";
import { Observation } from "../models/Observation";
import { DocumentReference } from "../models/DocumentReference";

// Fixed seed so every server start produces identical patients/observations/
// documents — required for the eval harness's ground-truth dataset
// (src/eval/dataset.json) to stay valid across restarts instead of
// referencing data that no longer exists.
faker.seed(20260815);

// --- Exam catalogue ---
// A fixed catalogue of common clinical exams ensures realistic, consistent
// Observation codes across patients (mimics real LOINC-coded panels).
const EXAM_CATALOGUE = [
  { code: "2339-0", display: "Blood Glucose", unit: "mg/dL", min: 70, max: 200 },
  { code: "55284-4", display: "Blood Pressure", unit: "mmHg", min: 80, max: 180 },
  { code: "2093-3", display: "Total Cholesterol", unit: "mg/dL", min: 120, max: 280 },
  { code: "718-7", display: "Hemoglobin", unit: "g/dL", min: 10, max: 18 },
  { code: "3094-0", display: "Blood Urea Nitrogen", unit: "mg/dL", min: 7, max: 50 },
];

// --- Document type catalogue ---
const DOCUMENT_TYPES = [
  "Discharge Summary",
  "Cardiology Visit Note",
  "General Practitioner Report",
  "Specialist Referral",
  "Anamnesis",
];

// --- Patient generator ---
function generatePatients(count: number): Patient[] {
  return Array.from({ length: count }, (): Patient => ({
    id: faker.string.uuid(),
    resourceType: "Patient",
    name: [
      {
        family: faker.person.lastName(),
        given: [faker.person.firstName()],
      },
    ],
    // faker.helpers.arrayElement ensures we only pick valid FHIR gender values
    gender: faker.helpers.arrayElement(["male", "female"] as const),
    // faker.date.birthdate generates a realistic birth date for adults
    birthDate: faker.date.birthdate({ min: 18, max: 90, mode: "age" })
      .toISOString()
      .split("T")[0] as string,
  }));
}

// --- Observation generator ---
// Creates 3-4 observations per patient, each from a different exam in the catalogue.
function generateObservations(patients: Patient[]): Observation[] {
  const observations: Observation[] = [];

  for (const patient of patients) {
    // Pick 3-4 random exams for each patient to simulate a partial exam history
    const selectedExams = faker.helpers.arrayElements(EXAM_CATALOGUE, { min: 3, max: 4 });

    for (const exam of selectedExams) {
      observations.push({
        id: faker.string.uuid(),
        resourceType: "Observation",
        subject: { reference: `Patient/${patient.id}` },
        code: {
          text: exam.display,
          coding: [
            {
              system: "http://loinc.org",
              code: exam.code,
              display: exam.display,
            },
          ],
        },
        valueQuantity: {
          // faker.number.float simulates a measurement within a clinically plausible range
          value: parseFloat(
            faker.number.float({ min: exam.min, max: exam.max, fractionDigits: 1 }).toFixed(1)
          ),
          unit: exam.unit,
        },
        // faker.date.past simulates an exam taken sometime in the last 2 years
        effectiveDateTime: faker.date.past({ years: 2 }).toISOString(),
      });
    }
  }

  return observations;
}

// --- DocumentReference generator ---
// Creates 1-2 clinical narrative documents per patient.
// The 'content' field is intentionally verbose to provide rich text for the RAG pipeline.
function generateDocumentReferences(patients: Patient[]): DocumentReference[] {
  const documents: DocumentReference[] = [];

  for (const patient of patients) {
    const patientName = `${patient.name[0]?.given[0] ?? "Patient"} ${patient.name[0]?.family ?? ""}`;
    const docCount = faker.number.int({ min: 1, max: 2 });

    for (let i = 0; i < docCount; i++) {
      const docType = faker.helpers.arrayElement(DOCUMENT_TYPES);

      // Build a multi-sentence clinical narrative to enrich the unstructured data corpus
      const content = [
        `${docType} for patient ${patientName}, born ${patient.birthDate}.`,
        `Chief complaint: ${faker.helpers.arrayElement([
          "chest pain and mild dyspnea on exertion",
          "persistent fatigue and dizziness",
          "elevated fasting glucose levels noted during routine checkup",
          "recurrent headaches and hypertension",
          "lower limb edema and reduced exercise tolerance",
        ])}.`,
        `Medical history: ${faker.helpers.arrayElement([
          "Known type 2 diabetes mellitus, currently managed with metformin.",
          "Arterial hypertension under ACE inhibitor therapy.",
          "No significant prior medical history.",
          "Previous myocardial infarction (5 years ago), on aspirin and statin.",
          "Chronic kidney disease stage 2, stable.",
        ])}`,
        `Physical examination: Blood pressure ${faker.number.int({ min: 110, max: 160 })}/${faker.number.int({ min: 70, max: 100 })} mmHg, heart rate ${faker.number.int({ min: 60, max: 100 })} bpm, SpO2 ${faker.number.int({ min: 95, max: 100 })}%.`,
        `Assessment and plan: ${faker.helpers.arrayElement([
          "Adjusted antihypertensive therapy; follow-up in 4 weeks.",
          "Ordered HbA1c and lipid panel; dietary counselling recommended.",
          "Echocardiography requested to assess cardiac function.",
          "Patient discharged in stable condition with outpatient follow-up.",
          "Referred to nephrology for further evaluation.",
        ])}`,
      ].join(" ");

      documents.push({
        id: faker.string.uuid(),
        resourceType: "DocumentReference",
        subject: { reference: `Patient/${patient.id}` },
        date: faker.date.past({ years: 3 }).toISOString(),
        // type must be a CodeableConcept (object with text + coding array), not a plain string
        type: {
          text: docType,
          coding: [
            {
              system: "http://loinc.org",
              code: "34133-9",
              display: docType,
            },
          ],
        },
        // content must be an array of DocumentReference_Content items.
        // The clinical narrative text is base64-encoded in attachment.data,
        // which is the format the FHIR Attachment type expects.
        content: [
          {
            attachment: {
              contentType: "text/plain",
              title: `${docType} — ${patientName}`,
              data: Buffer.from(content).toString("base64"),
            },
          },
        ],
      });
    }
  }

  return documents;
}

// --- In-memory database ---
// This object is populated once at server startup and shared across all controllers.
// It acts as the single source of truth for all mock FSE data.
const patients = generatePatients(15);
const observations = generateObservations(patients);
const documentReferences = generateDocumentReferences(patients);

export const db = {
  patients,
  observations,
  documentReferences,
};
