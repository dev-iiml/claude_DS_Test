/**
 * Builds design-system/design-system.html — ONE self-contained file (no network) with the brand book,
 * foundations from tokens.json, live previews of every component, the proposals and the screens.
 *
 *   node design-system/viewer/build.mjs        # refresh components/bundle.js + bundle.css first
 *   node design-system/viewer/build-html.mjs
 *
 * Live previews run the real components (bundle.js) inside same-origin iframes, so breakpoints,
 * fixed bars and the theme behave as in the app. Dev-only; no dependencies beyond Node.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DS = path.resolve(HERE, "..");
const REPO = path.resolve(DS, "..");
const read = (p) => readFileSync(path.join(DS, p), "utf8");
const b64 = (abs) => readFileSync(abs).toString("base64");

/* ---------- tiny markdown renderer (headings, lists, tables, code, quotes, inline) ---------- */

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function inline(s) {
  return s
    .split(/(`[^`]+`)/)
    .map((part) => {
      if (/^`[^`]+`$/.test(part)) return `<code>${esc(part.slice(1, -1))}</code>`;
      return esc(part)
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) =>
          /^https?:/.test(u)
            ? `<a href="${u}" target="_blank" rel="noopener">${t}</a>`
            : `<span class="ref">${t}</span>`,
        )
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[\s(])_([^_]+)_(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>")
        .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
    })
    .join("");
}
function md(src, { shift = 0 } = {}) {
  const lines = src.replace(/\r/g, "").split("\n");
  const out = [];
  let i = 0;
  const isTableSep = (l) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);
  const cells = (l) =>
    l
      .trim()
      .replace(/^\||\|$/g, "")
      .split(/(?<!\\)\|/)
      .map((c) => c.trim());
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) {
      i++;
      continue;
    }
    let m;
    if ((m = /^```(\w*)/.exec(l))) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) {
      const lvl = Math.min(6, m[1].length + shift);
      out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`);
      i++;
      continue;
    }
    if (/^---+\s*$/.test(l)) {
      out.push("<hr>");
      i++;
      continue;
    }
    if (/^\s*\|/.test(l) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(l);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(
        `<div class="tbl"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`,
      );
      continue;
    }
    if (/^>\s?/.test(l)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${md(buf.join("\n"), { shift })}</blockquote>`);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const buf = [];
      while (i < lines.length && (/^\s*([-*]|\d+\.)\s+/.test(lines[i]) || /^\s{2,}\S/.test(lines[i])))
        buf.push(lines[i++]);
      out.push(list(buf));
      continue;
    }
    const buf = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|```|>|\s*([-*]|\d+\.)\s+|\s*\|)/.test(lines[i]) &&
      !/^---+\s*$/.test(lines[i])
    )
      buf.push(lines[i++].trim());
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}
function list(buf) {
  const indent = (l) => l.match(/^\s*/)[0].length;
  const base = indent(buf[0]);
  const ordered = /^\s*\d+\./.test(buf[0]);
  const items = [];
  for (const l of buf) {
    if (indent(l) === base && /^\s*([-*]|\d+\.)\s+/.test(l))
      items.push({ text: l.replace(/^\s*([-*]|\d+\.)\s+/, ""), sub: [] });
    else if (items.length) {
      if (indent(l) > base && /^\s*([-*]|\d+\.)\s+/.test(l)) items.at(-1).sub.push(l);
      else items.at(-1).text += " " + l.trim();
    }
  }
  const tag = ordered ? "ol" : "ul";
  return `<${tag}>${items.map((it) => `<li>${inline(it.text)}${it.sub.length ? list(it.sub) : ""}</li>`).join("")}</${tag}>`;
}
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/* ---------- inputs ---------- */

const tokens = JSON.parse(read("tokens.json"));
const bundleJs = read("components/bundle.js");
const bundleCss = read("components/bundle.css");
if (/<\/script|<!--/i.test(bundleJs) || /<\/style/i.test(bundleCss)) throw new Error("bundle contains a closing tag");
const FS = path.join(REPO, "node_modules/@fontsource-variable");
const fontCss = [
  ["Inter Variable", "inter/files/inter-latin-wght-normal.woff2", "100 900"],
  ["Newsreader Variable", "newsreader/files/newsreader-latin-wght-normal.woff2", "200 800"],
]
  .map(
    ([fam, f, w]) =>
      `@font-face{font-family:"${fam}";font-style:normal;font-weight:${w};font-display:swap;src:url(data:font/woff2;base64,${b64(path.join(FS, f))}) format("woff2")}`,
  )
  .join("");

const COMP_DIR = path.join(DS, "components");
const comps = readdirSync(COMP_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "Cover")
  .map((d) => {
    const name = d.name;
    const preview = readFileSync(path.join(COMP_DIR, name, "preview.html"), "utf8");
    const marker = /@dsCard([^>]*)-->/.exec(preview)?.[1] ?? "";
    const group = /group="([^"]+)"/.exec(marker)?.[1] ?? "Other";
    const height = Number(/height=(\d+)/.exec(marker)?.[1] ?? 300);
    const width = Number(/width=(\d+)/.exec(marker)?.[1] ?? 960);
    const readme = existsSync(path.join(COMP_DIR, name, "README.md"))
      ? readFileSync(path.join(COMP_DIR, name, "README.md"), "utf8")
      : "";
    const shots = [...preview.matchAll(/screens\/([a-z0-9-]+)-mobile-dark\.webp/g)].map((m) => m[1]);
    return { name, group, height, width, readme, shot: shots[0] ?? null };
  });

const GROUPS = ["Actions", "Forms", "Feedback", "Identity & status", "Typography", "Layout & navigation"];
const SCREEN_ORDER = [
  "landing",
  "login",
  "signup",
  "signup-typing",
  "onboarding-welcome",
  "onboarding-about",
  "onboarding-about-error",
  "onboarding-business",
  "onboarding-consent",
  "onboarding-consent-error",
  "dashboard-unconnected",
  "dashboard",
  "passport-unconnected",
  "passport",
  "connect",
  "connect-error",
  "connect-provider",
  "signals",
  "access",
  "account",
  "risk-console",
];

function splitReadme(src) {
  const body = src.replace(/^#\s+.*\n+/, "");
  const parts = body.split(/\n{2,}/);
  return { summary: parts[0] ?? "", rest: parts.slice(1).join("\n\n") };
}

/* ---------- sections ---------- */

const nav = [];
const sections = [];
function section(id, title, html, { group } = {}) {
  nav.push({ id, title, group });
  sections.push(`<section id="${id}" class="sec"><h1 class="sec-title">${esc(title)}</h1>${html}</section>`);
}

// Overview
const cover = readFileSync(path.join(COMP_DIR, "Cover/preview.html"), "utf8");
const coverSvg = /<svg[\s\S]*<\/svg>/.exec(cover)[0].replace(/<!--[\s\S]*?-->/, "");
section(
  "overview",
  "Overview",
  `<div class="cover">${coverSvg}<div class="cover-text"><p class="cover-name">CreatorCo<i></i></p><p class="cover-tag">A professional and financial network for creators in India. Design system v2 — the product as built.</p></div></div>
  <div class="prose">${md(read("README.md"), { shift: 1 })}</div>`,
  { group: "Brand book" },
);

// Foundations
const themeVal = (v, th) => (typeof v === "string" ? v : (v[th] ?? v.dark));
const colourRows = tokens.color.tokens
  .map(
    (
      t,
    ) => `<tr><td><span class="sw" style="--c:${themeVal(t.value, "dark")}"></span><code>${esc(themeVal(t.value, "dark"))}</code></td>
    <td><span class="sw" style="--c:${themeVal(t.value, "light")}"></span><code>${esc(themeVal(t.value, "light"))}</code></td>
    <td><code>${t.name}</code></td><td>${inline(t.usage ?? "")}</td></tr>`,
  )
  .join("");
const typeHtml = tokens.type.groups
  .map(
    (g) =>
      `<h3>${esc(g.name)}</h3><div class="type-list">${g.styles
        .map((s) => {
          const fam = tokens.type.families[s.family ?? g.family];
          const lh = typeof s.lineHeight === "number" ? s.lineHeight : s.lineHeight;
          const style = `font-family:${fam.replace(/"/g, "&quot;")};font-size:${s.fontSize};line-height:${lh};font-weight:${s.fontWeight};letter-spacing:${s.letterSpacing ?? "normal"}`;
          const sample =
            s.sample ??
            (parseInt(s.fontSize) >= 20
              ? "Your influence opens doors"
              : "Your business earns the limit — ₹1,50,000 · 14 of 15 months");
          return `<div class="type-row"><div class="type-meta"><code>${s.name}</code><span>${s.fontSize} / ${s.lineHeight} · ${s.fontWeight}</span></div><div class="type-sample" style="${style}">${esc(sample)}</div><div class="type-use">${inline(s.usage ?? "")}</div></div>`;
        })
        .join("")}</div>`,
  )
  .join("");
const simpleTable = (fam, render) =>
  `${tokens[fam].note ? `<p class="note">${inline(tokens[fam].note)}</p>` : ""}<div class="tbl"><table><thead><tr><th></th><th>Token</th><th>Value</th><th>Usage</th></tr></thead><tbody>${tokens[
    fam
  ].tokens
    .map(
      (t) =>
        `<tr><td class="vis">${render(t)}</td><td><code>${t.name}</code></td><td><code>${esc(typeof t.value === "string" ? t.value : `dark ${t.value.dark} · light ${t.value.light}`)}</code></td><td>${inline(t.usage ?? "")}</td></tr>`,
    )
    .join("")}</tbody></table></div>`;
section(
  "foundations",
  "Foundations",
  `<p class="lede">Generated from <code>design-system/tokens.json</code>, which <code>npm run tokens</code> writes from <code>src/design/tokens.ts</code>. Dark is the default; the light column shows the Light appearance.</p>
  <h2 id="f-colour">Colour</h2><div class="tbl"><table class="colours"><thead><tr><th>Dark</th><th>Light</th><th>Token</th><th>Usage</th></tr></thead><tbody>${colourRows}</tbody></table></div>
  <h2 id="f-type">Typography</h2>${typeHtml}
  <h2 id="f-spacing">Spacing</h2>${simpleTable("spacing", (t) => `<span class="bar" style="width:${t.value}"></span>`)}
  <h2 id="f-radius">Radius</h2>${simpleTable("radius", (t) => `<span class="rad" style="border-radius:${t.value}"></span>`)}
  <h2 id="f-shadow">Shadow</h2>${simpleTable("shadow", (t) => `<span class="shd" style="box-shadow:${typeof t.value === "string" ? t.value : t.value.dark}"></span>`)}
  <h2 id="f-size">Sizes and touch target</h2>${simpleTable("size", (t) => `<span class="bar sz" style="width:${t.value}"></span>`)}
  <h2 id="f-motion">Motion</h2>${simpleTable("timing", () => "")}`,
  { group: "Brand book" },
);

// Components
function card(c, proposed) {
  const { summary, rest } = splitReadme(c.readme);
  return `<article class="comp" id="c-${c.name}">
    <header><h2>${c.name}</h2>${proposed ? '<span class="pill warn">Proposed — not adopted</span>' : ""}</header>
    <div class="summary">${md(summary)}</div>
    <div class="spec" data-spec="${c.name}" data-w="${c.width}" data-h="${c.height}"><div class="stage"><div class="loading">Loading preview…</div></div></div>
    ${rest.trim() ? `<details><summary>Guidelines, props and states</summary><div class="prose">${md(rest, { shift: 1 })}</div></details>` : ""}
  </article>`;
}
for (const g of GROUPS) {
  const list = comps.filter((c) => c.group === g);
  if (list.length) section(`g-${slug(g)}`, g, list.map((c) => card(c, false)).join(""), { group: "Components" });
}
section(
  "proposed",
  "Proposed",
  `<p class="lede">Everything here is <strong>proposed — not adopted</strong>. Each is composed from existing components and tokens. Status and detail: <a href="#doc-proposals">Proposals</a>.</p>` +
    comps
      .filter((c) => c.group === "Proposed")
      .map((c) => card(c, true))
      .join(""),
  { group: "Components" },
);

// Screens
const SHOTS = path.join(DS, "screens");
const screens = SCREEN_ORDER.map((key) => {
  const c = comps.find((x) => x.shot === key);
  const title = /—|—/.test(c?.readme ?? "")
    ? c.readme
        .split("\n")
        .find((l) => / — /.test(l))
        .split(" — ")[0]
    : key;
  const note = (c?.readme ?? "").match(/\(Stage 07 build, demo seed\)\. (.*?)\n/)?.[1] ?? "";
  const img = (dev, th) =>
    `<img class="t-${th}" alt="${esc(title)}, ${dev}, ${th}" src="data:image/webp;base64,${b64(path.join(SHOTS, `${key}-${dev}-${th}.webp`))}">`;
  return `<article class="screen" id="s-${key}"><header><h2>${esc(title)}</h2><p>${esc(note)}</p></header>
    <div class="shots"><figure class="m">${img("mobile", "dark")}${img("mobile", "light")}<figcaption>iPhone · 390pt</figcaption></figure>
    <figure class="d">${img("desktop", "dark")}${img("desktop", "light")}<figcaption>Desktop · 1280px</figcaption></figure></div></article>`;
}).join("");
section(
  "screens",
  "Screens",
  `<p class="lede">Screenshots of the running app (Stage 07 build, demo seed data). They follow the appearance switch at the top. Not-yet-built screens — status reveal, eligibility result, membership-card screen, invitation — are in <a href="#proposed">Proposed</a>.</p>${screens}`,
  { group: "Product" },
);

// Guides
for (const [file, title] of [
  ["patterns.md", "Patterns"],
  ["trust-and-copy.md", "Trust and copy"],
  ["accessibility.md", "Accessibility"],
  ["USAGE.md", "Usage and workflow"],
  ["PROPOSALS.md", "Proposals"],
  ["CHANGELOG.md", "Changelog"],
]) {
  section(
    `doc-${slug(title).split("-")[0]}`,
    title,
    `<div class="prose">${md(read(file).replace(/^#\s+.*\n+/, ""), { shift: 1 })}</div>`,
    {
      group: "Guides",
    },
  );
}

/* ---------- page ---------- */

const navHtml = ["Brand book", "Components", "Product", "Guides"]
  .map(
    (g) =>
      `<p class="nav-group">${g}</p><ul>${nav
        .filter((n) => n.group === g)
        .map((n) => `<li><a href="#${n.id}">${esc(n.title)}</a></li>`)
        .join("")}</ul>`,
  )
  .join("");

const PAGE_CSS = `
:root{--gut:16px}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:72px}
body{margin:0;background:var(--paper);color:var(--ink);font:400 var(--type-subhead-size)/1.55 var(--font-stack-sans);-webkit-font-smoothing:antialiased}
a{color:var(--gold);text-decoration:none}a:hover{text-decoration:underline}
code{font:500 0.86em/1.4 var(--font-stack-mono);background:var(--elevated);border-radius:6px;padding:.1em .38em;color:var(--ink)}
.top{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:16px;height:56px;padding:0 20px;border-bottom:1px solid var(--line);background:var(--bar);-webkit-backdrop-filter:blur(var(--motion-bar-blur));backdrop-filter:blur(var(--motion-bar-blur))}
.brand{font:400 21px/1 var(--font-stack-serif);letter-spacing:-.02em;color:var(--ink);display:flex;align-items:baseline;gap:4px}
.brand i{width:6px;height:6px;border-radius:999px;background:var(--gold);display:inline-block;transform:translateY(-2px)}
.brand small{font:500 var(--type-footnote-size)/1 var(--font-stack-sans);color:var(--ink-subtle);margin-left:10px;letter-spacing:0}
.seg{margin-left:auto;display:grid;grid-auto-flow:column;gap:2px;padding:2px;border-radius:11px;background:var(--elevated);box-shadow:inset 0 0 0 1px var(--line)}
.seg button{all:unset;cursor:pointer;min-height:30px;padding:0 12px;border-radius:9px;font:500 var(--type-footnote-size)/30px var(--font-stack-sans);color:var(--ink-muted);text-align:center}
.seg button[aria-pressed=true]{background:var(--ink);color:var(--paper)}
.seg button:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.menu{all:unset;display:none;cursor:pointer;color:var(--ink);font:600 var(--type-subhead-size)/1 var(--font-stack-sans);padding:10px 4px}
.layout{display:grid;grid-template-columns:var(--size-sidebar) minmax(0,1fr)}
.side{position:sticky;top:56px;height:calc(100dvh - 56px);overflow:auto;padding:20px 12px 40px;border-right:1px solid var(--line);background:color-mix(in srgb,var(--surface) 60%,transparent)}
.side ul{list-style:none;margin:0 0 14px;padding:0}
.side a{display:block;padding:7px 12px;border-radius:var(--radius-token-sm);color:var(--ink-muted);font-weight:500}
.side a:hover{background:var(--elevated);color:var(--ink);text-decoration:none}
.side a[aria-current=true]{background:var(--elevated);color:var(--ink)}
.nav-group{margin:10px 12px 6px;font:600 var(--type-caption-2-size)/1 var(--font-stack-sans);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-subtle)}
main{min-width:0;padding:32px clamp(var(--gut),4vw,48px) 96px;max-width:1240px}
.sec{padding-top:24px;margin-bottom:72px}
.sec-title{font:700 var(--type-large-title-size)/1.15 var(--font-stack-sans);letter-spacing:-.025em;margin:0 0 20px}
.lede{max-width:72ch;color:var(--ink-muted);font-size:var(--type-body-size);margin:0 0 24px}
.note{color:var(--ink-muted)}
.prose{max-width:80ch}
.prose h2,main h2{font:700 var(--type-title-2-size)/1.25 var(--font-stack-sans);letter-spacing:-.02em;margin:40px 0 12px}
.prose h3,main h3{font:600 var(--type-headline-size)/1.3 var(--font-stack-sans);margin:28px 0 8px}
.prose h4{font:600 var(--type-subhead-size)/1.3 var(--font-stack-sans);margin:20px 0 6px;color:var(--ink-muted)}
.prose p,.prose li{color:var(--ink)}
.prose ul,.prose ol{padding-left:1.3em}.prose li{margin:4px 0}
blockquote{margin:16px 0;padding:12px 16px;border-radius:var(--radius-token-control);background:var(--gold-soft);color:var(--ink)}
blockquote p{margin:6px 0}
pre{overflow:auto;padding:14px 16px;border-radius:var(--radius-token-control);background:var(--surface);box-shadow:inset 0 0 0 1px var(--line)}
pre code{background:none;padding:0}
hr{border:0;border-top:1px solid var(--line);margin:32px 0}
.tbl{overflow-x:auto;margin:12px 0 20px;border-radius:var(--radius-token-lg);box-shadow:inset 0 0 0 1px var(--line);background:var(--surface)}
table{border-collapse:collapse;width:100%;font-size:var(--type-footnote-size)}
th,td{text-align:left;vertical-align:top;padding:10px 14px;border-bottom:1px solid var(--line)}
tr:last-child td{border-bottom:0}
th{font-weight:600;color:var(--ink-subtle);background:var(--elevated)}
.colours td:nth-child(-n+2){white-space:nowrap}
.sw{display:inline-block;width:28px;height:28px;border-radius:8px;vertical-align:middle;margin-right:8px;background:linear-gradient(var(--c),var(--c)),repeating-conic-gradient(#888 0 25%,#ccc 0 50%) 0 0/10px 10px;box-shadow:inset 0 0 0 1px var(--line-strong)}
.vis{width:120px}
.bar{display:inline-block;height:12px;max-width:110px;border-radius:3px;background:var(--gold)}
.bar.sz{background:var(--ink-subtle);height:10px}
.rad{display:inline-block;width:56px;height:40px;background:var(--elevated);box-shadow:inset 0 0 0 1px var(--input-border)}
.shd{display:inline-block;width:64px;height:40px;border-radius:10px;background:var(--elevated)}
.type-list{border-radius:var(--radius-token-lg);box-shadow:inset 0 0 0 1px var(--line);background:var(--surface)}
.type-row{display:grid;grid-template-columns:170px minmax(0,1fr) 260px;gap:16px;align-items:baseline;padding:14px 16px;border-bottom:1px solid var(--line)}
.type-row:last-child{border-bottom:0}
.type-meta{display:flex;flex-direction:column;gap:4px;font-size:var(--type-caption-size);color:var(--ink-subtle)}
.type-sample{min-width:0;overflow-wrap:anywhere}
.type-use{font-size:var(--type-footnote-size);color:var(--ink-muted)}
.cover{position:relative;height:300px;overflow:hidden;border-radius:var(--radius-token-card);background:var(--paper);box-shadow:inset 0 0 0 1px var(--line);margin-bottom:32px}
.cover svg{position:absolute;right:0;top:0;height:300px;width:960px;max-width:none}
.cover .platinum{fill:var(--primary)}.cover .gold{fill:var(--gold)}.cover .subtle{fill:var(--ink-subtle)}.cover .cut{fill:var(--paper)}
.cover .card{rx:var(--radius-token-card)}.cover .tile{rx:var(--radius-token-xl)}
.cover-text{position:absolute;left:36px;bottom:32px;max-width:440px}
.cover-name{margin:0;font:400 clamp(52px,9vw,88px)/.92 var(--font-stack-serif);letter-spacing:-.02em}
.cover-name i{display:inline-block;width:.16em;height:.16em;border-radius:999px;background:var(--gold);margin-left:.06em}
.cover-tag{margin:14px 0 0;font-size:14px;color:var(--ink-muted)}
.comp,.screen{margin:0 0 40px;padding:20px;border-radius:var(--radius-token-card);background:var(--surface);box-shadow:inset 0 0 0 1px var(--line)}
.comp header,.screen header{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.comp h2,.screen h2{margin:0;font:700 var(--type-title-3-size)/1.2 var(--font-stack-sans)}
.screen header p{flex-basis:100%;margin:2px 0 0;color:var(--ink-muted)}
.summary p{margin:6px 0 14px;color:var(--ink-muted);max-width:80ch}
.pill{display:inline-flex;align-items:center;border-radius:999px;padding:4px 10px;font:500 var(--type-footnote-size)/1 var(--font-stack-sans)}
.pill.warn{background:var(--warning-soft);color:var(--warning)}
.spec{border-radius:var(--radius-token-lg);overflow:hidden;box-shadow:inset 0 0 0 1px var(--line);background:var(--paper)}
.stage{position:relative;overflow:hidden}
.stage iframe{display:block;border:0;transform-origin:0 0;background:var(--paper)}
.loading{padding:24px;color:var(--ink-subtle)}
details{margin-top:14px}
summary{cursor:pointer;color:var(--gold);font-weight:600;padding:6px 0}
summary:focus-visible{outline:2px solid var(--gold);outline-offset:2px;border-radius:4px}
.shots{display:grid;grid-template-columns:300px minmax(0,1fr);gap:20px;align-items:start;margin-top:16px}
.shots figure{margin:0}.shots img{display:block;width:100%;height:auto;border-radius:12px;box-shadow:0 0 0 1px var(--line)}
figcaption{margin-top:8px;font-size:var(--type-footnote-size);color:var(--ink-subtle)}
.t-light{display:none!important}
[data-theme=light] .t-light{display:block!important}[data-theme=light] .t-dark{display:none!important}
@media (prefers-color-scheme:light){[data-theme=system] .t-light{display:block!important}[data-theme=system] .t-dark{display:none!important}}
@media (max-width:900px){
  .layout{grid-template-columns:1fr}
  .side{display:none;position:fixed;inset:56px 0 0 0;z-index:30;height:auto;background:var(--paper)}
  body.nav-open .side{display:block}
  .menu{display:inline-block}
  .brand small{display:none}
  .type-row{grid-template-columns:1fr}
  .shots{grid-template-columns:1fr}
  .shots .m{max-width:320px}
  .comp,.screen{padding:14px}
  .cover{height:260px}.cover svg{opacity:.35}
}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
`;

const PAGE_JS = `
(function(){
  var KEY='cc-ds-theme', root=document.documentElement;
  function get(){try{return localStorage.getItem(KEY)||'dark'}catch(e){return 'dark'}}
  function set(t){root.setAttribute('data-theme',t);try{localStorage.setItem(KEY,t)}catch(e){}
    document.querySelectorAll('.seg button').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.t===t))});
    document.querySelectorAll('.stage iframe').forEach(function(f){try{f.contentDocument.documentElement.setAttribute('data-theme',t)}catch(e){}});}
  set(get());
  document.querySelectorAll('.seg button').forEach(function(b){b.addEventListener('click',function(){set(b.dataset.t)})});
  var menu=document.querySelector('.menu');
  menu.addEventListener('click',function(){var o=document.body.classList.toggle('nav-open');menu.setAttribute('aria-expanded',String(o))});
  document.querySelectorAll('.side a').forEach(function(a){a.addEventListener('click',function(){document.body.classList.remove('nav-open');menu.setAttribute('aria-expanded','false')})});

  var CSS=document.getElementById('ds-css').textContent;
  // Responsive specimens (960) fill the column; device-specific ones (390 iPhone, 1180 desktop shells) keep
  // their layout width and scale down to fit, so their breakpoints stay true.
  function layoutW(spec){var w=+spec.dataset.w,cw=spec.clientWidth;return w===960?cw:w}
  function fit(spec){var f=spec._f,cw=spec.clientWidth,lw=layoutW(spec),s=Math.min(1,cw/lw),stage=spec.firstElementChild;
    if(!f){stage.style.height=Math.ceil((+spec.dataset.h)*s)+'px';return}
    if(f.style.width!==lw+'px')f.style.width=lw+'px';
    f.style.transform=s<1?'scale('+s+')':'none';stage.style.height=Math.ceil(f._h*s)+'px';}
  function mount(spec){
    if(spec._f)return; var name=spec.dataset.spec,w=+spec.dataset.w,h=+spec.dataset.h,stage=spec.firstElementChild;
    var f=document.createElement('iframe');f.title=name+' — live preview';f.setAttribute('loading','eager');
    f.style.width=layoutW(spec)+'px';f.style.height=h+'px';f._h=h;stage.innerHTML='';stage.appendChild(f);spec._f=f;
    var d=f.contentDocument;d.open();
    d.write('<!doctype html><html lang="en-IN" data-theme="'+root.getAttribute('data-theme')+'"><head><meta charset="utf-8"><style>'+CSS+'html,body{margin:0}html{overflow:hidden}</style></head><body><div id="root"></div></body></html>');
    d.close();
    try{window.CreatorCo.mount(name,d.getElementById('root'))}catch(e){stage.innerHTML='<div class="loading">Preview failed: '+e.message+'</div>';return}
    var n=0;function size(){var r=d.getElementById('root');if(!r)return;var ch=Math.ceil(Math.max(r.scrollHeight,r.getBoundingClientRect().height,120));
      if(Math.abs(ch-f._h)>2&&n++<40){f._h=Math.min(ch,4000);f.style.height=f._h+'px'}fit(spec)}
    setTimeout(size,60);setTimeout(size,400);
    if(window.ResizeObserver){new ResizeObserver(size).observe(d.body)}
  }
  var specs=document.querySelectorAll('.spec');specs.forEach(fit);
  if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){mount(e.target);io.unobserve(e.target)}})},{rootMargin:'800px 0px'});specs.forEach(function(s){io.observe(s)})}
  else specs.forEach(mount);
  if(window.ResizeObserver){var ro=new ResizeObserver(function(es){es.forEach(function(e){fit(e.target)})});specs.forEach(function(s){ro.observe(s)})}
  // nav highlight
  var links={};document.querySelectorAll('.side a').forEach(function(a){links[a.getAttribute('href').slice(1)]=a});
  if('IntersectionObserver' in window){var so=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){Object.values(links).forEach(function(a){a.removeAttribute('aria-current')});var a=links[e.target.id];if(a)a.setAttribute('aria-current','true')}})},{rootMargin:'-40% 0px -55% 0px'});
    document.querySelectorAll('.sec').forEach(function(s){so.observe(s)})}
})();
`;

const html = `<!doctype html>
<html lang="en-IN" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>CreatorCo Design System</title>
<meta name="description" content="CreatorCo design system v2 — the product as built: tokens, live components, screens, proposals.">
<meta name="generator" content="design-system/viewer/build-html.mjs — GENERATED, do not edit">
<style id="ds-css">${fontCss}${bundleCss}</style>
<style>${PAGE_CSS}</style>
</head>
<body>
<header class="top">
  <button class="menu" aria-expanded="false" aria-controls="side">Menu</button>
  <span class="brand">CreatorCo<i></i><small>Design system v2 · as built</small></span>
  <div class="seg" role="group" aria-label="Appearance"><button data-t="dark" aria-pressed="true">Dark</button><button data-t="light" aria-pressed="false">Light</button><button data-t="system" aria-pressed="false">System</button></div>
</header>
<div class="layout">
<nav class="side" id="side" aria-label="Sections">${navHtml}</nav>
<main id="main">
${sections.join("\n")}
<p class="note">Generated ${new Date().toISOString().slice(0, 10)} from <code>design-system/</code> by <code>node design-system/viewer/build-html.mjs</code>. “CreatorCo” is a placeholder wordmark.</p>
</main>
</div>
<script>${bundleJs}</script>
<script>${PAGE_JS}</script>
</body>
</html>
`;

const out = path.join(DS, "design-system.html");
writeFileSync(out, html);
console.log(
  `design-system.html ${(html.length / 1024 / 1024).toFixed(1)} MB · ${comps.length} cards · ${SCREEN_ORDER.length} screens`,
);
