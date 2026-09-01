import * as http from "http";
import type { AddressInfo } from "net";
import { fetchAllDocumentReferences } from "../src/rag/fetchDocuments";

describe("fetchAllDocumentReferences", () => {
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
            total: 2,
            entry: [{ id: "p1" }, { id: "p2" }],
          })
        );
        return;
      }

      if (url.pathname === "/api/DocumentReference") {
        const patientId = url.searchParams.get("patientId");
        if (patientId === "p1") {
          res.writeHead(200);
          res.end(
            JSON.stringify({
              resourceType: "Bundle",
              total: 1,
              entry: [{ id: "doc-p1-a", subject: { reference: "Patient/p1" } }],
            })
          );
          return;
        }
        // Mimics documentController.ts: 404 when a patient has no documents.
        res.writeHead(404);
        res.end(JSON.stringify({ error: "No documents found" }));
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

  test("aggregates DocumentReferences across all patients, treating a 404 as no documents", async () => {
    const docs = await fetchAllDocumentReferences(baseUrl);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.id).toBe("doc-p1-a");
  });
});
