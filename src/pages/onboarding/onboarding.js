import { DEFAULT_SETTINGS } from "../../core/submissions.js";
import { logo, send, setBusy, showNotice } from "../../shared/client.js";

document.querySelector("#logo").innerHTML = logo();
const notice = document.querySelector("#notice");
const panes = [document.querySelector("#connect-step"), document.querySelector("#configure-step"), document.querySelector("#finish-step")];
let repos = [];
let user = null;

function showStep(index) {
  panes.forEach((pane, i) => pane.hidden = i !== index);
  document.querySelector("#step-eyebrow").textContent = `Step ${index + 1} of 3`;
  document.querySelector("#step-count").textContent = `0${index + 1} / 03`;
  document.querySelector("#step-title").textContent = ["Connect GitHub", "Configure your repo", "Setup complete"][index];
  document.querySelectorAll("[data-step-marker]").forEach((item, i) => item.classList.toggle("active", i === index));
  showNotice(notice, "");
}

document.querySelector("#connect-step").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#connect-button");
  setBusy(button, true, "Checking GitHub…");
  try {
    const result = await send("CONNECT_GITHUB", { token: document.querySelector("#token").value });
    repos = result.repos;
    user = result.user;
    document.querySelector("#github-login").textContent = `@${user.login}`;
    document.querySelector("#avatar").textContent = user.login.slice(0, 2).toUpperCase();
    const select = document.querySelector("#repo");
    select.innerHTML = repos.map((repo) => `<option value="${repo.full_name}" data-branch="${repo.default_branch}">${repo.full_name}</option>`).join("");
    if (!repos.length) throw new Error("No writable repositories were found for this token.");
    showStep(1);
  } catch (error) {
    showNotice(notice, error.message, true);
  } finally {
    setBusy(button, false);
  }
});

document.querySelector("#configure-step").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#configure-button");
  setBusy(button, true, "Saving…");
  try {
    const selected = document.querySelector("#repo");
    const [owner, repo] = selected.value.split("/");
    const branch = selected.selectedOptions[0]?.dataset.branch || "main";
    await send("SAVE_SETTINGS", { settings: {
      ...DEFAULT_SETTINGS,
      connected: true,
      owner,
      repo,
      branch,
      autoPush: document.querySelector("#setup-auto-push").checked,
      commitTemplate: document.querySelector("#commit-template").value.trim() || DEFAULT_SETTINGS.commitTemplate
    }});
    showStep(2);
  } catch (error) {
    showNotice(notice, error.message, true);
  } finally {
    setBusy(button, false);
  }
});

document.querySelector("#finish-dashboard").addEventListener("click", () => send("OPEN_DASHBOARD"));

send("GET_STATE").then((state) => {
  if (state.settings.connected) showStep(2);
}).catch(() => {});
