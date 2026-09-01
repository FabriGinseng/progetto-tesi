import { loadRetrievalConfigFromEnv, runRetrievalQuery } from "./retrieval";

// Manual verification script (not part of the automated test suite): run a
// natural-language query against the populated Chroma collection and print
// the top-K results so you can eyeball whether retrieval is actually
// semantically relevant before trusting it in the agent. Usage:
//   npm run retrieve -- "Quali sono le indicazioni per la terapia antipertensiva?"
const DEFAULT_QUERY = "Quali sono le indicazioni per la terapia antipertensiva?";

if (require.main === module) {
  const queryText = process.argv[2] ?? DEFAULT_QUERY;
  const config = loadRetrievalConfigFromEnv(queryText);

  runRetrievalQuery(config)
    .then((chunks) => {
      console.log(`Top ${chunks.length} results for: "${queryText}"\n`);
      chunks.forEach((chunk, index) => {
        console.log(
          `#${index + 1}  distance=${chunk.distance ?? "n/a"}  patient=${chunk.patientId ?? "?"}  document=${chunk.documentId ?? "?"}`
        );
        console.log(`    ${chunk.text}\n`);
      });
    })
    .catch((error: unknown) => {
      console.error("Retrieval query failed:", error);
      process.exitCode = 1;
    });
}
