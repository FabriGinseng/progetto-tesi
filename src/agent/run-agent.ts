import { loadAgentConfigFromEnv, runAgentQuery } from "./orchestrator";

// Manual verification script (not part of the automated test suite): ask
// the agent a question and print the full AgentResult. Usage:
//   npm run agent -- "Qual è l'ultima pressione di Mario Rossi?"
const DEFAULT_QUESTION = "Qual è stata l'ultima misurazione della pressione del paziente Mario Rossi?";

if (require.main === module) {
  const question = process.argv[2] ?? DEFAULT_QUESTION;
  const config = loadAgentConfigFromEnv();

  runAgentQuery(question, config)
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error: unknown) => {
      console.error("Agent query failed:", error);
      process.exitCode = 1;
    });
}
