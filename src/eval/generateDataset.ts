import * as fs from "fs";
import * as path from "path";
import { db } from "../utils/dataGenerator";
import { decodeDocumentText } from "../rag/textDecoding";
import { Patient } from "../models/Patient";
import { DatasetEntry } from "./types";

const ALL_EXAM_TYPES = [
  "Blood Glucose",
  "Blood Pressure",
  "Total Cholesterol",
  "Hemoglobin",
  "Blood Urea Nitrogen",
];

const SECTION_LABELS = [
  "Chief complaint:",
  "Medical history:",
  "Physical examination:",
  "Assessment and plan:",
] as const;

type SectionLabel = (typeof SECTION_LABELS)[number];

const SECTION_QUESTIONS: Record<SectionLabel, string> = {
  "Chief complaint:":
    'Qual era il motivo principale della visita del paziente {name} secondo il referto "{docType}" del {date}?',
  "Medical history:":
    'Qual è la storia clinica del paziente {name} secondo il referto "{docType}" del {date}?',
  "Physical examination:":
    'Quali sono stati i risultati dell\'esame obiettivo del paziente {name} secondo il referto "{docType}" del {date}?',
  "Assessment and plan:":
    'Qual è il piano di trattamento per il paziente {name} secondo il referto "{docType}" del {date}?',
};

export function patientFullName(patient: Patient): string {
  const name = patient.name[0];
  return name ? `${name.given.join(" ")} ${name.family}`.trim() : "Unknown";
}

// Extracts one labeled section's exact sentence from a decoded document's
// narrative text. The four section labels and their fixed template are
// confirmed directly against dataGenerator.ts's document-generation code.
export function extractSection(text: string, label: SectionLabel): string {
  const startIndex = text.indexOf(label);
  if (startIndex === -1) {
    throw new Error(`Section label '${label}' not found in document text.`);
  }
  const afterLabel = text.slice(startIndex + label.length).trim();
  const nextLabelIndex = SECTION_LABELS.map((otherLabel) => afterLabel.indexOf(otherLabel))
    .filter((index) => index !== -1)
    .sort((a, b) => a - b)[0];
  const section = nextLabelIndex === undefined ? afterLabel : afterLabel.slice(0, nextLabelIndex);
  return section.trim();
}

function buildStructuredEntries(): DatasetEntry[] {
  const entries: DatasetEntry[] = [];

  for (const patient of db.patients) {
    const observations = db.observations.filter(
      (obs) => obs.subject.reference === `Patient/${patient.id}`
    );
    if (observations.length === 0) continue;

    const mostRecent = [...observations].sort(
      (a, b) => new Date(b.effectiveDateTime).getTime() - new Date(a.effectiveDateTime).getTime()
    )[0];
    if (!mostRecent) continue;

    const name = patientFullName(patient);
    entries.push({
      id: `structured-${entries.length + 1}`,
      category: "structured",
      question: `Qual è stata l'ultima misurazione di ${mostRecent.code.text} per il paziente ${name}?`,
      expectedTool: "query_fhir_api",
      expectedAnswer: `${mostRecent.valueQuantity.value} ${mostRecent.valueQuantity.unit}`,
      patientName: name,
    });
  }

  return entries;
}

function buildNarrativeEntries(): DatasetEntry[] {
  const entries: DatasetEntry[] = [];

  db.documentReferences.forEach((doc, index) => {
    const patientId = doc.subject.reference.replace("Patient/", "");
    const patient = db.patients.find((p) => p.id === patientId);
    if (!patient) return;

    const text = decodeDocumentText(doc);
    const label = SECTION_LABELS[index % SECTION_LABELS.length];
    if (!label) return;
    const section = extractSection(text, label);
    const name = patientFullName(patient);
    const documentDate = doc.date.split("T")[0] ?? doc.date;

    entries.push({
      id: `narrative-${entries.length + 1}`,
      category: "narrative",
      question: SECTION_QUESTIONS[label]
        .replace("{name}", name)
        .replace("{docType}", doc.type.text)
        .replace("{date}", documentDate),
      expectedTool: "query_vector_db",
      expectedAnswer: section,
      patientName: name,
    });
  });

  return entries;
}

// Finds a given/family name word shared by 2+ seeded patients, so the
// ambiguous-name edge case is guaranteed correct by construction against
// the actual data rather than assumed.
export function findSharedNameWord(patients: Patient[]): string | undefined {
  const wordCounts = new Map<string, number>();
  for (const patient of patients) {
    const name = patient.name[0];
    if (!name) continue;
    for (const word of [...name.given, name.family]) {
      const key = word.toLowerCase();
      wordCounts.set(key, (wordCounts.get(key) ?? 0) + 1);
    }
  }
  for (const [word, count] of wordCounts) {
    if (count >= 2) return word;
  }
  return undefined;
}

function buildEdgeCaseEntries(): DatasetEntry[] {
  const entries: DatasetEntry[] = [];

  const sharedWord = findSharedNameWord(db.patients);
  if (sharedWord) {
    entries.push({
      id: "edge-ambiguous",
      category: "edge_case",
      question: `Qual è la pressione del paziente ${sharedWord}?`,
      expectedTool: null,
      expectedAnswer: "Multiple patients match",
    });
  }

  entries.push({
    id: "edge-not-found",
    category: "edge_case",
    question: "Qual è la pressione del paziente Zzyzx Nonexistent?",
    expectedTool: null,
    expectedAnswer: "No patient found",
  });

  const patientWithGap = db.patients.find((patient) => {
    const observedExams = new Set(
      db.observations
        .filter((obs) => obs.subject.reference === `Patient/${patient.id}`)
        .map((obs) => obs.code.text)
    );
    return ALL_EXAM_TYPES.some((exam) => !observedExams.has(exam));
  });

  if (patientWithGap) {
    const observedExams = new Set(
      db.observations
        .filter((obs) => obs.subject.reference === `Patient/${patientWithGap.id}`)
        .map((obs) => obs.code.text)
    );
    const missingExam = ALL_EXAM_TYPES.find((exam) => !observedExams.has(exam));
    if (missingExam) {
      const name = patientFullName(patientWithGap);
      entries.push({
        id: "edge-no-data",
        category: "edge_case",
        question: `Qual è stata l'ultima misurazione di ${missingExam} per il paziente ${name}?`,
        expectedTool: "query_fhir_api",
        expectedAnswer: "No observations found",
        patientName: name,
      });
    }
  }

  return entries;
}

function main(): void {
  const dataset: DatasetEntry[] = [
    ...buildStructuredEntries(),
    ...buildNarrativeEntries(),
    ...buildEdgeCaseEntries(),
  ];

  const outPath = path.join(__dirname, "dataset.json");
  fs.writeFileSync(outPath, JSON.stringify(dataset, null, 2));
  console.log(`Wrote ${dataset.length} entries to ${outPath}`);
}

if (require.main === module) {
  main();
}
