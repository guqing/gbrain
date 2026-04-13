export const UI_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>exo UI</title>
    <style>
      :root {
        color-scheme: light dark;
        --bg: #0b1020;
        --panel: rgba(15, 23, 42, 0.88);
        --panel-soft: rgba(30, 41, 59, 0.72);
        --text: #e5eefc;
        --muted: #9fb0d0;
        --border: rgba(148, 163, 184, 0.22);
        --accent: #60a5fa;
        --accent-soft: rgba(96, 165, 250, 0.18);
        --warning: #fbbf24;
        --shadow: 0 24px 80px rgba(15, 23, 42, 0.45);
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top, rgba(96, 165, 250, 0.14), transparent 28%),
          linear-gradient(180deg, #020617 0%, #0f172a 100%);
        color: var(--text);
      }

      .shell {
        width: min(1120px, calc(100vw - 32px));
        margin: 32px auto;
        padding: 20px;
        border: 1px solid var(--border);
        border-radius: 24px;
        background: var(--panel);
        box-shadow: var(--shadow);
        backdrop-filter: blur(18px);
      }

      .topbar {
        display: grid;
        grid-template-columns: 1fr minmax(260px, 420px);
        gap: 16px;
        align-items: center;
      }

      .brand {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .brand h1 {
        margin: 0;
        font-size: 24px;
        letter-spacing: -0.02em;
      }

      .brand p {
        margin: 0;
        color: var(--muted);
        font-size: 14px;
      }

      .search {
        width: 100%;
        padding: 14px 16px;
        border-radius: 14px;
        border: 1px solid var(--border);
        background: rgba(15, 23, 42, 0.88);
        color: var(--text);
        font-size: 16px;
        outline: none;
      }

      .search:focus {
        border-color: rgba(96, 165, 250, 0.7);
        box-shadow: 0 0 0 4px rgba(96, 165, 250, 0.14);
      }

      .toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin-top: 18px;
        flex-wrap: wrap;
      }

      .tabs {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .tab {
        border: 1px solid var(--border);
        background: var(--panel-soft);
        color: var(--muted);
        border-radius: 999px;
        padding: 8px 14px;
        cursor: pointer;
        font-size: 14px;
      }

      .tab.active {
        color: white;
        border-color: rgba(96, 165, 250, 0.55);
        background: var(--accent-soft);
      }

      .status {
        color: var(--muted);
        font-size: 14px;
      }

      .warning {
        display: none;
        margin-top: 16px;
        padding: 12px 14px;
        border: 1px solid rgba(251, 191, 36, 0.35);
        border-radius: 14px;
        background: rgba(120, 53, 15, 0.22);
        color: #fde68a;
        font-size: 14px;
      }

      .warning.show { display: block; }

      .results {
        margin-top: 20px;
        display: grid;
        gap: 14px;
      }

      .empty {
        padding: 32px 18px;
        border: 1px dashed var(--border);
        border-radius: 18px;
        text-align: center;
        color: var(--muted);
        background: rgba(15, 23, 42, 0.42);
      }

      .result {
        border: 1px solid var(--border);
        border-radius: 18px;
        background: rgba(15, 23, 42, 0.7);
        overflow: hidden;
      }

      .result-toggle {
        appearance: none;
        width: 100%;
        border: 0;
        margin: 0;
        padding: 16px 18px 14px;
        background: transparent;
        color: inherit;
        text-align: left;
        cursor: pointer;
      }

      .result-toggle:hover {
        background: rgba(148, 163, 184, 0.06);
      }

      .result-head {
        display: flex;
        justify-content: space-between;
        gap: 14px;
        align-items: flex-start;
      }

      .title-wrap {
        min-width: 0;
        flex: 1;
      }

      .title {
        font-size: 18px;
        font-weight: 600;
        line-height: 1.35;
        word-break: break-word;
      }

      .subline {
        margin-top: 6px;
        color: var(--muted);
        font-size: 13px;
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }

      .score-wrap {
        width: 156px;
        flex: none;
        text-align: right;
      }

      .score-label {
        color: var(--muted);
        font-size: 13px;
      }

      .bar {
        margin-top: 8px;
        height: 8px;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.16);
        overflow: hidden;
      }

      .bar > span {
        display: block;
        height: 100%;
        border-radius: 999px;
        background: linear-gradient(90deg, #60a5fa 0%, #a78bfa 100%);
      }

      .snippet {
        margin: 14px 0 0;
        color: #dbeafe;
        font-size: 14px;
        line-height: 1.55;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .expand {
        border-top: 1px solid var(--border);
        padding: 16px 18px 18px;
        display: none;
      }

      .expand.show {
        display: block;
      }

      .expand-meta {
        color: var(--muted);
        font-size: 13px;
        margin-bottom: 10px;
      }

      .content {
        margin: 0;
        padding: 14px;
        border-radius: 14px;
        background: rgba(2, 6, 23, 0.55);
        color: #dbeafe;
        font-size: 13px;
        line-height: 1.6;
        white-space: pre-wrap;
        overflow-x: auto;
      }

      .loading {
        color: var(--muted);
        font-size: 14px;
      }

      @media (max-width: 860px) {
        .topbar {
          grid-template-columns: 1fr;
        }

        .result-head {
          flex-direction: column;
        }

        .score-wrap {
          width: 100%;
          text-align: left;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <header class="topbar">
        <div class="brand">
          <h1>exo</h1>
          <p>Local search and knowledge browsing for your brain.db</p>
        </div>
        <input id="query" class="search" type="search" autocomplete="off" placeholder="Search your brain..." />
      </header>

      <section class="toolbar">
        <div class="tabs" id="tabs">
          <button class="tab active" data-scope="all" type="button">All</button>
          <button class="tab" data-scope="pages" type="button">Pages</button>
          <button class="tab" data-scope="sessions" type="button">Sessions</button>
          <button class="tab" data-scope="files" type="button">Files</button>
        </div>
        <div class="status" id="status">Type to search</div>
      </section>

      <div class="warning" id="warning"></div>
      <section class="results" id="results"></section>
    </main>

    <script>
      const state = {
        query: "",
        scope: "all",
        requestId: 0,
      };

      const queryInput = document.getElementById("query");
      const statusEl = document.getElementById("status");
      const warningEl = document.getElementById("warning");
      const resultsEl = document.getElementById("results");
      const tabsEl = document.getElementById("tabs");

      function debounce(fn, wait) {
        let timer = null;
        return function() {
          const args = arguments;
          clearTimeout(timer);
          timer = setTimeout(function() {
            fn.apply(null, args);
          }, wait);
        };
      }

      function setStatus(text) {
        statusEl.textContent = text;
      }

      function setWarning(text) {
        if (text) {
          warningEl.textContent = text;
          warningEl.classList.add("show");
        } else {
          warningEl.textContent = "";
          warningEl.classList.remove("show");
        }
      }

      function emptyState(text) {
        resultsEl.innerHTML = "";
        const node = document.createElement("div");
        node.className = "empty";
        node.textContent = text;
        resultsEl.appendChild(node);
      }

      function displayTitle(result) {
        if (result.result_kind === "file" && result.title) {
          return result.title.replace(/^file-[A-Za-z0-9]+-/, "") || result.title;
        }
        return result.title || result.slug;
      }

      function displayType(result) {
        if (result.result_kind === "file") return "file";
        return result.type || "page";
      }

      function detailSlug(result) {
        if (result.result_kind === "file") {
          return result.parent_page_slug || result.page_slug || "";
        }
        return result.page_slug || result.slug;
      }

      async function toggleExpand(result, container) {
        const expandEl = container.querySelector(".expand");
        if (!expandEl) return;

        if (expandEl.classList.contains("show")) {
          expandEl.classList.remove("show");
          return;
        }

        expandEl.classList.add("show");
        if (expandEl.dataset.loaded === "true") {
          return;
        }

        const slug = detailSlug(result);
        if (!slug) {
          const meta = document.createElement("div");
          meta.className = "expand-meta";
          meta.textContent = "No page is attached to this file result.";

          const pre = document.createElement("pre");
          pre.className = "content";
          pre.textContent = result.chunk_text || "";

          expandEl.innerHTML = "";
          expandEl.appendChild(meta);
          expandEl.appendChild(pre);
          expandEl.dataset.loaded = "true";
          return;
        }

        expandEl.innerHTML = '<div class="loading">Loading page...</div>';
        try {
          const response = await fetch("/api/page/" + encodeURIComponent(slug));
          if (!response.ok) {
            throw new Error("HTTP " + response.status);
          }
          const page = await response.json();
          expandEl.innerHTML = "";

          const meta = document.createElement("div");
          meta.className = "expand-meta";
          meta.textContent = page.slug + "  |  " + page.type;

          const pre = document.createElement("pre");
          pre.className = "content";
          pre.textContent = page.content || page.compiled_truth || "";

          expandEl.appendChild(meta);
          expandEl.appendChild(pre);
          expandEl.dataset.loaded = "true";
        } catch (error) {
          expandEl.innerHTML = "";
          const meta = document.createElement("div");
          meta.className = "expand-meta";
          meta.textContent = "Failed to load page.";

          const pre = document.createElement("pre");
          pre.className = "content";
          pre.textContent = error instanceof Error ? error.message : String(error);

          expandEl.appendChild(meta);
          expandEl.appendChild(pre);
        }
      }

      function renderResults(payload) {
        const results = payload.results || [];
        setWarning(payload.warning || "");
        resultsEl.innerHTML = "";

        if (!state.query) {
          setStatus("Type to search");
          emptyState("Start typing to search your knowledge base.");
          return;
        }

        setStatus(results.length + " result" + (results.length === 1 ? "" : "s"));
        if (results.length === 0) {
          emptyState("No results.");
          return;
        }

        const topScore = results[0].score > 0 ? results[0].score : 1;

        results.forEach(function(result) {
          const article = document.createElement("article");
          article.className = "result";

          const toggle = document.createElement("button");
          toggle.type = "button";
          toggle.className = "result-toggle";

          const head = document.createElement("div");
          head.className = "result-head";

          const titleWrap = document.createElement("div");
          titleWrap.className = "title-wrap";

          const title = document.createElement("div");
          title.className = "title";
          title.textContent = displayTitle(result);

          const subline = document.createElement("div");
          subline.className = "subline";

          const typeNode = document.createElement("span");
          typeNode.textContent = displayType(result);
          subline.appendChild(typeNode);

          if (result.chunk_source) {
            const sourceNode = document.createElement("span");
            sourceNode.textContent = result.chunk_source;
            subline.appendChild(sourceNode);
          }

          if (result.parent_page_slug) {
            const parentNode = document.createElement("span");
            parentNode.textContent = "attached to " + result.parent_page_slug;
            subline.appendChild(parentNode);
          }

          titleWrap.appendChild(title);
          titleWrap.appendChild(subline);

          const scoreWrap = document.createElement("div");
          scoreWrap.className = "score-wrap";

          const scoreLabel = document.createElement("div");
          scoreLabel.className = "score-label";
          scoreLabel.textContent = Number(result.score || 0).toFixed(3);

          const bar = document.createElement("div");
          bar.className = "bar";
          const fill = document.createElement("span");
          fill.style.width = Math.max(6, Math.round(((result.score || 0) / topScore) * 100)) + "%";
          bar.appendChild(fill);

          scoreWrap.appendChild(scoreLabel);
          scoreWrap.appendChild(bar);

          head.appendChild(titleWrap);
          head.appendChild(scoreWrap);

          const snippet = document.createElement("pre");
          snippet.className = "snippet";
          snippet.textContent = result.chunk_text || "";

          toggle.appendChild(head);
          toggle.appendChild(snippet);

          const expand = document.createElement("div");
          expand.className = "expand";

          toggle.addEventListener("click", function() {
            toggleExpand(result, article);
          });

          article.appendChild(toggle);
          article.appendChild(expand);
          resultsEl.appendChild(article);
        });
      }

      async function runSearch() {
        const q = state.query.trim();
        if (!q) {
          renderResults({ results: [], warning: null });
          return;
        }

        const requestId = ++state.requestId;
        setStatus("Searching...");

        const params = new URLSearchParams({
          q: q,
          scope: state.scope,
          limit: "20",
        });

        try {
          const response = await fetch("/api/search?" + params.toString());
          const payload = await response.json();
          if (requestId !== state.requestId) return;
          renderResults(payload);

          const url = new URL(window.location.href);
          url.searchParams.set("q", q);
          url.searchParams.set("scope", state.scope);
          history.replaceState(null, "", url.toString());
        } catch (error) {
          if (requestId !== state.requestId) return;
          setWarning(error instanceof Error ? error.message : String(error));
          emptyState("Search request failed.");
        }
      }

      const debouncedSearch = debounce(runSearch, 300);

      queryInput.addEventListener("input", function(event) {
        state.query = event.target.value;
        debouncedSearch();
      });

      tabsEl.querySelectorAll(".tab").forEach(function(button) {
        button.addEventListener("click", function() {
          const nextScope = button.dataset.scope || "all";
          state.scope = nextScope;
          tabsEl.querySelectorAll(".tab").forEach(function(other) {
            other.classList.toggle("active", other === button);
          });
          debouncedSearch();
        });
      });

      const initial = new URLSearchParams(window.location.search);
      const initialQuery = initial.get("q") || "";
      const initialScope = initial.get("scope") || "all";
      state.query = initialQuery;
      state.scope = initialScope;
      queryInput.value = initialQuery;

      const activeTab = tabsEl.querySelector('[data-scope="' + initialScope + '"]');
      if (activeTab) {
        tabsEl.querySelectorAll(".tab").forEach(function(other) {
          other.classList.toggle("active", other === activeTab);
        });
      }

      if (initialQuery) {
        runSearch();
      } else {
        emptyState("Start typing to search your knowledge base.");
      }

      queryInput.focus();
    </script>
  </body>
</html>
`;
