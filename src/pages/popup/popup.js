import { calculateStreak, relativeTime } from "../../core/submissions.js";
import { currentSubmission, difficultyClass, escapeHtml, logo, send, setBusy, showNotice } from "../../shared/client.js";

document.querySelector("#logo").innerHTML = logo();
const pushButton = document.querySelector("#push-button");
const notice = document.querySelector("#notice");
let submission = null;
let state = null;

function syncedSolutionFor(item) {
  const repoUrl = `https://github.com/${state.settings.owner || ""}/${state.settings.repo || ""}/`.toLowerCase();
  return state.submissions.find((stored) => String(stored.number) === String(item?.number)
    && String(stored.language || "").toLowerCase() === String(item?.language || "").toLowerCase()
    && (!stored.commitUrl || stored.commitUrl.toLowerCase().startsWith(repoUrl)));
}

async function init() {
  state = await send("GET_STATE");
  const connected = state.settings.connected === true;
  document.querySelector("#auth-gate").hidden = connected;
  document.querySelector("#app-content").hidden = !connected;
  if (!connected) return;
  submission = await currentSubmission();
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
  const existingSolution = syncedSolutionFor(submission);
  const freshAcceptance = submission.pushReady === true;
  const currentSolutionSynced = !freshAcceptance && Boolean(existingSolution?.code && String(existingSolution.code).trimEnd() === String(submission.code || "").trimEnd());
  const diff = difficultyClass(submission.difficulty);
  document.querySelector("#status-badge").className = `badge ${freshAcceptance || currentSolutionSynced ? "accepted" : "unknown"}`;
  document.querySelector("#status-badge").textContent = freshAcceptance ? "Accepted" : currentSolutionSynced ? "Synced" : "Submit on LeetCode";
  document.querySelector("#problem-title").textContent = `${submission.number}. ${submission.title}`;
  document.querySelector("#problem-meta").innerHTML = `<span class="badge ${diff}">${escapeHtml(submission.difficulty)}</span><span>${escapeHtml(submission.language)} · ${escapeHtml(submission.runtime)} · ${escapeHtml(submission.memory)}</span>`;
  pushButton.disabled = currentSolutionSynced || !freshAcceptance || !submission.code || !state.settings.connected;
  pushButton.textContent = currentSolutionSynced ? "Solution already synced" : existingSolution ? "Update on GitHub" : "Push to GitHub";
  document.querySelector("#personal-notes").value = submission.notes;
  if (!state.settings.connected) showNotice(notice, "Connect GitHub in Settings before your first push.");
}

pushButton.addEventListener("click", async () => {
  setBusy(pushButton, true, "Pushing…");
  showNotice(notice, "");
  try {
    const response = await send("PUSH_SUBMISSION", { submission });
    submission = { ...response.submission, pushReady: false };
    const pushed = response.result?.updated ? "Solution updated successfully." : "Pushed successfully.";
    const message = response.ai?.warning
      ? `${pushed} ${response.ai.warning}`
      : response.ai?.generated
        ? `${pushed} A Groq-generated explanation was added.`
        : response.ai?.reused
          ? `${pushed} The existing AI explanation was reused without another request.`
          : `${pushed} Your GitHub commit is ready.`;
    showNotice(notice, message);
    state = await send("GET_STATE");
    renderState();
    renderSubmission();
  } catch (error) {
    showNotice(notice, error.message, true);
  } finally {
    setBusy(pushButton, false);
    renderSubmission();
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
document.querySelector("#start-onboarding").addEventListener("click", async () => {
  await send("OPEN_ONBOARDING");
  globalThis.close();
});

init().catch((error) => showNotice(notice, error.message, true));
