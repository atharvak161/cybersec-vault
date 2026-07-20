# The Vault

A static, fully client-side cybersecurity knowledge base browser — 248 notes
across four tracks (CLOUDHAWK, GRC-GUARDIAN, OSCP-JOURNEY, PHANTOM). No
backend, no build step at runtime, no external CDN — everything needed to
render the site is vendored in this repo. Dark-first terminal/console design,
single accent color, JetBrains Mono for chrome and code, system sans for
reading prose.

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
