import { Request, Response } from "express";
import { db } from "../utils/dataGenerator";

// GET /api/Observation?patientId=<uuid>
// Filters and returns all Observations for a given patient ID.
// Returns 400 if the query parameter is missing, 404 if no observations exist for the patient.
export const getObservationsByPatient = async (req: Request, res: Response): Promise<void> => {
  try {
    const { patientId } = req.query;

    if (!patientId || typeof patientId !== "string") {
      res.status(400).json({ error: "Missing required query parameter: patientId." });
      return;
    }

    // Filter by the FHIR subject reference pattern "Patient/<id>"
    const results = db.observations.filter(
      (o) => o.subject.reference === `Patient/${patientId}`
    );

    if (results.length === 0) {
      res.status(404).json({ error: `No observations found for patient '${patientId}'.` });
      return;
    }

    res.status(200).json({
      resourceType: "Bundle",
      total: results.length,
      entry: results,
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error." });
  }
};
