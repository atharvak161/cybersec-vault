/* The Vault — client-side app. No build step, no network deps. */
(function () {
  'use strict';

  // ---------------- State ----------------
  var manifest = [];        // [{path, title, track, module, tags}]
  var searchIndex = [];     // [{path, title, tags, body}]
  var graph = { nodes: [], edges: [] };
  var byPath = new Map();   // path -> manifest entry
  var titleIndex = new Map();
  var prefixIndex = new Map();
  var outLinks = new Map(); // path -> [target paths]
  var inLinks = new Map();  // path -> [source paths] (backlinks)
  var expandedTracks = new Set();
  var expandedModules = new Set();
  var currentPath = null;
  var searchActiveIndex = -1;
  var tocObserver = null;

  var TRACK_META = {
    'CLOUDHAWK': { glyph: 'CH', desc: 'Cloud penetration testing across AWS, Azure, and GCP — IAM abuse, metadata services, container and serverless attack paths.' },
    'GRC-GUARDIAN': { glyph: 'GG', desc: 'Governance, risk, and compliance — ISO 27001, PCI-DSS, GDPR, audit and assurance, CISM and CISSP domains.' },
    'OSCP-JOURNEY': { glyph: 'OJ', desc: 'A structured path from fundamentals through eJPT, PNPT, HTB, OSCP, and CPTS.' },
    'PHANTOM': { glyph: 'PH', desc: 'Network, web application, and Active Directory penetration testing, end to end.' }
  };

  var els = {};

  // ---------------- Utilities ----------------

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function naturalCompare(a, b) {
    var re = /(\d+(?:\.\d+)?)|(\D+)/g;
    var ax = a.match(re) || [];
    var bx = b.match(re) || [];
    var len = Math.max(ax.length, bx.length);
    for (var i = 0; i < len; i++) {
      var av = ax[i] || '';
      var bv = bx[i] || '';
      if (av === bv) continue;
      var an = parseFloat(av);
      var bn = parseFloat(bv);
      var aIsNum = !isNaN(an) && /^\d/.test(av);
      var bIsNum = !isNaN(bn) && /^\d/.test(bv);
      if (aIsNum && bIsNum) {
        if (an !== bn) return an - bn;
      } else {
        if (av < bv) return -1;
        if (av > bv) return 1;
      }
    }
    return 0;
  }

  function pathToHash(path) {
    return '#/' + path.split('/').map(encodeURIComponent).join('/');
  }

  function hashToPath(hash) {
    var raw = hash.replace(/^#\/?/, '');
    if (!raw) return null;
    try {
      return raw.split('/').map(decodeURIComponent).join('/');
    } catch (e) {
      return null;
    }
  }

  function notesUrlForPath(path) {
    return 'notes/' + path.split('/').map(encodeURIComponent).join('/');
  }

  function slugify(text, used) {
    var base = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
    var slug = base;
    var n = 2;
    while (used.has(slug)) {
      slug = base + '-' + n;
      n++;
    }
    used.add(slug);
    return slug;
  }

  // ---------------- Theme ----------------

  function currentThemeMode() {
    var stored = document.documentElement.getAttribute('data-theme');
    if (stored) return stored;
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  }

  function applyHljsTheme(mode) {
    els.hljsTheme.setAttribute('href', mode === 'dark' ? 'assets/vendor/hljs-dark.min.css' : 'assets/vendor/hljs-light.min.css');
  }

  function initTheme() {
    var stored = localStorage.getItem('theme');
    if (stored === 'dark' || stored === 'light') {
      document.documentElement.setAttribute('data-theme', stored);
    }
    var mode = currentThemeMode();
    updateThemeIcon(mode);
    applyHljsTheme(mode);
  }

  function updateThemeIcon(mode) {
    document.getElementById('theme-icon-sun').hidden = mode === 'dark';
    document.getElementById('theme-icon-moon').hidden = mode !== 'dark';
  }

  function toggleTheme() {
    var current = currentThemeMode();
    var next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateThemeIcon(next);
    applyHljsTheme(next);
  }

  // ---------------- Data loading ----------------

  function loadData() {
    return Promise.all([
      fetch('manifest.json').then(function (r) { return r.json(); }),
      fetch('search-index.json').then(function (r) { return r.json(); }),
      fetch('graph.json').then(function (r) { return r.json(); })
    ]).then(function (results) {
      manifest = results[0];
      searchIndex = results[1];
      graph = results[2];
      buildIndexes();
    });
  }

  function buildIndexes() {
    manifest.forEach(function (entry) {
      byPath.set(entry.path, entry);
      var key = entry.title.trim().toLowerCase();
      if (!titleIndex.has(key)) titleIndex.set(key, []);
      titleIndex.get(key).push(entry.path);
      var m = entry.title.match(/^(\d+(?:\.\d+)?)/);
      if (m) {
        var prefix = m[1];
        if (!prefixIndex.has(prefix)) prefixIndex.set(prefix, []);
        prefixIndex.get(prefix).push(entry.path);
      }
    });

    graph.edges.forEach(function (e) {
      if (!outLinks.has(e.source)) outLinks.set(e.source, []);
      outLinks.get(e.source).push(e.target);
      if (!inLinks.has(e.target)) inLinks.set(e.target, []);
      inLinks.get(e.target).push(e.source);
    });
  }

  // ---------------- Sidebar tree ----------------

  function buildTree() {
    var tracks = new Map();
    manifest.forEach(function (entry) {
      if (!tracks.has(entry.track)) tracks.set(entry.track, new Map());
      var modules = tracks.get(entry.track);
      if (!modules.has(entry.module)) modules.set(entry.module, []);
      modules.get(entry.module).push(entry);
    });

    var trackNames = Array.from(tracks.keys()).sort();
    var frag = document.createDocumentFragment();

    trackNames.forEach(function (trackName) {
      var trackEl = document.createElement('div');
      trackEl.className = 'tree-track';
      if (!expandedTracks.has(trackName)) trackEl.classList.add('is-collapsed');
      trackEl.dataset.track = trackName;

      var row = document.createElement('div');
      row.className = 'tree-row';
      row.innerHTML = '<span class="tree-caret">' + caretSvg() + '</span><span>' + escapeHtml(trackName) + '</span>';
      row.addEventListener('click', function () { toggleTrack(trackName, trackEl); });
      trackEl.appendChild(row);

      var childWrap = document.createElement('div');
      childWrap.className = 'tree-children';

      var moduleNames = Array.from(tracks.get(trackName).keys()).sort(naturalCompare);
      moduleNames.forEach(function (moduleName) {
        var moduleKey = trackName + ' ' + moduleName;
        var moduleEl = document.createElement('div');
        moduleEl.className = 'tree-module';
        if (!expandedModules.has(moduleKey)) moduleEl.classList.add('is-collapsed');
        moduleEl.dataset.moduleKey = moduleKey;

        var mRow = document.createElement('div');
        mRow.className = 'tree-row';
        mRow.innerHTML = '<span class="tree-caret">' + caretSvg() + '</span><span>' + escapeHtml(moduleName) + '</span>';
        mRow.addEventListener('click', function () { toggleModule(moduleKey, moduleEl); });
        moduleEl.appendChild(mRow);

        var notesWrap = document.createElement('div');
        notesWrap.className = 'tree-children';

        var entries = tracks.get(trackName).get(moduleName).slice().sort(function (a, b) {
          return naturalCompare(a.title, b.title);
        });
        entries.forEach(function (entry) {
          var a = document.createElement('a');
          a.className = 'tree-note';
          a.href = pathToHash(entry.path);
          a.textContent = entry.title;
          a.dataset.path = entry.path;
          notesWrap.appendChild(a);
        });

        moduleEl.appendChild(notesWrap);
        childWrap.appendChild(moduleEl);
      });

      trackEl.appendChild(childWrap);
      frag.appendChild(trackEl);
    });

    els.tree.innerHTML = '';
    els.tree.appendChild(frag);
    highlightActiveNote();
  }

  function caretSvg() {
    return '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 1.5L7 5l-4.5 3.5"/></svg>';
  }

  function toggleTrack(trackName, el) {
    if (expandedTracks.has(trackName)) { expandedTracks.delete(trackName); el.classList.add('is-collapsed'); }
    else { expandedTracks.add(trackName); el.classList.remove('is-collapsed'); }
  }

  function toggleModule(moduleKey, el) {
    if (expandedModules.has(moduleKey)) { expandedModules.delete(moduleKey); el.classList.add('is-collapsed'); }
    else { expandedModules.add(moduleKey); el.classList.remove('is-collapsed'); }
  }

  function expandAncestorsFor(path) {
    var entry = byPath.get(path);
    if (!entry) return;
    expandedTracks.add(entry.track);
    expandedModules.add(entry.track + ' ' + entry.module);
  }

  function highlightActiveNote() {
    var links = els.tree.querySelectorAll('.tree-note');
    links.forEach(function (a) {
      if (a.dataset.path === currentPath) {
        a.classList.add('active');
        a.scrollIntoView({ block: 'nearest' });
      } else {
        a.classList.remove('active');
      }
    });
  }

  // ---------------- Landing dashboard ----------------

  function renderLanding() {
    var counts = new Map();
    manifest.forEach(function (e) {
      counts.set(e.track, (counts.get(e.track) || 0) + 1);
    });
    var trackNames = Array.from(counts.keys()).sort();

    els.landingStats.textContent = manifest.length + ' notes · ' + trackNames.length + ' tracks · fully offline';

    var firstByTrack = {};
    manifest.forEach(function (e) {
      if (!firstByTrack[e.track]) firstByTrack[e.track] = e;
    });

    var html = trackNames.map(function (name) {
      var meta = TRACK_META[name] || { glyph: name.slice(0, 2).toUpperCase(), desc: '' };
      var first = firstByTrack[name];
      var href = first ? pathToHash(first.path) : '#/';
      return (
        '<a class="track-card" href="' + href + '">' +
        '<div class="track-card-top">' +
        '<div class="track-monogram">' + escapeHtml(meta.glyph) + '</div>' +
        '<div><div class="track-name">' + escapeHtml(name) + '</div>' +
        '<div class="track-count">' + counts.get(name) + ' notes</div></div>' +
        '</div>' +
        '<p class="track-desc">' + escapeHtml(meta.desc) + '</p>' +
        '</a>'
      );
    }).join('');
    els.landingTracks.innerHTML = html;
  }

  // ---------------- Frontmatter / markdown ----------------

  function parseFrontmatter(raw) {
    var m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!m) return { frontmatter: {}, body: raw };
    var fmBlock = m[1];
    var body = raw.slice(m[0].length);
    var frontmatter = {};
    fmBlock.split(/\r?\n/).forEach(function (line) {
      var mm = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!mm) return;
      var key = mm[1].trim();
      var val = mm[2].trim();
      if (val[0] === '[' && val[val.length - 1] === ']') {
        val = val.slice(1, -1).split(',').map(function (s) {
          return s.trim().replace(/^["']|["']$/g, '');
        }).filter(Boolean);
      } else {
        val = val.replace(/^["']|["']$/g, '');
      }
      frontmatter[key] = val;
    });
    return { frontmatter: frontmatter, body: body };
  }

  function stripLeadingH1(body, title) {
    var m = body.match(/^\s*#\s+(.+?)\s*\r?\n/);
    if (m && m[1].trim() === title.trim()) {
      return body.slice(m[0].length);
    }
    return body;
  }

  function resolveWikilink(target, currentEntry) {
    var key = target.trim().toLowerCase();

    if (titleIndex.has(key)) {
      return pickBest(titleIndex.get(key), currentEntry);
    }

    var pm = target.match(/^(\d+(?:\.\d+)?)/);
    if (pm && prefixIndex.has(pm[1])) {
      return pickBest(prefixIndex.get(pm[1]), currentEntry);
    }

    var targetWords = key.split(/[^a-z0-9]+/).filter(Boolean);
    var bestPath = null, bestScore = 0;
    manifest.forEach(function (entry) {
      var words = entry.title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      var overlap = 0;
      targetWords.forEach(function (w) { if (words.indexOf(w) !== -1) overlap++; });
      var score = targetWords.length ? overlap / targetWords.length : 0;
      if (score > bestScore) { bestScore = score; bestPath = entry.path; }
    });
    if (bestScore >= 0.6) return bestPath;
    return null;
  }

  function pickBest(candidatePaths, currentEntry) {
    if (candidatePaths.length === 1) return candidatePaths[0];
    if (currentEntry) {
      var sameTrack = candidatePaths.filter(function (p) {
        var e = byPath.get(p);
        return e && e.track === currentEntry.track;
      });
      if (sameTrack.length) return sameTrack[0];
    }
    return candidatePaths.slice().sort()[0];
  }

  function renderWikilinks(markdown, currentEntry) {
    return markdown.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, function (whole, target, alias) {
      var display = (alias || target).trim();
      var resolved = resolveWikilink(target, currentEntry);
      if (resolved) {
        return '<a class="wikilink" href="' + pathToHash(resolved) + '" data-path="' +
          escapeHtml(resolved) + '">' + escapeHtml(display) + '</a>';
      }
      return '<span class="wikilink-broken">' + escapeHtml(display) + '</span>';
    });
  }

  // ---------------- Note rendering ----------------

  function openNote(path, opts) {
    opts = opts || {};
    var entry = byPath.get(path);
    if (!entry) {
      showNotFound(path);
      return;
    }
    currentPath = path;
    expandAncestorsFor(path);
    buildTree();

    fetch(notesUrlForPath(path))
      .then(function (r) {
        if (!r.ok) throw new Error('fetch failed: ' + r.status);
        return r.text();
      })
      .then(function (raw) {
        renderNote(entry, raw);
        if (!opts.skipScroll) els.reader.scrollTop = 0;
        closeSidebarMobile();
      })
      .catch(function (err) {
        showNotFound(path, err);
      });
  }

  function renderNote(entry, raw) {
    var parsed = parseFrontmatter(raw);
    var body = stripLeadingH1(parsed.body, entry.title);
    var withWikilinks = renderWikilinks(body, entry);
    var html = window.marked.parse(withWikilinks, { gfm: true, breaks: false });

    els.landing.hidden = true;
    els.noteView.hidden = false;
    els.rightRail.hidden = false;

    els.breadcrumb.innerHTML =
      '<span class="crumb-prompt">&gt;</span>' +
      '<span>' + escapeHtml(entry.track) + '</span>' +
      '<span class="sep">/</span>' +
      '<span>' + escapeHtml(entry.module) + '</span>' +
      '<span class="sep">/</span>' +
      '<span class="crumb-current">' + escapeHtml(entry.title) + '</span>';

    els.noteTitle.textContent = entry.title;

    var tags = (parsed.frontmatter.tags && parsed.frontmatter.tags.length) ? parsed.frontmatter.tags : (entry.tags || []);
    els.noteTags.innerHTML = tags.map(function (t) {
      return '<span class="tag-chip">#' + escapeHtml(t) + '</span>';
    }).join('');

    els.noteBody.innerHTML = html;

    highlightCode();
    buildToc();
    renderBacklinks(entry.path);
    renderLocalGraph(entry.path);

    document.title = entry.title + ' — The Vault';
  }

  function highlightCode() {
    if (!window.hljs) return;
    els.noteBody.querySelectorAll('pre code').forEach(function (block) {
      window.hljs.highlightElement(block);
    });
  }

  function showNotFound(path, err) {
    els.landing.hidden = false;
    els.noteView.hidden = true;
    els.rightRail.hidden = true;
    els.landingStats.textContent = 'note not found: ' + (path || '');
    if (err) console.error(err);
  }

  function onNoteBodyClick(e) {
    var a = e.target.closest('a.wikilink');
    if (!a) return;
    e.preventDefault();
    var path = a.dataset.path;
    if (path) location.hash = pathToHash(path);
  }

  // ---------------- Table of contents (scroll-spy) ----------------

  function buildToc() {
    if (tocObserver) { tocObserver.disconnect(); tocObserver = null; }
    var headings = els.noteBody.querySelectorAll('h2, h3');
    if (!headings.length) {
      els.toc.innerHTML = '<div class="search-empty" style="padding:4px 8px;text-align:left;">no sections</div>';
      return;
    }
    var used = new Set();
    var items = [];
    headings.forEach(function (h) {
      var id = slugify(h.textContent, used);
      h.id = id;
      var a = document.createElement('a');
      a.href = '#toc-' + id;
      a.textContent = h.textContent;
      a.dataset.target = id;
      if (h.tagName === 'H3') a.classList.add('toc-h3');
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        h.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
      items.push(a);
    });
    els.toc.innerHTML = '';
    items.forEach(function (a) { els.toc.appendChild(a); });

    tocObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var id = entry.target.id;
        var link = els.toc.querySelector('a[data-target="' + cssEscape(id) + '"]');
        if (!link) return;
        if (entry.isIntersecting) {
          els.toc.querySelectorAll('a.active').forEach(function (a) { a.classList.remove('active'); });
          link.classList.add('active');
        }
      });
    }, { root: els.reader, rootMargin: '0px 0px -75% 0px', threshold: 0 });

    headings.forEach(function (h) { tocObserver.observe(h); });
  }

  function cssEscape(s) {
    return s.replace(/["\\]/g, '\\$&');
  }

  // ---------------- Backlinks ----------------

  function renderBacklinks(path) {
    var sources = inLinks.get(path) || [];
    if (!sources.length) {
      els.backlinks.hidden = true;
      els.backlinksList.innerHTML = '';
      return;
    }
    els.backlinks.hidden = false;
    els.backlinksList.innerHTML = sources.map(function (p) {
      var entry = byPath.get(p);
      if (!entry) return '';
      return (
        '<a class="backlink-item" href="' + pathToHash(p) + '">' +
        '<span class="backlink-title">' + escapeHtml(entry.title) + '</span>' +
        '<span class="backlink-breadcrumb">' + escapeHtml(entry.track) + ' / ' + escapeHtml(entry.module) + '</span>' +
        '</a>'
      );
    }).join('');
  }

  // ---------------- Local graph (mini widget) ----------------

  function renderLocalGraph(path) {
    var canvas = els.localGraph;
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    var neighborSet = new Set();
    (outLinks.get(path) || []).forEach(function (p) { neighborSet.add(p); });
    (inLinks.get(path) || []).forEach(function (p) { neighborSet.add(p); });
    neighborSet.delete(path);
    var neighbors = Array.from(neighborSet).slice(0, 8);

    var style = getComputedStyle(document.documentElement);
    var accent = style.getPropertyValue('--accent').trim() || '#39d0d8';
    var textTertiary = style.getPropertyValue('--text-tertiary').trim() || '#888';
    var bgRaised = style.getPropertyValue('--bg-raised').trim() || '#11161d';

    var cx = w / 2, cy = h / 2 - 6;
    var radius = Math.min(w, h) / 2 - 34;

    canvas.onclick = null;
    var clickTargets = [];

    if (!neighbors.length) {
      ctx.fillStyle = textTertiary;
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('no linked notes', cx, cy);
      return;
    }

    var positions = neighbors.map(function (p, i) {
      var angle = (i / neighbors.length) * Math.PI * 2 - Math.PI / 2;
      return { path: p, x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
    });

    // edges
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    positions.forEach(function (pos) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // neighbor nodes
    positions.forEach(function (pos) {
      var entry = byPath.get(pos.path);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = bgRaised;
      ctx.strokeStyle = textTertiary;
      ctx.lineWidth = 1.2;
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = textTertiary;
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.textAlign = pos.x < cx - 4 ? 'right' : pos.x > cx + 4 ? 'left' : 'center';
      var label = entry ? truncate(entry.title, 16) : '';
      var ty = pos.y + (pos.y < cy ? -9 : 14);
      ctx.fillText(label, pos.x + (pos.x < cx - 4 ? -8 : pos.x > cx + 4 ? 8 : 0), ty);

      clickTargets.push({ x: pos.x, y: pos.y, path: pos.path });
    });

    // current node (center)
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();

    canvas.onclick = function (ev) {
      var rect = canvas.getBoundingClientRect();
      var scaleX = canvas.width / rect.width;
      var scaleY = canvas.height / rect.height;
      var mx = (ev.clientX - rect.left) * scaleX;
      var my = (ev.clientY - rect.top) * scaleY;
      for (var i = 0; i < clickTargets.length; i++) {
        var t = clickTargets[i];
        if (Math.hypot(mx - t.x, my - t.y) < 10) {
          location.hash = pathToHash(t.path);
          return;
        }
      }
    };
  }

  function truncate(s, n) {
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  // ---------------- Global graph view ----------------

  var globalGraphState = null;

  function ensureGlobalGraphLayout() {
    if (globalGraphState) return globalGraphState;

    var nodes = graph.nodes.map(function (n, i) {
      var angle = (i / graph.nodes.length) * Math.PI * 2;
      var r = 200 + (i % 7) * 40;
      return {
        path: n.path,
        title: n.title,
        track: n.track,
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r,
        vx: 0,
        vy: 0
      };
    });
    var nodeByPath = new Map(nodes.map(function (n) { return [n.path, n]; }));
    var edges = graph.edges
      .map(function (e) { return { source: nodeByPath.get(e.source), target: nodeByPath.get(e.target) }; })
      .filter(function (e) { return e.source && e.target; });

    // Simple force simulation, run synchronously to a settled layout.
    var iterations = 220;
    var k = 70; // ideal edge length
    for (var iter = 0; iter < iterations; iter++) {
      // repulsion
      for (var i = 0; i < nodes.length; i++) {
        var a = nodes[i];
        var fx = 0, fy = 0;
        for (var j = 0; j < nodes.length; j++) {
          if (i === j) continue;
          var b = nodes[j];
          var dx = a.x - b.x, dy = a.y - b.y;
          var dist2 = dx * dx + dy * dy + 0.01;
          var dist = Math.sqrt(dist2);
          var force = (k * k) / dist2;
          fx += (dx / dist) * force;
          fy += (dy / dist) * force;
        }
        a.vx = (a.vx + fx) * 0.4;
        a.vy = (a.vy + fy) * 0.4;
      }
      // attraction along edges
      edges.forEach(function (e) {
        var dx = e.target.x - e.source.x, dy = e.target.y - e.source.y;
        var dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
        var force = (dist - k) * 0.012;
        var fx = (dx / dist) * force, fy = (dy / dist) * force;
        e.source.vx += fx; e.source.vy += fy;
        e.target.vx -= fx; e.target.vy -= fy;
      });
      // centering + integrate
      nodes.forEach(function (n) {
        n.vx -= n.x * 0.002;
        n.vy -= n.y * 0.002;
        n.x += n.vx * 0.06;
        n.y += n.vy * 0.06;
      });
    }

    globalGraphState = { nodes: nodes, edges: edges, offsetX: 0, offsetY: 0, scale: 1 };
    return globalGraphState;
  }

  function renderGlobalGraph() {
    var canvas = els.globalGraph;
    var rect = canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    var state = ensureGlobalGraphLayout();
    var ctx = canvas.getContext('2d');
    var style = getComputedStyle(document.documentElement);
    var accent = style.getPropertyValue('--accent').trim() || '#39d0d8';
    var accentStrong = style.getPropertyValue('--accent-strong').trim() || '#5cdde3';
    var textTertiary = style.getPropertyValue('--text-tertiary').trim() || '#888';
    var bgRaised = style.getPropertyValue('--bg-raised').trim() || '#11161d';

    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.save();
      ctx.translate(rect.width / 2 + state.offsetX, rect.height / 2 + state.offsetY);
      ctx.scale(state.scale, state.scale);

      var hoverPath = state.hoverPath;
      var connected = new Set();
      if (hoverPath) {
        state.edges.forEach(function (e) {
          if (e.source.path === hoverPath) connected.add(e.target.path);
          if (e.target.path === hoverPath) connected.add(e.source.path);
        });
      }

      // edges
      state.edges.forEach(function (e) {
        var isConnected = hoverPath && (e.source.path === hoverPath || e.target.path === hoverPath);
        ctx.strokeStyle = isConnected ? accentStrong : accent;
        ctx.globalAlpha = hoverPath ? (isConnected ? 0.7 : 0.05) : 0.16;
        ctx.lineWidth = isConnected ? 1.3 : 0.7;
        ctx.beginPath();
        ctx.moveTo(e.source.x, e.source.y);
        ctx.lineTo(e.target.x, e.target.y);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;

      // nodes
      state.nodes.forEach(function (n) {
        var isHover = n.path === hoverPath;
        var isConnected = connected.has(n.path);
        var dim = hoverPath && !isHover && !isConnected;
        ctx.beginPath();
        ctx.arc(n.x, n.y, isHover ? 5.5 : 3.4, 0, Math.PI * 2);
        ctx.fillStyle = isHover ? accent : bgRaised;
        ctx.globalAlpha = dim ? 0.25 : 1;
        ctx.fill();
        ctx.strokeStyle = isHover ? accent : textTertiary;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      });

      if (hoverPath) {
        var hn = state.nodes.find(function (n) { return n.path === hoverPath; });
        if (hn) {
          ctx.font = '600 12px "JetBrains Mono", monospace';
          ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#fff';
          ctx.textAlign = hn.x > 0 ? 'right' : 'left';
          ctx.fillText(hn.title, hn.x + (hn.x > 0 ? -10 : 10), hn.y - 10);
        }
      }

      ctx.restore();
    }

    state.draw = draw;
    draw();
  }

  function initGlobalGraphInteraction() {
    var canvas = els.globalGraph;
    var dragging = false;
    var lastX = 0, lastY = 0;

    canvas.addEventListener('mousedown', function (e) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.style.cursor = 'grabbing';
    });
    window.addEventListener('mouseup', function () {
      dragging = false;
      canvas.style.cursor = 'grab';
    });
    canvas.addEventListener('mousemove', function (e) {
      var state = globalGraphState;
      if (!state) return;
      if (dragging) {
        state.offsetX += e.clientX - lastX;
        state.offsetY += e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        state.draw && state.draw();
        return;
      }
      var rect = canvas.getBoundingClientRect();
      var mx = (e.clientX - rect.left - rect.width / 2 - state.offsetX) / state.scale;
      var my = (e.clientY - rect.top - rect.height / 2 - state.offsetY) / state.scale;
      var found = null;
      for (var i = 0; i < state.nodes.length; i++) {
        var n = state.nodes[i];
        if (Math.hypot(mx - n.x, my - n.y) < 8) { found = n.path; break; }
      }
      if (found !== state.hoverPath) {
        state.hoverPath = found;
        canvas.style.cursor = found ? 'pointer' : 'grab';
        state.draw && state.draw();
      }
    });
    canvas.addEventListener('click', function (e) {
      var state = globalGraphState;
      if (!state || !state.hoverPath) return;
      var target = state.hoverPath;
      closeGraphView();
      location.hash = pathToHash(target);
    });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var state = globalGraphState;
      if (!state) return;
      var delta = e.deltaY > 0 ? 0.92 : 1.08;
      state.scale = Math.max(0.25, Math.min(3, state.scale * delta));
      state.draw && state.draw();
    }, { passive: false });
  }

  function openGraphView() {
    els.graphView.hidden = false;
    requestAnimationFrame(renderGlobalGraph);
  }

  function closeGraphView() {
    els.graphView.hidden = true;
  }

  // ---------------- Routing ----------------

  function onHashChange() {
    if (location.hash === '#/graph') {
      openGraphView();
      return;
    }
    closeGraphView();

    var path = hashToPath(location.hash);
    if (path) {
      openNote(path);
    } else {
      currentPath = null;
      els.landing.hidden = false;
      els.noteView.hidden = true;
      els.rightRail.hidden = true;
      document.title = 'The Vault';
      buildTree();
    }
  }

  // ---------------- Search / command palette ----------------

  function snippetFor(body, queryTokens) {
    var lower = body.toLowerCase();
    var idx = -1;
    for (var i = 0; i < queryTokens.length && idx === -1; i++) {
      idx = lower.indexOf(queryTokens[i]);
    }
    if (idx === -1) return body.slice(0, 140);
    var start = Math.max(0, idx - 60);
    var end = Math.min(body.length, idx + 100);
    return (start > 0 ? '…' : '') + body.slice(start, end) + (end < body.length ? '…' : '');
  }

  function highlightSnippet(snippet, queryTokens) {
    var escaped = escapeHtml(snippet);
    queryTokens.forEach(function (t) {
      if (!t) return;
      var re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
      escaped = escaped.replace(re, '<mark>$1</mark>');
    });
    return escaped;
  }

  function runSearch(query) {
    var q = query.trim().toLowerCase();
    if (!q) {
      renderSearchResults([], []);
      return;
    }
    var tokens = q.split(/\s+/).filter(Boolean);
    var scored = [];
    searchIndex.forEach(function (item) {
      var titleLower = item.title.toLowerCase();
      var bodyLower = item.body.toLowerCase();
      var score = 0;
      var matched = true;
      tokens.forEach(function (t) {
        var inTitle = titleLower.indexOf(t) !== -1;
        var inBody = bodyLower.indexOf(t) !== -1;
        var inTags = item.tags.join(' ').toLowerCase().indexOf(t) !== -1;
        if (!inTitle && !inBody && !inTags) matched = false;
        if (inTitle) score += 10;
        if (inTags) score += 4;
        if (inBody) score += 1;
      });
      if (matched) scored.push({ item: item, score: score });
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    renderSearchResults(scored.slice(0, 30).map(function (s) { return s.item; }), tokens);
  }

  function renderSearchResults(items, tokens) {
    searchActiveIndex = -1;
    if (!items.length) {
      els.searchResults.innerHTML = tokens.length
        ? '<div class="search-empty">no matching notes</div>'
        : '<div class="search-empty">type to search 248 notes…</div>';
      return;
    }
    els.searchResults.innerHTML = items.map(function (item, i) {
      var entry = byPath.get(item.path);
      var breadcrumb = entry ? (entry.track + ' / ' + entry.module) : '';
      var snippet = snippetFor(item.body, tokens);
      return '<a class="search-result-item" data-index="' + i + '" data-path="' +
        escapeHtml(item.path) + '" href="' + pathToHash(item.path) + '">' +
        '<div class="search-result-title">' + escapeHtml(item.title) + '</div>' +
        '<div class="search-result-breadcrumb">' + escapeHtml(breadcrumb) + '</div>' +
        '<div class="search-result-snippet">' + highlightSnippet(snippet, tokens) + '</div>' +
        '</a>';
    }).join('');
  }

  function moveSearchSelection(delta) {
    var items = els.searchResults.querySelectorAll('.search-result-item');
    if (!items.length) return;
    searchActiveIndex = (searchActiveIndex + delta + items.length) % items.length;
    items.forEach(function (el, i) {
      el.classList.toggle('active', i === searchActiveIndex);
      if (i === searchActiveIndex) el.scrollIntoView({ block: 'nearest' });
    });
  }

  function confirmSearchSelection() {
    var items = els.searchResults.querySelectorAll('.search-result-item');
    var target = searchActiveIndex >= 0 ? items[searchActiveIndex] : items[0];
    if (target) {
      location.hash = pathToHash(target.dataset.path);
      closePalette();
    }
  }

  function openPalette() {
    els.palette.hidden = false;
    els.searchInput.value = '';
    renderSearchResults([], []);
    els.searchInput.focus();
  }

  function closePalette() {
    els.palette.hidden = true;
    els.searchInput.blur();
  }

  function togglePalette() {
    if (els.palette.hidden) openPalette();
    else closePalette();
  }

  // ---------------- Mobile sidebar ----------------

  function openSidebarMobile() {
    els.sidebar.classList.add('open');
    els.sidebarScrim.hidden = false;
    els.hamburger.setAttribute('aria-expanded', 'true');
  }
  function closeSidebarMobile() {
    els.sidebar.classList.remove('open');
    els.sidebarScrim.hidden = true;
    els.hamburger.setAttribute('aria-expanded', 'false');
  }
  function toggleSidebarMobile() {
    if (els.sidebar.classList.contains('open')) closeSidebarMobile();
    else openSidebarMobile();
  }

  // ---------------- Init ----------------

  function cacheEls() {
    els.tree = document.getElementById('tree');
    els.reader = document.getElementById('reader');
    els.landing = document.getElementById('landing');
    els.landingStats = document.getElementById('landing-stats');
    els.landingTracks = document.getElementById('landing-tracks');
    els.noteView = document.getElementById('note-view');
    els.breadcrumb = document.getElementById('breadcrumb');
    els.noteTitle = document.getElementById('note-title');
    els.noteTags = document.getElementById('note-tags');
    els.noteBody = document.getElementById('note-body');
    els.backlinks = document.getElementById('backlinks');
    els.backlinksList = document.getElementById('backlinks-list');
    els.rightRail = document.getElementById('right-rail');
    els.toc = document.getElementById('toc');
    els.localGraph = document.getElementById('local-graph');
    els.searchInput = document.getElementById('search-input');
    els.searchResults = document.getElementById('search-results');
    els.themeToggle = document.getElementById('theme-toggle');
    els.hljsTheme = document.getElementById('hljs-theme');
    els.hamburger = document.getElementById('hamburger');
    els.sidebar = document.getElementById('sidebar');
    els.sidebarScrim = document.getElementById('sidebar-scrim');
    els.palette = document.getElementById('palette');
    els.paletteBackdrop = document.getElementById('palette-backdrop');
    els.paletteTrigger = document.getElementById('palette-trigger');
    els.graphTrigger = document.getElementById('graph-trigger');
    els.graphView = document.getElementById('graph-view');
    els.graphClose = document.getElementById('graph-close');
    els.globalGraph = document.getElementById('global-graph');
  }

  function bindEvents() {
    window.addEventListener('hashchange', onHashChange);

    els.themeToggle.addEventListener('click', toggleTheme);
    els.hamburger.addEventListener('click', toggleSidebarMobile);
    els.sidebarScrim.addEventListener('click', closeSidebarMobile);
    els.noteBody.addEventListener('click', onNoteBodyClick);

    els.paletteTrigger.addEventListener('click', openPalette);
    els.paletteBackdrop.addEventListener('click', closePalette);

    els.graphTrigger.addEventListener('click', openGraphView);
    els.graphClose.addEventListener('click', closeGraphView);

    els.searchInput.addEventListener('input', function () { runSearch(els.searchInput.value); });
    els.searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSearchSelection(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveSearchSelection(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); confirmSearchSelection(); }
      else if (e.key === 'Escape') { closePalette(); }
    });

    document.addEventListener('keydown', function (e) {
      var isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        togglePalette();
      } else if (e.key === 'Escape') {
        if (!els.palette.hidden) closePalette();
        else if (!els.graphView.hidden) closeGraphView();
      }
    });

    window.addEventListener('resize', function () {
      if (!els.graphView.hidden) renderGlobalGraph();
    });

    initGlobalGraphInteraction();
  }

  function init() {
    cacheEls();
    initTheme();
    bindEvents();
    renderSearchResults([], []);
    loadData().then(function () {
      buildTree();
      renderLanding();
      onHashChange();
    }).catch(function (err) {
      console.error('Failed to load notes data', err);
      els.landingStats.textContent = 'failed to load notes index — see console';
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
