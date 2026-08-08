import { DEFAULT_SETTINGS } from "../../core/submissions.js";
import { logo, send, setBusy, showNotice } from "../../shared/client.js";

document.querySelector("#logo").innerHTML = logo();
const notice = document.querySelector("#notice");
const panes = [document.querySelector("#connect-step"), document.querySelector("#configure-step"), document.querySelector("#finish-step")];
let repos = [];
let user = null;
let signInGeneration = 0;

function repoMode() {
  return document.querySelector('input[name="repo-mode"]:checked').value;
}

function renderRepoMode() {
  const creating = repoMode() === "new";
  document.querySelector("#existing-repo-field").hidden = creating;
  document.querySelector("#new-repo-fields").hidden = !creating;
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
  document.querySelector("#github-login").textContent = `@${user.login}`;
  document.querySelector("#avatar").textContent = user.login.slice(0, 2).toUpperCase();
  const select = document.querySelector("#repo");
  select.innerHTML = repos.map((repo) => `<option value="${repo.full_name}" data-branch="${repo.default_branch}">${repo.full_name}</option>`).join("");
  if (!repos.length) {
    document.querySelector('input[name="repo-mode"][value="new"]').checked = true;
    renderRepoMode();
  }
  showStep(1);
}

function failGitHubSignIn(error, generation) {
  if (generation !== signInGeneration) return;
  signInGeneration += 1;
  document.querySelector("#device-flow").hidden = true;
  document.querySelector("#connect-button").hidden = false;
  showNotice(notice, error.message, true);
}

function pollGitHubSignIn(interval, expiresAt, generation) {
  window.setTimeout(async () => {
    if (generation !== signInGeneration) return;
    if (Date.now() >= expiresAt) {
      failGitHubSignIn(new Error("The GitHub sign-in code expired. Start again to get a new code."), generation);
      return;
    }
    try {
      const result = await send("POLL_GITHUB_SIGN_IN");
      if (result.status === "connected") {
        signInGeneration += 1;
        finishGitHubSignIn(result);
        return;
      }
      document.querySelector("#device-status").textContent = "Waiting for approval on GitHub…";
      pollGitHubSignIn(result.interval || interval, expiresAt, generation);
    } catch (error) {
      failGitHubSignIn(error, generation);
    }
  }, interval * 1000);
}

document.querySelector("#connect-step").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#connect-button");
  setBusy(button, true, "Starting GitHub…");
  const generation = ++signInGeneration;
  try {
    const result = await send("START_GITHUB_SIGN_IN");
    document.querySelector("#device-code").textContent = result.userCode;
    document.querySelector("#open-github-device").href = result.verificationUri;
    document.querySelector("#device-flow").hidden = false;
    button.hidden = true;
    pollGitHubSignIn(result.interval, result.expiresAt, generation);
  } catch (error) {
    failGitHubSignIn(error, generation);
  } finally {
    setBusy(button, false);
  }
});

document.querySelector("#copy-device-code").addEventListener("click", async () => {
  const button = document.querySelector("#copy-device-code");
  try {
    await navigator.clipboard.writeText(document.querySelector("#device-code").textContent);
    button.textContent = "Copied";
    window.setTimeout(() => button.textContent = "Copy code", 1500);
  } catch {
    showNotice(notice, "Could not copy the code. Select it and copy it manually.", true);
  }
});

document.querySelector("#configure-step").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#configure-button");
  setBusy(button, true, "Saving…");
  try {
    let owner;
    let repo;
    let branch;
    if (repoMode() === "new") {
      const created = await send("CREATE_REPO", { repo: {
        name: document.querySelector("#new-repo-name").value,
        visibility: document.querySelector("#new-repo-visibility").value
      }});
      owner = created.repo.owner?.login || user.login;
      repo = created.repo.name;
      branch = created.repo.default_branch || "main";
    } else {
      const selected = document.querySelector("#repo");
      if (!selected.value) throw new Error("Choose a repository or create a new one.");
      [owner, repo] = selected.value.split("/");
      branch = selected.selectedOptions[0]?.dataset.branch || "main";
    }
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
      includeReview: document.querySelector("#setup-review").checked,
      includeProfile: document.querySelector("#setup-profile").checked,
      spacedRepetition: document.querySelector("#setup-repetition").checked,
      commitTemplate: document.querySelector("#commit-template").value.trim() || DEFAULT_SETTINGS.commitTemplate
    }});
    if (document.querySelector("#setup-backfill").checked && repoMode() === "existing") {
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
document.querySelectorAll('input[name="repo-mode"]').forEach((input) => input.addEventListener("change", renderRepoMode));
renderRepoMode();

send("GET_STATE").then((state) => {
  if (state.settings.connected) showStep(2);
}).catch(() => {});
