import { LLM_PROVIDERS } from "../../core/llm.js";
import { DEFAULT_SETTINGS } from "../../core/submissions.js";
import { ensureProviderPermission, logo, send, setBusy, showNotice } from "../../shared/client.js";

document.querySelector("#logo").innerHTML = logo();
const notice = document.querySelector("#notice");
const panes = [document.querySelector("#connect-step"), document.querySelector("#configure-step"), document.querySelector("#finish-step")];
const providerSelect = document.querySelector("#setup-ai-provider");
let repos = [];

providerSelect.replaceChildren(...Object.entries(LLM_PROVIDERS).map(([id, provider]) => new Option(provider.label, id)));

function syncProviderFields({ reset = false } = {}) {
  const provider = LLM_PROVIDERS[providerSelect.value] || LLM_PROVIDERS.groq;
  const baseUrl = document.querySelector("#setup-ai-base-url");
  const model = document.querySelector("#setup-ai-model");
  if (reset || !baseUrl.value) baseUrl.value = provider.baseUrl;
  if (reset || !model.value) model.value = provider.model;
  baseUrl.readOnly = providerSelect.value !== "custom";
  document.querySelector("#ai-setup-fields").hidden = !document.querySelector("#setup-ai-readme").checked;
}

function showStep(index) {
  panes.forEach((pane, paneIndex) => pane.hidden = paneIndex !== index);
  document.querySelector("#step-eyebrow").textContent = `Step ${index + 1} of 3`;
  document.querySelector("#step-count").textContent = `0${index + 1} / 03`;
  document.querySelector("#step-title").textContent = ["Connect your services", "Configure your repo", "Setup complete"][index];
  document.querySelectorAll("[data-step-marker]").forEach((item, markerIndex) => {
    item.classList.toggle("active", markerIndex === index);
    item.classList.toggle("done", markerIndex < index);
  });
  showNotice(notice, "");
}

function finishGitHubConnection(result) {
  repos = result.repos || [];
  const user = result.user;
  if (!repos.length) throw new Error("This token cannot access any repositories. Grant it access to a repository, then try again.");
  document.querySelector("#github-token").value = "";
  document.querySelector("#setup-ai-key").value = "";
  document.querySelector("#github-login").textContent = `@${user.login}`;
  document.querySelector("#avatar").textContent = user.login.slice(0, 2).toUpperCase();
  const select = document.querySelector("#repo");
  select.replaceChildren(...repos.map((repo) => {
    const option = new Option(repo.full_name, repo.full_name);
    option.dataset.branch = repo.default_branch;
    return option;
  }));
  showStep(1);
}

document.querySelector("#setup-ai-readme").addEventListener("change", () => syncProviderFields());
providerSelect.addEventListener("change", () => syncProviderFields({ reset: true }));

document.querySelector("#connect-step").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#connect-button");
  const aiEnabled = document.querySelector("#setup-ai-readme").checked;
  const aiBaseUrl = document.querySelector("#setup-ai-base-url").value.trim();
  setBusy(button, true, "Verifying…");
  try {
    if (aiEnabled) await ensureProviderPermission(aiBaseUrl);
    const result = await send("CONNECT_GITHUB_TOKEN", { token: document.querySelector("#github-token").value });
    await send("SAVE_SETTINGS", {
      settings: {
        aiEnabled,
        aiConsent: aiEnabled,
        aiProvider: providerSelect.value,
        aiBaseUrl,
        aiModel: document.querySelector("#setup-ai-model").value.trim()
      },
      aiApiKey: document.querySelector("#setup-ai-key").value
    });
    finishGitHubConnection(result);
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
    await send("SAVE_SETTINGS", { settings: {
      connected: true,
      owner,
      repo,
      branch,
      autoPush: document.querySelector("#setup-auto-push").checked,
      includeReadme: true,
      includeStats: document.querySelector("#setup-stats").checked,
      includeLink: document.querySelector("#setup-link").checked,
      includeNotes: document.querySelector("#setup-notes").checked,
      includeProfile: document.querySelector("#setup-profile").checked,
      spacedRepetition: document.querySelector("#setup-repetition").checked,
      commitTemplate: document.querySelector("#commit-template").value.trim() || DEFAULT_SETTINGS.commitTemplate
    }});
    if (document.querySelector("#setup-backfill").checked) {
      const imported = await send("IMPORT_REPOSITORY");
      document.querySelector("#finish-step p").textContent = imported.imported || imported.updated
        ? `Imported ${imported.imported} new problem${imported.imported === 1 ? "" : "s"} and updated ${imported.updated} existing problem${imported.updated === 1 ? "" : "s"}. Open any LeetCode problem to keep syncing.`
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

syncProviderFields({ reset: true });
send("GET_STATE").then((state) => {
  if (state.settings.connected) showStep(2);
}).catch(() => {});
