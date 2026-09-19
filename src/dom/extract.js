// Runs inside the Wikipedia page via page.evaluate(). Plain JS on purpose: bundler helpers
// (tsx/esbuild `__name`) don't exist in the page context. Must evaluate to a single expression.
(() => {
  const root = document.querySelector("#mw-content-text") || document.body;
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

  // Section anchors from the table of contents (Vector 2022 sidebar or legacy #toc).
  // Top-level sections first so long TOCs don't push them past the candidate cap.
  const sections = [];
  document.querySelectorAll('.vector-toc a[href^="#"], #toc a[href^="#"]').forEach((a) => {
    const text = clean(a.textContent).replace(/^\d+(\.\d+)*\s*/, "");
    if (!text || !a.hash || a.hash === "#") return;
    const li = a.closest("li");
    const cls = li ? li.className : "";
    const level = /toclevel-(\d)|vector-toc-level-(\d)/.exec(cls);
    sections.push({ text, href: a.hash, level: level ? Number(level[1] || level[2]) : 9 });
  });
  sections.sort((x, y) => x.level - y.level);

  const links = [];
  const seen = new Set();
  const skip = ".reference, .mw-editsection, .navbox, .catlinks, .mw-cite-backlink, .sidebar, .metadata, .hatnote, .infobox, sup, .mw-jump-link, .noprint";
  // Wikipedia serves hrefs as either "/wiki/X" or "https://en.wikipedia.org/wiki/X"; normalize to a path.
  root.querySelectorAll('a[href^="/wiki/"], a[href^="https://en.wikipedia.org/wiki/"]').forEach((a) => {
    if (a.closest(skip)) return;
    const href = (a.getAttribute("href") || "").replace(/^https:\/\/en\.wikipedia\.org/, "");
    const text = clean(a.textContent);
    if (!text || text.length > 80 || seen.has(href)) return;
    seen.add(href);
    const parent = a.closest("p, li, td, th, dd, h2, h3, h4") || a.parentElement;
    const full = clean(parent ? parent.textContent : "");
    const idx = full.indexOf(text);
    const context = idx >= 0 ? full.slice(Math.max(0, idx - 45), idx + text.length + 45) : full.slice(0, 90);
    links.push({ text, href, context });
  });

  const firstPara = Array.from(root.querySelectorAll("p")).find((p) => clean(p.textContent).length > 80);
  const headings = Array.from(document.querySelectorAll(".mw-heading2 h2, h2 .mw-headline, h2"))
    .map((h) => clean(h.textContent))
    .filter(Boolean);
  const heading = document.querySelector("#firstHeading");
  return {
    title: clean(heading ? heading.textContent : document.title),
    summary: clean(firstPara ? firstPara.textContent : "").slice(0, 700),
    headings: Array.from(new Set(headings)).slice(0, 40),
    sections,
    links,
  };
})()
