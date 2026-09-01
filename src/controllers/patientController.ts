import { Request, Response } from "express";
import { db } from "../utils/dataGenerator";

// GET /api/Patient/:id
// Returns a single patient by their UUID. Returns 404 if no match is found.
export const getPatientById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const patient = db.patients.find((p) => p.id === id);

    if (!patient) {
      res.status(404).json({ error: `Patient with id '${id}' not found.` });
      return;
    }

    res.status(200).json(patient);
  } catch (error) {
    res.status(500).json({ error: "Internal server error." });
  }
};

// GET /api/Patient
// Returns the full list of patients. Useful for the agent to discover patient IDs.
export const getAllPatients = async (_req: Request, res: Response): Promise<void> => {
  try {
    res.status(200).json({
      resourceType: "Bundle",
      total: db.patients.length,
      entry: db.patients,
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error." });
  }
};
