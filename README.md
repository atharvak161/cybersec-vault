# The Vault

A static, fully client-side cybersecurity knowledge base browser — 248 notes
across four tracks (CLOUDHAWK, GRC-GUARDIAN, OSCP-JOURNEY, PHANTOM). No
backend, no build step at runtime, no external CDN — everything needed to
render the site is vendored in this repo. Dark-first terminal/console design,
single accent color, JetBrains Mono for chrome and code, system sans for
reading prose.

## Architecture

### Build and serve

```
  notes/**/*.md ──────▶ scripts/generate-index.js ──────▶ search-index.json
  248 markdown files    run manually, not in CI                3.2 MB
  across 4 tracks                │                      ──────▶ graph.json
                                 │                              119 KB
                                 ▼
                          index.html (5 KB shell)
                          assets/app.js  ── renders everything client-side
                          assets/style.css
                          assets/vendor/ ── marked, highlight.js (vendored)
```

There is no server and no build step at deploy time. `generate-index.js` is run
by hand after adding or editing notes; it walks `notes/`, extracts titles,
headings and body text into `search-index.json`, and resolves `[[wikilinks]]`
into the adjacency list in `graph.json`. Everything committed is everything
served.

### Runtime

```
  index.html
      │
      ├─ fetch search-index.json   one request, then all search is in-memory
      ├─ fetch graph.json          backlinks + the interactive link graph
      │
      └─ assets/app.js
            ├── router          URL hash addresses a note; back/forward work
            ├── search          full-text over the prebuilt index, no server
            ├── renderer        marked → HTML, highlight.js for code fences
            ├── wikilinks       [[Note]] rewritten to in-app navigation
            ├── backlinks       reverse edges read from graph.json
            └── command palette ⌘K
```

### Why it is shaped this way

**The index is built ahead of time, not at load.** Parsing 248 markdown files
in the browser on every visit would be slow and would scale badly. Building
once into a flat JSON index makes search instant and keeps the runtime a single
fetch.

**Vendored, not CDN.** `marked` and `highlight.js` live in `assets/vendor/` so
the knowledge base still renders if a CDN is unreachable, and so nothing
third-party can inject into a page that renders untrusted markdown.

**Notes stay plain markdown.** `notes/` is readable and editable without this
app — in any editor, or straight on GitHub. The browser is a convenience layer
over the files, never the format of record.

### Trade-offs

The search index is 3.2 MB and is fetched in full on first load, which is the
cost of instant client-side search with no backend. It is cached thereafter.
Re-running `generate-index.js` after editing notes is a manual step; forgetting
it means search and the graph lag behind the markdown until it is run.


## How it works

- `notes/` — the 248 source markdown files, copied byte-for-byte from the
  original knowledge base, with the exact folder tree preserved (track →
  module → note).
- `manifest.json` — a generated index of every note (path, title, track,
  module, tags), produced by scanning `notes/`. Powers the sidebar tree and
  the landing dashboard.
- `search-index.json` — a generated per-note record (path, title, tags,
  plaintext body) used for client-side full-text search (the command
  palette). No server, no external search service.
- `graph.json` — generated { nodes, edges } derived from resolved
  `[[wikilinks]]`. Powers the backlinks panel, the local graph widget in the
  reader, and the full-screen graph view.
- `assets/vendor/marked.min.js` — a pinned, locally-vendored copy of
  [marked.js](https://github.com/markedjs/marked) (v15.0.12) used to render
  markdown in the browser.
- `assets/vendor/highlight.min.js` + `hljs-dark.min.css` / `hljs-light.min.css`
  — a pinned, locally-vendored copy of [highlight.js](https://highlightjs.org/)
  (v11.9.0, common-languages bundle) for fenced code block syntax
  highlighting. The active stylesheet swaps with the theme toggle.
- `assets/vendor/purify.min.js` — a pinned, locally-vendored copy of
  [DOMPurify](https://github.com/cure53/DOMPurify) (v3.2.4). Every piece of HTML
  that `marked` produces is sanitised through it before it reaches the DOM, so a
  malicious note cannot execute script in the reader.
- `assets/vendor/fonts/` — JetBrains Mono (400/500/600/700, woff2),
  self-hosted, no Google Fonts / CDN request at runtime.
- `assets/app.js` — the whole app: sidebar tree, landing dashboard, hash
  router, command palette (Cmd/Ctrl+K) full-text search, wikilink resolution,
  frontmatter parsing, table of contents with scroll-spy, backlinks, local +
  global graph view, and theme toggle.
- `assets/style.css` — the design system: dark-first terminal aesthetic, one
  accent color, restrained motion, mobile layout.
- `.nojekyll` — tells GitHub Pages to serve files as-is (not through Jekyll),
  so `.md` and `.json` assets are served as static files.

Regenerating the indexes (after notes change) is done with a small Node
script that only *reads* `notes/` — it never modifies a note:

```bash
node scripts/generate-index.js
```

This writes `manifest.json`, `search-index.json`, and `graph.json`.

## Running locally

No build step. From this directory:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/` in a browser.

## Notes on data integrity

The 248 files under `notes/` are verified byte-for-byte identical (md5) to
the original source in `knowledge/cybersecurity/Cyber Security/` at the time
they were copied. The generator and app only ever read these files.
