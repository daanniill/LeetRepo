import { DEFAULT_SETTINGS } from "./lib.js";
import { logo, send, setBusy, showNotice } from "./client.js";

document.querySelector("#logo").innerHTML = logo();
const notice = document.querySelector("#notice");
const toggleKeys = ["autoPush", "includeReadme", "includeStats", "includeLink", "includeReview"];

async function init() {
  const { settings } = await send("GET_STATE");
  document.querySelector("#owner").value = settings.owner || "";
  document.querySelector("#repo").value = settings.repo || "";
  document.querySelector("#branch").value = settings.branch || "";
  document.querySelector("#commit-template").value = settings.commitTemplate || DEFAULT_SETTINGS.commitTemplate;
  toggleKeys.forEach((key) => document.querySelector(`#${key}`).checked = settings[key] !== false);
  const badge = document.querySelector("#connection-badge");
  badge.textContent = settings.connected ? "Connected" : "Not connected";
  badge.className = `badge ${settings.connected ? "accepted" : "unknown"}`;
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
      commitTemplate: document.querySelector("#commit-template").value.trim()
    };
    toggleKeys.forEach((key) => settings[key] = document.querySelector(`#${key}`).checked);
    await send("SAVE_SETTINGS", { settings });
    showNotice(notice, "Settings saved.");
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
document.querySelector("#open-dashboard").addEventListener("click", () => send("OPEN_DASHBOARD"));
document.querySelector("#brand").addEventListener("click", (event) => { event.preventDefault(); send("OPEN_DASHBOARD"); });

init().catch((error) => showNotice(notice, error.message, true));
