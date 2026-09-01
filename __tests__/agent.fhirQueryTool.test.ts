import { selectObservations } from "../src/agent/tools/fhirQueryTool";
import { Observation } from "../src/models/Observation";

function buildObservation(
  id: string,
  examName: string,
  value: number,
  unit: string,
  date: string
): Observation {
  return {
    id,
    resourceType: "Observation",
    subject: { reference: "Patient/p1" },
    code: { text: examName, coding: [{ system: "http://loinc.org", code: "x", display: examName }] },
    valueQuantity: { value, unit },
    effectiveDateTime: date,
  };
}

describe("selectObservations", () => {
  const observations: Observation[] = [
    buildObservation("o1", "Blood Pressure", 120, "mmHg", "2024-01-01T00:00:00.000Z"),
    buildObservation("o2", "Blood Pressure", 130, "mmHg", "2024-03-01T00:00:00.000Z"),
    buildObservation("o3", "Blood Glucose", 90, "mg/dL", "2024-02-01T00:00:00.000Z"),
  ];

  test("with no examType, returns all observations sorted newest-first", () => {
    const result = selectObservations(observations);
    expect(result.map((o) => o.id)).toEqual(["o2", "o3", "o1"]);
  });

  test("filters to observations matching examType (case-insensitive), still newest-first", () => {
    const result = selectObservations(observations, "blood pressure");
    expect(result.map((o) => o.id)).toEqual(["o2", "o1"]);
  });

  test("matches when examType is a substring of the catalogue label", () => {
    const result = selectObservations(observations, "pressure");
    expect(result.map((o) => o.id)).toEqual(["o2", "o1"]);
  });

  test("returns an empty array when examType matches nothing", () => {
    expect(selectObservations(observations, "cholesterol")).toEqual([]);
  });
});
