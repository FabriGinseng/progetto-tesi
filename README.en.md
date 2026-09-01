# FSE Mock Backend — LLM Agent for Electronic Health Records

> 🇮🇹 Versione italiana: [README.md](./README.md)

Proof of Concept for a **Master's Thesis in Computer Engineering**: an autonomous LLM agent that queries a simulated Electronic Health Record (FSE — *Fascicolo Sanitario Elettronico*), choosing between structured API calls (FHIR) and semantic search over unstructured documents (RAG), via Tool Calling.

**Thesis title:** *Implementation and Analysis of LLM Agents for Electronic Health Record (EHR) Querying: Evaluation of a Hybrid Approach based on Tool Calling and RAG.*

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Tech Stack](#tech-stack)
4. [Project Structure](#project-structure)
5. [Setup](#setup)
6. [Starting the Backend](#starting-the-backend)
7. [Mock FSE REST API](#mock-fse-rest-api)
8. [RAG Pipeline (Ingestion & Retrieval)](#rag-pipeline-ingestion--retrieval)
9. [LangGraph Agent](#langgraph-agent)
10. [Evaluation (Eval Harness)](#evaluation-eval-harness)
11. [Testing](#testing)
12. [API Costs and Limits (Gemini Free Tier)](#api-costs-and-limits-gemini-free-tier)
13. [Roadmap](#roadmap)

---

## Overview

The system has three macro-components, built in order:

1. **Mock FSE (REST API)** — simulates a regional healthcare gateway. Returns structured clinical data in a simplified HL7 FHIR R4 style (`Patient` and `Observation` resources) and unstructured textual reports (`DocumentReference`). *Status: complete.*
2. **RAG Pipeline (Ingestion & Retrieval)** — an ETL process that fetches `DocumentReference` texts from the Mock FSE, splits them into semantic chunks, embeds them, and stores them in ChromaDB with metadata strictly tied to a single patient (to prevent data leaking between patients). *Status: complete.*
3. **Agent Orchestrator** — a LangGraph-based agent (via LangChain.js's `createAgent`) that receives a natural-language question from a doctor and, via Tool Calling, decides whether to query the FHIR API (structured data) or the vector store (unstructured data). *Status: complete.*

Every agent query returns, alongside the text answer, the metrics needed for the thesis's experimental evaluation: latency, tokens consumed, and tools used.

## Architecture

```
┌─────────────────────┐        ┌──────────────────────┐
│   Doctor (natural     │        │                       │
│   language question)   │──────▶│   Agent Orchestrator   │
│                         │        │   (src/agent/)         │
└─────────────────────┘        └──────────┬────────────┘
                                            │ Tool Calling
                        ┌───────────────────┴───────────────────┐
                        ▼                                       ▼
            ┌───────────────────────┐              ┌───────────────────────────┐
            │  query_fhir_api        │              │  query_vector_db            │
            │  (structured data)      │              │  (unstructured data)         │
            └───────────┬───────────┘              └─────────────┬─────────────┘
                        │                                        │
                        ▼                                        ▼
            ┌───────────────────────┐              ┌───────────────────────────┐
            │  Mock FSE REST API     │              │  ChromaDB (Chroma Cloud     │
            │  (src/controllers/)    │              │  or local) — chunks filtered │
            │  GET /api/Observation   │              │  by patientId                │
            └───────────────────────┘              └───────────────────────────┘
```

Key architectural properties:

- **Patient isolation is structurally guaranteed.** The semantic-search tool (`query_vector_db`) *always* requires a resolved patient before it can query the vector store, and every Chroma query is filtered with a `where: { patientId }` clause. Cross-patient search isn't merely discouraged — it's made impossible by design.
- **Patient-name resolution with ambiguity detection.** If a question names a patient ambiguously (e.g. multiple patients share the same name), the agent detects it and asks for clarification instead of silently guessing the wrong patient.
- **Pure logic separated from "real wiring."** In every module, pure business logic (filtering, parsing, scoring) is kept separate from real network calls (Gemini, Chroma, HTTP). The former is covered by automated tests; the latter is manually verified against the real services — a convention applied consistently throughout the project.

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js, TypeScript (strict mode) |
| Backend API | Express.js |
| Generated-data validation | AJV (JSON Schema, against the official HL7 FHIR R4 schema) |
| Synthetic data generation | Faker.js |
| Agent orchestration | LangChain.js (`createAgent`), LangGraph.js (under the hood) |
| LLM | Google Gemini (`@langchain/google-genai`) — chat and embeddings |
| Vector database | ChromaDB (local or Chroma Cloud) |
| Testing | Jest + ts-jest |

## Project Structure

```
src/
├── index.ts                     # Express entrypoint
├── routes/index.ts               # REST route definitions
├── models/                       # simplified FHIR types (Patient, Observation, DocumentReference)
├── utils/dataGenerator.ts        # generates the in-memory database with Faker.js
├── controllers/                  # REST handlers (patient, observation, document, agent)
│
├── rag/                          # RAG pipeline (ingestion + retrieval)
│   ├── textDecoding.ts            # base64 decoding of clinical narratives
│   ├── fetchDocuments.ts          # HTTP client for the Mock FSE
│   ├── chunking.ts                # semantic chunking with per-patient metadata
│   ├── embeddingStore.ts          # embedding + upsert into Chroma
│   ├── ingestion.ts               # ingestion orchestrator + CLI (`npm run ingest`)
│   ├── retrieval.ts               # semantic query with optional per-patient filter
│   └── test-retrieval.ts          # manual retrieval-testing CLI (`npm run retrieve`)
│
└── agent/                        # Agent Orchestrator
    ├── patientResolver.ts         # name → patient resolution, with ambiguity detection
    ├── fetchObservations.ts       # HTTP client for a patient's Observations
    ├── tools/
    │   ├── fhirQueryTool.ts        # Tool A: structured FHIR queries
    │   └── vectorQueryTool.ts      # Tool B: patient-scoped semantic search
    ├── orchestrator.ts            # agent construction + metrics extraction
    └── run-agent.ts                # CLI to query the agent (`npm run agent`)
│
└── eval/                         # Batch evaluation harness
    ├── types.ts                   # DatasetEntry / RawResult / GradedResult
    ├── generateDataset.ts         # generates dataset.json from the seeded data (`eval:generate-dataset`)
    ├── dataset.json                # committed ground-truth dataset (39 questions)
    ├── run.ts                      # runs the dataset against the real agent (`eval:run`)
    ├── grade.ts                    # grades the results and writes the CSV (`eval:grade`)
    └── results/                    # local output (raw JSON + CSV), not version-controlled

__tests__/                        # automated tests (one per module, conventions below)
```

## Setup

### Prerequisites

- Node.js and npm
- A Google Gemini API key (free, at [aistudio.google.com/apikey](https://aistudio.google.com/apikey))
- A ChromaDB instance — local (`chroma run`) or free on [trychroma.com](https://www.trychroma.com/) (Chroma Cloud)

### Installation

```bash
npm install
cp .env.example .env
```

### Configuration (`.env`)

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_API_KEY` | Yes | Gemini key, used for both the agent and embeddings |
| `GOOGLE_EMBEDDING_MODEL` | No (default `gemini-embedding-001`) | Embedding model |
| `GOOGLE_CHAT_MODEL` | No (default `gemini-3.5-flash`) | Chat model used by the agent |
| `MOCK_FSE_BASE_URL` | No (default `http://localhost:3000`) | Mock FSE URL |
| `CHROMA_COLLECTION` | No (default `fse_documents`) | Chroma collection name |
| `RAG_CHUNK_SIZE` / `RAG_CHUNK_OVERLAP` | No (default `500` / `50`) | Chunking parameters |
| `RAG_TOP_K` | No (default `5`) | Number of chunks returned by semantic search |
| `CHROMA_HOST` / `CHROMA_PORT` | No | **Local** Chroma only — ignored if `CHROMA_API_KEY` is set |
| `CHROMA_API_KEY` / `CHROMA_TENANT` / `CHROMA_DATABASE` | No | **Chroma Cloud** only — setting these switches from local to cloud Chroma automatically |

> ⚠️ **Note on Gemini model names:** model names change over time — some get deprecated and return a 404 even while still appearing in the list of available models. If a model stops working, check which ones are actually active for your key with:
> ```bash
> curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$GOOGLE_API_KEY" | grep '"name"'
> ```

## Starting the Backend

```bash
npm run dev
```

The server starts on `http://localhost:3000` and generates a synthetic in-memory dataset: 15 patients, ~55 observations, ~20-22 clinical documents.

> ℹ️ **The dataset is deterministic.** `src/utils/dataGenerator.ts` fixes a Faker seed (`faker.seed(20260815)`), so patients, observations, and documents are identical on every server restart. `npm run ingest` only needs to run once (not on every restart) — re-run it only if you change the seed or the data-generation templates in `dataGenerator.ts`.

## Mock FSE REST API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/Patient` | List all patients |
| `GET` | `/api/Patient/:id` | Single patient by ID |
| `GET` | `/api/Observation?patientId=<id>` | A patient's structured observations |
| `GET` | `/api/DocumentReference?patientId=<id>` | A patient's textual reports |
| `POST` | `/api/agent/query` | Query the LLM agent (see below) |

## RAG Pipeline (Ingestion & Retrieval)

```bash
npm run ingest     # fetches reports, chunks them, embeds them, and stores them in Chroma
npm run retrieve -- "a test question"   # manual semantic search, not patient-scoped
```

`npm run ingest` is **idempotent**: every run clears and repopulates the Chroma collection, so orphaned chunks from previous runs never accumulate (important since the Mock FSE's data changes on every restart — see above).

## LangGraph Agent

```bash
npm run agent -- "What was the last blood pressure measurement for patient Mario Rossi?"
```

Or via HTTP:

```bash
curl -X POST http://localhost:3000/api/agent/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What was the last blood pressure measurement for patient Mario Rossi?"}'
```

Response:

```json
{
  "answer": "The most recent blood pressure reading for patient Mario Rossi was 114 mmHg, recorded on July 25, 2025.",
  "tokenUsage": { "inputTokens": 697, "outputTokens": 64, "totalTokens": 761 },
  "toolsUsed": ["query_fhir_api"],
  "latencyMs": 3153
}
```

The agent autonomously chooses between two tools:

- **`query_fhir_api`** — for structured-data questions (e.g. "what's the latest blood pressure", "what's their glucose level"). Resolves the patient by name, fetches their Observations, optionally filters by exam type, sorts by most recent date.
- **`query_vector_db`** — for free-text questions (e.g. "what does the cardiology report say", "what's their medical history"). Always requires a resolved patient, then searches semantically only among that patient's documents.

If the patient name is ambiguous or not found, the agent responds explicitly instead of guessing (e.g. *"Multiple patients match that name; please specify the full name."*).

## Evaluation (Eval Harness)

A two-stage batch evaluation harness (`src/eval/`), designed to produce the thesis's experimental metrics without burning Gemini quota every time only the grading logic changes.

```bash
npm run eval:generate-dataset                       # regenerates src/eval/dataset.json from the seeded data
npm run eval:run -- --limit 5 --delay-ms 15000       # runs N questions against the real agent
npm run eval:grade                                    # grades the latest raw-*.json file and writes a CSV
```

- **`eval:generate-dataset`** — automatically generates `src/eval/dataset.json` (committed, 39 questions) from the seeded dataset: 15 **structured** questions (`query_fhir_api`, expected answer = value + unit of the latest observation), 22 **narrative** questions (`query_vector_db`, expected answer = a sentence extracted from a report section, disambiguated by document type and date), 2 **edge case** questions (ambiguous or non-existent patient name, missing data). Only needs re-running if the seed or generation logic changes — otherwise the committed file is already valid.
- **`eval:run`** — runs the questions **sequentially** against the real agent (never in parallel: the Gemini free-tier quota is per-minute), with a configurable pause between calls (`--delay-ms`, default 1000ms) and an optional question limit (`--limit N`, always takes the first N entries of the dataset). Any failed question is recorded with its error and the batch continues. Results are written **after every single question**, not just at the end, to `src/eval/results/raw-<timestamp>.json` — so an interrupted batch (quota exhausted, crash) never loses answers already obtained.
- **`eval:grade`** — reads the latest `raw-*.json` (or a path passed as an argument), grades every answer, and writes `src/eval/results/graded-<timestamp>.csv`:
  - **structured** questions: exact match of the expected numeric value, with a word boundary (`\b`) to avoid false positives like `"15"` matching inside `"115.8"`;
  - **narrative**/**edge_case** questions: a single LLM judge call (`temperature: 0`, same configured chat model) answers YES/NO comparing the expected and actual answers, tolerating differences in language/wording;
  - the CSV includes expected/actual tool, tool match, expected/actual answer, correctness, grading method, latency, and token usage — ready for a spreadsheet (with a UTF-8 BOM so accented characters open correctly in Excel).
- **`src/eval/results/`** is not version-controlled (it's in `.gitignore`): every local run/grading output stays on the machine that produced it.

## Testing

```bash
npm test          # runs the full Jest suite
npm run build      # full type-check (tsc) — this is the authoritative type-check,
                    # since ts-jest has diagnostics disabled
```

Testing conventions applied consistently throughout the project:

- **No mocking library.** Tests use real objects, hand-written fixtures, or a real ephemeral `http.Server` (port 0) to test HTTP clients.
- **Pure logic vs. "real wiring" separation.** Pure functions (filtering, scoring, parsing, CSV formatting) get exact-value unit tests. Functions that talk to real services (Gemini, Chroma) are manually verified, not automatically tested — a pattern kept consistent across every module (`runIngestion`, `runRetrievalQuery`, `runAgentQuery`, etc.).
- **Strict TypeScript.** `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are enabled: every array/optional-property access is explicitly checked.

## API Costs and Limits (Gemini Free Tier)

While building this project, the free Gemini key hit two real limits worth knowing about before running extensive tests or the future batch evaluation:

- **Per-minute limit:** 5 requests/minute per model (`GenerateRequestsPerMinutePerProjectPerModel-FreeTier`).
- **Daily limit:** 20 requests/day per model (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`).

Every question sent to the agent consumes **more than one** Gemini call (reasoning, tool calling, answer synthesis), so even light manual testing exhausts the free daily quota quickly. A paid plan is recommended for a full-scale (30-50 question) evaluation.

## Roadmap

The three macro-components and the evaluation harness are complete and tested (68 automated tests, `npm run build` clean). What's left is experimental, not implementation work:

- **Run the full batch evaluation** (`npm run eval:run` with no `--limit`) against all 39 dataset questions. The free Gemini quota (5 requests/minute, 20/day per model — see [above](#api-costs-and-limits-gemini-free-tier)) isn't enough for a complete run in a single session: this needs either a paid plan or several partial runs spread across multiple days.
- **Collect the graded results** (`npm run eval:grade`) for the thesis's experimental evaluation (per-category accuracy, latency, token usage, tool-routing correctness).
