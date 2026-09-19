# Jev drives Wikipedia

Voice-controlled Wikipedia navigation where **TypeSafe's Jev (System One)** makes every decision and code executes them, with a live dashboard showing each model call's tokens, cost, and latency.

```
🎤 voice ──▶ transcript ──▶ Jev (one fan-out request) ──▶ confidence routing ──▶ Playwright executes ──▶ page changes
                                                                   │
                                                                   ▼
                                                  dashboard: model, tokens, $, ms, probabilities
```

## Run it

```sh
npm install
cp .env.example .env      # put your TypeSafe key in TYPESAFE_AI_KEY (or TYPESAFE_API_KEY)
npm start                 # opens Chrome on Wikipedia + dashboard at http://localhost:3000
```

Open <http://localhost:3000> in Chrome or Edge, click the mic (or press Space), and speak:

- "open the page about the industrial revolution"
- "go to the history section"
- "who was James Watt"
- "search for Ada Lovelace"
- "scroll down" · "go back"

The Playwright-driven Chrome window is the one navigating; the dashboard tab is the control room.

`npm run smoke` runs a scripted sequence headlessly and prints every decision, useful for testing question changes.

## How Jev is used

One request per command asks several **independent questions over the same state** (the transcript plus the current page's title, summary, headings, and up to ~440 extracted links/section anchors). They run in parallel; code consumes only the answers the chosen intent needs.

| Question | Type | Decides |
|---|---|---|
| `intent` | Choice | `click_link` / `search` / `scroll_down` / `scroll_up` / `go_back` / `unclear` |
| `target_link_N` | Choice over link ids (+ `NONE`) | Which link or section matches, as a probability per candidate |
| `search_query` | Choice over transcript spans | The search topic, *selected* from the user's own words rather than generated |
| `goal_satisfied` | Noul | Whether the current page already is what was asked for |

**Chunking.** The API accepts at most 255 options per Choice. Pages with more candidates get one `target_link_N` question per chunk in the same request; if the intent is `click_link`, a second small request picks among the chunk winners (top 3 per chunk). Both calls appear on the dashboard.

**Confidence routing** (`src/pipeline.ts`, `THRESHOLDS`): the top candidate's probability decides whether to execute immediately, show the top candidates for a click-to-confirm, or escalate ("nothing matched"). Thresholds are a starting point; tune them on real usage.

## Measured (jev-1.13.0, Sept 2026)

Typical Wikipedia article (300–500 candidates): 20–31k input tokens, **$0.0008–0.0014 and 0.5–1.5 s per command** for the fan-out request, plus ~$0.00004 / 0.3–0.7 s for the final-round request on link clicks. Output tokens are free. The first request after startup can take 20+ s (cold start), so the server sends a warm-up request on boot.

## Models

| Role | Model | Notes |
|---|---|---|
| All decisions | `jev-latest` (TypeSafe) | $0.042 / M input tokens, output free |
| Speech-to-text | Browser Web Speech API | Free, no key, Chrome/Edge. Swap in a hosted STT (Deepgram, Whisper) if you need better accuracy or other browsers |
| Comparison baseline | none yet | `src/pricing.ts` and the `model_call` event are model-agnostic — add an LLM (e.g. Claude Haiku 4.5) running the same link-selection task to show cost/latency side by side |

## Layout

```
src/server.ts      Express + SSE; POST /command, POST /confirm, GET /events
src/pipeline.ts    orchestration, confidence routing, event log
src/jev.ts         question design, chunking, measured request wrapper
src/browser.ts     Playwright wrapper for the Wikipedia tab
src/dom/extract.js page-side link/section extraction (plain JS, evaluated in the page)
src/events.ts      event types + totals
src/pricing.ts     per-model pricing
public/            dashboard (vanilla HTML/JS, Web Speech API mic)
scripts/smoke.ts   headless end-to-end run
```

## Config (`.env`)

| Var | Default | |
|---|---|---|
| `TYPESAFE_AI_KEY` / `TYPESAFE_API_KEY` | — | required |
| `TYPESAFE_MODEL` | `jev-latest` | |
| `BROWSER_CHANNEL` | (bundled Chromium) | `chrome` or `msedge` to drive the installed browser |
| `HEADLESS` | `false` | |
| `PORT` | `3000` | |

Docs: <https://docs.typesafe.ai> (API, primitives, cookbooks — the *function calling*, *semantic find*, and *hierarchical classification* cookbooks are the patterns this project composes).
