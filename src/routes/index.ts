import { Router } from "express";
import { getAllPatients, getPatientById } from "../controllers/patientController";
import { getObservationsByPatient } from "../controllers/observationController";
import { getDocumentsByPatient } from "../controllers/documentController";
import { postAgentQuery } from "../controllers/agentController";

const router = Router();

// Patient endpoints
router.get("/api/Patient", getAllPatients);
router.get("/api/Patient/:id", getPatientById);

// Structured data endpoint (lab results, vital signs)
router.get("/api/Observation", getObservationsByPatient);

// Unstructured data endpoint (clinical narrative documents)
router.get("/api/DocumentReference", getDocumentsByPatient);

// Agent orchestrator endpoint (LangGraph agent with FHIR + vector search tools)
router.post("/api/agent/query", postAgentQuery);

export default router;
