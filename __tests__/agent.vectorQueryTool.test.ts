import { buildPatientScopedRetrievalConfig } from "../src/agent/tools/vectorQueryTool";
import { Patient } from "../src/models/Patient";

describe("buildPatientScopedRetrievalConfig", () => {
  test("sets patientId on the config from the resolved patient, and preserves the query text", () => {
    const patient: Patient = {
      id: "patient-123",
      resourceType: "Patient",
      name: [{ given: ["Mario"], family: "Rossi" }],
      gender: "male",
      birthDate: "1980-01-01",
    };

    const config = buildPatientScopedRetrievalConfig(patient, "some clinical query");

    expect(config.patientId).toBe("patient-123");
    expect(config.queryText).toBe("some clinical query");
  });
});
