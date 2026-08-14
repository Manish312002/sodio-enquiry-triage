# Screenshots

This directory contains the four submission screenshots referenced by
`README.md` and required by `Docs/Phases.md` Phase 11 (3–4 screenshots
or a short screen recording).

## What's here

| # | File | Width | Shows |
|---|---|---|---|
| 1 | `01-mobile-375-empty-state.png` | 375 × 667 | Mobile single-column stack: paste strip, batch progress, filter rail, queue, detail all flow vertically. Demonstrates Phase 10 acceptance criterion #1 (UI does not resemble a generic AI chat / dashboard template) and the responsive layout (design.md §17). |
| 2 | `02-tablet-768-empty-state.png` | 768 × 1024 | Tablet width: filter rail collapses, queue + detail remain. |
| 3 | `03-desktop-1280-three-zone-layout.png` | 1280 × 800 | Desktop three-zone layout: FILTER RAIL (left) \| QUEUE (centre) \| DETAIL (right). Demonstrates the Signal Desk aesthetic (warm paper background, orange accent, IBM Plex Mono labels, no chat bubbles, no gradients, no glassmorphism). |
| 4 | `04-desktop-1920-three-zone-layout.png` | 1920 × 1080 | Desktop wide: same three-zone layout, more breathing room. |

All four screenshots show the **empty state** (no enquiry selected).
This is a limitation of the build sandbox: there is no MongoDB instance
and no outbound network access to LLM providers, so the queue cannot
be populated end-to-end in the sandbox that produced this commit.

## What's NOT here (and how to capture it)

The six **capability** screenshots (single + file ingestion, LLM
extraction, deterministic priority, console with filters + sort,
inline correction, re-extraction safety) require a running backend
with MongoDB + real `GROQ_API_KEY` / `GEMINI_API_KEY`, and a populated
queue (after uploading `test-data/sample-enquiries.txt`).

The capture workflow for those six screenshots is documented in
`Docs/SCREENSHOTS.md`. The operator (or evaluator) should:

1. Start MongoDB locally.
2. `cd backend && cp .env.example .env` → edit `.env` to set
   `MONGODB_URI`, `GROQ_API_KEY`, `GEMINI_API_KEY`.
3. `cd backend && npm install && npm run dev` (serves
   http://localhost:3001).
4. `cd frontend && npm install && npm run dev` (serves
   http://localhost:5173).
5. Open http://localhost:5173/ in a browser.
6. Upload `test-data/sample-enquiries.txt` via the IMPORT ENQUIRIES
   strip; wait for the segmented progress bar to reach COMPLETED.
7. Follow `Docs/SCREENSHOTS.md` to capture each of the six capability
   views.

## Why the empty-state screenshots are still useful

Even without populated data, the four screenshots here demonstrate
Phase 10 acceptance criterion #1 (UI does not resemble a generic AI
chat / dashboard template) and the responsive layout (Phase 10 build
item: responsive layout). They also show:

- the **Signal Desk** aesthetic (warm paper background, orange
  accent, IBM Plex Mono labels with `tracking-widest`, no chat
  bubbles, no gradients, no glassmorphism, no oversized hero cards,
  no animated AI icons);
- the **three-zone desktop layout** (FILTER RAIL \| QUEUE \| DETAIL)
  at ≥1280px;
- the **mobile single-column stack** at <640px;
- the **loading / empty states** (NO SIGNAL YET, NO ENQUIRY
  SELECTED) which are themselves Phase 10 build items;
- the **kicker labels** (QUEUE / DETAIL) added in Phase 10 to give
  the empty states a stronger sense of place;
- the **keyboard hint** in the DETAIL empty state
  ("tip: use ↑ / ↓ to move through the queue without leaving the
  keyboard") added in Phase 10.

These four screenshots are sufficient to evaluate the UI design and
the responsive layout. They are NOT sufficient to evaluate the six
core capabilities — for that, the operator must run the dev server
locally with MongoDB + real API keys and follow
`Docs/SCREENSHOTS.md`.

## Reference

- `Docs/SCREENSHOTS.md` — full capture workflow for the six
  capability screenshots + optional failure-state captures +
  responsive-width guidance.
- `Docs/design.md` §2 — explicit list of what the UI should NOT
  resemble (generic AI chat bubbles, oversized hero cards,
  glassmorphism, purple-blue gradients, "AI thinking" spinner
  animations, raw stack traces).
- `Docs/Phases.md` Phase 11 — submission requirements (3–4
  screenshots or short screen recording).
