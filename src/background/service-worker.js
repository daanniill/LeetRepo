import { DEFAULT_SETTINGS, normalizeSubmission } from "../core/submissions.js";
import { listRepos, pushSubmission, verifyToken } from "../core/github.js";
import {
  addTokenUsage,
  generateExplanation,
  normalizeDailyLimit,
  normalizeGroqModel,
  reserveUsage,
  usageForToday
} from "../core/llm.js";

const getLocal = (keys) => chrome.storage.local.get(keys);
const setLocal = (value) => chrome.storage.local.set(value);
const getSync = (keys) => chrome.storage.sync.get(keys);
const setSync = (value) => chrome.storage.sync.set(value);
let llmUsageQueue = Promise.resolve();

function normalizeSettings(value = {}) {
  const stored = value && typeof value === "object" ? value : {};
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    aiEnabled: stored.aiEnabled === true,
    aiModel: normalizeGroqModel(stored.aiModel),
    aiDailyLimit: normalizeDailyLimit(stored.aiDailyLimit)
  };
}

function mutateLlmUsage(update) {
  const task = llmUsageQueue.then(async () => {
    const { llmUsage } = await getLocal("llmUsage");
    const next = update(llmUsage);
    await setLocal({ llmUsage: next });
    return next;
  });
  llmUsageQueue = task.catch(() => {});
  return task;
}

function reserveLlmRequest(limit) {
  return mutateLlmUsage((usage) => reserveUsage(usage, limit));
}

function recordLlmTokens(apiUsage, model) {
  return mutateLlmUsage((usage) => addTokenUsage(usage, apiUsage, model));
}

async function explanationFor(settings, submission, groqApiKey) {
  if (settings.includeReadme === false || settings.includeReview === false || !settings.aiEnabled) {
    return { review: null, ai: { generated: false } };
  }
  try {
    if (!groqApiKey) throw new Error("Add a Groq API key in Settings to enable AI explanations.");
    await reserveLlmRequest(settings.aiDailyLimit);
    const generated = await generateExplanation({ apiKey: groqApiKey, submission, model: settings.aiModel });
    const usage = await recordLlmTokens(generated.usage, generated.model);
    return {
      review: generated.review,
      ai: { generated: true, usage, limit: settings.aiDailyLimit, model: generated.model }
    };
  } catch (error) {
    const { llmUsage } = await getLocal("llmUsage");
    return {
      review: null,
      ai: {
        generated: false,
        warning: error.message,
        usage: usageForToday(llmUsage),
        limit: settings.aiDailyLimit
      }
    };
  }
}

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
      const [{ settings }, local] = await Promise.all([getSync("settings"), getLocal(["submissions", "lastSubmission", "groqApiKey", "llmUsage"])]);
      return {
        settings: normalizeSettings(settings),
        submissions: local.submissions || [],
        lastSubmission: local.lastSubmission || null,
        ai: {
          hasApiKey: Boolean(local.groqApiKey),
          usage: usageForToday(local.llmUsage)
        }
      };
    }
    case "SAVE_SETTINGS": {
      const [{ settings = {} }, { groqApiKey }] = await Promise.all([getSync("settings"), getLocal("groqApiKey")]);
      const { groqApiKey: ignoredKey, ...publicSettings } = message.settings || {};
      void ignoredKey;
      const newApiKey = String(message.groqApiKey || "").trim();
      const next = normalizeSettings({ ...settings, ...publicSettings });
      if (next.aiEnabled && !newApiKey && !groqApiKey) throw new Error("Add a Groq API key before enabling AI explanations.");
      if (newApiKey) await setLocal({ groqApiKey: newApiKey });
      await setSync({ settings: next });
      return { settings: next, ai: { hasApiKey: Boolean(newApiKey || groqApiKey) } };
    }
    case "CLEAR_GROQ_KEY": {
      const { settings = {} } = await getSync("settings");
      await chrome.storage.local.remove("groqApiKey");
      const next = normalizeSettings({ ...settings, aiEnabled: false });
      await setSync({ settings: next });
      return { settings: next, ai: { hasApiKey: false } };
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
      const [{ githubToken, groqApiKey }, { settings }] = await Promise.all([getLocal(["githubToken", "groqApiKey"]), getSync("settings")]);
      if (!githubToken || !settings?.connected) throw new Error("Finish GitHub setup first.");
      if (message.submission?.status !== "Accepted") throw new Error("Only Accepted submissions can be pushed.");
      const normalizedSettings = normalizeSettings(settings);
      const explanation = await explanationFor(normalizedSettings, message.submission, groqApiKey);
      const result = await pushSubmission({
        token: githubToken,
        settings: normalizedSettings,
        submission: message.submission,
        review: explanation.review
      });
      return { result, submission: await recordPush(message.submission, result), ai: explanation.ai };
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
