#!/usr/bin/env node
/**
 * Generator script — READS notes/ only, never modifies them.
 * Produces:
 *   manifest.json      — file tree: path, title, track, module, tags
 *   search-index.json  — per-note { path, title, tags, body } for full-text search
 *   graph.json          — { nodes: [{path,title,track}], edges: [{source,target}] }
 *                          resolved from [[wikilinks]], used for backlinks + graph view
 *
 * Run: node scripts/generate-index.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NOTES_DIR = path.join(ROOT, 'notes');

// ---- Natural sort (03.1 before 03.2 before 03.10) ----
function naturalCompare(a, b) {
  const re = /(\d+(?:\.\d+)?)|(\D+)/g;
  const ax = a.match(re) || [];
  const bx = b.match(re) || [];
  const len = Math.max(ax.length, bx.length);
  for (let i = 0; i < len; i++) {
    const av = ax[i] ?? '';
    const bv = bx[i] ?? '';
    if (av === bv) continue;
    const an = parseFloat(av);
    const bn = parseFloat(bv);
    const aIsNum = !Number.isNaN(an) && /^\d/.test(av);
    const bIsNum = !Number.isNaN(bn) && /^\d/.test(bv);
    if (aIsNum && bIsNum) {
      if (an !== bn) return an - bn;
    } else {
      if (av < bv) return -1;
      if (av > bv) return 1;
    }
  }
  return 0;
}

// ---- Frontmatter parser (minimal YAML: key: value / key: [a, b, c]) ----
function parseFrontmatter(raw) {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fmMatch) return { frontmatter: {}, body: raw };
  const fmBlock = fmMatch[1];
  const body = raw.slice(fmMatch[0].length);
  const frontmatter = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    let val = m[2].trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    } else {
      val = val.replace(/^["']|["']$/g, '');
    }
    frontmatter[key] = val;
  }
  return { frontmatter, body };
}

function extractTitle(body, fallback) {
  const m = body.match(/^\s*#\s+(.+)$/m);
  if (m) return m[1].trim();
  return fallback;
}

function toPlaintext(body) {
  return body
    .replace(/```[\s\S]*?```/g, ' ') // fenced code blocks
    .replace(/`[^`]*`/g, ' ') // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1') // wikilinks -> text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // md links -> text
    .replace(/[#>*_~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractWikilinkTargets(body) {
  const targets = [];
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let m;
  while ((m = re.exec(body))) {
    targets.push(m[1].trim());
  }
  return targets;
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

// ---- Wikilink resolution (mirrors assets/app.js client-side resolver) ----
// Tiers: 1) exact title match  2) numeric-prefix match  3) closest title (word overlap)
function buildResolutionIndexes(entries) {
  const byPath = new Map();
  const titleIndex = new Map();
  const prefixIndex = new Map();
  entries.forEach((e) => {
    byPath.set(e.path, e);
    const key = e.title.trim().toLowerCase();
    if (!titleIndex.has(key)) titleIndex.set(key, []);
    titleIndex.get(key).push(e.path);
    const m = e.title.match(/^(\d+(?:\.\d+)?)/);
    if (m) {
      if (!prefixIndex.has(m[1])) prefixIndex.set(m[1], []);
      prefixIndex.get(m[1]).push(e.path);
    }
  });
  return { byPath, titleIndex, prefixIndex };
}

function pickBest(candidatePaths, currentEntry, byPath) {
  if (candidatePaths.length === 1) return candidatePaths[0];
  if (currentEntry) {
    const sameTrack = candidatePaths.filter((p) => {
      const e = byPath.get(p);
      return e && e.track === currentEntry.track;
    });
    if (sameTrack.length) return sameTrack[0];
  }
  return candidatePaths.slice().sort()[0];
}

function resolveWikilink(target, currentEntry, indexes, allEntries) {
  const { byPath, titleIndex, prefixIndex } = indexes;
  const key = target.trim().toLowerCase();

  if (titleIndex.has(key)) {
    return pickBest(titleIndex.get(key), currentEntry, byPath);
  }

  const pm = target.match(/^(\d+(?:\.\d+)?)/);
  if (pm && prefixIndex.has(pm[1])) {
    return pickBest(prefixIndex.get(pm[1]), currentEntry, byPath);
  }

  const targetWords = key.split(/[^a-z0-9]+/).filter(Boolean);
  let bestPath = null;
  let bestScore = 0;
  allEntries.forEach((entry) => {
    const words = entry.title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    let overlap = 0;
    targetWords.forEach((w) => {
      if (words.indexOf(w) !== -1) overlap++;
    });
    const score = targetWords.length ? overlap / targetWords.length : 0;
    if (score > bestScore) {
      bestScore = score;
      bestPath = entry.path;
    }
  });
  if (bestScore >= 0.6) return bestPath;
  return null;
}

function main() {
  const files = walk(NOTES_DIR);
  const manifestEntries = [];
  const searchEntries = [];
  const rawBodies = new Map(); // path -> body (post-frontmatter)

  for (const fullPath of files) {
    const relPath = path.relative(NOTES_DIR, fullPath).split(path.sep).join('/');
    const parts = relPath.split('/');
    const track = parts[0];
    const module = parts.length > 2 ? parts[1] : '';
    const filename = parts[parts.length - 1];
    const baseName = filename.replace(/\.md$/, '');

    const raw = fs.readFileSync(fullPath, 'utf8');
    const { frontmatter, body } = parseFrontmatter(raw);
    const title = extractTitle(body, baseName);
    const tags = Array.isArray(frontmatter.tags)
      ? frontmatter.tags
      : frontmatter.tags
      ? [frontmatter.tags]
      : [];

    manifestEntries.push({
      path: relPath,
      title,
      track,
      module,
      tags,
      sortKey: baseName,
    });

    searchEntries.push({
      path: relPath,
      title,
      tags,
      body: toPlaintext(body),
    });

    rawBodies.set(relPath, body);
  }

  // Sort manifest: track, module, then natural sort of filename
  manifestEntries.sort((a, b) => {
    if (a.track !== b.track) return a.track < b.track ? -1 : 1;
    if (a.module !== b.module) return naturalCompare(a.module, b.module);
    return naturalCompare(a.sortKey, b.sortKey);
  });
  for (const e of manifestEntries) delete e.sortKey;

  searchEntries.sort((a, b) => naturalCompare(a.path, b.path));

  // ---- Build graph.json ----
  const indexes = buildResolutionIndexes(manifestEntries);
  const edgeSet = new Set();
  const edges = [];
  manifestEntries.forEach((entry) => {
    const body = rawBodies.get(entry.path) || '';
    const targets = extractWikilinkTargets(body);
    targets.forEach((target) => {
      const resolved = resolveWikilink(target, entry, indexes, manifestEntries);
      if (resolved && resolved !== entry.path) {
        const key = entry.path + ' -> ' + resolved;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({ source: entry.path, target: resolved });
        }
      }
    });
  });

  const graph = {
    nodes: manifestEntries.map((e) => ({ path: e.path, title: e.title, track: e.track })),
    edges,
  };

  const manifestPath = path.join(ROOT, 'manifest.json');
  const searchPath = path.join(ROOT, 'search-index.json');
  const graphPath = path.join(ROOT, 'graph.json');

  fs.writeFileSync(manifestPath, JSON.stringify(manifestEntries, null, 2) + '\n');
  fs.writeFileSync(searchPath, JSON.stringify(searchEntries) + '\n');
  fs.writeFileSync(graphPath, JSON.stringify(graph) + '\n');

  console.log(`Wrote ${manifestEntries.length} entries to manifest.json`);
  console.log(`Wrote ${searchEntries.length} entries to search-index.json`);
  console.log(`Wrote ${graph.nodes.length} nodes / ${graph.edges.length} edges to graph.json`);
}

main();
