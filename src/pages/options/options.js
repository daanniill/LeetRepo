import { DEFAULT_SETTINGS } from "../../core/submissions.js";
import { applyTheme, logo, send, setBusy, showNotice } from "../../shared/client.js";

document.querySelector("#logo").innerHTML = logo();
const notice = document.querySelector("#notice");
const toggleKeys = ["autoPush", "includeReadme", "includeStats", "includeLink", "includeNotes", "includeReview", "includeProfile", "spacedRepetition", "aiEnabled"];

async function init() {
  const state = await send("GET_STATE");
  const { settings } = state;
  document.querySelector("#owner").value = settings.owner || "";
  document.querySelector("#repo").value = settings.repo || "";
  document.querySelector("#branch").value = settings.branch || "";
  document.querySelector("#commit-template").value = settings.commitTemplate || DEFAULT_SETTINGS.commitTemplate;
  const themeInputs = [...document.querySelectorAll('input[name="theme"]')];
  const theme = themeInputs.find((input) => input.value === settings.theme) || themeInputs[0];
  theme.checked = true;
  applyTheme(theme.value);
  toggleKeys.forEach((key) => document.querySelector(`#${key}`).checked = settings[key] !== false);
  document.querySelector("#ai-consent").checked = settings.aiConsent === true;
  const badge = document.querySelector("#connection-badge");
  badge.textContent = settings.connected ? "Connected" : "Not connected";
  badge.className = `badge ${settings.connected ? "accepted" : "unknown"}`;
  const connectionButton = document.querySelector("#disconnect");
  connectionButton.dataset.connected = String(settings.connected);
  connectionButton.textContent = settings.connected ? "Disconnect GitHub" : "Connect GitHub";
  connectionButton.classList.toggle("danger", settings.connected);
  const aiBadge = document.querySelector("#ai-status-badge");
  aiBadge.textContent = state.ai.available ? "Hosted free tier" : "Sign-in required";
  aiBadge.className = `badge ${state.ai.available ? "accepted" : "unknown"}`;
  const usage = state.ai.usage;
  document.querySelector("#ai-usage").textContent = `${usage.daily.requests} of ${usage.daily.limit} today · ${usage.monthly.requests} of ${usage.monthly.limit} this month`;
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
      theme: document.querySelector('input[name="theme"]:checked')?.value || DEFAULT_SETTINGS.theme,
      aiConsent: document.querySelector("#ai-consent").checked
    };
    toggleKeys.forEach((key) => settings[key] = document.querySelector(`#${key}`).checked);
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

document.querySelector("#disconnect").addEventListener("click", async () => {
  if (document.querySelector("#disconnect").dataset.connected !== "true") {
    await send("OPEN_ONBOARDING");
    return;
  }
  await send("DISCONNECT");
  showNotice(notice, "GitHub disconnected and hosted account data deleted. Your local history is unchanged.");
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
document.querySelector("#open-dashboard").addEventListener("click", () => send("OPEN_DASHBOARD"));
document.querySelector("#brand").addEventListener("click", (event) => { event.preventDefault(); send("OPEN_DASHBOARD"); });

init().catch((error) => showNotice(notice, error.message, true));
