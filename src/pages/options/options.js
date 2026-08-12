import { LLM_PROVIDERS } from "../../core/llm.js";
import { DEFAULT_SETTINGS } from "../../core/submissions.js";
import { formatStudyInterval, normalizeStudyInterval } from "../../core/study.js";
import { applyTheme, ensureProviderPermission, logo, send, setBusy, showNotice } from "../../shared/client.js";

document.querySelector("#logo").innerHTML = logo();
const notice = document.querySelector("#notice");
const providerSelect = document.querySelector("#ai-provider");
const toggleKeys = ["autoPush", "includeReadme", "includeStats", "includeLink", "includeNotes", "includeProfile", "spacedRepetition", "aiEnabled"];
const intervalMaximums = { days: 365, weeks: 52, months: 12 };

providerSelect.replaceChildren(...Object.entries(LLM_PROVIDERS).map(([id, provider]) => new Option(provider.label, id)));

function syncProviderFields({ reset = false } = {}) {
  const provider = LLM_PROVIDERS[providerSelect.value] || LLM_PROVIDERS.groq;
  const baseUrl = document.querySelector("#ai-base-url");
  const model = document.querySelector("#ai-model");
  if (reset) {
    baseUrl.value = provider.baseUrl;
    model.value = provider.model;
  }
  baseUrl.readOnly = providerSelect.value !== "custom";
}

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
  const themeInputs = [...document.querySelectorAll('input[name="theme"]')];
  const theme = themeInputs.find((input) => input.value === settings.theme) || themeInputs[0];
  theme.checked = true;
  applyTheme(theme.value);
  toggleKeys.forEach((key) => document.querySelector(`#${key}`).checked = settings[key] === true);
  syncStudyIntervalControls();

  providerSelect.value = settings.aiProvider;
  document.querySelector("#ai-base-url").value = settings.aiBaseUrl;
  document.querySelector("#ai-model").value = settings.aiModel;
  document.querySelector("#ai-daily-limit").value = settings.aiDailyLimit;
  syncProviderFields();

  const badge = document.querySelector("#connection-badge");
  badge.textContent = "Connected";
  badge.className = "badge accepted";
  const aiBadge = document.querySelector("#ai-status-badge");
  aiBadge.textContent = state.ai.limitReached ? "Daily limit reached" : state.ai.hasApiKey ? `${state.ai.providerLabel} key saved` : "Key required";
  aiBadge.className = `badge ${state.ai.hasApiKey && !state.ai.limitReached ? "accepted" : "unknown"}`;
  document.querySelector("#ai-api-key").placeholder = state.ai.hasApiKey ? "Saved — leave blank to keep it" : "Paste your provider key";
  document.querySelector("#clear-ai-key").disabled = !state.ai.hasApiKey;
  document.querySelector("#ai-usage").textContent = `${state.ai.usage.requests} of ${state.ai.usage.limit} requests used today · resets at 00:00 UTC`;
  document.querySelector("#ai-toggle-row").classList.toggle("ai-limit", state.ai.limitReached);
}

document.querySelector("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#save-button");
  setBusy(button, true, "Saving…");
  try {
    const githubToken = document.querySelector("#github-token").value;
    if (githubToken.trim()) await send("CONNECT_GITHUB_TOKEN", { token: githubToken });
    const aiEnabled = document.querySelector("#aiEnabled").checked;
    const aiBaseUrl = document.querySelector("#ai-base-url").value.trim();
    if (aiEnabled) await ensureProviderPermission(aiBaseUrl);
    const settings = {
      owner: document.querySelector("#owner").value.trim(),
      repo: document.querySelector("#repo").value.trim(),
      branch: document.querySelector("#branch").value.trim(),
      commitTemplate: document.querySelector("#commit-template").value.trim(),
      studyIntervalValue: Number(document.querySelector("#study-interval-value").value),
      studyIntervalUnit: document.querySelector("#study-interval-unit").value,
      theme: document.querySelector('input[name="theme"]:checked')?.value || DEFAULT_SETTINGS.theme,
      aiProvider: providerSelect.value,
      aiBaseUrl,
      aiModel: document.querySelector("#ai-model").value.trim(),
      aiDailyLimit: document.querySelector("#ai-daily-limit").value
    };
    toggleKeys.forEach((key) => settings[key] = document.querySelector(`#${key}`).checked);
    settings.aiConsent = settings.aiEnabled;
    await send("SAVE_SETTINGS", { settings, aiApiKey: document.querySelector("#ai-api-key").value });
    document.querySelector("#github-token").value = "";
    document.querySelector("#ai-api-key").value = "";
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
    showNotice(notice, "Theme updated across LeetRepo Lite.");
  } catch (error) {
    showNotice(notice, error.message, true);
  }
}));
providerSelect.addEventListener("change", () => syncProviderFields({ reset: true }));
document.querySelector("#spacedRepetition").addEventListener("change", () => syncStudyIntervalControls());
document.querySelector("#study-interval-value").addEventListener("input", () => syncStudyIntervalControls());
document.querySelector("#study-interval-unit").addEventListener("change", () => syncStudyIntervalControls({ clamp: true }));

document.querySelector("#sign-out").addEventListener("click", async () => {
  const button = document.querySelector("#sign-out");
  setBusy(button, true, "Disconnecting…");
  try {
    await send("DISCONNECT");
    globalThis.location.replace("../onboarding/onboarding.html");
  } catch (error) {
    showNotice(notice, error.message, true);
    setBusy(button, false);
  }
});
document.querySelector("#delete-local-data").addEventListener("click", async () => {
  if (!globalThis.confirm("Clear the saved tokens, settings, solution history, notes, and study schedule from this browser? Existing GitHub repositories will not be changed.")) return;
  const button = document.querySelector("#delete-local-data");
  setBusy(button, true, "Clearing…");
  try {
    await send("DELETE_LOCAL_DATA");
    globalThis.location.replace("../onboarding/onboarding.html");
  } catch (error) {
    showNotice(notice, error.message, true);
    setBusy(button, false);
  }
});
document.querySelector("#clear-ai-key").addEventListener("click", async () => {
  await send("CLEAR_AI_KEY");
  document.querySelector("#ai-api-key").value = "";
  showNotice(notice, "AI key removed and AI explanations disabled.");
  await init();
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
