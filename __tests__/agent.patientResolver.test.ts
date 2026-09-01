import * as http from "http";
import type { AddressInfo } from "net";
import { resolvePatientByName, resolvePatientId, lookupPatientByName } from "../src/agent/patientResolver";
import { Patient } from "../src/models/Patient";

function buildPatient(id: string, given: string[], family: string): Patient {
  return {
    id,
    resourceType: "Patient",
    name: [{ given, family }],
    gender: "unknown",
    birthDate: "1980-01-01",
  };
}

describe("resolvePatientByName", () => {
  const patients: Patient[] = [
    buildPatient("p1", ["Mario"], "Rossi"),
    buildPatient("p2", ["Anna"], "Bianchi"),
    buildPatient("p3", ["Mario"], "Bianchi"),
  ];

  test("matches on full given + family name", () => {
    expect(resolvePatientByName(patients, "Mario Rossi")?.id).toBe("p1");
  });

  test("matches on family name alone, breaking ties by list order", () => {
    expect(resolvePatientByName(patients, "Bianchi")?.id).toBe("p2");
  });

  test("matches regardless of word order", () => {
    expect(resolvePatientByName(patients, "Rossi Mario")?.id).toBe("p1");
  });

  test("prefers the patient with the higher word-match score", () => {
    expect(resolvePatientByName(patients, "Mario Bianchi")?.id).toBe("p3");
  });

  test("returns undefined when no patient matches any word", () => {
    expect(resolvePatientByName(patients, "Zelda Nowhere")).toBeUndefined();
  });

  test("returns undefined for an empty or whitespace-only query", () => {
    expect(resolvePatientByName(patients, "   ")).toBeUndefined();
  });

  test("skips patients with no HumanName entries without crashing", () => {
    const noName: Patient = {
      id: "p4",
      resourceType: "Patient",
      name: [],
      gender: "unknown",
      birthDate: "1980-01-01",
    };
    expect(resolvePatientByName([noName], "Mario Rossi")).toBeUndefined();
  });
});

describe("resolvePatientId", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll((done) => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      res.setHeader("Content-Type", "application/json");

      if (url.pathname === "/api/Patient") {
        res.writeHead(200);
        res.end(
          JSON.stringify({
            resourceType: "Bundle",
            total: 1,
            entry: [
              {
                id: "p1",
                resourceType: "Patient",
                name: [{ given: ["Mario"], family: "Rossi" }],
                gender: "male",
                birthDate: "1980-01-01",
              },
            ],
          })
        );
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://localhost:${port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  test("fetches the patient list and resolves the matching patient", async () => {
    const patient = await resolvePatientId(baseUrl, "Mario Rossi");
    expect(patient?.id).toBe("p1");
  });

  test("returns undefined when no patient matches", async () => {
    const patient = await resolvePatientId(baseUrl, "Nobody Here");
    expect(patient).toBeUndefined();
  });
});

describe("lookupPatientByName", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll((done) => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      res.setHeader("Content-Type", "application/json");

      if (url.pathname === "/api/Patient") {
        res.writeHead(200);
        res.end(
          JSON.stringify({
            resourceType: "Bundle",
            total: 3,
            entry: [
              {
                id: "p1",
                resourceType: "Patient",
                name: [{ given: ["Mario"], family: "Rossi" }],
                gender: "male",
                birthDate: "1980-01-01",
              },
              {
                id: "p2",
                resourceType: "Patient",
                name: [{ given: ["Anna"], family: "Bianchi" }],
                gender: "female",
                birthDate: "1980-01-01",
              },
              {
                id: "p3",
                resourceType: "Patient",
                name: [{ given: ["Mario"], family: "Bianchi" }],
                gender: "male",
                birthDate: "1980-01-01",
              },
            ],
          })
        );
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://localhost:${port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  test("returns status 'found' with the single matching patient", async () => {
    const result = await lookupPatientByName(baseUrl, "Mario Rossi");
    expect(result).toEqual({ status: "found", patient: expect.objectContaining({ id: "p1" }) });
  });

  test("returns status 'not_found' when no patient matches", async () => {
    const result = await lookupPatientByName(baseUrl, "Nobody Here");
    expect(result).toEqual({ status: "not_found" });
  });

  test("returns status 'ambiguous' with all tied candidates when the query matches multiple patients equally well", async () => {
    const result = await lookupPatientByName(baseUrl, "Bianchi");
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.candidates.map((p) => p.id).sort()).toEqual(["p2", "p3"]);
    }
  });
});
