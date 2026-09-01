import { extractSection, findSharedNameWord, patientFullName } from "../src/eval/generateDataset";
import { Patient } from "../src/models/Patient";

function buildPatient(id: string, given: string[], family: string): Patient {
  return { id, resourceType: "Patient", name: [{ given, family }], gender: "unknown", birthDate: "1980-01-01" };
}

describe("extractSection", () => {
  const text =
    "Anamnesis for patient Mario Rossi, born 1980-01-01. " +
    "Chief complaint: chest pain and mild dyspnea on exertion. " +
    "Medical history: No significant prior medical history. " +
    "Physical examination: Blood pressure 120/80 mmHg, heart rate 70 bpm, SpO2 98%. " +
    "Assessment and plan: Referred to nephrology for further evaluation.";

  test("extracts the sentence for a middle section, stopping at the next label", () => {
    expect(extractSection(text, "Chief complaint:")).toBe("chest pain and mild dyspnea on exertion.");
  });

  test("extracts the sentence for the last section, running to the end of the text", () => {
    expect(extractSection(text, "Assessment and plan:")).toBe("Referred to nephrology for further evaluation.");
  });

  test("throws a descriptive error when the label is not present", () => {
    expect(() => extractSection("no labels here", "Chief complaint:")).toThrow("Chief complaint:");
  });
});

describe("patientFullName", () => {
  test("joins given and family name", () => {
    expect(patientFullName(buildPatient("p1", ["Mario"], "Rossi"))).toBe("Mario Rossi");
  });

  test("falls back to 'Unknown' when there is no HumanName entry", () => {
    const noName: Patient = { id: "p2", resourceType: "Patient", name: [], gender: "unknown", birthDate: "1980-01-01" };
    expect(patientFullName(noName)).toBe("Unknown");
  });
});

describe("findSharedNameWord", () => {
  test("returns a word shared by two or more patients", () => {
    const patients = [
      buildPatient("p1", ["Mario"], "Rossi"),
      buildPatient("p2", ["Anna"], "Bianchi"),
      buildPatient("p3", ["Mario"], "Bianchi"),
    ];
    const word = findSharedNameWord(patients);
    expect(word).toBeDefined();
    expect(["mario", "bianchi"]).toContain(word);
  });

  test("returns undefined when no name word repeats", () => {
    const patients = [buildPatient("p1", ["Mario"], "Rossi"), buildPatient("p2", ["Anna"], "Bianchi")];
    expect(findSharedNameWord(patients)).toBeUndefined();
  });
});
