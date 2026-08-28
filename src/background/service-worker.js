import { aiLimitReached, aiSubmissionPayload, buildReview, DEFAULT_SETTINGS, isSubmissionPushReady, mergeSubmissionSolutions, normalizeSubmission, normalizeTheme, reusableGeneratedReview, sameProblem, submissionSolutions } from "../core/submissions.js";
import { listRepos, listSolutionFolders, pushSubmission } from "../core/github.js";
import { beginHostedGitHubSignIn, hostedRequest, launchIdentityWebAuthFlow, newRequestId } from "../core/service.js";
import { clearDeviceAuthentication, hasCompletedOnboarding, settingsForSync } from "../core/auth.js";
import { clearLeetRepoStorage } from "../core/storage.js";
import { normalizeStudyInterval, reviewDueAfterSync, scheduleReview, snoozeReview, studyIntervalDays } from "../core/study.js";

const getLocal = (keys) => chrome.storage.local.get(keys);
const setLocal = (value) => chrome.storage.local.set(value);
const getSync = (keys) => chrome.storage.sync.get(keys);
const setSync = (value) => chrome.storage.sync.set(value);
let localMutationQueue = Promise.resolve();
let repositoryMutationQueue = Promise.resolve();
let accountDeletionInProgress = false;
const pushesInFlight = new Map();

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
  const studyInterval = normalizeStudyInterval(stored.studyIntervalValue, stored.studyIntervalUnit);
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    aiConsent: stored.aiConsent === true,
    aiEnabled: stored.aiEnabled === true && stored.aiConsent === true,
    includeReadme: true,
    studyIntervalValue: studyInterval.value,
    studyIntervalUnit: studyInterval.unit,
    theme: normalizeTheme(stored.theme)
  };
}

function emptyHostedUsage(authenticationRequired = false) {
  return {
    authenticationRequired,
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
  } catch (error) {
    return emptyHostedUsage(error.status === 401);
  }
}

async function explanationFor(settings, submission) {
  if (!settings.aiEnabled) {
    return { review: null, ai: { generated: false } };
  }
  const usage = await hostedUsage();
  if (aiLimitReached(usage)) {
    return {
      review: null,
      ai: {
        generated: false,
        limitReached: true,
        usage,
        warning: "Your AI tier limit has been reached. LeetRepo used the local fallback."
      }
    };
  }
  try {
    const { leetrepoSessionToken } = await getLocal("leetrepoSessionToken");
    if (!leetrepoSessionToken) throw new Error("Reconnect GitHub to use hosted AI explanations.");
    const generated = await hostedRequest("/v1/ai/explanations", {
      method: "POST",
      sessionToken: leetrepoSessionToken,
      body: { requestId: newRequestId(), submission: aiSubmissionPayload(submission) }
    });
    return {
      review: generated.review,
      ai: { generated: true, limitReached: aiLimitReached(generated.usage), usage: generated.usage, model: generated.model }
    };
  } catch (error) {
    const latestUsage = await hostedUsage();
    return {
      review: null,
      ai: {
        generated: false,
        warning: error.message,
        limitReached: aiLimitReached(latestUsage),
        usage: latestUsage
      }
    };
  }
}

function launchWebAuthFlow(url) {
  return launchIdentityWebAuthFlow(chrome, url);
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const [{ settings }, { authSchemaVersion }] = await Promise.all([getSync("settings"), getLocal("authSchemaVersion")]);
  if (!settings) await setSync({ settings: settingsForSync(DEFAULT_SETTINGS) });
  if (authSchemaVersion !== 2) {
    await chrome.storage.local.remove(["githubAccessToken", "githubDeviceFlow", "githubToken", "githubUser", "groqApiKey", "llmUsage"]);
    await setLocal({ authSchemaVersion: 2 });
  }
  if (reason === "install") chrome.tabs.create({ url: chrome.runtime.getURL("src/pages/onboarding/onboarding.html") });
});

function mutateLocal(update) {
  const task = localMutationQueue.then(() => {
    if (accountDeletionInProgress) throw new Error("Account deletion is in progress.");
    return update();
  });
  localMutationQueue = task.catch(() => {});
  return task;
}

function mutateRepository(update) {
  const task = repositoryMutationQueue.then(() => {
    if (accountDeletionInProgress) throw new Error("Account deletion is in progress.");
    return update();
  });
  repositoryMutationQueue = task.catch(() => {});
  return task;
}

function codeHash(value = "") {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) result = ((result << 5) - result + value.charCodeAt(index)) | 0;
  return result;
}

function compactAttempt(input = {}) {
  const item = normalizeSubmission(input);
  return {
    key: String(input.key || `${item.id}:${item.status}:${codeHash(item.code)}`),
    id: item.id,
    number: item.number,
    title: item.title,
    slug: item.slug,
    difficulty: item.difficulty,
    language: item.language,
    runtime: item.runtime,
    memory: item.memory,
    status: item.status,
    recordedAt: input.recordedAt || new Date().toISOString()
  };
}

async function recordAttempt(submission) {
  return mutateLocal(async () => {
    const item = normalizeSubmission(submission);
    const { attempts = [] } = await getLocal("attempts");
    const key = `${item.id}:${item.status}:${codeHash(item.code)}`;
    if (attempts.some((attempt) => attempt.key === key)) return null;
    const attempt = compactAttempt({ ...item, key, recordedAt: new Date().toISOString() });
    await setLocal({ attempts: [attempt, ...attempts].slice(0, 500) });
    return attempt;
  });
}

export async function recordPush(submission, result, review, settings, existing = {}) {
  const normalized = normalizeSubmission(submission);
  const syncedAt = normalized.syncedAt || new Date().toISOString();
  const item = mergeSubmissionSolutions(existing, {
    ...normalized,
    solvedAt: existing.solvedAt || normalized.solvedAt || existing.syncedAt || syncedAt,
    review: review || normalized.review || buildReview(normalized),
    syncedAt,
    commitUrl: result.url || normalized.commitUrl,
    commitSha: result.sha || normalized.commitSha
  });
  item.reviewDueAt = reviewDueAfterSync(item, syncedAt, studyIntervalDays(settings), settings.spacedRepetition !== false);
  return item;
}

async function repositorySubmissions(accessToken, settings) {
  return listSolutionFolders(accessToken, settings.owner, settings.repo, settings.branch);
}

function selectedSubmission(item, selected) {
  const normalized = normalizeSubmission(selected);
  const solution = submissionSolutions(item).find((candidate) => candidate.key === `${normalized.language.toLowerCase()}:${normalized.extension}`)
    || submissionSolutions(item)[0];
  return solution ? { ...item, ...solution, solutions: item.solutions } : item;
}

function notesFor(items) {
  const notes = {};
  for (const item of items) {
    if (!item.notes) continue;
    notes[item.id] = item.notes;
    notes[`${item.number}-${item.slug}`] = item.notes;
  }
  return notes;
}

async function updateRepositoryReadme(accessToken, settings, submission, commitTemplate) {
  return pushSubmission({
    token: accessToken,
    settings: { ...settings, includeReadme: true, includeProfile: false, commitTemplate },
    submission,
    review: submission.review
  });
}

async function clearAuthentication() {
  await clearDeviceAuthentication(chrome.storage);
}

export async function handle(message) {
  if (accountDeletionInProgress && message.type !== "DELETE_ACCOUNT") {
    throw new Error("Account deletion is in progress.");
  }
  switch (message.type) {
    case "GET_STATE": {
      const [{ settings }, local, usage] = await Promise.all([
        getSync("settings"),
        getLocal(["attempts", "leetrepoSessionToken"]),
        hostedUsage()
      ]);
      const connected = hasCompletedOnboarding(settings, local.leetrepoSessionToken) && usage.authenticationRequired !== true;
      if (usage.authenticationRequired) {
        await clearDeviceAuthentication(chrome.storage);
      }
      const normalizedSettings = normalizeSettings({ ...settings, connected });
      const submissions = connected
        ? await repositorySubmissions(await getGitHubAccessToken(), normalizedSettings)
        : [];
      const attempts = (local.attempts || []).map(compactAttempt);
      if (JSON.stringify(attempts) !== JSON.stringify(local.attempts || [])) await setLocal({ attempts });
      const { authenticationRequired: _authenticationRequired, ...visibleUsage } = usage;
      return {
        settings: normalizedSettings,
        submissions,
        attempts,
        notes: notesFor(submissions),
        lastSubmission: submissions[0] || null,
        ai: {
          available: connected,
          usage: visibleUsage,
          limitReached: aiLimitReached(visibleUsage)
        }
      };
    }
    case "SAVE_SETTINGS": {
      const [{ settings = {} }, { leetrepoSessionToken }] = await Promise.all([
        getSync("settings"),
        getLocal("leetrepoSessionToken")
      ]);
      const requested = { ...settings, ...(message.settings || {}) };
      if (message.settings?.connected === true && !hasCompletedOnboarding(requested, leetrepoSessionToken)) {
        throw new Error("Sign in with GitHub and choose an installed repository before finishing setup.");
      }
      if (requested.aiEnabled === true && requested.aiConsent !== true) {
        throw new Error("Consent to hosted AI processing before enabling AI explanations.");
      }
      const next = normalizeSettings({ ...requested, connected: hasCompletedOnboarding(requested, leetrepoSessionToken) });
      await setSync({ settings: settingsForSync(next, settings) });
      return { settings: next, ai: { available: next.connected } };
    }
    case "START_GITHUB_SIGN_IN": {
      const { leetrepoSessionToken } = await getLocal("leetrepoSessionToken");
      const result = await beginHostedGitHubSignIn({
        redirectUri: chrome.identity.getRedirectURL("github"),
        launchWebAuthFlow,
        sessionToken: leetrepoSessionToken
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
      const [accessToken, { settings }, { leetrepoSessionToken }] = await Promise.all([
        getGitHubAccessToken(),
        getSync("settings"),
        getLocal("leetrepoSessionToken")
      ]);
      if (!accessToken || !hasCompletedOnboarding(settings, leetrepoSessionToken)) {
        throw new Error("Finish GitHub setup before backfilling.");
      }
      const imported = await listSolutionFolders(accessToken, settings.owner, settings.repo, settings.branch);
      return { imported: imported.length, updated: 0, submissions: imported };
    }
    case "PUSH_SUBMISSION": {
      const [accessToken, { settings }, { leetrepoSessionToken }] = await Promise.all([
        getGitHubAccessToken(),
        getSync("settings"),
        getLocal("leetrepoSessionToken")
      ]);
      if (!accessToken || !hasCompletedOnboarding(settings, leetrepoSessionToken)) throw new Error("Finish GitHub setup first.");
      if (!isSubmissionPushReady(message.submission)) {
        throw new Error("Submit this code on LeetCode and wait for a fresh Accepted result before pushing.");
      }
      const normalizedSettings = normalizeSettings(settings);
      const submission = normalizeSubmission(message.submission);
      const pushKey = JSON.stringify({
        repository: [normalizedSettings.owner, normalizedSettings.repo, normalizedSettings.branch],
        submission
      });
      if (pushesInFlight.has(pushKey)) return pushesInFlight.get(pushKey);
      const task = mutateRepository(async () => {
        const submissions = await repositorySubmissions(accessToken, normalizedSettings);
        const existing = submissions.find((item) => sameProblem(item, submission)) || {};
        submission.syncedAt = new Date().toISOString();
        submission.solvedAt = existing?.solvedAt || existing?.syncedAt || submission.syncedAt;
        submission.notes = submission.notes || existing.notes || "";
        const cachedReview = submission.review?.generatedBy
          ? submission.review
          : normalizedSettings.aiEnabled ? reusableGeneratedReview(existing, submission) : null;
        const explanation = cachedReview
          ? { review: cachedReview, ai: { generated: false, reused: true } }
          : await explanationFor(normalizedSettings, submission);
        const prepared = await recordPush(submission, {}, explanation.review, normalizedSettings, existing);
        const result = await pushSubmission({
          token: accessToken,
          settings: normalizedSettings,
          submission: prepared,
          review: prepared.review,
          profileItems: submissions
        });
        await recordAttempt(submission);
        const stored = await recordPush(prepared, result, prepared.review, normalizedSettings, existing);
        return { result, submission: stored, ai: explanation.ai };
      });
      pushesInFlight.set(pushKey, task);
      try {
        return await task;
      } finally {
        if (pushesInFlight.get(pushKey) === task) pushesInFlight.delete(pushKey);
      }
    }
    case "GENERATE_FEEDBACK": {
      const [{ settings }, { leetrepoSessionToken }] = await Promise.all([
        getSync("settings"),
        getLocal("leetrepoSessionToken")
      ]);
      if (!hasCompletedOnboarding(settings, leetrepoSessionToken)) throw new Error("Finish GitHub setup first.");
      const accessToken = await getGitHubAccessToken();
      if (!accessToken) throw new Error("Finish GitHub setup first.");
      const normalizedSettings = normalizeSettings(settings);
      const explanation = await explanationFor({ ...normalizedSettings, includeReadme: true }, message.submission);
      const review = explanation.review || buildReview(message.submission);
      const normalized = normalizeSubmission(message.submission);
      return mutateRepository(async () => {
        const submissions = await repositorySubmissions(accessToken, normalizedSettings);
        const existing = submissions.find((item) => sameProblem(item, normalized));
        if (!existing) {
          return { review, submission: { ...normalized, review }, persisted: false, ai: explanation.ai };
        }
        const merged = mergeSubmissionSolutions(existing, { ...normalized, review });
        const updatedSubmission = selectedSubmission(merged, normalized);
        const result = await updateRepositoryReadme(
          accessToken,
          normalizedSettings,
          updatedSubmission,
          "docs: update {number}. {title} feedback"
        );
        return {
          review,
          result,
          submission: { ...updatedSubmission, commitUrl: result.url, commitSha: result.sha },
          persisted: true,
          ai: explanation.ai
        };
      });
    }
    case "RECORD_ATTEMPT": {
      const [{ settings }, { leetrepoSessionToken }] = await Promise.all([getSync("settings"), getLocal("leetrepoSessionToken")]);
      if (!hasCompletedOnboarding(settings, leetrepoSessionToken)) return { attempt: null };
      const allowed = new Set(["Accepted", "Wrong Answer", "Time Limit Exceeded", "Memory Limit Exceeded", "Runtime Error", "Compile Error", "Output Limit Exceeded"]);
      if (!allowed.has(message.submission?.status) || !message.submission?.code) return { attempt: null };
      return { attempt: await recordAttempt(message.submission) };
    }
    case "SAVE_NOTES": {
      const [{ settings }, { leetrepoSessionToken }] = await Promise.all([
        getSync("settings"),
        getLocal("leetrepoSessionToken")
      ]);
      if (!hasCompletedOnboarding(settings, leetrepoSessionToken)) throw new Error("Finish GitHub setup first.");
      const accessToken = await getGitHubAccessToken();
      if (!accessToken) throw new Error("Finish GitHub setup first.");
      const normalizedSettings = normalizeSettings(settings);
      const normalized = normalizeSubmission({ ...message.submission, notes: message.notes });
      return mutateRepository(async () => {
        const submissions = await repositorySubmissions(accessToken, normalizedSettings);
        const existing = submissions.find((item) => sameProblem(item, normalized));
        if (!existing) return { notes: normalized.notes, persisted: false };
        const updatedSubmission = selectedSubmission({ ...existing, notes: normalized.notes }, normalized);
        const result = await updateRepositoryReadme(
          accessToken,
          normalizedSettings,
          updatedSubmission,
          "docs: update {number}. {title} notes"
        );
        return { notes: normalized.notes, submission: updatedSubmission, result, persisted: true };
      });
    }
    case "SNOOZE_REVIEW":
    case "MARK_REVIEWED":
    case "RATE_REVIEW": {
      const [{ settings }, { leetrepoSessionToken }] = await Promise.all([
        getSync("settings"),
        getLocal("leetrepoSessionToken")
      ]);
      if (!hasCompletedOnboarding(settings, leetrepoSessionToken)) throw new Error("Finish GitHub setup first.");
      if (settings?.spacedRepetition === false) throw new Error("Turn on spaced repetition in Settings to schedule reviews.");
      const accessToken = await getGitHubAccessToken();
      if (!accessToken) throw new Error("Finish GitHub setup first.");
      const id = String(message.id || "");
      const normalizedSettings = normalizeSettings(settings);
      return mutateRepository(async () => {
        const submissions = await repositorySubmissions(accessToken, normalizedSettings);
        const existing = submissions.find((item) => item.id === id);
        if (!existing) throw new Error("That review is no longer in your study queue.");
        const now = new Date();
        const updatedSubmission = message.type === "SNOOZE_REVIEW"
          ? snoozeReview(existing, now, 3)
          : scheduleReview(existing, message.type === "MARK_REVIEWED" ? "good" : message.rating, now, studyIntervalDays(settings), message.recall);
        await updateRepositoryReadme(
          accessToken,
          normalizedSettings,
          updatedSubmission,
          "docs: update {number}. {title} study progress"
        );
        const next = submissions.map((item) => item.id === id ? updatedSubmission : item);
        return { submissions: next, submission: updatedSubmission };
      });
    }
    case "SIGN_OUT": {
      const { leetrepoSessionToken } = await getLocal("leetrepoSessionToken");
      if (leetrepoSessionToken) {
        await hostedRequest("/v1/auth/session", { method: "DELETE", sessionToken: leetrepoSessionToken });
      }
      await clearAuthentication();
      return { ok: true };
    }
    case "DELETE_ACCOUNT": {
      if (accountDeletionInProgress) throw new Error("Account deletion is already in progress.");
      accountDeletionInProgress = true;
      try {
        await Promise.allSettled([localMutationQueue, repositoryMutationQueue]);
        const { leetrepoSessionToken } = await getLocal("leetrepoSessionToken");
        if (leetrepoSessionToken) {
          await hostedRequest("/v1/account", { method: "DELETE", sessionToken: leetrepoSessionToken });
        }
        await clearLeetRepoStorage(chrome.storage);
        return { ok: true };
      } finally {
        accountDeletionInProgress = false;
      }
    }
    case "OPEN_DASHBOARD":
      {
        const [{ settings }, { leetrepoSessionToken }] = await Promise.all([getSync("settings"), getLocal("leetrepoSessionToken")]);
        const onboarded = hasCompletedOnboarding(settings, leetrepoSessionToken);
        const path = onboarded ? "src/pages/dashboard/dashboard.html" : "src/pages/onboarding/onboarding.html";
        const query = onboarded && message.view === "study" ? "?view=study" : "";
        await chrome.tabs.create({ url: chrome.runtime.getURL(path) + query });
      }
      return { ok: true };
    case "OPEN_OPTIONS":
      {
        const [{ settings }, { leetrepoSessionToken }] = await Promise.all([getSync("settings"), getLocal("leetrepoSessionToken")]);
        if (hasCompletedOnboarding(settings, leetrepoSessionToken)) await chrome.runtime.openOptionsPage();
        else await chrome.tabs.create({ url: chrome.runtime.getURL("src/pages/onboarding/onboarding.html") });
      }
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
