import express from "express";
import router from "./routes";
import { db } from "./utils/dataGenerator";

const app = express();
const PORT = 3000;

// Middleware: parse incoming JSON request bodies
app.use(express.json());

// Register all API routes
app.use("/", router);

// Start the server
// The db import above triggers data generation at module load time,
// so the in-memory database is ready before the first request arrives.
app.listen(PORT, () => {
  console.log(`\n🏥  Mock FSE Backend running on http://localhost:${PORT}`);
  console.log(`   Patients loaded : ${db.patients.length}`);
  console.log(`   Observations    : ${db.observations.length}`);
  console.log(`   Documents       : ${db.documentReferences.length}`);
  console.log("\n📡  Available endpoints:");
  console.log(`   GET  /api/Patient`);
  console.log(`   GET  /api/Patient/:id`);
  console.log(`   GET  /api/Observation?patientId=<id>`);
  console.log(`   GET  /api/DocumentReference?patientId=<id>`);
  console.log(`   POST /api/agent/query\n`);
});
