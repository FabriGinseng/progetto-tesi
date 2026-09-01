import * as http from "http";
import type { AddressInfo } from "net";
import { fetchObservationsForPatient } from "../src/agent/fetchObservations";

describe("fetchObservationsForPatient", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll((done) => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      res.setHeader("Content-Type", "application/json");

      if (url.pathname === "/api/Observation") {
        const patientId = url.searchParams.get("patientId");
        if (patientId === "p1") {
          res.writeHead(200);
          res.end(
            JSON.stringify({
              resourceType: "Bundle",
              total: 1,
              entry: [
                {
                  id: "obs-1",
                  resourceType: "Observation",
                  subject: { reference: "Patient/p1" },
                  code: { text: "Blood Pressure", coding: [] },
                  valueQuantity: { value: 120, unit: "mmHg" },
                  effectiveDateTime: "2024-01-01T00:00:00.000Z",
                },
              ],
            })
          );
          return;
        }
        if (patientId === "trigger-500") {
          res.writeHead(500);
          res.end(JSON.stringify({ error: "boom" }));
          return;
        }
        res.writeHead(404);
        res.end(JSON.stringify({ error: "No observations found" }));
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

  test("returns the patient's observations from the Bundle", async () => {
    const observations = await fetchObservationsForPatient(baseUrl, "p1");
    expect(observations).toHaveLength(1);
    expect(observations[0]?.code.text).toBe("Blood Pressure");
  });

  test("treats a 404 as no observations", async () => {
    const observations = await fetchObservationsForPatient(baseUrl, "p2");
    expect(observations).toEqual([]);
  });

  test("throws a descriptive error on other non-2xx statuses", async () => {
    await expect(fetchObservationsForPatient(baseUrl, "trigger-500")).rejects.toThrow();
  });
});
