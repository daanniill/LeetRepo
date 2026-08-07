import { DEFAULT_SETTINGS, normalizeSubmission } from "../core/submissions.js";
import { listRepos, pushSubmission, verifyToken } from "../core/github.js";

const getLocal = (keys) => chrome.storage.local.get(keys);
const setLocal = (value) => chrome.storage.local.set(value);
const getSync = (keys) => chrome.storage.sync.get(keys);
const setSync = (value) => chrome.storage.sync.set(value);

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const { settings } = await getSync("settings");
  if (!settings) await setSync({ settings: DEFAULT_SETTINGS });
  if (reason === "install") chrome.tabs.create({ url: chrome.runtime.getURL("src/pages/onboarding/onboarding.html") });
});

async function recordPush(submission, result) {
  const { submissions = [] } = await getLocal("submissions");
  const item = { ...normalizeSubmission(submission), syncedAt: new Date().toISOString(), commitUrl: result.url, commitSha: result.sha };
  const next = [item, ...submissions.filter((existing) => existing.id !== item.id)].slice(0, 500);
  await setLocal({ submissions: next, lastSubmission: item });
  return item;
}

async function handle(message) {
  switch (message.type) {
    case "GET_STATE": {
      const [{ settings }, local] = await Promise.all([getSync("settings"), getLocal(["submissions", "lastSubmission"])]);
      return { settings: { ...DEFAULT_SETTINGS, ...settings }, submissions: local.submissions || [], lastSubmission: local.lastSubmission || null };
    }
    case "SAVE_SETTINGS": {
      const { settings = {} } = await getSync("settings");
      const next = { ...DEFAULT_SETTINGS, ...settings, ...message.settings };
      await setSync({ settings: next });
      return { settings: next };
    }
    case "CONNECT_GITHUB": {
      const token = String(message.token || "").trim();
      if (!token) throw new Error("Enter a GitHub token.");
      const user = await verifyToken(token);
      const repos = await listRepos(token);
      await setLocal({ githubToken: token, githubUser: user });
      return { user, repos };
    }
    case "LIST_REPOS": {
      const { githubToken } = await getLocal("githubToken");
      if (!githubToken) throw new Error("Connect GitHub first.");
      return { repos: await listRepos(githubToken) };
    }
    case "PUSH_SUBMISSION": {
      const [{ githubToken }, { settings }] = await Promise.all([getLocal("githubToken"), getSync("settings")]);
      if (!githubToken || !settings?.connected) throw new Error("Finish GitHub setup first.");
      if (message.submission?.status !== "Accepted") throw new Error("Only Accepted submissions can be pushed.");
      const result = await pushSubmission({ token: githubToken, settings: { ...DEFAULT_SETTINGS, ...settings }, submission: message.submission });
      return { result, submission: await recordPush(message.submission, result) };
    }
    case "DISCONNECT": {
      await chrome.storage.local.remove(["githubToken", "githubUser"]);
      const { settings = {} } = await getSync("settings");
      await setSync({ settings: { ...settings, connected: false, owner: "", repo: "" } });
      return { ok: true };
    }
    case "OPEN_DASHBOARD":
      await chrome.tabs.create({ url: chrome.runtime.getURL("src/pages/dashboard/dashboard.html") });
      return { ok: true };
    case "OPEN_OPTIONS":
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    default:
      throw new Error(`Unknown message: ${message.type}`);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handle(message).then((data) => sendResponse({ ok: true, ...data })).catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
