// Playwright wrapper around a single Wikipedia tab. Code owns execution; Jev only decides.
import { chromium, type Browser, type Page } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Page-side extraction script; see src/dom/extract.js for why it is plain JS.
const EXTRACT_SCRIPT = readFileSync(fileURLToPath(new URL("./dom/extract.js", import.meta.url)), "utf8");
// In-page assistant overlay, injected into every page and surviving navigation.
const OVERLAY_SCRIPT = readFileSync(fileURLToPath(new URL("./dom/overlay.js", import.meta.url)), "utf8");

interface RawExtract {
  title: string;
  summary: string;
  headings: string[];
  sections: { text: string; href: string; level: number }[];
  links: { text: string; href: string; context: string }[];
}

export interface PageLink {
  id: string; // L001… for article links, S001… for section (table-of-contents) anchors
  text: string;
  href: string;
  context: string; // a little surrounding text so Jev can disambiguate
}

export interface PageSnapshot {
  title: string;
  url: string;
  summary: string;
  headings: string[];
  links: PageLink[];
  extractMs: number;
}

const WIKI = "https://en.wikipedia.org";
const EXCLUDED_NAMESPACES = /^\/wiki\/(File|Special|Help|Category|Template|Wikipedia|Talk|Portal|User|Template_talk|Wikipedia_talk|Module|Draft|Book|MediaWiki):/i;

export interface OverlayState {
  phase: "clarify" | "done" | "error";
  runId?: string;
  top?: number;
  escalated?: boolean;
  confident?: boolean;
  ok?: boolean;
  description?: string;
  message?: string;
  candidates?: { id: string; label: string; probability: number }[];
}

export class WikiBrowser {
  private browser: Browser | null = null;
  private page: Page | null = null;
  readonly maxLinks: number;

  /** Wired up by the server so the in-page overlay can drive the pipeline. */
  onCommand: (text: string) => void = () => {};
  onConfirm: (runId: string, candidateId: string) => void = () => {};
  onFeedback: (runId: string, correct: boolean) => void = () => {};

  constructor(opts: { maxLinks?: number } = {}) {
    // Keeps state well under the documented 32k-token budget even on link-heavy articles.
    this.maxLinks = opts.maxLinks ?? 440;
  }

  async start(headless = false, startUrl = `${WIKI}/wiki/Main_Page`) {
    // BROWSER_CHANNEL=chrome|msedge drives the system browser; unset uses Playwright's bundled Chromium.
    const channel = process.env.BROWSER_CHANNEL || undefined;
    this.browser = await chromium.launch({ headless, channel });
    const ctx = await this.browser.newContext({ viewport: { width: 1280, height: 900 } });
    // Voice happens in the page itself, so the page needs the mic.
    await ctx.grantPermissions(["microphone"]).catch(() => {});
    // One bridge from the overlay back into Node.
    await ctx.exposeFunction("__sxBridge", (raw: string) => {
      try {
        const m = JSON.parse(raw) as { t: string; text?: string; runId?: string; candidateId?: string; correct?: boolean };
        if (m.t === "command" && m.text) this.onCommand(m.text);
        else if (m.t === "confirm" && m.runId && m.candidateId) this.onConfirm(m.runId, m.candidateId);
        else if (m.t === "feedback" && m.runId && typeof m.correct === "boolean") this.onFeedback(m.runId, m.correct);
      } catch {
        /* ignore malformed bridge messages */
      }
    });
    await ctx.addInitScript({ content: OVERLAY_SCRIPT });
    this.page = await ctx.newPage();
    await this.page.goto(startUrl, { waitUntil: "domcontentloaded" });
  }

  async stop() {
    await this.browser?.close();
    this.browser = null;
    this.page = null;
  }

  private get p(): Page {
    if (!this.page) throw new Error("Browser not started");
    return this.page;
  }

  /** Extract the article body links, table-of-contents anchors, and a short summary. */
  async snapshot(): Promise<PageSnapshot> {
    const t0 = performance.now();
    const raw = (await this.p.evaluate(EXTRACT_SCRIPT)) as RawExtract;

    const filtered = raw.links.filter((l) => !EXCLUDED_NAMESPACES.test(l.href));
    const links: PageLink[] = [];
    raw.sections.slice(0, 60).forEach((s, i) => links.push({ id: `S${String(i + 1).padStart(3, "0")}`, text: s.text, href: s.href, context: "section of the current page" }));
    filtered.slice(0, this.maxLinks).forEach((l, i) => links.push({ id: `L${String(i + 1).padStart(3, "0")}`, ...l }));

    return {
      title: raw.title,
      url: this.p.url(),
      summary: raw.summary,
      headings: raw.headings,
      links,
      extractMs: Math.round(performance.now() - t0),
    };
  }

  /** Push assistant state into the page overlay. Never let UI failures break the run. */
  async pushOverlay(state: OverlayState) {
    try {
      await this.p.evaluate((s) => (window as unknown as { __sxUpdate?: (x: unknown) => void }).__sxUpdate?.(s), state);
    } catch {
      /* page navigating, or overlay not mounted yet */
    }
  }

  async clickLink(link: PageLink) {
    if (link.href.startsWith("#")) {
      // Section anchor: scroll into view rather than navigating.
      await this.p.evaluate((hash) => {
        const el = document.getElementById(decodeURIComponent(hash.slice(1)));
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, link.href);
      return;
    }
    await this.p.goto(WIKI + link.href, { waitUntil: "domcontentloaded" });
  }

  async search(query: string) {
    const url = `${WIKI}/w/index.php?search=${encodeURIComponent(query)}`;
    await this.p.goto(url, { waitUntil: "domcontentloaded" });
  }

  async scroll(direction: "down" | "up") {
    await this.p.evaluate((dir) => window.scrollBy({ top: dir === "down" ? window.innerHeight * 0.8 : -window.innerHeight * 0.8, behavior: "smooth" }), direction);
  }

  async back() {
    await this.p.goBack({ waitUntil: "domcontentloaded" });
  }

  async goto(url: string) {
    await this.p.goto(url, { waitUntil: "domcontentloaded" });
  }
}
