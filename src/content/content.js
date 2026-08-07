(() => {
  const PANEL_ID = "leetrepo-panel";
  let settings = null;
  let latest = null;
  let checkTimer = null;
  let pushing = false;

  const text = (selector) => document.querySelector(selector)?.textContent?.trim() || "";
  const normalizeSpace = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const escapeHtml = (value) => String(value || "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" })[character]);

  function getProblemIdentity() {
    const match = document.title.match(/^(\d+)\.\s*(.+?)(?:\s*-\s*LeetCode)?$/i);
    const heading = text('[data-cy="question-title"]') || text('[data-e2e-locator="problem-title"]') || text("h1");
    const headingMatch = heading.match(/^(\d+)\.\s*(.+)$/);
    const urlParts = location.pathname.split("/").filter(Boolean);
    const slug = urlParts[urlParts.indexOf("problems") + 1] || "problem";
    return {
      number: headingMatch?.[1] || match?.[1] || "0",
      title: headingMatch?.[2] || match?.[2] || slug.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" "),
      slug
    };
  }

  function detectDifficulty() {
    const candidates = document.querySelectorAll('[diff], [data-degree], [class*="difficulty"], [class*="text-difficulty"]');
    for (const node of candidates) {
      const value = normalizeSpace(node.textContent);
      if (["Easy", "Medium", "Hard"].includes(value)) return value;
    }
    const visible = Array.from(document.querySelectorAll("div, span")).slice(0, 1500).find((node) => ["Easy", "Medium", "Hard"].includes(normalizeSpace(node.textContent)) && node.children.length === 0);
    return visible ? normalizeSpace(visible.textContent) : "Unknown";
  }

  function detectStatus() {
    const selectors = [
      '[data-e2e-locator="submission-result"]',
      '[data-cy="submission-result"]',
      '[class*="result"]',
      '[class*="success"]'
    ];
    const resultText = selectors.map(text).join(" ");
    if (/\bAccepted\b/i.test(resultText)) return "Accepted";
    const pageSignals = Array.from(document.querySelectorAll("span, div")).slice(-800).some((node) => node.children.length === 0 && normalizeSpace(node.textContent) === "Accepted");
    return pageSignals ? "Accepted" : "Ready";
  }

  function editorCode() {
    const monacoLines = document.querySelectorAll(".monaco-editor .view-lines .view-line");
    if (monacoLines.length) return Array.from(monacoLines).map((line) => line.textContent || "").join("\n");
    const codeMirror = document.querySelector(".CodeMirror-code");
    if (codeMirror) return Array.from(codeMirror.querySelectorAll(".CodeMirror-line")).map((line) => line.textContent || "").join("\n");
    const textarea = document.querySelector('.monaco-editor textarea, textarea[data-mode-id], textarea[aria-label*="Editor"]');
    return textarea?.value || "";
  }

  function findMetric(name) {
    const nodes = Array.from(document.querySelectorAll("div, span")).slice(-1200);
    for (const node of nodes) {
      if (node.children.length > 4) continue;
      const value = normalizeSpace(node.textContent);
      const match = value.match(new RegExp(`${name}[:\\s]+([0-9.]+\\s*(?:ms|MB))`, "i"));
      if (match) return match[1];
    }
    return "—";
  }

  function detectLanguage() {
    const value = text('button[id*="lang"]') || text('[data-cy="lang-select"]') || text('[class*="lang-select"]');
    const supported = value.match(/Python3?|C\+\+|JavaScript|TypeScript|Java|C#|Go|Rust|Swift|Kotlin|Ruby|PHP/i);
    return supported?.[0] || "Code";
  }

  function extractSubmission() {
    return {
      ...getProblemIdentity(),
      difficulty: detectDifficulty(),
      language: detectLanguage(),
      code: editorCode(),
      runtime: findMetric("Runtime"),
      memory: findMetric("Memory"),
      status: detectStatus(),
      url: location.href.split("?")[0]
    };
  }

  function mount() {
    if (document.getElementById(PANEL_ID)) return;
    const panel = document.createElement("aside");
    panel.id = PANEL_ID;
    panel.setAttribute("aria-label", "LeetRepo sync panel");
    panel.innerHTML = `
      <div class="lr-shell">
        <div class="lr-head">
          <span class="lr-logo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg></span>
          <span class="lr-brand">LeetRepo</span>
          <button class="lr-minimize" title="Minimize LeetRepo" aria-label="Minimize LeetRepo">−</button>
        </div>
        <div class="lr-body">
          <div class="lr-title">Reading this problem…</div>
          <div class="lr-meta"></div>
          <div class="lr-status">Waiting for an Accepted submission</div>
          <button class="lr-button" disabled>Push to GitHub</button>
          <button class="lr-button secondary lr-review">View interview overview</button>
          <div class="lr-notice" hidden></div>
        </div>
      </div>`;
    document.body.appendChild(panel);
    panel.querySelector(".lr-minimize").addEventListener("click", () => {
      panel.classList.toggle("lr-collapsed");
      panel.querySelector(".lr-minimize").textContent = panel.classList.contains("lr-collapsed") ? "+" : "−";
    });
    panel.querySelector(".lr-button:not(.secondary)").addEventListener("click", () => push(false));
    panel.querySelector(".lr-review").addEventListener("click", () => chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" }));
  }

  function render() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || !latest) return;
    panel.querySelector(".lr-title").textContent = `${latest.number}. ${latest.title}`;
    const difficulty = ["Easy", "Medium", "Hard"].includes(latest.difficulty) ? latest.difficulty : "Unknown";
    panel.querySelector(".lr-meta").innerHTML = `<span class="lr-badge ${difficulty}">${escapeHtml(difficulty)}</span><span>${escapeHtml(latest.language)} · ${escapeHtml(latest.runtime)} · ${escapeHtml(latest.memory)}</span>`;
    const status = panel.querySelector(".lr-status");
    status.textContent = latest.status === "Accepted" ? "Accepted — ready to sync" : "Waiting for an Accepted submission";
    status.classList.toggle("accepted", latest.status === "Accepted");
    const button = panel.querySelector(".lr-button:not(.secondary)");
    button.disabled = pushing || latest.status !== "Accepted" || !latest.code || !settings?.connected;
    button.textContent = pushing ? "Pushing…" : settings?.connected ? (latest.code ? "Push to GitHub" : "Open the code editor") : "Connect GitHub in Settings";
  }

  function showNotice(message, error = false) {
    const notice = document.querySelector(`#${PANEL_ID} .lr-notice`);
    if (!notice) return;
    notice.hidden = !message;
    notice.textContent = message;
    notice.classList.toggle("error", error);
  }

  async function push(automatic) {
    if (pushing || latest?.status !== "Accepted" || !latest?.code) return;
    pushing = true;
    render();
    showNotice("");
    try {
      const response = await chrome.runtime.sendMessage({ type: "PUSH_SUBMISSION", submission: latest });
      if (!response?.ok) throw new Error(response?.error || "Push failed.");
      await chrome.storage.local.set({ lastAutoPushKey: `${latest.number}:${hash(latest.code)}` });
      showNotice(automatic ? "Accepted and pushed automatically." : "Pushed successfully to GitHub.");
    } catch (error) {
      showNotice(error.message, true);
    } finally {
      pushing = false;
      render();
    }
  }

  function hash(value) {
    let result = 0;
    for (let index = 0; index < value.length; index += 1) result = ((result << 5) - result + value.charCodeAt(index)) | 0;
    return result;
  }

  async function refresh() {
    latest = extractSubmission();
    render();
    if (settings?.autoPush && settings.connected && latest.status === "Accepted" && latest.code) {
      const key = `${latest.number}:${hash(latest.code)}`;
      const { lastAutoPushKey } = await chrome.storage.local.get("lastAutoPushKey");
      if (key !== lastAutoPushKey) push(true);
    }
  }

  function scheduleRefresh() {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(refresh, 700);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "GET_SUBMISSION") {
      latest = extractSubmission();
      sendResponse({ submission: latest });
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.settings) {
      settings = changes.settings.newValue;
      render();
    }
  });

  mount();
  chrome.runtime.sendMessage({ type: "GET_STATE" }).then((response) => {
    settings = response?.settings || {};
    refresh();
  });
  new MutationObserver((mutations) => {
    const pageChanged = mutations.some((mutation) => {
      const target = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
      return target && !target.closest?.(`#${PANEL_ID}`);
    });
    if (pageChanged) scheduleRefresh();
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
})();
