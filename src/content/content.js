(() => {
  const PANEL_ID = "leetrepo-panel";
  let settings = null;
  let latest = null;
  let checkTimer = null;
  let pushing = false;
  let reviewing = false;
  let ai = { limitReached: false };
  let notes = {};
  let syncedSubmissions = [];
  let pendingSubmission = null;
  let acceptedSubmissionKey = "";
  let autoPushAttemptedKey = "";
  const themes = new Set(["light", "dark", "teal"]);
  const submissionStatuses = ["Accepted", "Wrong Answer", "Time Limit Exceeded", "Memory Limit Exceeded", "Runtime Error", "Compile Error", "Output Limit Exceeded"];
  const resultSelector = '[data-e2e-locator*="submission-result"], [data-cy*="submission-result"]';

  const text = (selector) => document.querySelector(selector)?.textContent?.trim() || "";
  const normalizeSpace = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const escapeHtml = (value) => String(value || "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" })[character]);

  function syncedSolutionFor(submission) {
    const repoUrl = `https://github.com/${settings?.owner || ""}/${settings?.repo || ""}/`.toLowerCase();
    return syncedSubmissions.find((item) => String(item.number) === String(submission?.number)
      && String(item.language || "").toLowerCase() === String(submission?.language || "").toLowerCase()
      && (!item.commitUrl || item.commitUrl.toLowerCase().startsWith(repoUrl)));
  }

  function isCurrentSolutionSynced() {
    const stored = syncedSolutionFor(latest);
    return Boolean(stored?.code && String(stored.code).trimEnd() === String(latest?.code || "").trimEnd());
  }

  function submissionKey(submission) {
    return `${submission?.number || "0"}:${String(submission?.code || "").trimEnd()}`;
  }

  function hasFreshAcceptance(submission = latest) {
    return Boolean(acceptedSubmissionKey && acceptedSubmissionKey === submissionKey(submission));
  }

  function submissionForPush(submission = latest) {
    const accepted = hasFreshAcceptance(submission);
    return {
      ...submission,
      status: accepted ? "Accepted" : submission?.status === "Accepted" ? "Ready" : submission?.status,
      pushReady: accepted
    };
  }

  function isLeetCodeSubmitButton(target) {
    const button = target?.closest?.("button");
    if (!button || button.closest(`#${PANEL_ID}`)) return false;
    return button.matches('[data-e2e-locator*="submit"], [data-cy*="submit"]')
      || /^submit$/i.test(normalizeSpace(button.textContent || button.getAttribute("aria-label")));
  }

  function resultStatusFromMutations(mutations) {
    const roots = new Set();
    for (const mutation of mutations) {
      const target = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
      const closest = target?.closest?.(resultSelector);
      if (closest) roots.add(closest);
      for (const added of mutation.addedNodes || []) {
        const element = added.nodeType === Node.ELEMENT_NODE ? added : added.parentElement;
        if (!element) continue;
        if (element.matches?.(resultSelector)) roots.add(element);
        element.querySelectorAll?.(resultSelector).forEach((root) => roots.add(root));
      }
    }
    for (const root of roots) {
      const value = normalizeSpace(root.textContent);
      const status = submissionStatuses.find((candidate) => new RegExp(`\\b${candidate.replaceAll(" ", "\\s+")}\\b`, "i").test(value));
      if (status) return status;
    }
    return null;
  }

  function applyTheme() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    if (themes.has(settings?.theme)) panel.dataset.theme = settings.theme;
    else delete panel.dataset.theme;
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
    for (const status of submissionStatuses) if (new RegExp(`\\b${status.replaceAll(" ", "\\s+")}\\b`, "i").test(resultText)) return status;
    const pageSignals = Array.from(document.querySelectorAll("span, div")).slice(-800)
      .filter((node) => node.children.length === 0)
      .map((node) => normalizeSpace(node.textContent));
    return submissionStatuses.find((status) => pageSignals.includes(status)) || "Ready";
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

  function extractSubmission() {
    const problemDetails = globalThis.LeetRepoProblem.getProblemDetails(document);
    const firstExample = problemDetails.examples[0] || {};
    return {
      ...globalThis.LeetRepoProblem.getProblemIdentity(document, location),
      tags: globalThis.LeetRepoProblem.getProblemTags(document),
      ...problemDetails,
      problemContext: problemDetails.problemDescription.slice(0, 1_200),
      exampleInput: firstExample.input || "",
      exampleOutput: firstExample.output || "",
      difficulty: detectDifficulty(),
      language: globalThis.LeetRepoLanguage.detectLanguage(document),
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
          <button class="lr-minimize" title="Minimize LeetRepo" aria-label="Minimize LeetRepo" aria-expanded="true">−</button>
        </div>
        <div class="lr-body"><div class="lr-body-inner">
          <div class="lr-title">Reading this problem…</div>
          <div class="lr-meta"></div>
          <div class="lr-status">Waiting for an Accepted submission</div>
          <button class="lr-button" disabled>Push to GitHub</button>
          <button class="lr-button secondary lr-review">Get AI feedback</button>
          <div class="lr-feedback" hidden></div>
          <label class="lr-notes-label" for="lr-personal-notes">Personal notes</label>
          <textarea class="lr-notes" id="lr-personal-notes" rows="2" maxlength="4000" placeholder="What should future-you remember?"></textarea>
          <div class="lr-auto"><span>Auto-push on Accepted</span><label class="lr-switch"><input class="lr-auto-push" type="checkbox"><span></span></label></div>
          <div class="lr-auto lr-ai-option"><span class="lr-ai-copy">AI walkthrough + diagram<small>Sends solution code to AI</small></span><label class="lr-switch"><input class="lr-ai-readme" type="checkbox" aria-label="Use AI walkthrough and diagram"><span></span></label></div>
          <button class="lr-link lr-dashboard">Open dashboard →</button>
          <div class="lr-notice" hidden></div>
        </div></div>
      </div>`;
    document.body.appendChild(panel);
    panel.querySelector(".lr-minimize").addEventListener("click", () => {
      const collapsed = panel.classList.toggle("lr-collapsed");
      const minimize = panel.querySelector(".lr-minimize");
      minimize.textContent = collapsed ? "+" : "−";
      minimize.setAttribute("aria-expanded", String(!collapsed));
      minimize.setAttribute("aria-label", collapsed ? "Expand LeetRepo" : "Minimize LeetRepo");
      minimize.title = collapsed ? "Expand LeetRepo" : "Minimize LeetRepo";
    });
    panel.querySelector(".lr-button:not(.secondary)").addEventListener("click", () => push(false));
    panel.querySelector(".lr-review").addEventListener("click", review);
    panel.querySelector(".lr-dashboard").addEventListener("click", () => chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" }));
    panel.querySelector(".lr-notes").addEventListener("input", (event) => { if (latest) latest.notes = event.target.value; });
    panel.querySelector(".lr-notes").addEventListener("change", async (event) => {
      if (!latest) return;
      notes[`${latest.number}-${latest.slug}`] = event.target.value;
      await chrome.runtime.sendMessage({ type: "SAVE_NOTES", submission: latest, notes: event.target.value });
    });
    panel.querySelector(".lr-auto-push").addEventListener("change", async (event) => {
      settings = { ...settings, autoPush: event.target.checked };
      await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings: { autoPush: event.target.checked } });
    });
    panel.querySelector(".lr-ai-readme").addEventListener("change", async (event) => {
      const previous = settings?.aiEnabled === true;
      const enabled = event.target.checked;
      settings = { ...settings, aiEnabled: enabled, aiConsent: enabled };
      render();
      try {
        const response = await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings: { aiEnabled: enabled, aiConsent: enabled } });
        if (!response?.ok) throw new Error(response?.error || "Could not update the AI README setting.");
        settings = response.settings;
        showNotice(enabled ? "AI walkthrough enabled. Solution code will be processed by LeetRepo's AI provider." : "Official problem details will still be included without AI.");
      } catch (error) {
        settings = { ...settings, aiEnabled: previous, aiConsent: previous };
        showNotice(error.message, true);
      }
      render();
    });
  }

  function render() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || !latest) return;
    panel.querySelector(".lr-title").textContent = `${latest.number}. ${latest.title}`;
    const difficulty = ["Easy", "Medium", "Hard"].includes(latest.difficulty) ? latest.difficulty : "Unknown";
    panel.querySelector(".lr-meta").innerHTML = `<span class="lr-badge ${difficulty}">${escapeHtml(difficulty)}</span><span>${escapeHtml(latest.language)} · ${escapeHtml(latest.runtime)} · ${escapeHtml(latest.memory)}</span>`;
    const status = panel.querySelector(".lr-status");
    const freshAcceptance = hasFreshAcceptance();
    const currentSolutionSynced = isCurrentSolutionSynced() && !freshAcceptance;
    const existingSolution = syncedSolutionFor(latest);
    status.textContent = currentSolutionSynced
      ? "Accepted — solution already synced"
      : freshAcceptance
        ? existingSolution ? "Accepted — updated solution ready to sync" : "Accepted — ready to sync"
        : pendingSubmission?.key === submissionKey(latest)
          ? "Waiting for LeetCode to finish…"
          : latest.status === "Ready" || latest.status === "Accepted" ? "Submit on LeetCode to sync" : latest.status;
    status.classList.toggle("accepted", freshAcceptance || currentSolutionSynced);
    status.classList.toggle("rejected", !freshAcceptance && !currentSolutionSynced && !["Accepted", "Ready"].includes(latest.status));
    const button = panel.querySelector(".lr-button:not(.secondary)");
    button.disabled = pushing || currentSolutionSynced || !freshAcceptance || !latest.code || !settings?.connected;
    button.textContent = pushing
      ? "Pushing…"
      : currentSolutionSynced
        ? "Solution already synced"
        : settings?.connected ? (latest.code ? existingSolution ? "Update on GitHub" : "Push to GitHub" : "Open the code editor") : "Connect GitHub in Settings";
    const reviewButton = panel.querySelector(".lr-review");
    const aiEnabled = settings?.aiEnabled === true;
    const aiBlocked = aiEnabled && ai.limitReached === true;
    reviewButton.disabled = reviewing || !latest.code || aiBlocked;
    reviewButton.textContent = reviewing ? "Reviewing solution…" : aiBlocked ? "AI tier limit reached" : aiEnabled ? "Get AI feedback" : "Get local feedback";
    panel.querySelector(".lr-auto-push").checked = settings?.autoPush !== false;
    const aiToggle = panel.querySelector(".lr-ai-readme");
    aiToggle.checked = aiEnabled;
    aiToggle.disabled = ai.limitReached === true && !aiEnabled;
    panel.querySelector(".lr-ai-option").classList.toggle("limited", ai.limitReached === true);
    panel.querySelector(".lr-ai-copy small").textContent = ai.limitReached === true
      ? aiEnabled ? "Limit reached — turn off for local mode" : "Limit reached — local mode active"
      : "Sends solution code to AI";
    const notesInput = panel.querySelector(".lr-notes");
    if (document.activeElement !== notesInput && notesInput.value !== (latest.notes || "")) notesInput.value = latest.notes || "";
  }

  async function review() {
    if (reviewing || !latest?.code || (settings?.aiEnabled === true && ai.limitReached === true)) return;
    reviewing = true;
    render();
    showNotice("");
    try {
      const response = await chrome.runtime.sendMessage({ type: "GENERATE_FEEDBACK", submission: latest });
      if (!response?.ok) throw new Error(response?.error || "Feedback failed.");
      ai = { ...ai, ...response.ai };
      const feedback = document.querySelector(`#${PANEL_ID} .lr-feedback`);
      const complexity = response.review.complexity?.time && response.review.complexity?.space
        ? `<div class="lr-complexity"><span>Time · ${escapeHtml(response.review.complexity.time)}</span><span>Space · ${escapeHtml(response.review.complexity.space)}</span></div>`
        : "";
      feedback.innerHTML = `<strong>30-second refresher</strong><p>${escapeHtml(response.review.summary || response.review.steps?.[0] || "Review the approach and its key invariant.")}</p><div class="lr-patterns">${(latest.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>${complexity}`;
      feedback.hidden = false;
      if (response.ai?.warning) showNotice(response.ai.warning, true);
    } catch (error) {
      showNotice(error.message, true);
    } finally {
      reviewing = false;
      render();
    }
  }

  function showNotice(message, error = false) {
    const notice = document.querySelector(`#${PANEL_ID} .lr-notice`);
    if (!notice) return;
    notice.hidden = !message;
    notice.textContent = message;
    notice.classList.toggle("error", error);
  }

  async function push(automatic) {
    const pushKey = acceptedSubmissionKey;
    if (pushing || !hasFreshAcceptance() || !latest?.code || (automatic && autoPushAttemptedKey === pushKey)) return;
    if (automatic) autoPushAttemptedKey = pushKey;
    pushing = true;
    render();
    showNotice("");
    try {
      const response = await chrome.runtime.sendMessage({ type: "PUSH_SUBMISSION", submission: submissionForPush() });
      if (!response?.ok) throw new Error(response?.error || "Push failed.");
      ai = { ...ai, ...response.ai };
      syncedSubmissions = [response.submission, ...syncedSubmissions.filter((item) => String(item.number) !== String(response.submission.number))];
      acceptedSubmissionKey = "";
      const success = response.result?.updated
        ? automatic ? "Accepted solution updated automatically." : "Solution updated successfully on GitHub."
        : automatic ? "Accepted and pushed automatically." : "Pushed successfully to GitHub.";
      showNotice(response.ai?.warning
        ? `${success} ${response.ai.warning}`
        : response.ai?.generated
          ? `${success} AI explanation added.`
          : response.ai?.reused ? `${success} Existing AI explanation reused without another request.` : success);
    } catch (error) {
      showNotice(error.message, true);
    } finally {
      pushing = false;
      render();
    }
  }

  async function refresh() {
    latest = extractSubmission();
    latest.notes = notes[`${latest.number}-${latest.slug}`] || "";
    render();
    if (!["Ready"].includes(latest.status) && latest.code) chrome.runtime.sendMessage({ type: "RECORD_ATTEMPT", submission: latest });
    if (settings?.autoPush && settings.connected && hasFreshAcceptance() && latest.code) push(true);
  }

  function scheduleRefresh() {
    if (!settings?.connected) return;
    clearTimeout(checkTimer);
    checkTimer = setTimeout(refresh, 700);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "GET_SUBMISSION") {
      if (settings?.connected === false) {
        sendResponse({ submission: null });
        return;
      }
      latest = extractSubmission();
      sendResponse({ submission: submissionForPush(latest) });
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.settings) {
      settings = changes.settings.newValue;
      if (!settings?.connected) {
        document.getElementById(PANEL_ID)?.remove();
        clearTimeout(checkTimer);
        latest = null;
        pendingSubmission = null;
        acceptedSubmissionKey = "";
        autoPushAttemptedKey = "";
        return;
      }
      mount();
      applyTheme();
      refresh();
    }
    if (area === "local" && changes.submissions) {
      syncedSubmissions = changes.submissions.newValue || [];
      if (hasFreshAcceptance() && isCurrentSolutionSynced()) acceptedSubmissionKey = "";
      render();
    }
  });

  chrome.runtime.sendMessage({ type: "GET_STATE" }).then((response) => {
    settings = response?.settings || {};
    ai = response?.ai || ai;
    notes = response?.notes || {};
    syncedSubmissions = response?.submissions || [];
    if (!settings.connected) return;
    mount();
    applyTheme();
    refresh();
  });
  document.addEventListener("click", (event) => {
    if (!settings?.connected || !isLeetCodeSubmitButton(event.target)) return;
    const submission = extractSubmission();
    if (!submission.code) return;
    acceptedSubmissionKey = "";
    autoPushAttemptedKey = "";
    pendingSubmission = { key: submissionKey(submission), startedAt: Date.now() };
    latest = submission;
    showNotice("");
    render();
  }, true);
  new MutationObserver((mutations) => {
    if (!settings?.connected) return;
    const resultStatus = pendingSubmission && Date.now() - pendingSubmission.startedAt >= 250
      ? resultStatusFromMutations(mutations)
      : null;
    if (resultStatus) {
      if (resultStatus === "Accepted") acceptedSubmissionKey = pendingSubmission.key;
      else acceptedSubmissionKey = "";
      pendingSubmission = null;
    }
    const pageChanged = mutations.some((mutation) => {
      const target = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
      return target && !target.closest?.(`#${PANEL_ID}`);
    });
    if (pageChanged) scheduleRefresh();
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
})();
