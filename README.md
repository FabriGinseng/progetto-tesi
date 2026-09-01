# FSE Mock Backend — Agente LLM per il Fascicolo Sanitario Elettronico

> 🇬🇧 English version: [README.en.md](./README.en.md)

Proof of Concept per una **Tesi Magistrale in Ingegneria Informatica**: un agente LLM autonomo che interroga un Fascicolo Sanitario Elettronico (FSE) simulato, scegliendo tra chiamate API strutturate (FHIR) e ricerca semantica su documenti non strutturati (RAG), tramite Tool Calling.

**Titolo tesi:** *Implementation and Analysis of LLM Agents for Electronic Health Record (EHR) Querying: Evaluation of a Hybrid Approach based on Tool Calling and RAG.*

---

## Indice

1. [Panoramica](#panoramica)
2. [Architettura](#architettura)
3. [Stack tecnologico](#stack-tecnologico)
4. [Struttura del progetto](#struttura-del-progetto)
5. [Setup](#setup)
6. [Come avviare il backend](#come-avviare-il-backend)
7. [API REST del Mock FSE](#api-rest-del-mock-fse)
8. [Pipeline RAG (ingestion e retrieval)](#pipeline-rag-ingestion-e-retrieval)
9. [Agente LangGraph](#agente-langgraph)
10. [Valutazione (Eval Harness)](#valutazione-eval-harness)
11. [Testing](#testing)
12. [Costi e limiti delle API (Gemini free tier)](#costi-e-limiti-delle-api-gemini-free-tier)
13. [Roadmap](#roadmap)

---

## Panoramica

Il sistema è composto da tre macro-componenti, costruiti in ordine:

1. **Mock FSE (REST API)** — simula un gateway sanitario regionale. Restituisce dati clinici strutturati in stile HL7 FHIR R4 (risorse `Patient` e `Observation`) e referti testuali non strutturati (`DocumentReference`). *Stato: completo.*
2. **Pipeline RAG (Ingestion & Retrieval)** — un processo ETL che estrae i testi dei `DocumentReference` dal Mock FSE, li suddivide in chunk semantici, li trasforma in embedding e li salva su ChromaDB con metadati rigorosamente associati al singolo paziente (per evitare fughe di dati tra pazienti diversi). *Stato: completo.*
3. **Agent Orchestrator** — un agente basato su LangGraph (tramite `createAgent` di LangChain.js) che riceve una domanda in linguaggio naturale da un medico e decide, tramite Tool Calling, se interrogare l'API FHIR (dati strutturati) o il vector store (dati non strutturati). *Stato: completo.*

Ogni interrogazione dell'agente restituisce, oltre alla risposta testuale, le metriche necessarie per la valutazione sperimentale della tesi: latenza, token consumati e tool utilizzati.

## Architettura

```
┌─────────────────────┐        ┌──────────────────────┐
│   Medico (domanda    │        │                       │
│   in linguaggio       │──────▶│   Agent Orchestrator   │
│   naturale)            │        │   (src/agent/)         │
└─────────────────────┘        └──────────┬────────────┘
                                            │ Tool Calling
                        ┌───────────────────┴───────────────────┐
                        ▼                                       ▼
            ┌───────────────────────┐              ┌───────────────────────────┐
            │  query_fhir_api        │              │  query_vector_db            │
            │  (dati strutturati)     │              │  (dati non strutturati)      │
            └───────────┬───────────┘              └─────────────┬─────────────┘
                        │                                        │
                        ▼                                        ▼
            ┌───────────────────────┐              ┌───────────────────────────┐
            │  Mock FSE REST API     │              │  ChromaDB (Chroma Cloud     │
            │  (src/controllers/)    │              │  o locale) — chunk filtrati  │
            │  GET /api/Observation   │              │  per patientId               │
            └───────────────────────┘              └───────────────────────────┘
```

Punti chiave dell'architettura:

- **Isolamento tra pazienti garantito strutturalmente.** Il tool di ricerca semantica (`query_vector_db`) richiede *sempre* un paziente risolto prima di poter interrogare il vector store, e ogni query Chroma è filtrata con una clausola `where: { patientId }`. Non è semplicemente "sconsigliato" cercare tra i dati di più pazienti: è reso impossibile dal design.
- **Risoluzione del nome paziente con rilevamento di ambiguità.** Se una domanda nomina un paziente in modo ambiguo (es. più pazienti con lo stesso nome), l'agente lo rileva e chiede di specificare meglio, invece di indovinare silenziosamente il paziente sbagliato.
- **Separazione tra logica pura e "real wiring".** In ogni modulo, la logica di business pura (filtri, parsing, scoring) è separata dalle chiamate di rete reali (Gemini, Chroma, HTTP). La prima è coperta da test automatici; la seconda viene verificata manualmente contro i servizi reali — è una convenzione applicata in modo coerente in tutto il progetto.

## Stack tecnologico

| Livello | Tecnologia |
|---|---|
| Runtime | Node.js, TypeScript (strict mode) |
| Backend API | Express.js |
| Validazione dati generati | AJV (JSON Schema, contro lo schema ufficiale HL7 FHIR R4) |
| Generazione dati sintetici | Faker.js |
| Orchestrazione agente | LangChain.js (`createAgent`), LangGraph.js (sotto il cofano) |
| Modello LLM | Google Gemini (`@langchain/google-genai`) — chat e embedding |
| Vector database | ChromaDB (locale o Chroma Cloud) |
| Test | Jest + ts-jest |

## Struttura del progetto

```
src/
├── index.ts                     # entrypoint Express
├── routes/index.ts               # definizione delle rotte REST
├── models/                       # tipi FHIR semplificati (Patient, Observation, DocumentReference)
├── utils/dataGenerator.ts        # genera il database in-memory con Faker.js
├── controllers/                  # handler REST (patient, observation, document, agent)
│
├── rag/                          # Pipeline RAG (ingestion + retrieval)
│   ├── textDecoding.ts            # decodifica base64 dei referti
│   ├── fetchDocuments.ts          # client HTTP verso il Mock FSE
│   ├── chunking.ts                # chunking semantico con metadati per paziente
│   ├── embeddingStore.ts          # embedding + upsert su Chroma
│   ├── ingestion.ts               # orchestratore ingestion + CLI (`npm run ingest`)
│   ├── retrieval.ts               # query semantica con filtro opzionale per paziente
│   └── test-retrieval.ts          # CLI per testare manualmente la ricerca (`npm run retrieve`)
│
└── agent/                        # Agent Orchestrator
    ├── patientResolver.ts         # risoluzione nome → paziente, con rilevamento ambiguità
    ├── fetchObservations.ts       # client HTTP per le Observation di un paziente
    ├── tools/
    │   ├── fhirQueryTool.ts        # Tool A: query strutturate FHIR
    │   └── vectorQueryTool.ts      # Tool B: ricerca semantica per paziente
    ├── orchestrator.ts            # costruzione dell'agente + estrazione metriche
    └── run-agent.ts                # CLI per interrogare l'agente (`npm run agent`)
│
└── eval/                         # Harness di valutazione batch
    ├── types.ts                   # DatasetEntry / RawResult / GradedResult
    ├── generateDataset.ts         # genera dataset.json dai dati seedati (`eval:generate-dataset`)
    ├── dataset.json                # dataset di ground truth committato (39 domande)
    ├── run.ts                      # esegue il dataset contro l'agente reale (`eval:run`)
    ├── grade.ts                    # valuta i risultati e produce il CSV (`eval:grade`)
    └── results/                    # output locale (raw JSON + CSV), non versionato

__tests__/                        # test automatici (uno per modulo, convenzioni sotto)
```

## Setup

### Prerequisiti

- Node.js e npm
- Una chiave API Google Gemini (gratuita su [aistudio.google.com/apikey](https://aistudio.google.com/apikey))
- Un'istanza ChromaDB — locale (`chroma run`) oppure gratuita su [trychroma.com](https://www.trychroma.com/) (Chroma Cloud)

### Installazione

```bash
npm install
cp .env.example .env
```

### Configurazione (`.env`)

| Variabile | Obbligatoria | Descrizione |
|---|---|---|
| `GOOGLE_API_KEY` | Sì | Chiave Gemini, usata sia per l'agente che per gli embedding |
| `GOOGLE_EMBEDDING_MODEL` | No (default `gemini-embedding-001`) | Modello di embedding |
| `GOOGLE_CHAT_MODEL` | No (default `gemini-3.5-flash`) | Modello di chat usato dall'agente |
| `MOCK_FSE_BASE_URL` | No (default `http://localhost:3000`) | URL del Mock FSE |
| `CHROMA_COLLECTION` | No (default `fse_documents`) | Nome della collection Chroma |
| `RAG_CHUNK_SIZE` / `RAG_CHUNK_OVERLAP` | No (default `500` / `50`) | Parametri di chunking |
| `RAG_TOP_K` | No (default `5`) | Numero di chunk restituiti dalla ricerca semantica |
| `CHROMA_HOST` / `CHROMA_PORT` | No | Solo per Chroma **locale** — ignorate se è impostato `CHROMA_API_KEY` |
| `CHROMA_API_KEY` / `CHROMA_TENANT` / `CHROMA_DATABASE` | No | Solo per **Chroma Cloud** — impostandole si passa automaticamente dal Chroma locale a quello cloud |

> ⚠️ **Nota sui modelli Gemini:** i nomi dei modelli cambiano nel tempo — alcuni vengono deprecati e restituiscono errore 404 anche se compaiono ancora nella lista modelli disponibili. Se un modello smette di funzionare, verifica quelli realmente attivi per la tua chiave con:
> ```bash
> curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$GOOGLE_API_KEY" | grep '"name"'
> ```

## Come avviare il backend

```bash
npm run dev
```

Il server parte su `http://localhost:3000` e genera un dataset sintetico in memoria: 15 pazienti, ~55 osservazioni, ~20-22 referti clinici.

> ℹ️ **Il dataset è deterministico.** `src/utils/dataGenerator.ts` fissa un seed Faker (`faker.seed(20260815)`), quindi pazienti, osservazioni e referti sono identici a ogni riavvio del server. `npm run ingest` va eseguito una volta sola (non a ogni riavvio) — riesegui l'ingestion solo se cambi il seed o i template di generazione dati in `dataGenerator.ts`.

## API REST del Mock FSE

| Metodo | Endpoint | Descrizione |
|---|---|---|
| `GET` | `/api/Patient` | Lista di tutti i pazienti |
| `GET` | `/api/Patient/:id` | Singolo paziente per ID |
| `GET` | `/api/Observation?patientId=<id>` | Osservazioni strutturate di un paziente |
| `GET` | `/api/DocumentReference?patientId=<id>` | Referti testuali di un paziente |
| `POST` | `/api/agent/query` | Interroga l'agente LLM (vedi sotto) |

## Pipeline RAG (ingestion e retrieval)

```bash
npm run ingest     # estrae i referti, li suddivide in chunk, crea gli embedding e li salva su Chroma
npm run retrieve -- "una domanda di prova"   # ricerca semantica manuale, non filtrata per paziente
```

`npm run ingest` è **idempotente**: ogni esecuzione svuota e ripopola la collection Chroma, così non si accumulano mai chunk orfani di esecuzioni precedenti (importante dato che i dati del Mock FSE cambiano a ogni riavvio, vedi sopra).

## Agente LangGraph

```bash
npm run agent -- "Qual è stata l'ultima misurazione della pressione del paziente Mario Rossi?"
```

Oppure via HTTP:

```bash
curl -X POST http://localhost:3000/api/agent/query \
  -H "Content-Type: application/json" \
  -d '{"question": "Qual è stata l'\''ultima misurazione della pressione del paziente Mario Rossi?"}'
```

Risposta:

```json
{
  "answer": "L'ultima misurazione della pressione registrata per il paziente Mario Rossi è stata di 114 mmHg, in data 25 luglio 2025.",
  "tokenUsage": { "inputTokens": 697, "outputTokens": 64, "totalTokens": 761 },
  "toolsUsed": ["query_fhir_api"],
  "latencyMs": 3153
}
```

L'agente sceglie autonomamente tra due tool:

- **`query_fhir_api`** — per domande su dati strutturati (es. "qual è l'ultima pressione", "che valore di glicemia ha"). Risolve il paziente per nome, recupera le sue Observation, filtra opzionalmente per tipo di esame, ordina per data più recente.
- **`query_vector_db`** — per domande su testo libero (es. "cosa dice il referto cardiologico", "qual è la sua storia clinica"). Richiede sempre un paziente risolto, poi cerca semanticamente solo tra i suoi documenti.

Se il nome del paziente è ambiguo o non trovato, l'agente risponde in modo esplicito invece di indovinare (es. *"Più pazienti corrispondono a quel nome; specifica il cognome completo."*).

## Valutazione (Eval Harness)

Harness di valutazione batch in due stadi (`src/eval/`), pensato per produrre le metriche sperimentali della tesi senza risprecare quota Gemini ogni volta che cambia solo la logica di grading.

```bash
npm run eval:generate-dataset                       # rigenera src/eval/dataset.json dai dati seedati
npm run eval:run -- --limit 5 --delay-ms 15000       # esegue N domande contro l'agente reale
npm run eval:grade                                    # valuta l'ultimo file raw-*.json e produce un CSV
```

- **`eval:generate-dataset`** — genera automaticamente `src/eval/dataset.json` (committato, 39 domande) a partire dal dataset seedato: 15 domande **strutturate** (`query_fhir_api`, risposta attesa = valore + unità dell'ultima osservazione), 22 **narrative** (`query_vector_db`, risposta attesa = frase estratta da una sezione del referto, disambiguata per tipo documento e data), 2 **edge case** (nome paziente ambiguo o inesistente, dato mancante). Va rieseguito solo se cambiano il seed o la logica di generazione — altrimenti il file committato è già valido.
- **`eval:run`** — esegue le domande **in sequenza** contro l'agente reale (mai in parallelo: la quota Gemini free tier è per-minuto), con una pausa configurabile tra una chiamata e l'altra (`--delay-ms`, default 1000ms) e un limite opzionale di domande (`--limit N`, prende sempre le prime N del dataset). Ogni domanda fallita viene registrata con l'errore e il batch continua. I risultati vengono scritti **dopo ogni singola domanda**, non solo alla fine, in `src/eval/results/raw-<timestamp>.json` — così un batch interrotto (quota esaurita, crash) non perde le risposte già ottenute.
- **`eval:grade`** — legge l'ultimo `raw-*.json` (o un path passato come argomento), valuta ogni risposta e scrive `src/eval/results/graded-<timestamp>.csv`:
  - domande **structured**: match esatto del valore numerico atteso, con un confine di parola (`\b`) per evitare falsi positivi tipo `"15"` dentro `"115.8"`;
  - domande **narrative**/**edge_case**: un singolo giudice LLM (`temperature: 0`, stesso modello di chat configurato) risponde SÌ/NO confrontando risposta attesa e risposta reale, tollerando differenze di lingua/formulazione;
  - il CSV include tool atteso/usato, corrispondenza tool, risposta attesa/reale, correttezza, metodo di grading, latenza e token usage — pronto per un foglio di calcolo (BOM UTF-8 incluso per l'apertura corretta in Excel dei caratteri accentati).
- **`src/eval/results/`** non è versionato (è in `.gitignore`): ogni run/grading locale resta sulla macchina di chi lo esegue.

## Testing

```bash
npm test          # esegue tutta la suite Jest
npm run build      # type-check completo (tsc) — è il controllo dei tipi autoritativo,
                    # dato che ts-jest ha i diagnostics disabilitati
```

Convenzioni di test applicate in modo coerente in tutto il progetto:

- **Nessuna libreria di mocking.** I test usano oggetti reali, fixture scritte a mano, oppure un vero `http.Server` effimero (porta 0) per testare i client HTTP.
- **Separazione pura / "real wiring".** Le funzioni pure (filtri, scoring, parsing, formattazione CSV) hanno test unitari con asserzioni esatte. Le funzioni che parlano con servizi reali (Gemini, Chroma) sono verificate manualmente, non con test automatici — un pattern coerente in ogni modulo (`runIngestion`, `runRetrievalQuery`, `runAgentQuery`, ecc.).
- **TypeScript strict.** `noUncheckedIndexedAccess` e `exactOptionalPropertyTypes` sono attivi: ogni accesso a un array o proprietà opzionale è controllato esplicitamente.

## Costi e limiti delle API (Gemini free tier)

Durante lo sviluppo di questo progetto, la chiave Gemini gratuita ha mostrato due limiti reali, utili da conoscere prima di eseguire test estesi o la futura valutazione batch:

- **Limite al minuto:** 5 richieste/minuto per modello (`GenerateRequestsPerMinutePerProjectPerModel-FreeTier`).
- **Limite giornaliero:** 20 richieste/giorno per modello (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`).

Ogni domanda posta all'agente consuma **più di una** chiamata Gemini (ragionamento, tool calling, sintesi della risposta), quindi anche pochi test manuali esauriscono rapidamente la quota giornaliera gratuita. Per una valutazione su larga scala (30-50 domande) è consigliabile un piano a pagamento.

## Roadmap

I tre macro-componenti e l'harness di valutazione sono completi e testati (68 test automatici, `npm run build` pulito). Il lavoro rimanente è sperimentale, non implementativo:

- **Eseguire la valutazione batch completa** (`npm run eval:run` senza `--limit`) contro tutte le 39 domande del dataset. La quota gratuita Gemini (5 richieste/minuto, 20/giorno per modello — vedi [sopra](#costi-e-limiti-delle-api-gemini-free-tier)) non basta per un run completo in un'unica sessione: serve un piano a pagamento, oppure più run parziali su più giorni.
- **Raccogliere i risultati graduati** (`npm run eval:grade`) per la valutazione sperimentale della tesi (accuracy per categoria, latenza, token usage, correttezza del routing tool).
