NotebookLM-style Web App (Monorepo)

Overview
- Minimal, dependency-free Node.js server (no install needed to run basic demo).
- Static web UI to ingest sources, ask AI, and generate outputs.
- Pluggable LLM provider: OpenAI or Gemini (via fetch). Falls back to a deterministic mock for offline use.

Run
- Install deps (for URL/PDF parsing, embeddings): `npm install`
- Dev: `node apps/server/index.js` (or `npm run dev`)
- Then open: http://localhost:8787

Environment (optional)
- `OPENAI_API_KEY` for OpenAI Chat Completions
- `GOOGLE_GENAI_API_KEY` for Google Generative Language API
  - Embeddings: OpenAI `text-embedding-3-small` or Gemini `text-embedding-004`
 - Vector index backend:
   - `VECTOR_BACKEND=sqlite` (default) — stores vectors in `apps/server/data/index.db`
   - `VECTOR_DB_PATH=/path/to/index.db` — override sqlite DB path
   - `VECTOR_BACKEND=pgvector` with `DATABASE_URL=postgres://...` (optional; requires pgvector extension installed)
   - `VECTOR_DIM=1536` — when using Postgres pgvector, set to match embedding dimension

API Endpoints
- GET `/api/sources` — List sources
- GET `/api/sources/:id` — Get source details
- GET `/api/sources/:id/summary` — Summarize a single source (短/中/长 + keywords)
- POST `/api/sources` — Add a source (JSON)
  - Body: `{ type: 'text'|'url'|'pdf', name?: string, content?: string, url?: string }`
- POST `/api/sources/upload` — Upload a file; parses PDF/text and ingests
  - multipart fields: `file` (+ optional `name`)
- POST `/api/ask` — Ask question with citations
  - Body: `{ question: string, sourceIds?: string[] }`
- POST `/api/generate` — Multi-format generators
  - Body: `{ type: 'audio_overview'|'video_overview'|'mind_map'|'report'|'flashcards'|'quiz'|'slides', sourceIds?: string[], options?: any }`
- POST `/api/reindex` — Rebuild chunk embeddings with current provider
  - Body: `{ provider?: string, batch?: number }`
  - Re-embeds pending chunks in batches; persists to SQLite index if enabled
 - GET `/api/index/status` — Index stats `{ totalChunks, withVectors, sqliteRows, embedding, backend }`

Notes
- Retrieval: Q&A uses vector retrieval (OpenAI/Gemini embeddings) when available; falls back to TF‑IDF.
- URL parsing: fetches HTML and extracts main article via Readability (falls back to plain text stripping).
- PDF parsing: uses `pdfjs-dist` to extract per-page text.
- Storage persists to `apps/server/data/data.json`.
- Mind map output includes a Mermaid `mindmap` block.

Postgres pgvector (optional)
- Requires `CREATE EXTENSION vector;`
- Example table (dimension must match your embedding model, e.g., 1536):
  ```sql
  CREATE TABLE IF NOT EXISTS chunk_vectors (
    chunk_id TEXT PRIMARY KEY,
    source_id TEXT,
    text TEXT,
    embedding vector(1536),
    updated_at TIMESTAMPTZ DEFAULT now()
  );
  -- Upsert example:
  -- INSERT INTO chunk_vectors(chunk_id, source_id, text, embedding)
  -- VALUES($1,$2,$3,$4) ON CONFLICT(chunk_id)
  -- DO UPDATE SET text=EXCLUDED.text, embedding=EXCLUDED.embedding, source_id=EXCLUDED.source_id, updated_at=now();
  -- Vector search: SELECT chunk_id, source_id, text FROM chunk_vectors ORDER BY embedding <#> $1 LIMIT $K;
  ```
  Set `VECTOR_BACKEND=pgvector`, `DATABASE_URL=...`, `VECTOR_DIM=1536` then call `/api/reindex`.

Next Steps (suggested)
- Add robust parsing for PDF (e.g., pdf.js), URL (readability), CSV/Excel, audio transcript ingestion.
- Add vector index (SQLite/pgvector) and retrieval.
- Add user auth + multi-space workspaces.
- Add streaming responses and better UI (Mermaid render, copy/export buttons).
- Flows/orchestration: compose multi-step tasks (e.g., Summarize → Slides → Quiz) with saved presets.
