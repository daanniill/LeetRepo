import { buildReview, DEFAULT_SETTINGS, normalizeTheme } from "../core/submissions.js";

const DEMO_SUBMISSION = {
  id: "42-trapping-rain-water",
  number: "42",
  title: "Trapping Rain Water",
  slug: "trapping-rain-water",
  difficulty: "Hard",
  language: "C++",
  extension: "cpp",
  code: "class Solution { public: int trap(vector<int>& height) { return 6; } };",
  runtime: "52 ms",
  memory: "41.2 MB",
  status: "Accepted",
  url: "https://leetcode.com/problems/trapping-rain-water/"
};

const DEMO_HISTORY = [
  { ...DEMO_SUBMISSION, syncedAt: new Date(Date.now() - 120000).toISOString() },
  { ...DEMO_SUBMISSION, id: "11-container-with-most-water", number: "11", title: "Container With Most Water", slug: "container-with-most-water", difficulty: "Medium", language: "Python3", extension: "py", syncedAt: new Date(Date.now() - 3600000).toISOString() },
  { ...DEMO_SUBMISSION, id: "1-two-sum", number: "1", title: "Two Sum", slug: "two-sum", difficulty: "Easy", language: "Python3", extension: "py", syncedAt: new Date(Date.now() - 86400000).toISOString() }
].map((item) => ({ ...item, review: buildReview(item) }));

const DEMO_ATTEMPTS = [
  { ...DEMO_HISTORY[1], status: "Wrong Answer", recordedAt: new Date(Date.now() - 180000).toISOString() },
  { ...DEMO_HISTORY[1], status: "Accepted", recordedAt: new Date(Date.now() - 120000).toISOString() }
];

export const isExtension = Boolean(globalThis.chrome?.runtime?.id);

export function applyTheme(value, root = globalThis.document?.documentElement) {
  const theme = normalizeTheme(value);
  if (!root) return theme;
  if (theme === "system") {
    delete root.dataset.theme;
    root.style.colorScheme = "light dark";
  } else {
    root.dataset.theme = theme;
    root.style.colorScheme = theme === "light" ? "light" : "dark";
  }
  return theme;
}

export async function initializeTheme() {
  if (!isExtension) return applyTheme(DEFAULT_SETTINGS.theme);
  const { settings } = await chrome.storage.sync.get("settings");
  return applyTheme(settings?.theme);
}

if (isExtension && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.settings) applyTheme(changes.settings.newValue?.theme);
  });
}

initializeTheme().catch(() => applyTheme(DEFAULT_SETTINGS.theme));

export async function send(type, payload = {}) {
  if (!isExtension) return demoResponse(type, payload);
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || "Something went wrong.");
  return response;
}

function demoResponse(type, payload) {
  if (type === "GET_STATE") {
    const onboardingPreview = globalThis.location?.pathname?.endsWith("/onboarding.html");
    return Promise.resolve({
      settings: { ...DEFAULT_SETTINGS, connected: !onboardingPreview, owner: onboardingPreview ? "" : "alex-c", repo: onboardingPreview ? "" : "leetcode-solutions" },
      submissions: DEMO_HISTORY,
      attempts: DEMO_ATTEMPTS,
      notes: {},
      lastSubmission: DEMO_HISTORY[0],
      ai: { hasApiKey: false, usage: { requests: 0, inputTokens: 0, outputTokens: 0 } }
    });
  }
  if (type === "SAVE_SETTINGS") return Promise.resolve({ settings: { ...DEFAULT_SETTINGS, ...payload.settings } });
  if (type === "PUSH_SUBMISSION") return new Promise((resolve) => setTimeout(() => resolve({ submission: { ...payload.submission, syncedAt: new Date().toISOString() }, result: { url: "https://github.com/" } }), 500));
  if (type === "START_GITHUB_SIGN_IN") return Promise.resolve({ userCode: "ABCD-EFGH", verificationUri: "https://github.com/login/device", expiresAt: Date.now() + 900000, interval: 1 });
  if (type === "POLL_GITHUB_SIGN_IN") return Promise.resolve({ status: "connected", user: { login: "alex-c" }, repos: [{ full_name: "alex-c/leetcode-solutions", name: "leetcode-solutions", owner: { login: "alex-c" }, default_branch: "main" }] });
  if (type === "CREATE_REPO") return Promise.resolve({ repo: { name: payload.repo?.name || "leetcode-solutions", owner: { login: "alex-c" }, default_branch: "main" } });
  if (type === "IMPORT_REPOSITORY") return Promise.resolve({ imported: 3 });
  if (type === "GENERATE_FEEDBACK") return Promise.resolve({ review: buildReview(payload.submission), ai: { generated: false } });
  return Promise.resolve({ ok: true });
}

export async function currentSubmission() {
  if (!isExtension) return DEMO_SUBMISSION;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/(www\.)?leetcode\.com\/problems\//.test(tab.url || "")) return null;
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_SUBMISSION" });
    return response?.submission || null;
  } catch {
    return null;
  }
}

export function logo() {
  return `<span class="logo-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg></span>`;
}

export function difficultyClass(value = "") {
  return ["easy", "medium", "hard"].includes(value.toLowerCase()) ? value.toLowerCase() : "unknown";
}

export function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" })[char]);
}

export function setBusy(button, busy, label) {
  if (!button) return;
  button.disabled = busy;
  if (busy) {
    button.dataset.label = button.innerHTML;
    button.innerHTML = `<span class="spinner"></span>${label || "Working…"}`;
  } else if (button.dataset.label) {
    button.innerHTML = button.dataset.label;
    delete button.dataset.label;
  }
}

export function showNotice(element, message, error = false) {
  element.hidden = !message;
  element.textContent = message || "";
  element.classList.toggle("error", error);
}
