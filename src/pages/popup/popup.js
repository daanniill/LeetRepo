import { calculateStreak, relativeTime } from "../../core/submissions.js";
import { currentSubmission, difficultyClass, escapeHtml, logo, send, setBusy, showNotice } from "../../shared/client.js";

document.querySelector("#logo").innerHTML = logo();
const pushButton = document.querySelector("#push-button");
const notice = document.querySelector("#notice");
let submission = null;
let state = null;

async function init() {
  [state, submission] = await Promise.all([send("GET_STATE"), currentSubmission()]);
  renderState();
  renderSubmission();
}

function renderState() {
  document.querySelector("#auto-push").checked = state.settings.autoPush;
  document.querySelector("#synced-count").textContent = state.submissions.length;
  document.querySelector("#streak").textContent = calculateStreak(state.submissions);
  const recent = state.submissions.slice(0, 3);
  document.querySelector("#recent-list").innerHTML = recent.length ? recent.map((item) => `
    <div class="recent-item">
      <span class="dot ${difficultyClass(item.difficulty)}"></span>
      <span class="truncate">${escapeHtml(item.number)}. ${escapeHtml(item.title)}</span>
      <time>${relativeTime(item.syncedAt)}</time>
    </div>`).join("") : '<div class="recent-empty">No pushes yet. Your first one will show up here.</div>';
}

function renderSubmission() {
  const notesWrap = document.querySelector("#popup-notes-wrap");
  notesWrap.hidden = !submission;
  if (!submission) return;
  submission.notes = submission.notes || state.notes?.[`${submission.number}-${submission.slug}`] || "";
  const diff = difficultyClass(submission.difficulty);
  document.querySelector("#status-badge").className = `badge ${submission.status === "Accepted" ? "accepted" : "unknown"}`;
  document.querySelector("#status-badge").textContent = submission.status || "Detected";
  document.querySelector("#problem-title").textContent = `${submission.number}. ${submission.title}`;
  document.querySelector("#problem-meta").innerHTML = `<span class="badge ${diff}">${escapeHtml(submission.difficulty)}</span><span>${escapeHtml(submission.language)} · ${escapeHtml(submission.runtime)} · ${escapeHtml(submission.memory)}</span>`;
  pushButton.disabled = !submission.code || submission.status !== "Accepted" || !state.settings.connected;
  document.querySelector("#personal-notes").value = submission.notes;
  if (!state.settings.connected) showNotice(notice, "Connect GitHub in Settings before your first push.");
}

pushButton.addEventListener("click", async () => {
  setBusy(pushButton, true, "Pushing…");
  showNotice(notice, "");
  try {
    const response = await send("PUSH_SUBMISSION", { submission });
    const message = response.ai?.warning
      ? `Pushed successfully. ${response.ai.warning}`
      : response.ai?.generated
        ? "Pushed successfully with a Groq-generated explanation."
        : "Pushed successfully — your GitHub commit is ready.";
    showNotice(notice, message);
    state = await send("GET_STATE");
    renderState();
  } catch (error) {
    showNotice(notice, error.message, true);
  } finally {
    setBusy(pushButton, false);
  }
});

document.querySelector("#auto-push").addEventListener("change", async (event) => {
  await send("SAVE_SETTINGS", { settings: { autoPush: event.target.checked } });
});

document.querySelector("#personal-notes").addEventListener("change", async (event) => {
  if (!submission) return;
  submission.notes = event.target.value;
  await send("SAVE_NOTES", { submission, notes: event.target.value });
});

for (const id of ["dashboard-link", "open-dashboard", "dashboard-button"]) document.querySelector(`#${id}`).addEventListener("click", (event) => { event.preventDefault(); send("OPEN_DASHBOARD"); });
document.querySelector("#open-settings").addEventListener("click", () => send("OPEN_OPTIONS"));

init().catch((error) => showNotice(notice, error.message, true));
