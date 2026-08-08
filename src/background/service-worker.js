import { buildReview, DEFAULT_SETTINGS, isSubmissionPushReady, normalizeSubmission, normalizeTheme, sameProblem } from "../core/submissions.js";
import { GITHUB_OAUTH_CLIENT_ID } from "../config.js";
import { createRepo, listRepos, listSolutionFolders, pollDeviceAuthorization, pushSubmission, startDeviceAuthorization, verifyToken } from "../core/github.js";
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
let localMutationQueue = Promise.resolve();

function githubOAuthClientId() {
  const clientId = String(GITHUB_OAUTH_CLIENT_ID || "").trim();
  if (!clientId || clientId === "YOUR_GITHUB_OAUTH_CLIENT_ID") {
    throw new Error("Add your GitHub OAuth app client ID to src/config.js, then reload LeetRepo.");
  }
  return clientId;
}

async function getGitHubAccessToken() {
  const { githubAccessToken, githubToken } = await getLocal(["githubAccessToken", "githubToken"]);
  return githubAccessToken || githubToken || "";
}

function normalizeSettings(value = {}) {
  const stored = value && typeof value === "object" ? value : {};
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    aiEnabled: stored.aiEnabled === true,
    aiModel: normalizeGroqModel(stored.aiModel),
    aiDailyLimit: normalizeDailyLimit(stored.aiDailyLimit),
    theme: normalizeTheme(stored.theme)
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

function mutateLocal(update) {
  const task = localMutationQueue.then(update);
  localMutationQueue = task.catch(() => {});
  return task;
}

function codeHash(value = "") {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) result = ((result << 5) - result + value.charCodeAt(index)) | 0;
  return result;
}

async function recordAttempt(submission) {
  return mutateLocal(async () => {
    const item = normalizeSubmission(submission);
    const { attempts = [] } = await getLocal("attempts");
    const key = `${item.id}:${item.status}:${codeHash(item.code)}`;
    if (attempts.some((attempt) => attempt.key === key)) return null;
    const attempt = { ...item, key, recordedAt: new Date().toISOString() };
    await setLocal({ attempts: [attempt, ...attempts].slice(0, 500) });
    return attempt;
  });
}

async function recordPush(submission, result, review, settings) {
  return mutateLocal(async () => {
    const { submissions = [] } = await getLocal("submissions");
    const normalized = normalizeSubmission(submission);
    const existing = submissions.find((item) => sameProblem(item, normalized)) || {};
    const syncedAt = normalized.syncedAt || new Date().toISOString();
    const reviewDueAt = new Date(syncedAt);
    reviewDueAt.setUTCDate(reviewDueAt.getUTCDate() + 30);
    const item = {
      ...existing,
      ...normalized,
      solvedAt: existing.solvedAt || normalized.solvedAt || existing.syncedAt || syncedAt,
      review: review || normalized.review || existing.review || buildReview(normalized),
      syncedAt,
      reviewDueAt: settings.spacedRepetition === false ? null : reviewDueAt.toISOString(),
      commitUrl: result.url,
      commitSha: result.sha
    };
    const next = [item, ...submissions.filter((stored) => !sameProblem(stored, item))].slice(0, 500);
    await setLocal({ submissions: next, lastSubmission: item });
    return item;
  });
}

async function handle(message) {
  switch (message.type) {
    case "GET_STATE": {
      const [{ settings }, local] = await Promise.all([getSync("settings"), getLocal(["submissions", "lastSubmission", "attempts", "submissionNotes", "groqApiKey", "llmUsage"])]);
      return {
        settings: normalizeSettings(settings),
        submissions: local.submissions || [],
        attempts: local.attempts || [],
        notes: local.submissionNotes || {},
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
    case "START_GITHUB_SIGN_IN": {
      const authorization = await startDeviceAuthorization(githubOAuthClientId());
      const expiresAt = Date.now() + authorization.expiresIn * 1000;
      await setLocal({ githubDeviceFlow: {
        deviceCode: authorization.deviceCode,
        expiresAt,
        interval: authorization.interval
      } });
      return {
        userCode: authorization.userCode,
        verificationUri: authorization.verificationUri,
        expiresAt,
        interval: authorization.interval
      };
    }
    case "POLL_GITHUB_SIGN_IN": {
      const { githubDeviceFlow } = await getLocal("githubDeviceFlow");
      if (!githubDeviceFlow?.deviceCode) throw new Error("Start GitHub sign-in again to get a new code.");
      if (Date.now() >= githubDeviceFlow.expiresAt) {
        await chrome.storage.local.remove("githubDeviceFlow");
        throw new Error("The GitHub sign-in code expired. Start again to get a new code.");
      }
      const result = await pollDeviceAuthorization(githubOAuthClientId(), githubDeviceFlow.deviceCode);
      if (result.status === "pending") {
        const interval = result.slowDown ? githubDeviceFlow.interval + 5 : githubDeviceFlow.interval;
        if (interval !== githubDeviceFlow.interval) await setLocal({ githubDeviceFlow: { ...githubDeviceFlow, interval } });
        return { status: "pending", interval };
      }
      const scopes = new Set(result.scope.split(/[\s,]+/).filter(Boolean));
      if (!scopes.has("repo")) throw new Error("GitHub did not grant the repository access LeetRepo needs. Start sign-in again and approve the repo scope.");
      const [user, repos] = await Promise.all([verifyToken(result.accessToken), listRepos(result.accessToken)]);
      await setLocal({ githubAccessToken: result.accessToken, githubUser: user });
      await chrome.storage.local.remove(["githubDeviceFlow", "githubToken"]);
      return { status: "connected", user, repos };
    }
    case "CREATE_REPO": {
      const accessToken = await getGitHubAccessToken();
      if (!accessToken) throw new Error("Connect GitHub first.");
      return { repo: await createRepo(accessToken, message.repo || {}) };
    }
    case "LIST_REPOS": {
      const accessToken = await getGitHubAccessToken();
      if (!accessToken) throw new Error("Connect GitHub first.");
      return { repos: await listRepos(accessToken) };
    }
    case "IMPORT_REPOSITORY": {
      const [accessToken, { settings }] = await Promise.all([getGitHubAccessToken(), getSync("settings")]);
      if (!accessToken || !settings?.owner || !settings?.repo) throw new Error("Choose a repository before backfilling.");
      const imported = await listSolutionFolders(accessToken, settings.owner, settings.repo, settings.branch);
      return mutateLocal(async () => {
        const { submissions = [] } = await getLocal("submissions");
        const additions = imported.map(normalizeSubmission).filter((item) => !submissions.some((existing) => sameProblem(existing, item)));
        await setLocal({ submissions: [...submissions, ...additions].slice(0, 500) });
        return { imported: additions.length };
      });
    }
    case "PUSH_SUBMISSION": {
      const [accessToken, { groqApiKey, submissions = [], submissionNotes = {} }, { settings }] = await Promise.all([
        getGitHubAccessToken(),
        getLocal(["groqApiKey", "submissions", "submissionNotes"]),
        getSync("settings")
      ]);
      if (!accessToken || !settings?.connected) throw new Error("Finish GitHub setup first.");
      if (!isSubmissionPushReady(message.submission)) {
        throw new Error("Submit this code on LeetCode and wait for a fresh Accepted result before pushing.");
      }
      const normalizedSettings = normalizeSettings(settings);
      const submission = normalizeSubmission(message.submission);
      const existing = submissions.find((item) => sameProblem(item, submission));
      submission.syncedAt = new Date().toISOString();
      submission.solvedAt = existing?.solvedAt || existing?.syncedAt || submission.syncedAt;
      submission.notes = submission.notes || submissionNotes[submission.id] || "";
      const explanation = await explanationFor(normalizedSettings, submission, groqApiKey);
      const result = await pushSubmission({
        token: accessToken,
        settings: normalizedSettings,
        submission,
        review: explanation.review,
        profileItems: submissions
      });
      await recordAttempt(submission);
      return { result, submission: await recordPush(submission, result, explanation.review, normalizedSettings), ai: explanation.ai };
    }
    case "GENERATE_FEEDBACK": {
      const [{ groqApiKey }, { settings }] = await Promise.all([getLocal("groqApiKey"), getSync("settings")]);
      const normalizedSettings = normalizeSettings(settings);
      const explanation = await explanationFor({ ...normalizedSettings, includeReadme: true, includeReview: true }, message.submission, groqApiKey);
      const review = explanation.review || buildReview(message.submission);
      const normalized = normalizeSubmission(message.submission);
      await mutateLocal(async () => {
        const { submissions = [], lastSubmission } = await getLocal(["submissions", "lastSubmission"]);
        if (!submissions.some((item) => sameProblem(item, normalized))) return;
        const next = submissions.map((item) => sameProblem(item, normalized) ? { ...item, review } : item);
        const nextLast = lastSubmission && sameProblem(lastSubmission, normalized) ? { ...lastSubmission, review } : lastSubmission;
        await setLocal({ submissions: next, lastSubmission: nextLast });
      });
      return { review, ai: explanation.ai };
    }
    case "RECORD_ATTEMPT": {
      const allowed = new Set(["Accepted", "Wrong Answer", "Time Limit Exceeded", "Memory Limit Exceeded", "Runtime Error", "Compile Error", "Output Limit Exceeded"]);
      if (!allowed.has(message.submission?.status) || !message.submission?.code) return { attempt: null };
      return { attempt: await recordAttempt(message.submission) };
    }
    case "SAVE_NOTES": {
      const normalized = normalizeSubmission({ ...message.submission, notes: message.notes });
      return mutateLocal(async () => {
        const { submissions = [], lastSubmission, submissionNotes = {} } = await getLocal(["submissions", "lastSubmission", "submissionNotes"]);
        const next = submissions.map((item) => sameProblem(item, normalized) ? { ...item, notes: normalized.notes } : item);
        const nextLast = lastSubmission && sameProblem(lastSubmission, normalized) ? { ...lastSubmission, notes: normalized.notes } : lastSubmission;
        await setLocal({ submissions: next, lastSubmission: nextLast, submissionNotes: {
          ...submissionNotes,
          [normalized.id]: normalized.notes,
          [`${normalized.number}-${normalized.slug}`]: normalized.notes
        } });
        return { notes: normalized.notes };
      });
    }
    case "SNOOZE_REVIEW":
    case "MARK_REVIEWED": {
      const id = String(message.id || "");
      return mutateLocal(async () => {
        const { submissions = [] } = await getLocal("submissions");
        const now = new Date();
        const due = new Date(now);
        due.setUTCDate(due.getUTCDate() + (message.type === "SNOOZE_REVIEW" ? 3 : 30));
        const next = submissions.map((item) => item.id === id ? {
          ...item,
          lastReviewedAt: message.type === "MARK_REVIEWED" ? now.toISOString() : item.lastReviewedAt,
          reviewDueAt: due.toISOString()
        } : item);
        await setLocal({ submissions: next });
        return { submissions: next };
      });
    }
    case "DISCONNECT": {
      await chrome.storage.local.remove(["githubAccessToken", "githubDeviceFlow", "githubToken", "githubUser"]);
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
    case "OPEN_ONBOARDING":
      await chrome.tabs.create({ url: chrome.runtime.getURL("src/pages/onboarding/onboarding.html") });
      return { ok: true };
    default:
      throw new Error(`Unknown message: ${message.type}`);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handle(message).then((data) => sendResponse({ ok: true, ...data })).catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
