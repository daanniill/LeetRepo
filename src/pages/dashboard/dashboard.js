import { buildReview, calculateStreak, historyInsights, relativeTime, solveTimestamp, submissionSearchText, submissionSolutions } from "../../core/submissions.js";
import { buildStudyQueue, formatStudyInterval, nextReviewInterval, patternCoverage, studyIntervalDays } from "../../core/study.js";
import { difficultyClass, escapeHtml, logo, send, setBusy } from "../../shared/client.js";

document.querySelector("#logo").innerHTML = logo();
let state = { settings: {}, submissions: [], attempts: [] };
let activeFilter = "All";
let selectedId = null;
const selectedSolutions = new Map();
let studyTab = "due";
let studyPattern = "All";
let studyDifficulty = "All";
let selectedStudyId = null;
let studyRevealed = false;
let studyEntries = [];
let studyRecallItemId = null;
let studyRecallDraft = "";
let toastTimer;
let toastHideTimer;
const DAY_MS = 86400000;

async function load() {
  state = await send("GET_STATE");
  if (!state.settings.connected) {
    globalThis.location.replace("../onboarding/onboarding.html");
    return;
  }
  state.attempts ||= [];
  render();
  const requestedView = new URLSearchParams(globalThis.location.search).get("view");
  if (requestedView === "study") showView("study");
}

function filteredItems() {
  const query = document.querySelector("#search").value.trim().toLowerCase();
  return state.submissions.filter((item) => {
    return (activeFilter === "All" || item.difficulty === activeFilter) && (!query || submissionSearchText(item).includes(query));
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
  document.querySelector("#difficulty-stat").innerHTML = counts.map((count) => `<b>${count}</b>`).join("<i>/</i>");
  document.querySelector("#reviewed-stat").textContent = items.filter((item) => item.review).length;
  document.querySelector("#profile-badges").innerHTML = [
    `${items.length} solved`,
    `${calculateStreak(items)}-day streak`,
    `${items.filter((item) => item.review).length} AI overviews`,
    `${historyInsights(items).languages.length} languages`
  ].map((label) => `<span class="badge unknown">${escapeHtml(label)}</span>`).join("");
  renderHeatmap(items);
  renderList();
  renderAnalytics();
  renderStudy();
}

function dayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function renderHeatmap(items) {
  const dayCounts = new Map();
  items.forEach((item) => {
    const timestamp = solveTimestamp(item);
    if (!timestamp) return;
    const key = dayKey(timestamp);
    dayCounts.set(key, (dayCounts.get(key) || 0) + 1);
  });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - 363);
  start.setDate(start.getDate() - start.getDay());
  const totalDays = Math.round((today - start) / DAY_MS) + 1;
  const cells = [];
  const months = [];
  let lastMonth = -1;
  let solved = 0;
  for (let offset = 0; offset < totalDays; offset += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + offset);
    const count = dayCounts.get(dayKey(day)) || 0;
    solved += count;
    const label = day.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    cells.push(`<span class="heat-cell ${count ? `l${Math.min(count, 3)}` : ""}" title="${escapeHtml(label)} — ${count} solved"></span>`);
    if (day.getDay() === 0 && day.getMonth() !== lastMonth) {
      lastMonth = day.getMonth();
      months.push(`<span style="grid-column:${Math.floor(offset / 7) + 1}">${day.toLocaleDateString(undefined, { month: "short" })}</span>`);
    }
  }
  for (let index = cells.length % 7; index && index < 7; index += 1) cells.push('<span class="heat-cell blank"></span>');
  const heatmap = document.querySelector("#heatmap");
  heatmap.closest(".heatmap-inner").style.setProperty("--heat-columns", String(cells.length / 7));
  heatmap.innerHTML = cells.join("");
  heatmap.setAttribute("aria-label", `Solve activity heatmap: ${solved} problems solved in the last 12 months`);
  document.querySelector("#heatmap-months").innerHTML = months.join("");
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
    <button class="problem-row ${item.id === selectedId ? "active" : ""}" role="option" aria-selected="${item.id === selectedId}" tabindex="${item.id === selectedId ? 0 : -1}" data-id="${escapeHtml(item.id)}">
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
    <div class="patterns">${(selectedItem.tags || []).map((tag) => `<span class="badge unknown">${escapeHtml(tag)}</span>`).join("")}</div>
    ${review.complexity?.time ? `<div class="complexity-strip"><span><small>Time</small>${escapeHtml(review.complexity.time)}</span><span><small>Space</small>${escapeHtml(review.complexity.space)}</span></div>` : ""}
    ${review.complexityCheck?.verdict === "suboptimal" ? `<div class="complexity-warning"><strong>Suboptimal solution detected</strong><br>${escapeHtml(review.complexityCheck.note || "Compare this solution with the intended pattern.")}</div>` : ""}
    <ol class="review-steps">${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
    <div class="detail-note"><label for="detail-note-input">Personal note</label><textarea id="detail-note-input" rows="3" maxlength="4000" aria-describedby="detail-note-help" placeholder="What should future-you remember?">${escapeHtml(selectedItem.notes || "")}</textarea><small id="detail-note-help">Saved to the tagged problem README on GitHub.</small></div>
    <div class="detail-actions">
      <button class="button secondary full" id="save-detail-note">Save note</button>
      ${selectedItem.code ? `<button class="button full" id="regenerate-feedback" ${aiBlocked ? "disabled" : ""}>${feedbackLabel}</button>` : ""}
      ${problemUrl ? `<a class="button secondary full" href="${escapeHtml(problemUrl)}" target="_blank" rel="noreferrer">View on LeetCode ↗</a>` : ""}
      ${commitUrl ? `<a class="button secondary full" href="${escapeHtml(commitUrl)}" target="_blank" rel="noreferrer">View on GitHub ↗</a>` : ""}
    </div>`;
  document.querySelector("#language-select")?.addEventListener("change", (event) => {
    selectedSolutions.set(item.id, event.target.value);
    renderDetail(item);
  });
  document.querySelector("#regenerate-feedback")?.addEventListener("click", (event) => regenerateFeedback(selectedItem, event.currentTarget));
  document.querySelector("#save-detail-note")?.addEventListener("click", (event) => saveDetailNote(item, document.querySelector("#detail-note-input").value, event.currentTarget));
}

async function saveDetailNote(item, notes, button) {
  setBusy(button, true, "Saving…");
  try {
    await send("SAVE_NOTES", { submission: item, notes });
    state.submissions = state.submissions.map((stored) => stored.id === item.id ? { ...stored, notes } : stored);
    button.textContent = "Note saved";
    delete button.dataset.label;
    showToast(notes.trim() ? "Personal note saved." : "Personal note cleared.");
  } catch (error) {
    setBusy(button, false);
    showToast(error.message);
  }
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

function reviewFor(item) {
  return item.review || buildReview(item);
}

function studyPatternsFor(item) {
  return [...new Set((item.tags || []).map((tag) => String(tag || "").replace(/\s+/g, " ").trim()).filter(Boolean))];
}

function studyDueLabel(value, now = new Date()) {
  const due = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(due.getTime())) return "not scheduled";
  const difference = due.getTime() - now.getTime();
  if (difference <= 0) {
    const overdueDays = Math.floor(Math.abs(difference) / 86400000);
    return overdueDays < 1 ? "due now" : `${overdueDays}d overdue`;
  }
  const days = Math.ceil(difference / 86400000);
  if (difference < 86400000) return "due within a day";
  return days === 1 ? "due tomorrow" : `due in ${days}d`;
}

function populateStudyFilters(coverage) {
  const patternSelect = document.querySelector("#study-pattern-filter");
  const available = coverage.filter(({ count }) => count > 0).map(({ pattern }) => pattern);
  if (studyPattern !== "All" && !available.includes(studyPattern)) studyPattern = "All";
  patternSelect.innerHTML = ['<option value="All">All topics</option>', ...available.map((pattern) => `<option value="${escapeHtml(pattern)}">${escapeHtml(pattern)}</option>`)].join("");
  patternSelect.value = studyPattern;
  document.querySelector("#study-difficulty-filter").value = studyDifficulty;
}

function filteredStudyEntries(entries) {
  return entries.filter(({ item }) => {
    const patternMatch = studyPattern === "All" || studyPatternsFor(item).includes(studyPattern);
    return patternMatch && (studyDifficulty === "All" || item.difficulty === studyDifficulty);
  });
}

function renderStudyQueue(queue, enabled) {
  const list = document.querySelector("#study-queue");
  const source = studyTab === "due" ? queue.due : queue.upcoming;
  const entries = filteredStudyEntries(source);
  studyEntries = [];
  document.querySelector("#study-queue-total").textContent = entries.length;
  document.querySelectorAll("[data-study-tab]").forEach((button) => {
    const active = button.dataset.studyTab === studyTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  if (!enabled) {
    list.innerHTML = '<div class="study-empty"><strong>Scheduling is paused</strong><p>Turn on spaced repetition to build a review queue.</p></div>';
    return null;
  }
  if (!state.submissions.length) {
    list.innerHTML = '<div class="study-empty"><strong>No solutions yet</strong><p>Sync an Accepted solution to start your study queue.</p></div>';
    return null;
  }
  if (!entries.length) {
    const hasFilters = studyPattern !== "All" || studyDifficulty !== "All";
    const next = queue.upcoming[0];
    list.innerHTML = hasFilters
      ? '<div class="study-empty"><strong>No matching reviews</strong><p>Clear a filter to see the rest of your queue.</p><button class="button ghost" id="clear-study-filters">Clear filters</button></div>'
      : studyTab === "due" && queue.upcoming.length
        ? `<div class="study-empty"><strong>You’re clear for now</strong><p>Your next review is ${escapeHtml(studyDueLabel(next.dueAt))}.</p><button class="button ghost" id="show-upcoming-reviews">View upcoming</button></div>`
        : '<div class="study-empty"><strong>Nothing scheduled</strong><p>Newly synced solutions receive their first review date automatically.</p></div>';
    document.querySelector("#clear-study-filters")?.addEventListener("click", () => { studyPattern = "All"; studyDifficulty = "All"; selectedStudyId = null; renderStudy(); });
    document.querySelector("#show-upcoming-reviews")?.addEventListener("click", () => { studyTab = "upcoming"; selectedStudyId = null; studyRevealed = false; renderStudy(); });
    return null;
  }
  if (!entries.some(({ item }) => item.id === selectedStudyId)) {
    selectedStudyId = entries[0].item.id;
    studyRevealed = false;
  }
  studyEntries = entries;
  list.innerHTML = entries.map(({ item, dueAt }) => {
    const patterns = studyPatternsFor(item);
    return `<button class="study-queue-item ${item.id === selectedStudyId ? "active" : ""}" role="option" aria-selected="${item.id === selectedStudyId}" tabindex="${item.id === selectedStudyId ? 0 : -1}" data-study-id="${escapeHtml(item.id)}">
      <span class="study-queue-title"><small>${String(item.number).padStart(4, "0")}</small><strong>${escapeHtml(item.title)}</strong></span>
      <span class="study-queue-meta"><span class="badge ${difficultyClass(item.difficulty)}">${escapeHtml(item.difficulty)}</span><span>${escapeHtml(patterns[0] || "Review")}</span></span>
      <span class="study-queue-due">${escapeHtml(studyDueLabel(dueAt))}</span>
    </button>`;
  }).join("");
  list.querySelectorAll("[data-study-id]").forEach((button) => button.addEventListener("click", () => {
    selectedStudyId = button.dataset.studyId;
    studyRevealed = false;
    renderStudy();
  }));
  return entries.find(({ item }) => item.id === selectedStudyId) || entries[0];
}

function renderStudySession(entry, enabled, preferredIntervalDays) {
  const panel = document.querySelector("#study-session");
  if (!enabled) {
    studyRecallItemId = null;
    studyRecallDraft = "";
    panel.innerHTML = '<div class="study-session-empty"><div class="eyebrow">Spaced repetition</div><h2>Scheduling is turned off.</h2><p>Your synced solutions are safe. Turn the setting back on when you want reviews to resurface.</p><button class="button" id="open-study-settings">Open settings</button></div>';
    panel.querySelector("#open-study-settings").addEventListener("click", () => send("OPEN_OPTIONS"));
    return;
  }
  if (!entry) {
    studyRecallItemId = null;
    studyRecallDraft = "";
    const message = state.submissions.length ? "Choose a review from the queue when you’re ready." : "Sync your first Accepted solution to create a study session.";
    panel.innerHTML = `<div class="study-session-empty"><div class="eyebrow">Study session</div><h2>No active review</h2><p>${escapeHtml(message)}</p></div>`;
    return;
  }
  const { item, dueAt } = entry;
  if (item.id !== studyRecallItemId) {
    studyRecallItemId = item.id;
    studyRecallDraft = "";
  }
  const review = reviewFor(item);
  const patterns = studyPatternsFor(item);
  const problemUrl = leetcodeProblemUrl(item);
  const commitUrl = safeUrl(item.commitUrl);
  const steps = review.approach || review.steps || [];
  panel.innerHTML = `
    <div class="study-session-header">
      <div><div class="eyebrow">${studyRevealed ? "Refresher revealed" : "Recall first"}</div><h2>${escapeHtml(item.number)}. ${escapeHtml(item.title)}</h2></div>
      <span class="badge ${difficultyClass(item.difficulty)}">${escapeHtml(item.difficulty)}</span>
    </div>
    <div class="study-session-meta"><span>${escapeHtml(studyDueLabel(dueAt))}</span>${patterns.map((pattern) => `<span>${escapeHtml(pattern)}</span>`).join("")}</div>
    ${studyRevealed ? `
      <article class="study-refresher">
        ${studyRecallDraft ? `<div class="recall-response"><strong>Your recall</strong><p>${escapeHtml(studyRecallDraft)}</p></div>` : ""}
        <p class="study-summary">${escapeHtml(review.summary || "Reconstruct the approach, invariant, and complexity before opening the code.")}</p>
        ${review.complexity?.time ? `<div class="complexity-strip"><span><small>Time</small>${escapeHtml(review.complexity.time)}</span><span><small>Space</small>${escapeHtml(review.complexity.space)}</span></div>` : ""}
        ${steps.length ? `<h3>Approach replay</h3><ol class="review-steps">${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>` : ""}
        ${review.edgeCases?.length ? `<h3>Edge cases</h3><ul class="edge-case-list">${review.edgeCases.map((edgeCase) => `<li>${escapeHtml(edgeCase)}</li>`).join("")}</ul>` : ""}
        ${item.notes ? `<div class="personal-note"><strong>Personal note</strong><br>${escapeHtml(item.notes)}</div>` : ""}
      </article>
      <div class="review-rating">
        <div class="eyebrow">How did recall feel?</div>
        <div class="rating-actions">
          <button data-rating="again"><strong>Again</strong><span>${formatStudyInterval(nextReviewInterval(item, "again", preferredIntervalDays))}</span></button>
          <button data-rating="hard"><strong>Hard</strong><span>${formatStudyInterval(nextReviewInterval(item, "hard", preferredIntervalDays))}</span></button>
          <button data-rating="good"><strong>Got it</strong><span>${formatStudyInterval(nextReviewInterval(item, "good", preferredIntervalDays), state.settings.studyIntervalUnit)}</span></button>
        </div>
      </div>` : `
      <div class="recall-prompt">
        <strong>Before looking at your solution:</strong>
        <ol><li>Describe the approach and its key invariant.</li><li>State the time and space complexity.</li><li>Name one edge case you would test.</li></ol>
      </div>
      <label class="recall-input"><span>Write your recall attempt</span><textarea id="study-recall-input" rows="4" maxlength="2000" placeholder="Type what you remember before revealing…">${escapeHtml(studyRecallDraft)}</textarea></label>
      <button class="button full reveal-button" id="reveal-study-review">Reveal refresher</button>`}
    <div class="study-session-actions">
      ${studyTab === "due" ? `<button class="button ghost" id="snooze-study-review">Snooze 3 days</button>` : ""}
      ${problemUrl ? `<a class="button secondary" href="${escapeHtml(problemUrl)}" target="_blank" rel="noreferrer">Re-solve on LeetCode ↗</a>` : ""}
      ${studyRevealed && commitUrl ? `<a class="button secondary" href="${escapeHtml(commitUrl)}" target="_blank" rel="noreferrer">View on GitHub ↗</a>` : ""}
    </div>`;
  panel.querySelector("#study-recall-input")?.addEventListener("input", (event) => { studyRecallDraft = event.target.value; });
  panel.querySelector("#reveal-study-review")?.addEventListener("click", () => { studyRevealed = true; renderStudy(); });
  panel.querySelector("#snooze-study-review")?.addEventListener("click", (event) => snoozeStudyReview(item, event.currentTarget));
  panel.querySelectorAll("[data-rating]").forEach((button) => button.addEventListener("click", () => rateStudyReview(item, button.dataset.rating, button)));
}

async function snoozeStudyReview(item, button) {
  setBusy(button, true, "Snoozing…");
  try {
    const response = await send("SNOOZE_REVIEW", { id: item.id });
    state.submissions = response.submissions || state.submissions;
    selectedStudyId = null;
    studyRevealed = false;
    render();
    showToast("Review snoozed for 3 days.");
  } catch (error) {
    setBusy(button, false);
    showToast(error.message);
  }
}

async function rateStudyReview(item, rating, button) {
  setBusy(button, true, "Saving…");
  try {
    const response = await send("RATE_REVIEW", { id: item.id, rating, recall: studyRecallDraft });
    state.submissions = response.submissions || state.submissions;
    selectedStudyId = null;
    studyRevealed = false;
    render();
    const interval = formatStudyInterval(response.submission?.reviewIntervalDays || 1, rating === "good" ? state.settings.studyIntervalUnit : null);
    showToast(`Review will resurface in ${interval}.`);
  } catch (error) {
    setBusy(button, false);
    showToast(error.message);
  }
}

function renderPatternCoverage(coverage, enabled) {
  const visibleCoverage = enabled ? coverage : coverage.map((entry) => ({ ...entry, status: "rotation", dueCount: 0 }));
  const cloud = document.querySelector("#pattern-cloud");
  cloud.innerHTML = visibleCoverage.map(({ pattern, count, dueCount, status }) => `<button class="pattern-chip ${status} ${studyPattern === pattern ? "active" : ""}" data-study-pattern="${escapeHtml(pattern)}" ${count ? "" : "disabled"}>
    ${escapeHtml(pattern)}<span>${dueCount ? `${dueCount} due` : count}</span>
  </button>`).join("");
  cloud.querySelectorAll("[data-study-pattern]:not([disabled])").forEach((button) => button.addEventListener("click", () => {
    studyPattern = button.dataset.studyPattern;
    studyTab = coverage.find(({ pattern }) => pattern === studyPattern)?.dueCount ? "due" : "upcoming";
    selectedStudyId = null;
    studyRevealed = false;
    renderStudy();
    document.querySelector(".study-workspace").scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  const duePatterns = visibleCoverage.filter(({ dueCount }) => dueCount > 0);
  document.querySelector("#gap-callout").innerHTML = !enabled
    ? "<strong>Review scheduling is paused.</strong> Topic coverage remains available while spaced repetition is off."
    : duePatterns.length
      ? `<strong>${duePatterns.length} topic${duePatterns.length === 1 ? " has" : "s have"} reviews due.</strong> Start with ${escapeHtml(duePatterns.slice(0, 3).map(({ pattern }) => pattern).join(", "))}.`
      : visibleCoverage.length
        ? "<strong>Your captured topics are in rotation.</strong> Keep using the review queue to maintain recall."
        : "<strong>No topics captured yet.</strong> Sync a problem to add its LeetCode topics.";
}

function renderStudy() {
  const items = state.submissions;
  const enabled = state.settings.spacedRepetition !== false;
  const preferredIntervalDays = studyIntervalDays(state.settings);
  const queue = buildStudyQueue(items, new Date(), preferredIntervalDays);
  const coverage = patternCoverage(items, studyPatternsFor, new Date(), preferredIntervalDays);
  const inRotation = coverage.filter(({ count }) => count > 0).length;
  document.querySelector("#study-due-stat").textContent = enabled ? queue.due.length : 0;
  document.querySelector("#study-upcoming-stat").textContent = enabled ? queue.nextSevenDays.length : 0;
  document.querySelector("#study-reviewed-stat").textContent = queue.totalReviews;
  document.querySelector("#study-pattern-stat").textContent = inRotation;
  document.querySelector("#study-due-tab-count").textContent = enabled ? queue.due.length : 0;
  document.querySelector("#study-upcoming-tab-count").textContent = enabled ? queue.upcoming.length : 0;
  populateStudyFilters(coverage);
  document.querySelector("#study-pattern-filter").disabled = !enabled || !items.length;
  document.querySelector("#study-difficulty-filter").disabled = !enabled || !items.length;
  const selectedEntry = renderStudyQueue(queue, enabled);
  renderStudySession(selectedEntry, enabled, preferredIntervalDays);
  renderPatternCoverage(coverage, enabled);

  const insights = historyInsights(items);
  const streak = calculateStreak(items);
  document.querySelector("#share-total").textContent = items.length;
  document.querySelector("#share-meta").innerHTML = `<span>${streak}-day streak</span><span>${queue.totalReviews} reviews</span><span>${insights.languages.length} languages</span>`;
}

function showView(view) {
  document.querySelectorAll("[data-view-panel]").forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== view; });
  document.querySelectorAll(".nav-item[data-view]").forEach((item) => {
    const active = item.dataset.view === view;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
}

function nextIndex(key, index, length) {
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  if (key === "ArrowDown") return Math.min(index + 1, length - 1);
  return Math.max(index - 1, 0);
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
  toast.classList.remove("leaving");
  clearTimeout(toastTimer);
  clearTimeout(toastHideTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add("leaving");
    toastHideTimer = setTimeout(() => { toast.hidden = true; toast.classList.remove("leaving"); }, 200);
  }, 3200);
}

document.querySelector("#search").addEventListener("input", renderList);
document.querySelector("#problem-list").addEventListener("keydown", (event) => {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const items = filteredItems();
  if (!items.length) return;
  event.preventDefault();
  selectedId = items[nextIndex(event.key, items.findIndex((item) => item.id === selectedId), items.length)].id;
  renderList();
  document.querySelector("#problem-list .problem-row.active")?.focus();
});
document.querySelector("#study-queue").addEventListener("keydown", (event) => {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  if (!studyEntries.length || !event.target.closest(".study-queue-item")) return;
  event.preventDefault();
  selectedStudyId = studyEntries[nextIndex(event.key, studyEntries.findIndex(({ item }) => item.id === selectedStudyId), studyEntries.length)].item.id;
  studyRevealed = false;
  renderStudy();
  document.querySelector("#study-queue .study-queue-item.active")?.focus();
});
document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => {
  activeFilter = button.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach((item) => {
    const active = item === button;
    item.classList.toggle("active", active);
    item.setAttribute("aria-pressed", String(active));
  });
  renderList();
}));
document.querySelectorAll("[data-study-tab]").forEach((button) => button.addEventListener("click", () => {
  studyTab = button.dataset.studyTab;
  selectedStudyId = null;
  studyRevealed = false;
  renderStudy();
}));
document.querySelector("#study-pattern-filter").addEventListener("change", (event) => {
  studyPattern = event.target.value;
  selectedStudyId = null;
  studyRevealed = false;
  renderStudy();
});
document.querySelector("#study-difficulty-filter").addEventListener("change", (event) => {
  studyDifficulty = event.target.value;
  selectedStudyId = null;
  studyRevealed = false;
  renderStudy();
});
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
