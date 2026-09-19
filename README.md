# KODA — a voice assistant that knows when it is sure

**Team members:** Nikolas Juhava, Qilun Li, Atte Laakso

KODA lives on the page you are already looking at. You say "hey KODA", ask for
something, and it acts, asks, or admits it cannot. Every decision comes from
**TypeSafe's Jev (System One)**, a typed probabilistic model: no language model
is in the loop, nothing is ever generated, and every output is a selection from
a list the code built, with a measured probability attached.

```
🎤 voice ──▶ transcript ──▶ Jev (one fan-out request) ──▶ confidence routing ──▶ Playwright acts
                                                              │
                                                              ▼
                                            overlay: what it picked, and how sure
```

## Project overview

Voice browsing has existed for years and is mostly unusable, because a generative
assistant that is wrong sounds exactly like one that is right. KODA removes the
generation step. On every command the code enumerates the options — every link on
the page, every section heading, every paragraph, every span of the words you just
said — and the model's only job is to pick one and report how likely it is to be
correct. A search box can therefore only ever contain words you actually said.

Because the probability is measured rather than written, a threshold on it means
something. KODA acts alone above its threshold, shows a short pick-list just below
it, and says so plainly when nothing on the page matches.

## Trust, measured

- **Calibration ledger** (`src/calibration.ts`) records every decision with the
  probability Jev gave the option it chose. Ground truth arrives free from normal
  use: the candidate you confirm is the truth, and any executed action can be rated
  right or wrong by voice. Reliability buckets, ECE, Brier score and a risk-coverage
  curve are computed live and persisted to `data/calibration.json`.
- **Self-tuning threshold.** Once there is enough evidence, KODA sets its own
  act-alone cutoff from its measured reliability curve rather than a hand-picked
  constant.
- **Measured baseline** (`src/shadow.ts`, optional) sends the identical decision to
  a frontier LLM and records latency, tokens, cost and agreement, so speed and cost
  multiples are measurements rather than citations. Enabled by setting
  `ANTHROPIC_API_KEY`; without it nothing changes.

Endpoints: `GET /calibration`, `POST /feedback` `{runId, correct}`, `POST /calibration/reset`.

## Run it

```sh
npm install
cp .env.example .env      # TypeSafe key in TYPESAFE_AI_KEY
npm start
```

A Chrome window opens on Wikipedia with the KODA pill in the corner; the dashboard
is at <http://localhost:3000>. Click the pill or say "hey KODA", then speak:

- "open the page about the industrial revolution"
- "go to the history section"
- "who was James Watt"
- "search for Ada Lovelace"
- "scroll down" · "go back" · "back to the top" · "reload"

Escape mutes the microphone instantly. `npm run smoke` runs a scripted sequence
headlessly and prints every decision.

## How Jev is used

One request per command asks several **independent questions over the same state**
— the transcript plus the page's title, summary, headings, paragraphs and up to
~440 extracted links and anchors. They run in parallel; code consumes only the
answers the chosen intent needs.

| Question | Type | Decides |
|---|---|---|
| `intent` | Choice | click a link, search, answer, scroll, go back/forward, reload, or unclear |
| `target_link_N` | Choice over link ids | Which link or section matches, as a probability per candidate |
| `search_query` | Choice over transcript spans | The search topic, *selected* from the user's own words |
| `answer_passage` | Choice over paragraph ids | Which passage on the page answers the question |
| `goal_satisfied` | Noul | Whether the page already is what was asked for |

The API accepts at most 255 options per Choice, so pages with more candidates get
one `target_link_N` question per chunk in the same request, followed by a small
second request among the chunk winners.

## Measured (jev-1.13.0, Sept 2026)

A typical Wikipedia article carries 300–500 candidates: 20–31k input tokens,
**$0.0008–0.0014 and 0.5–1.5 s per command** for the fan-out request, plus
~$0.00004 and 0.3–0.7 s for the final round on link clicks. Output tokens are
unmetered. The first request after startup can take 20+ s, so the server warms up
on boot.

## Layout

```
src/server.ts       Express + SSE; POST /command, /confirm, /feedback; GET /events, /calibration
src/pipeline.ts     orchestration, confidence routing, learned thresholds, event log
src/jev.ts          question design, chunking, measured request wrapper
src/calibration.ts  reliability ledger: ECE, Brier, risk-coverage, threshold suggestion
src/shadow.ts       optional frontier-LLM baseline on the identical decision
src/browser.ts      Playwright wrapper and overlay bridge
src/dom/overlay.js  the in-page widget: wake word, confidence gauge, voice clarification
src/dom/extract.js  page-side link, section and paragraph extraction
public/             dashboard (vanilla HTML/JS)
scripts/smoke.ts    headless end-to-end run
```

## Stack

TypeScript on Node 20, Express with server-sent events, Playwright driving Chrome,
the TypeSafe SDK for all decisions, the browser Web Speech API for transcription,
and a shadow-DOM overlay injected into the page itself.

## Contributions

- **Nikolas Juhava** — original voice-to-Jev prototype: the question design,
  chunked Choice fan-out, confidence routing and the cost/latency dashboard that
  the rest is built on.
- **Qilun Li** — calibration and evaluation: the reliability ledger, ECE and Brier
  scoring, the risk-coverage curve, and the self-tuning act-alone threshold derived
  from it.
- **Atte Laakso** — the in-page product: shadow-DOM overlay, wake-word listening,
  hands-free voice clarification and rating, extractive answers, and the frontier-LLM
  baseline harness.

See `PITCH.md` for the argument, including an honest account of what is and is not
new here. TypeSafe docs: <https://docs.typesafe.ai>
