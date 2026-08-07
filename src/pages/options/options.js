import { DEFAULT_SETTINGS } from "../../core/submissions.js";
import { GROQ_MODELS } from "../../core/llm.js";
import { logo, send, setBusy, showNotice } from "../../shared/client.js";

document.querySelector("#logo").innerHTML = logo();
const notice = document.querySelector("#notice");
const toggleKeys = ["autoPush", "includeReadme", "includeStats", "includeLink", "includeNotes", "includeReview", "includeProfile", "spacedRepetition", "aiEnabled"];

document.querySelector("#ai-model").innerHTML = GROQ_MODELS
  .map(({ id, label }) => `<option value="${id}">${label}</option>`)
  .join("");

async function init() {
  const state = await send("GET_STATE");
  const { settings } = state;
  document.querySelector("#owner").value = settings.owner || "";
  document.querySelector("#repo").value = settings.repo || "";
  document.querySelector("#branch").value = settings.branch || "";
  document.querySelector("#commit-template").value = settings.commitTemplate || DEFAULT_SETTINGS.commitTemplate;
  document.querySelector("#ai-model").value = settings.aiModel;
  document.querySelector("#ai-daily-limit").value = settings.aiDailyLimit;
  toggleKeys.forEach((key) => document.querySelector(`#${key}`).checked = settings[key] !== false);
  const badge = document.querySelector("#connection-badge");
  badge.textContent = settings.connected ? "Connected" : "Not connected";
  badge.className = `badge ${settings.connected ? "accepted" : "unknown"}`;
  const aiBadge = document.querySelector("#ai-status-badge");
  aiBadge.textContent = state.ai.hasApiKey ? "Key saved" : "Key required";
  aiBadge.className = `badge ${state.ai.hasApiKey ? "accepted" : "unknown"}`;
  document.querySelector("#groq-api-key").placeholder = state.ai.hasApiKey ? "Saved — leave blank to keep current key" : "gsk_…";
  document.querySelector("#ai-usage").textContent = `${state.ai.usage.requests} of ${settings.aiDailyLimit} requests used today · resets at 00:00 UTC`;
  document.querySelector("#clear-groq-key").disabled = !state.ai.hasApiKey;
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
      aiModel: document.querySelector("#ai-model").value,
      aiDailyLimit: document.querySelector("#ai-daily-limit").value
    };
    toggleKeys.forEach((key) => settings[key] = document.querySelector(`#${key}`).checked);
    await send("SAVE_SETTINGS", { settings, groqApiKey: document.querySelector("#groq-api-key").value });
    document.querySelector("#groq-api-key").value = "";
    showNotice(notice, "Settings saved.");
    await init();
  } catch (error) {
    showNotice(notice, error.message, true);
  } finally {
    setBusy(button, false);
  }
});

document.querySelector("#disconnect").addEventListener("click", async () => {
  await send("DISCONNECT");
  showNotice(notice, "GitHub disconnected. Your local history is unchanged.");
  init();
});
document.querySelector("#backfill-repository").addEventListener("click", async () => {
  const button = document.querySelector("#backfill-repository");
  setBusy(button, true, "Importing…");
  try {
    const result = await send("IMPORT_REPOSITORY");
    showNotice(notice, result.imported ? `Imported ${result.imported} existing solution folders.` : "No new LeetRepo-style solution folders were found.");
  } catch (error) {
    showNotice(notice, error.message, true);
  } finally {
    setBusy(button, false);
  }
});
document.querySelector("#clear-groq-key").addEventListener("click", async () => {
  await send("CLEAR_GROQ_KEY");
  document.querySelector("#groq-api-key").value = "";
  showNotice(notice, "Groq key removed and AI explanations disabled.");
  await init();
});
document.querySelector("#open-dashboard").addEventListener("click", () => send("OPEN_DASHBOARD"));
document.querySelector("#brand").addEventListener("click", (event) => { event.preventDefault(); send("OPEN_DASHBOARD"); });

init().catch((error) => showNotice(notice, error.message, true));
