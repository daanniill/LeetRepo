import { DEFAULT_SETTINGS } from "../../core/submissions.js";
import { logo, send, setBusy, showNotice } from "../../shared/client.js";

document.querySelector("#logo").innerHTML = logo();
const notice = document.querySelector("#notice");
const panes = [document.querySelector("#connect-step"), document.querySelector("#configure-step"), document.querySelector("#finish-step")];
let repos = [];
let user = null;

function setAiAvailability(ai = {}) {
  const limited = ai.limitReached === true;
  const toggle = document.querySelector("#setup-ai-readme");
  toggle.disabled = limited && !toggle.checked;
  document.querySelector("#setup-ai-row").classList.toggle("ai-limit", limited);
  document.querySelector("#setup-ai-copy").textContent = limited
    ? "Your AI tier limit has been reached. Basic stats READMEs and local feedback remain available."
    : "Opt in to sending solution details and code to LeetRepo's AI provider for a walkthrough and diagram. Off creates a basic stats-only README.";
}

function showStep(index) {
  panes.forEach((pane, i) => pane.hidden = i !== index);
  document.querySelector("#step-eyebrow").textContent = `Step ${index + 1} of 3`;
  document.querySelector("#step-count").textContent = `0${index + 1} / 03`;
  document.querySelector("#step-title").textContent = ["Connect GitHub", "Configure your repo", "Setup complete"][index];
  document.querySelectorAll("[data-step-marker]").forEach((item, i) => item.classList.toggle("active", i === index));
  showNotice(notice, "");
}

function finishGitHubSignIn(result) {
  repos = result.repos;
  user = result.user;
  setAiAvailability(result.ai);
  document.querySelector("#github-login").textContent = `@${user.login}`;
  document.querySelector("#avatar").textContent = user.login.slice(0, 2).toUpperCase();
  const select = document.querySelector("#repo");
  select.replaceChildren(...repos.map((repo) => {
    const option = new Option(repo.full_name, repo.full_name);
    option.dataset.branch = repo.default_branch;
    return option;
  }));
  if (!repos.length) {
    throw new Error("Install LeetRepo on at least one repository, then sign in again.");
  }
  showStep(1);
}

document.querySelector("#connect-step").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#connect-button");
  setBusy(button, true, "Opening GitHub…");
  try {
    const result = await send("START_GITHUB_SIGN_IN");
    finishGitHubSignIn(result);
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
    if (!selected.value) throw new Error("Choose a repository.");
    const [owner, repo] = selected.value.split("/");
    const branch = selected.selectedOptions[0]?.dataset.branch || "main";
    const aiEnabled = document.querySelector("#setup-ai-readme").checked;
    await send("SAVE_SETTINGS", { settings: {
      connected: true,
      owner,
      repo,
      branch,
      autoPush: document.querySelector("#setup-auto-push").checked,
      includeReadme: document.querySelector("#setup-readme").checked,
      includeStats: document.querySelector("#setup-stats").checked,
      includeLink: document.querySelector("#setup-link").checked,
      includeNotes: document.querySelector("#setup-notes").checked,
      includeProfile: document.querySelector("#setup-profile").checked,
      spacedRepetition: document.querySelector("#setup-repetition").checked,
      aiEnabled,
      aiConsent: aiEnabled,
      commitTemplate: document.querySelector("#commit-template").value.trim() || DEFAULT_SETTINGS.commitTemplate
    }});
    if (document.querySelector("#setup-backfill").checked) {
      const imported = await send("IMPORT_REPOSITORY");
      document.querySelector("#finish-step p").textContent = imported.imported
        ? `Imported ${imported.imported} existing solution folders. Open any LeetCode problem to keep syncing.`
        : "No LeetRepo-style solution folders were found. Open any LeetCode problem to start syncing.";
    }
    showStep(2);
  } catch (error) {
    showNotice(notice, error.message, true);
  } finally {
    setBusy(button, false);
  }
});

document.querySelector("#finish-dashboard").addEventListener("click", () => send("OPEN_DASHBOARD"));

send("GET_STATE").then((state) => {
  setAiAvailability(state.ai);
  if (state.settings.connected) showStep(2);
}).catch(() => {});
