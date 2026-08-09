import { buildReview, calculateStreak, dueForReview, historyInsights, relativeTime, reviewDueAt, submissionSolutions } from "../../core/submissions.js";
import { difficultyClass, escapeHtml, logo, send, setBusy } from "../../shared/client.js";

document.querySelector("#logo").innerHTML = logo();
let state = { settings: {}, submissions: [], attempts: [] };
let activeFilter = "All";
let selectedId = null;
const selectedSolutions = new Map();
let toastTimer;

async function load() {
  state = await send("GET_STATE");
  if (!state.settings.connected) {
    globalThis.location.replace("../onboarding/onboarding.html");
    return;
  }
  state.attempts ||= [];
  render();
}

function filteredItems() {
  const query = document.querySelector("#search").value.trim().toLowerCase();
  return state.submissions.filter((item) => {
    const languages = submissionSolutions(item).map((solution) => solution.language).join(" ");
    return (activeFilter === "All" || item.difficulty === activeFilter) && (!query || `${item.number} ${item.title} ${languages}`.toLowerCase().includes(query));
  });
}

function safeUrl(value) {
  return /^https:\/\//.test(value || "") ? value : "";
}

function leetcodeProblemUrl(item) {
  const url = safeUrl(item?.url);
  if (/^https:\/\/(www\.)?leetcode\.com\/problems\/[a-z0-9-]+(?:\/|$)/i.test(url)) return url;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item?.slug || "") ? `https://leetcode.com/problems/${item.slug}/` : "";
}

function render() {
  const items = state.submissions;
  const counts = ["Easy", "Medium", "Hard"].map((difficulty) => items.filter((item) => item.difficulty === difficulty).length);
  const repoUrl = state.settings.connected ? `https://github.com/${encodeURIComponent(state.settings.owner)}/${encodeURIComponent(state.settings.repo)}` : "";
  const repoName = document.querySelector("#repo-name");
  repoName.textContent = state.settings.connected ? `${state.settings.owner}/${state.settings.repo}` : "Not connected";
  repoName.href = repoUrl || "#";
  document.querySelector("#view-repository").href = repoUrl || "#";
  document.querySelector("#profile-title").textContent = state.settings.connected ? `${state.settings.owner} / ${state.settings.repo}` : "leetcode-solutions";
  document.querySelector("#total-stat").textContent = items.length;
  document.querySelector("#streak-stat").textContent = calculateStreak(items);
  document.querySelector("#difficulty-stat").textContent = counts.join(" / ");
  document.querySelector("#reviewed-stat").textContent = items.filter((item) => item.review).length;
  document.querySelector("#profile-badges").innerHTML = [
    `${items.length} solved`,
    `${calculateStreak(items)}-day streak`,
    `${items.filter((item) => item.review).length} reviewed`,
    `${historyInsights(items).languages.length} languages`
  ].map((label) => `<span class="badge unknown">${escapeHtml(label)}</span>`).join("");
  renderHeatmap(items);
  renderList();
  renderAnalytics();
  renderStudy();
}

function renderHeatmap(items) {
  const dayCounts = new Map();
  items.forEach((item) => {
    if (!item.syncedAt) return;
    const key = new Date(item.syncedAt).toISOString().slice(0, 10);
    dayCounts.set(key, (dayCounts.get(key) || 0) + 1);
  });
  const today = new Date();
  const cells = [];
  for (let offset = 139; offset >= 0; offset -= 1) {
    const day = new Date(today);
    day.setDate(today.getDate() - offset);
    const key = day.toISOString().slice(0, 10);
    const count = dayCounts.get(key) || 0;
    cells.push(`<span class="heat-cell ${count ? `l${Math.min(count, 3)}` : ""}" title="${key}: ${count} synced"></span>`);
  }
  document.querySelector("#heatmap").innerHTML = cells.join("");
}

function renderList() {
  const items = filteredItems();
  document.querySelector("#result-count").textContent = `${items.length} result${items.length === 1 ? "" : "s"}`;
  const list = document.querySelector("#problem-list");
  if (!items.length) {
    list.innerHTML = '<div class="empty-list"><strong>No matching problems.</strong><br>Try another filter or sync a solution.</div>';
    renderDetail(null);
    return;
  }
  if (!items.some((item) => item.id === selectedId)) selectedId = items[0].id;
  list.innerHTML = items.map((item) => `
    <button class="problem-row ${item.id === selectedId ? "active" : ""}" data-id="${escapeHtml(item.id)}">
      <span class="problem-name"><small>${String(item.number).padStart(4, "0")}</small><strong>${escapeHtml(item.title)}</strong></span>
      <span><span class="badge ${difficultyClass(item.difficulty)}">${escapeHtml(item.difficulty)}</span></span>
      <span class="language">${escapeHtml(item.language)}</span>
      <span class="synced">${relativeTime(item.syncedAt)}</span>
    </button>`).join("");
  list.querySelectorAll("[data-id]").forEach((button) => button.addEventListener("click", () => { selectedId = button.dataset.id; renderList(); }));
  renderDetail(items.find((item) => item.id === selectedId));
}

function renderDetail(item) {
  const panel = document.querySelector("#detail-panel");
  if (!item) {
    panel.innerHTML = '<div class="empty"><strong>No problem selected</strong>Choose a synced solution to review it.</div>';
    return;
  }
  const solutions = submissionSolutions(item);
  const selectedKey = selectedSolutions.get(item.id);
  const solution = solutions.find((candidate) => candidate.key === selectedKey) || solutions[0];
  const selectedItem = { ...item, ...solution };
  selectedSolutions.set(item.id, solution.key);
  const review = selectedItem.review || buildReview(selectedItem);
  const steps = review.approach || review.steps || [];
  const aiEnabled = state.settings.aiEnabled === true;
  const aiBlocked = aiEnabled && state.ai?.limitReached === true;
  const feedbackLabel = aiBlocked
    ? "AI tier limit reached"
    : aiEnabled
      ? selectedItem.review ? "Regenerate AI feedback" : "Get AI feedback"
      : selectedItem.review ? "Regenerate local feedback" : "Get local feedback";
  const commitUrl = safeUrl(selectedItem.commitUrl);
  const problemUrl = leetcodeProblemUrl(selectedItem);
  panel.innerHTML = `
    <div class="eyebrow">${review.generatedBy ? "AI overview" : "Interview overview"}</div>
    <h2>${escapeHtml(selectedItem.number)}. ${escapeHtml(selectedItem.title)}</h2>
    <div class="detail-solution-row">
      <div class="detail-meta">${escapeHtml(selectedItem.runtime)} · ${escapeHtml(selectedItem.memory)}</div>
      ${solutions.length > 1 ? `<label class="language-picker"><span>Language</span><select id="language-select" aria-label="Select solution language">${solutions.map((candidate) => `<option value="${escapeHtml(candidate.key)}" ${candidate.key === solution.key ? "selected" : ""}>${escapeHtml(candidate.language)}</option>`).join("")}</select></label>` : `<span class="detail-language">${escapeHtml(selectedItem.language)}</span>`}
    </div>
    <p class="detail-summary">${escapeHtml(review.summary || "Use the replay steps below to reconstruct the solution.")}</p>
    <div class="patterns">${(review.patterns || []).map((pattern) => `<span class="badge unknown">${escapeHtml(pattern)}</span>`).join("")}</div>
    ${review.complexity?.time ? `<div class="complexity-strip"><span><small>Time</small>${escapeHtml(review.complexity.time)}</span><span><small>Space</small>${escapeHtml(review.complexity.space)}</span></div>` : ""}
    ${review.complexityCheck?.verdict === "suboptimal" ? `<div class="complexity-warning"><strong>Suboptimal solution detected</strong><br>${escapeHtml(review.complexityCheck.note || "Compare this solution with the intended pattern.")}</div>` : ""}
    <ol class="review-steps">${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
    ${selectedItem.notes ? `<div class="personal-note"><strong>Personal note</strong><br>${escapeHtml(selectedItem.notes)}</div>` : ""}
    <div class="detail-actions">
      ${selectedItem.code ? `<button class="button full" id="regenerate-feedback" ${aiBlocked ? "disabled" : ""}>${feedbackLabel}</button>` : ""}
      ${problemUrl ? `<a class="button secondary full" href="${escapeHtml(problemUrl)}" target="_blank" rel="noreferrer">View on LeetCode ↗</a>` : ""}
      ${commitUrl ? `<a class="button secondary full" href="${escapeHtml(commitUrl)}" target="_blank" rel="noreferrer">View on GitHub ↗</a>` : ""}
    </div>`;
  document.querySelector("#language-select")?.addEventListener("change", (event) => {
    selectedSolutions.set(item.id, event.target.value);
    renderDetail(item);
  });
  document.querySelector("#regenerate-feedback")?.addEventListener("click", (event) => regenerateFeedback(selectedItem, event.currentTarget));
}

async function regenerateFeedback(item, button) {
  setBusy(button, true, "Reviewing…");
  try {
    const response = await send("GENERATE_FEEDBACK", { submission: item });
    if (response.submission) {
      state.submissions = state.submissions.map((stored) => stored.id === response.submission.id ? response.submission : stored);
    }
    state.ai = { ...state.ai, ...response.ai };
    render();
    showToast(response.ai?.generated ? "AI feedback updated." : "Local interview overview updated.");
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(button, false);
  }
}

function renderBars(element, entries) {
  const max = Math.max(1, ...entries.map(([, count]) => count));
  element.innerHTML = entries.length ? entries.slice(0, 8).map(([label, count]) => `
    <div class="bar-row"><strong>${escapeHtml(label)}</strong><div class="bar-track"><i style="width:${Math.round((count / max) * 100)}%"></i></div><span>${count}</span></div>`).join("") : '<div class="empty"><strong>No data yet</strong>Sync a solution to build this breakdown.</div>';
}

function renderAnalytics() {
  const insights = historyInsights(state.submissions);
  renderBars(document.querySelector("#pattern-breakdown"), insights.patterns);
  renderBars(document.querySelector("#language-breakdown"), insights.languages);
  document.querySelector("#attempt-count").textContent = `${state.attempts.length} captured`;
  const list = document.querySelector("#attempt-list");
  list.innerHTML = state.attempts.length ? state.attempts.slice(0, 30).map((attempt) => `
    <div class="attempt-row">
      <div><strong>${escapeHtml(attempt.number)}. ${escapeHtml(attempt.title)}</strong><small>${escapeHtml(attempt.language)} · ${escapeHtml(attempt.runtime)} · ${escapeHtml(attempt.memory)}</small></div>
      <span class="attempt-status ${attempt.status === "Accepted" ? "accepted" : ""}">${escapeHtml(attempt.status)}</span>
      <time class="muted">${relativeTime(attempt.recordedAt)}</time>
    </div>`).join("") : '<div class="empty"><strong>No attempts captured yet</strong>Submit from a LeetCode problem page to build the full path.</div>';
}

function renderStudy() {
  const items = state.submissions;
  const insights = historyInsights(items);
  const due = state.settings.spacedRepetition === false ? [] : dueForReview(items);
  const card = document.querySelector("#review-card");
  if (!due.length) {
    card.innerHTML = '<div class="eyebrow">Spaced repetition</div><h2>Nothing due today.</h2><p>Solutions return here 30 days after a sync or completed review.</p><div class="notice">Keep solving — your next review will surface automatically.</div>';
  } else {
    const item = due[0];
    const review = item.review || buildReview(item);
    card.innerHTML = `
      <div class="row spread"><div class="eyebrow">Due for review</div><span class="badge ${difficultyClass(item.difficulty)}">${escapeHtml(item.difficulty)}</span></div>
      <h2>${escapeHtml(item.number)}. ${escapeHtml(item.title)}</h2>
      <div class="due-meta"><span class="badge unknown">${escapeHtml((review.patterns || ["Review"])[0])}</span><span class="muted">due ${relativeTime(reviewDueAt(item))}</span></div>
      <p>${escapeHtml(review.summary || review.steps?.[0] || "Reconstruct the approach, invariant, and complexity before opening the code.")}</p>
      <div class="review-actions"><a class="button grow" href="${escapeHtml(safeUrl(item.url) || "#")}" target="_blank" rel="noreferrer">Re-solve now ↗</a><button class="button secondary" data-snooze="${escapeHtml(item.id)}">Snooze 3 days</button><button class="button secondary" data-reviewed="${escapeHtml(item.id)}">Mark reviewed</button></div>`;
    card.querySelector("[data-snooze]").addEventListener("click", async () => { await send("SNOOZE_REVIEW", { id: item.id }); await load(); showToast("Review snoozed for 3 days."); });
    card.querySelector("[data-reviewed]").addEventListener("click", async () => { await send("MARK_REVIEWED", { id: item.id }); await load(); showToast("Review completed. It will return in 30 days."); });
  }

  const commonPatterns = ["Arrays & Hashing", "Two Pointers", "Sliding Window", "Stack", "Binary Search", "Dynamic Programming", "Graph Traversal", "Heap", "Union-Find", "Trie", "Segment Tree"];
  const patternCounts = new Map(insights.patterns);
  const gaps = commonPatterns.filter((pattern) => !patternCounts.has(pattern));
  document.querySelector("#pattern-cloud").innerHTML = [
    ...insights.patterns.map(([pattern, count]) => `<span class="pattern-chip">${escapeHtml(pattern)}<span>${count}</span></span>`),
    ...gaps.map((pattern) => `<span class="pattern-chip gap">${escapeHtml(pattern)}<span>0</span></span>`)
  ].join("");
  document.querySelector("#gap-callout").innerHTML = gaps.length
    ? `<strong>${gaps.length} common patterns uncovered.</strong> Start with ${escapeHtml(gaps.slice(0, 3).join(", "))}.`
    : "<strong>Strong coverage.</strong> Every common pattern in this map appears in your synced solutions.";

  const streak = calculateStreak(items);
  document.querySelector("#share-total").textContent = items.length;
  document.querySelector("#share-meta").innerHTML = `<span>${streak}-day streak</span><span>${items.filter((item) => item.review).length} reviewed</span><span>${insights.languages.length} languages</span>`;
}

function showView(view) {
  document.querySelectorAll("[data-view-panel]").forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== view; });
  document.querySelectorAll(".nav-item[data-view]").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
}

function drawShareCard() {
  const canvas = document.querySelector("#share-canvas");
  const context = canvas.getContext("2d");
  const theme = getComputedStyle(document.documentElement);
  const insights = historyInsights(state.submissions);
  const streak = calculateStreak(state.submissions);
  context.fillStyle = theme.getPropertyValue("--share-bg").trim() || "#4e5a37";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = theme.getPropertyValue("--share-ink").trim() || "#f5ead8";
  context.font = "700 34px system-ui";
  context.fillText("LeetRepo", 70, 82);
  context.font = "700 150px system-ui";
  context.fillText(String(state.submissions.length), 70, 310);
  context.font = "32px system-ui";
  context.fillText("problems solved & committed", 76, 365);
  context.font = "700 27px system-ui";
  context.fillText(`${streak}-day streak`, 76, 455);
  context.fillText(`${state.submissions.filter((item) => item.review).length} reviewed`, 370, 455);
  context.fillText(`${insights.languages.length} languages`, 690, 455);
  context.font = "24px ui-monospace, monospace";
  context.globalAlpha = .72;
  context.fillText(state.settings.connected ? `github.com/${state.settings.owner}/${state.settings.repo}` : "Synced by LeetRepo", 76, 560);
  context.globalAlpha = 1;
  return canvas;
}

function canvasBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

async function copyStatsImage() {
  const blob = await canvasBlob(drawShareCard());
  if (!blob || !globalThis.ClipboardItem || !navigator.clipboard?.write) throw new Error("Image copying is unavailable in this browser.");
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  showToast("Stats image copied.");
}

async function shareStats() {
  const blob = await canvasBlob(drawShareCard());
  const file = new File([blob], "leetrepo-stats.png", { type: "image/png" });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ title: "My LeetRepo progress", text: `${state.submissions.length} LeetCode problems solved and committed.`, files: [file] });
  } else {
    await copyStatsImage();
  }
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
}

document.querySelector("#search").addEventListener("input", renderList);
document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => {
  activeFilter = button.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach((item) => item.classList.toggle("active", item === button));
  renderList();
}));
document.querySelector("#refresh").addEventListener("click", load);
document.querySelector("#settings-link").addEventListener("click", () => send("OPEN_OPTIONS"));
document.querySelector("#sign-out").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "Signing out…";
  try {
    await send("SIGN_OUT");
    globalThis.location.replace("../onboarding/onboarding.html");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Sign out";
    showToast(error.message);
  }
});
document.querySelectorAll("[data-view]").forEach((item) => item.addEventListener("click", (event) => { event.preventDefault(); showView(item.dataset.view); }));
document.querySelector("#copy-stats").addEventListener("click", () => copyStatsImage().catch((error) => showToast(error.message)));
document.querySelector("#share-stats").addEventListener("click", () => shareStats().catch((error) => showToast(error.message)));

if (globalThis.chrome?.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.settings) return;
    state.settings = changes.settings.newValue;
    render();
  });
}

load().catch((error) => showToast(error.message));
