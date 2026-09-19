// Jev question design. One fan-out request per voice command: independent questions over the
// same state, answered in parallel; code consumes only the answers the chosen intent needs.
import { TypeSafeClient, choice, noul, type EntryType, type Questions, type SystemOneResult } from "@typesafe-ai/sdk";
import { bus, type Intent, type ModelCall } from "./events.js";
import { costUsd } from "./pricing.js";
import type { PageLink, PageSnapshot } from "./browser.js";

export const NO_LINK = "NONE";

export function createClient() {
  const apiKey = process.env.TYPESAFE_API_KEY ?? process.env.TYPESAFE_AI_KEY;
  if (!apiKey) throw new Error("Set TYPESAFE_AI_KEY (or TYPESAFE_API_KEY) in .env");
  return new TypeSafeClient({
    apiKey,
    defaultModel: process.env.TYPESAFE_MODEL ?? "jev-latest",
    timeout: 30_000,
  });
}

/** Contiguous word spans of the transcript — Jev selects the search topic instead of generating it. */
export function querySpans(transcript: string, maxSpans = 60): string[] {
  const words = transcript.replace(/[^\p{L}\p{N}\s'-]/gu, " ").split(/\s+/).filter(Boolean);
  const spans = new Set<string>();
  for (let len = Math.min(7, words.length); len >= 1; len--) {
    for (let i = 0; i + len <= words.length; i++) {
      spans.add(words.slice(i, i + len).join(" "));
      if (spans.size >= maxSpans) return [...spans];
    }
  }
  return [...spans];
}

// The API accepts at most 255 options per Choice question. Larger pages are split into chunks,
// each asked as its own question in the same request, then a second request picks among chunk winners.
export const MAX_CHOICES = 255;
const CHUNK = MAX_CHOICES - 1; // leave room for NONE

function linkQuestion(links: PageLink[]) {
  const criteria: Record<string, string | null> = { [NO_LINK]: "No link or section on this page matches what the user asked for" };
  for (const l of links) criteria[l.id] = null;
  return choice(
    {
      question: "Which entry in `page.links` is the one the user wants to open or jump to?",
      note: "Entries with ids starting with S are sections of the current page; ids starting with L are links to other articles. Only the ids listed as options are eligible for this question. Choose NONE if none of them match.",
    },
    criteria,
  );
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function buildQuestions(transcript: string, page: PageSnapshot) {
  const spanCriteria: Record<string, null> = {};
  for (const s of querySpans(transcript)) spanCriteria[s] = null;

  const linkChunks = chunk(page.links, CHUNK);
  const linkQuestions = Object.fromEntries(linkChunks.map((links, i) => [`target_link_${i}`, linkQuestion(links)]));

  return {
    ...linkQuestions,
    intent: choice(
      {
        question: "What kind of browser action does the user's request call for on the current Wikipedia page?",
        note: "The user speaks naturally; infer the single best action. Prefer click_link when the thing they name is a link or section on the current page; prefer search when it is a new topic not on this page.",
      },
      {
        click_link: "Open a link or jump to a section that exists on the current page (see `page.links`)",
        search: "Look up a new topic on Wikipedia that is not linked from the current page",
        scroll_down: "Scroll further down / read more of the current page",
        scroll_up: "Scroll back up toward the top of the current page",
        go_back: "Return to the previous page",
        unclear: "The request is not a browser action, or is too ambiguous to act on",
      },
    ),
    search_query: choice(
      "If the user wants to look up a new topic, which span of `user_request` is the topic itself — the exact words to type into Wikipedia search, without command words like 'search for', 'look up', 'go to', 'show me'?",
      spanCriteria,
    ),
    goal_satisfied: noul(
      "Does the current page (see `page.title` and `page.summary`) already show what the user is asking for, so that no navigation is needed?",
      {
        true: "The current page is the thing the user asked for",
        false: "The user is asking for something not on the current page, or for an action like scrolling or going back",
      },
    ),
  } satisfies Questions;
}

export function buildState(transcript: string, page: PageSnapshot) {
  return {
    user_request: transcript,
    page: {
      title: page.title,
      url: page.url,
      summary: page.summary,
      headings: page.headings,
      links: page.links.map((l) => ({ id: l.id, text: l.text, context: l.context })),
    },
  };
}

export interface ChoiceAnswer {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface Decision {
  model: string;
  intent: ChoiceAnswer;
  targetLink: ChoiceAnswer;
  searchQuery: ChoiceAnswer;
  goalSatisfied: number;
}

/** Measured wrapper: runs one request and publishes a model_call event with tokens, cost, latency. */
async function ask<Q extends Questions>(client: TypeSafeClient, runId: string, id: string, purpose: string, state: EntryType, questions: Q, candidateCount: number): Promise<SystemOneResult<Q>> {
  const t0 = performance.now();
  const { data, requestId } = await client.systemOne({ state, questions }).withResponse();
  const call: ModelCall = {
    id: `${runId}-${id}`,
    model: data.model,
    purpose,
    questionCount: Object.keys(questions).length,
    candidateCount,
    inputTokens: data.usage.input_tokens,
    outputTokens: data.usage.output_tokens,
    costUsd: costUsd(data.model, data.usage.input_tokens, data.usage.output_tokens),
    latencyMs: Math.round(performance.now() - t0),
    requestId,
  };
  bus.publish({ type: "model_call", runId, call });
  return data;
}

/**
 * Stage 1: one fan-out request answers intent, search span, goal check, and link selection
 * (one Choice per chunk of ≤254 links). Stage 2, only when the intent is click_link and the page
 * needed more than one chunk: pick among the chunk winners over a reduced state.
 */
export async function decide(client: TypeSafeClient, runId: string, transcript: string, page: PageSnapshot): Promise<Decision> {
  const questions = buildQuestions(transcript, page);
  const chunkKeys = Object.keys(questions).filter((k) => k.startsWith("target_link_"));
  const spanCount = Object.keys(questions.search_query.criteria).length;
  const d = await ask(
    client,
    runId,
    "decide",
    chunkKeys.length > 1
      ? `intent + search span + goal check + link selection across ${chunkKeys.length} chunks (one fan-out request)`
      : "intent + link selection + search span + goal check (one fan-out request)",
    buildState(transcript, page),
    questions,
    page.links.length + chunkKeys.length + spanCount,
  );

  const answers = d.answers as Record<string, ChoiceAnswer | { noul: number }>;
  const chunkAnswers = chunkKeys.map((k) => answers[k] as ChoiceAnswer);
  const intent = answers.intent as ChoiceAnswer;
  const searchQuery = answers.search_query as ChoiceAnswer;
  const goalSatisfied = (answers.goal_satisfied as { noul: number }).noul;

  let targetLink: ChoiceAnswer;
  if (chunkAnswers.length === 1) {
    targetLink = chunkAnswers[0];
  } else if (intent.choice !== "click_link") {
    // Not needed for this intent; merge for display only, no second request.
    targetLink = mergeChunks(chunkAnswers);
  } else {
    // Stage 2: finalists = top 3 of each chunk (excluding NONE), judged together.
    const finalistIds = new Set(chunkAnswers.flatMap((a) => topK(a.probabilities, 4).filter((c) => c.id !== NO_LINK).slice(0, 3).map((c) => c.id)));
    const finalists = page.links.filter((l) => finalistIds.has(l.id));
    const d2 = await ask(
      client,
      runId,
      "final",
      `final link selection among ${finalists.length} chunk winners`,
      buildState(transcript, { ...page, links: finalists }),
      { target_link: linkQuestion(finalists) },
      finalists.length + 1,
    );
    targetLink = d2.answers.target_link;
  }

  return { model: d.model, intent, targetLink, searchQuery, goalSatisfied };
}

/** Best-effort merge of per-chunk distributions for display when no final round is run. */
function mergeChunks(chunks: ChoiceAnswer[]): ChoiceAnswer {
  const probabilities: Record<string, number> = {};
  for (const c of chunks) for (const [id, p] of Object.entries(c.probabilities)) probabilities[id] = Math.max(probabilities[id] ?? 0, p);
  const best = topK(probabilities, 1)[0];
  return { choice: best?.id ?? NO_LINK, confidence: Math.min(...chunks.map((c) => c.confidence)), probabilities };
}

export function topK(probabilities: Record<string, number>, k = 5): { id: string; probability: number }[] {
  return Object.entries(probabilities)
    .map(([id, probability]) => ({ id, probability }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, k);
}

export const INTENTS: Intent[] = ["click_link", "search", "scroll_down", "scroll_up", "go_back", "unclear"];
