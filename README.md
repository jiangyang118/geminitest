NotebookLM-style Web App (Monorepo)

Overview
- Minimal, dependency-free Node.js server (no install needed to run basic demo).
- Static web UI to ingest sources, ask AI, and generate outputs.
- Pluggable LLM provider: OpenAI or Gemini (via fetch). Falls back to a deterministic mock for offline use.

Run
- Dev: `node apps/server/index.js` (or `npm run dev`)
- Then open: http://localhost:8787

Environment (optional)
- `OPENAI_API_KEY` for OpenAI Chat Completions
- `GOOGLE_GENAI_API_KEY` for Google Generative Language API

API Endpoints
- GET `/api/sources` — List sources
- GET `/api/sources/:id` — Get source details
- GET `/api/sources/:id/summary` — Summarize a single source (短/中/长 + keywords)
- POST `/api/sources` — Add a source (JSON)
  - Body: `{ type: 'text'|'url'|'pdf', name?: string, content?: string, url?: string }`
- POST `/api/ask` — Ask question with citations
  - Body: `{ question: string, sourceIds?: string[] }`
- POST `/api/generate` — Multi-format generators
  - Body: `{ type: 'audio_overview'|'video_overview'|'mind_map'|'report'|'flashcards'|'quiz'|'slides', sourceIds?: string[], options?: any }`

Notes
- Retrieval: Q&A uses TF-IDF to select top-k chunks as context, improving relevance and citations.
- PDF/URL parsing is currently placeholder (stores text as-is). Add real parsers as needed.
- Storage persists to `apps/server/data/data.json`.
- Mind map output includes a Mermaid `mindmap` block.

Next Steps (suggested)
- Add robust parsing for PDF (e.g., pdf.js), URL (readability), CSV/Excel, audio transcript ingestion.
- Add vector index (SQLite/pgvector) and retrieval.
- Add user auth + multi-space workspaces.
- Add streaming responses and better UI (Mermaid render, copy/export buttons).
- Flows/orchestration: compose multi-step tasks (e.g., Summarize → Slides → Quiz) with saved presets.
