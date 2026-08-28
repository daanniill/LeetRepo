import { DEFAULT_SETTINGS } from "../../core/submissions.js";
import { formatStudyInterval, normalizeDailyStudyLimit, normalizeStudyInterval } from "../../core/study.js";
import { applyTheme, logo, send, setBusy, showNotice } from "../../shared/client.js";

document.querySelector("#logo").innerHTML = logo();
const notice = document.querySelector("#notice");
const toggleKeys = ["autoPush", "includeStats", "includeLink", "includeNotes", "includeProfile", "spacedRepetition", "aiEnabled"];
const intervalMaximums = { days: 365, weeks: 52, months: 12 };

function syncStudyIntervalControls({ clamp = false } = {}) {
  const enabled = document.querySelector("#spacedRepetition").checked;
  const input = document.querySelector("#study-interval-value");
  const unit = document.querySelector("#study-interval-unit");
  input.max = intervalMaximums[unit.value];
  if (clamp && Number(input.value) > Number(input.max)) input.value = input.max;
  input.disabled = !enabled;
  unit.disabled = !enabled;
  document.querySelector("#study-interval-setting").classList.toggle("disabled", !enabled);
  const interval = normalizeStudyInterval(input.value, unit.value);
  document.querySelector("#study-interval-preview").textContent = enabled
    ? `Got it resurfaces this problem after ${formatStudyInterval(interval.days, interval.unit)}.`
    : "Turn on spaced repetition to use this interval.";
  const dailyLimit = document.querySelector("#daily-study-limit");
  dailyLimit.disabled = !enabled;
  document.querySelector("#daily-study-limit-setting").classList.toggle("disabled", !enabled);
}

async function init() {
  const state = await send("GET_STATE");
  if (!state.settings.connected) {
    globalThis.location.replace("../onboarding/onboarding.html");
    return;
  }
  const { settings } = state;
  document.querySelector("#owner").value = settings.owner || "";
  document.querySelector("#repo").value = settings.repo || "";
  document.querySelector("#branch").value = settings.branch || "";
  document.querySelector("#commit-template").value = settings.commitTemplate || DEFAULT_SETTINGS.commitTemplate;
  const studyInterval = normalizeStudyInterval(settings.studyIntervalValue, settings.studyIntervalUnit);
  document.querySelector("#study-interval-value").value = studyInterval.value;
  document.querySelector("#study-interval-unit").value = studyInterval.unit;
  document.querySelector("#daily-study-limit").value = normalizeDailyStudyLimit(settings.dailyStudyLimit);
  const themeInputs = [...document.querySelectorAll('input[name="theme"]')];
  const theme = themeInputs.find((input) => input.value === settings.theme) || themeInputs[0];
  theme.checked = true;
  applyTheme(theme.value);
  toggleKeys.forEach((key) => document.querySelector(`#${key}`).checked = settings[key] !== false);
  syncStudyIntervalControls();
  const badge = document.querySelector("#connection-badge");
  badge.textContent = settings.connected ? "Connected" : "Not connected";
  badge.className = `badge ${settings.connected ? "accepted" : "unknown"}`;
  const aiBadge = document.querySelector("#ai-status-badge");
  aiBadge.textContent = state.ai.limitReached ? "Tier limit reached" : state.ai.available ? "Hosted free tier" : "Sign-in required";
  aiBadge.className = `badge ${state.ai.available && !state.ai.limitReached ? "accepted" : "unknown"}`;
  const usage = state.ai.usage;
  document.querySelector("#ai-usage").textContent = `${state.ai.limitReached ? "AI paused · " : ""}${usage.daily.requests} of ${usage.daily.limit} today · ${usage.monthly.requests} of ${usage.monthly.limit} this month`;
  const aiToggle = document.querySelector("#aiEnabled");
  aiToggle.disabled = state.ai.limitReached && settings.aiEnabled !== true;
  document.querySelector("#ai-toggle-row").classList.toggle("ai-limit", state.ai.limitReached);
}

document.querySelector("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#save-button");
  setBusy(button, true, "Saving…");
  try {
    const settings = {
      owner: document.querySelector("#owner").value.trim(),
      repo: document.querySelector("#repo").value.trim(),
      branch: document.querySelector("#branch").value.trim(),
      commitTemplate: document.querySelector("#commit-template").value.trim(),
      studyIntervalValue: Number(document.querySelector("#study-interval-value").value),
      studyIntervalUnit: document.querySelector("#study-interval-unit").value,
      dailyStudyLimit: Number(document.querySelector("#daily-study-limit").value),
      theme: document.querySelector('input[name="theme"]:checked')?.value || DEFAULT_SETTINGS.theme
    };
    toggleKeys.forEach((key) => settings[key] = document.querySelector(`#${key}`).checked);
    settings.aiConsent = settings.aiEnabled;
    await send("SAVE_SETTINGS", { settings });
    showNotice(notice, "Settings saved.");
    await init();
  } catch (error) {
    showNotice(notice, error.message, true);
  } finally {
    setBusy(button, false);
  }
});

document.querySelectorAll('input[name="theme"]').forEach((input) => input.addEventListener("change", async (event) => {
  const theme = applyTheme(event.target.value);
  try {
    await send("SAVE_SETTINGS", { settings: { theme } });
    showNotice(notice, "Theme updated across LeetRepo.");
  } catch (error) {
    showNotice(notice, error.message, true);
  }
}));
document.querySelector("#spacedRepetition").addEventListener("change", () => syncStudyIntervalControls());
document.querySelector("#study-interval-value").addEventListener("input", () => syncStudyIntervalControls());
document.querySelector("#study-interval-unit").addEventListener("change", () => syncStudyIntervalControls({ clamp: true }));

document.querySelector("#sign-out").addEventListener("click", async () => {
  const button = document.querySelector("#sign-out");
  setBusy(button, true, "Signing out…");
  try {
    await send("SIGN_OUT");
    globalThis.location.replace("../onboarding/onboarding.html");
  } catch (error) {
    showNotice(notice, error.message, true);
    setBusy(button, false);
  }
});
document.querySelector("#delete-account").addEventListener("click", async () => {
  if (!globalThis.confirm("Permanently delete your LeetRepo account and all LeetRepo data stored in this browser, and revoke GitHub authorization? Existing GitHub repositories and their contents will not be changed. The GitHub App installation will remain until you remove it in GitHub settings.")) return;
  const button = document.querySelector("#delete-account");
  setBusy(button, true, "Deleting…");
  try {
    await send("DELETE_ACCOUNT");
    globalThis.location.replace("../onboarding/onboarding.html");
  } catch (error) {
    showNotice(notice, error.message, true);
    setBusy(button, false);
  }
});
document.querySelector("#backfill-repository").addEventListener("click", async () => {
  const button = document.querySelector("#backfill-repository");
  setBusy(button, true, "Importing…");
  try {
    const result = await send("IMPORT_REPOSITORY");
    showNotice(notice, result.imported || result.updated
      ? `Imported ${result.imported} new problem${result.imported === 1 ? "" : "s"} and updated ${result.updated} existing problem${result.updated === 1 ? "" : "s"}.`
      : "No new LeetRepo-style solution folders were found.");
  } catch (error) {
    showNotice(notice, error.message, true);
  } finally {
    setBusy(button, false);
  }
});
document.querySelector("#open-dashboard").addEventListener("click", () => send("OPEN_DASHBOARD"));
document.querySelector("#brand").addEventListener("click", (event) => { event.preventDefault(); send("OPEN_DASHBOARD"); });

init().catch((error) => showNotice(notice, error.message, true));
