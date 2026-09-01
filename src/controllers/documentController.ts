import { Request, Response } from "express";
import { db } from "../utils/dataGenerator";

// GET /api/DocumentReference?patientId=<uuid>
// Returns all unstructured clinical documents (narratives) for a given patient.
// These documents are the primary input for the RAG pipeline in the LangChain agent.
export const getDocumentsByPatient = async (req: Request, res: Response): Promise<void> => {
  try {
    const { patientId } = req.query;

    if (!patientId || typeof patientId !== "string") {
      res.status(400).json({ error: "Missing required query parameter: patientId." });
      return;
    }

    // Filter by the FHIR subject reference pattern "Patient/<id>"
    const results = db.documentReferences.filter(
      (d) => d.subject.reference === `Patient/${patientId}`
    );

    if (results.length === 0) {
      res.status(404).json({ error: `No documents found for patient '${patientId}'.` });
      return;
    }

    res.status(200).json({
      resourceType: "Bundle",
      total: results.length,
      // Each entry is the raw FHIR DocumentReference. The clinical narrative text
      // is stored base64-encoded in entry.content[0].attachment.data — the agent
      // should decode it with Buffer.from(data, "base64").toString("utf-8").
      entry: results,
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error." });
  }
};
