import { buildReview, calculateStreak, relativeTime } from "./lib.js";
import { difficultyClass, escapeHtml, logo, send } from "./client.js";

document.querySelector("#logo").innerHTML = logo();
let state = { settings: {}, submissions: [] };
let activeFilter = "All";
let selectedId = null;

async function load() {
  state = await send("GET_STATE");
  render();
}

function filteredItems() {
  const query = document.querySelector("#search").value.trim().toLowerCase();
  return state.submissions.filter((item) => (activeFilter === "All" || item.difficulty === activeFilter) && (!query || `${item.number} ${item.title} ${item.language}`.toLowerCase().includes(query)));
}

function render() {
  const items = state.submissions;
  const counts = ["Easy", "Medium", "Hard"].map((difficulty) => items.filter((item) => item.difficulty === difficulty).length);
  document.querySelector("#repo-name").textContent = state.settings.connected ? `${state.settings.owner}/${state.settings.repo}` : "Not connected";
  document.querySelector("#total-stat").textContent = items.length;
  document.querySelector("#streak-stat").textContent = calculateStreak(items);
  document.querySelector("#difficulty-stat").textContent = counts.join(" / ");
  document.querySelector("#reviewed-stat").textContent = state.settings.includeReview === false ? 0 : items.length;
  renderHeatmap(items);
  renderList();
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
  const review = buildReview(item);
  panel.innerHTML = `
    <div class="eyebrow">Interview overview</div>
    <h2>${escapeHtml(item.number)}. ${escapeHtml(item.title)}</h2>
    <div class="detail-meta">${escapeHtml(item.language)} · ${escapeHtml(item.runtime)} · ${escapeHtml(item.memory)}</div>
    <div class="patterns">${review.patterns.map((pattern) => `<span class="badge unknown">${escapeHtml(pattern)}</span>`).join("")}</div>
    <ol class="review-steps">${review.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
    ${item.commitUrl ? `<a class="button secondary full" href="${escapeHtml(item.commitUrl)}" target="_blank" rel="noreferrer">View commit on GitHub ↗</a>` : ""}`;
}

document.querySelector("#search").addEventListener("input", renderList);
document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => {
  activeFilter = button.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach((item) => item.classList.toggle("active", item === button));
  renderList();
}));
document.querySelector("#refresh").addEventListener("click", load);
document.querySelector("#settings-link").addEventListener("click", () => send("OPEN_OPTIONS"));

load();
