import { buildReview, DEFAULT_SETTINGS, isSubmissionPushReady, normalizeSubmission, normalizeTheme, sameProblem } from "../core/submissions.js";
import { listRepos, listSolutionFolders, pushSubmission } from "../core/github.js";
import { beginHostedGitHubSignIn, hostedRequest, newRequestId } from "../core/service.js";

const getLocal = (keys) => chrome.storage.local.get(keys);
const setLocal = (value) => chrome.storage.local.set(value);
const getSync = (keys) => chrome.storage.sync.get(keys);
const setSync = (value) => chrome.storage.sync.set(value);
let localMutationQueue = Promise.resolve();

async function getGitHubAccessToken() {
  const { githubAccessToken, githubAccessTokenExpiresAt, leetrepoSessionToken } = await getLocal([
    "githubAccessToken",
    "githubAccessTokenExpiresAt",
    "leetrepoSessionToken"
  ]);
  if (!leetrepoSessionToken) return "";
  if (githubAccessToken && new Date(githubAccessTokenExpiresAt || 0).getTime() > Date.now() + 5 * 60 * 1000) {
    return githubAccessToken;
  }
  const refreshed = await hostedRequest("/v1/auth/github/token", {
    method: "POST",
    sessionToken: leetrepoSessionToken
  });
  await setLocal({
    githubAccessToken: refreshed.githubAccessToken,
    githubAccessTokenExpiresAt: refreshed.githubAccessTokenExpiresAt
  });
  return refreshed.githubAccessToken;
}

function normalizeSettings(value = {}) {
  const stored = value && typeof value === "object" ? value : {};
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    aiConsent: stored.aiConsent === true,
    aiEnabled: stored.aiEnabled === true && stored.aiConsent === true,
    theme: normalizeTheme(stored.theme)
  };
}

function emptyHostedUsage() {
  return {
    plan: "free",
    daily: { requests: 0, inputTokens: 0, outputTokens: 0, limit: 3 },
    monthly: { requests: 0, inputTokens: 0, outputTokens: 0, limit: 30 }
  };
}

async function hostedUsage() {
  const { leetrepoSessionToken } = await getLocal("leetrepoSessionToken");
  if (!leetrepoSessionToken) return emptyHostedUsage();
  try {
    return await hostedRequest("/v1/ai/usage", { sessionToken: leetrepoSessionToken });
  } catch {
    return emptyHostedUsage();
  }
}

async function explanationFor(settings, submission) {
  if (settings.includeReadme === false || !settings.aiEnabled) {
    return { review: null, ai: { generated: false } };
  }
  try {
    const { leetrepoSessionToken } = await getLocal("leetrepoSessionToken");
    if (!leetrepoSessionToken) throw new Error("Reconnect GitHub to use hosted AI explanations.");
    const generated = await hostedRequest("/v1/ai/explanations", {
      method: "POST",
      sessionToken: leetrepoSessionToken,
      body: { requestId: newRequestId(), submission }
    });
    return {
      review: generated.review,
      ai: { generated: true, usage: generated.usage, model: generated.model }
    };
  } catch (error) {
    return {
      review: null,
      ai: {
        generated: false,
        warning: error.message,
        usage: await hostedUsage()
      }
    };
  }
}

function launchWebAuthFlow(url) {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (redirectUrl) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) reject(new Error(runtimeError.message));
      else if (!redirectUrl) reject(new Error("GitHub sign-in was cancelled."));
      else resolve(redirectUrl);
    });
  });
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const [{ settings }, { authSchemaVersion }] = await Promise.all([getSync("settings"), getLocal("authSchemaVersion")]);
  if (!settings) await setSync({ settings: DEFAULT_SETTINGS });
  if (authSchemaVersion !== 2) {
    await chrome.storage.local.remove(["githubAccessToken", "githubDeviceFlow", "githubToken", "githubUser", "groqApiKey", "llmUsage"]);
    await setLocal({ authSchemaVersion: 2 });
    if (settings) await setSync({ settings: { ...DEFAULT_SETTINGS, ...settings, connected: false, aiEnabled: false, aiConsent: false } });
  }
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
      const [{ settings }, local, usage] = await Promise.all([
        getSync("settings"),
        getLocal(["submissions", "lastSubmission", "attempts", "submissionNotes", "leetrepoSessionToken"]),
        hostedUsage()
      ]);
      const connected = Boolean(local.leetrepoSessionToken);
      return {
        settings: normalizeSettings({ ...settings, connected: settings?.connected === true && connected }),
        submissions: local.submissions || [],
        attempts: local.attempts || [],
        notes: local.submissionNotes || {},
        lastSubmission: local.lastSubmission || null,
        ai: {
          available: connected,
          usage
        }
      };
    }
    case "SAVE_SETTINGS": {
      const { settings = {} } = await getSync("settings");
      const requested = { ...settings, ...(message.settings || {}) };
      if (requested.aiEnabled === true && requested.aiConsent !== true) {
        throw new Error("Consent to hosted AI processing before enabling AI explanations.");
      }
      const next = normalizeSettings(requested);
      await setSync({ settings: next });
      return { settings: next, ai: { available: true } };
    }
    case "START_GITHUB_SIGN_IN": {
      const result = await beginHostedGitHubSignIn({
        redirectUri: chrome.identity.getRedirectURL("github"),
        launchWebAuthFlow
      });
      await setLocal({
        leetrepoSessionToken: result.sessionToken,
        githubAccessToken: result.githubAccessToken,
        githubAccessTokenExpiresAt: result.githubAccessTokenExpiresAt,
        githubUser: result.user
      });
      await chrome.storage.local.remove(["githubDeviceFlow", "githubToken", "groqApiKey", "llmUsage"]);
      return { status: "connected", user: result.user, repos: result.repos, ai: result.ai };
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
      const [accessToken, { submissions = [], submissionNotes = {} }, { settings }] = await Promise.all([
        getGitHubAccessToken(),
        getLocal(["submissions", "submissionNotes"]),
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
      const explanation = await explanationFor(normalizedSettings, submission);
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
      const { settings } = await getSync("settings");
      const normalizedSettings = normalizeSettings(settings);
      const explanation = await explanationFor({ ...normalizedSettings, includeReadme: true }, message.submission);
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
      const { leetrepoSessionToken } = await getLocal("leetrepoSessionToken");
      if (leetrepoSessionToken) {
        await hostedRequest("/v1/account", { method: "DELETE", sessionToken: leetrepoSessionToken });
      }
      await chrome.storage.local.remove([
        "leetrepoSessionToken",
        "githubAccessToken",
        "githubAccessTokenExpiresAt",
        "githubDeviceFlow",
        "githubToken",
        "githubUser"
      ]);
      const { settings = {} } = await getSync("settings");
      await setSync({ settings: { ...settings, connected: false, owner: "", repo: "", aiEnabled: false } });
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
