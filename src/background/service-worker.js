import { buildReview, DEFAULT_SETTINGS, isSubmissionPushReady, mergeSubmissionSolutions, normalizeSubmission, normalizeTheme, reusableGeneratedReview, sameProblem, submissionSolutions } from "../core/submissions.js";
import { createRepo, listRepos, listSolutionFolders, pushSubmission, verifyToken } from "../core/github.js";
import { addTokenUsage, generateExplanation, LLM_PROVIDERS, normalizeDailyLimit, normalizeLlmBaseUrl, normalizeLlmModel, normalizeLlmProvider, reserveUsage, usageForToday } from "../core/llm.js";
import { hasCompletedOnboarding } from "../core/auth.js";
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
  const { githubAccessToken } = await getLocal("githubAccessToken");
  return String(githubAccessToken || "").trim();
}

function normalizeSettings(value = {}) {
  const stored = value && typeof value === "object" ? value : {};
  const studyInterval = normalizeStudyInterval(stored.studyIntervalValue, stored.studyIntervalUnit);
  const aiProvider = normalizeLlmProvider(stored.aiProvider);
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    aiEnabled: stored.aiEnabled === true,
    aiConsent: stored.aiEnabled === true,
    aiProvider,
    aiBaseUrl: normalizeLlmBaseUrl(stored.aiBaseUrl, aiProvider),
    aiModel: normalizeLlmModel(stored.aiModel, aiProvider),
    aiDailyLimit: normalizeDailyLimit(stored.aiDailyLimit),
    includeReadme: true,
    studyIntervalValue: studyInterval.value,
    studyIntervalUnit: studyInterval.unit,
    theme: normalizeTheme(stored.theme)
  };
}

async function localAiState(settings) {
  const { aiApiKey, groqApiKey, llmUsage } = await getLocal(["aiApiKey", "groqApiKey", "llmUsage"]);
  const usage = usageForToday(llmUsage);
  const limit = normalizeDailyLimit(settings.aiDailyLimit);
  const hasApiKey = Boolean(String(aiApiKey || groqApiKey || "").trim());
  return {
    available: hasApiKey,
    hasApiKey,
    providerLabel: LLM_PROVIDERS[settings.aiProvider].label,
    usage: { ...usage, limit },
    limitReached: usage.requests >= limit
  };
}

async function explanationFor(settings, submission) {
  if (!settings.aiEnabled) {
    return { review: null, ai: { generated: false } };
  }
  const { aiApiKey, groqApiKey, llmUsage } = await getLocal(["aiApiKey", "groqApiKey", "llmUsage"]);
  const apiKey = String(aiApiKey || groqApiKey || "").trim();
  if (!apiKey) {
    return { review: null, ai: { generated: false, warning: "Add an AI provider key in Settings to use AI explanations." } };
  }
  let reserved;
  try {
    reserved = reserveUsage(llmUsage, settings.aiDailyLimit);
  } catch (error) {
    return {
      review: null,
      ai: {
        generated: false,
        limitReached: true,
        usage: { ...usageForToday(llmUsage), limit: settings.aiDailyLimit },
        warning: error.message
      }
    };
  }
  await setLocal({ llmUsage: reserved });
  try {
    const generated = await generateExplanation({
      apiKey,
      submission,
      provider: settings.aiProvider,
      baseUrl: settings.aiBaseUrl,
      model: settings.aiModel
    });
    const usage = addTokenUsage(reserved, generated.usage, generated.model);
    await setLocal({ llmUsage: usage });
    return {
      review: generated.review,
      ai: {
        generated: true,
        limitReached: usage.requests >= settings.aiDailyLimit,
        usage: { ...usage, limit: settings.aiDailyLimit },
        model: generated.model,
        providerLabel: LLM_PROVIDERS[settings.aiProvider].label
      }
    };
  } catch (error) {
    const usage = usageForToday((await getLocal("llmUsage")).llmUsage);
    return {
      review: null,
      ai: {
        generated: false,
        warning: error.message,
        limitReached: usage.requests >= settings.aiDailyLimit,
        usage: { ...usage, limit: settings.aiDailyLimit }
      }
    };
  }
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const [{ settings }, local] = await Promise.all([
    getSync("settings"),
    getLocal(["aiApiKey", "groqApiKey"])
  ]);
  await setSync({ settings: normalizeSettings(settings || DEFAULT_SETTINGS) });
  if (!local.aiApiKey && local.groqApiKey) await setLocal({ aiApiKey: local.groqApiKey });
  await chrome.storage.local.remove(["leetrepoSessionToken", "githubAccessTokenExpiresAt", "githubDeviceFlow", "githubToken"]);
  if (reason === "install") chrome.tabs.create({ url: chrome.runtime.getURL("src/pages/onboarding/onboarding.html") });
});

function mutateLocal(update) {
  const task = localMutationQueue.then(update);
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
  await chrome.storage.local.remove(["githubAccessToken", "githubUser"]);
  const { settings = {} } = await getSync("settings");
  await setSync({ settings: {
    ...settings,
    connected: false
  } });
}

export async function handle(message) {
  if (accountDeletionInProgress && message.type !== "DELETE_ACCOUNT") {
    throw new Error("Account deletion is in progress.");
  }
  switch (message.type) {
    case "GET_STATE": {
      const [{ settings }, local] = await Promise.all([
        getSync("settings"),
        getLocal(["attempts", "githubAccessToken"])
      ]);
      const normalized = normalizeSettings(settings);
      const connected = hasCompletedOnboarding(normalized, local.githubAccessToken);
      const normalizedSettings = { ...normalized, connected };
      const submissions = connected
        ? await repositorySubmissions(local.githubAccessToken, normalizedSettings)
        : [];
      const attempts = (local.attempts || []).map(compactAttempt);
      if (JSON.stringify(attempts) !== JSON.stringify(local.attempts || [])) await setLocal({ attempts });
      return {
        settings: normalizedSettings,
        submissions,
        attempts,
        notes: notesFor(submissions),
        lastSubmission: submissions[0] || null,
        github: { hasToken: Boolean(local.githubAccessToken) },
        ai: await localAiState(normalized)
      };
    }
    case "SAVE_SETTINGS": {
      const [{ settings = {} }, local] = await Promise.all([
        getSync("settings"),
        getLocal(["githubAccessToken", "aiApiKey", "groqApiKey"])
      ]);
      const requested = { ...settings, ...(message.settings || {}) };
      const suppliedAiKey = String(message.aiApiKey || "").trim();
      if (requested.connected === true && !hasCompletedOnboarding(requested, local.githubAccessToken)) {
        throw new Error("Add a GitHub token and choose a repository before finishing setup.");
      }
      if (requested.aiEnabled === true && !suppliedAiKey && !local.aiApiKey && !local.groqApiKey) {
        throw new Error("Add an AI provider key before enabling AI explanations.");
      }
      const next = normalizeSettings({ ...requested, connected: hasCompletedOnboarding(requested, local.githubAccessToken) });
      await setSync({ settings: next });
      if (suppliedAiKey) await setLocal({ aiApiKey: suppliedAiKey });
      return { settings: next, ai: await localAiState(next) };
    }
    case "CONNECT_GITHUB_TOKEN": {
      const token = String(message.token || "").trim();
      if (!token) throw new Error("Paste a GitHub personal access token.");
      const [user, repos] = await Promise.all([verifyToken(token), listRepos(token)]);
      await setLocal({ githubAccessToken: token, githubUser: user });
      return { status: "connected", user, repos };
    }
    case "CREATE_REPO": {
      const accessToken = await getGitHubAccessToken();
      if (!accessToken) throw new Error("Add a GitHub token first.");
      return { repo: await createRepo(accessToken, message.repo || {}) };
    }
    case "LIST_REPOS": {
      const accessToken = await getGitHubAccessToken();
      if (!accessToken) throw new Error("Add a GitHub token first.");
      return { repos: await listRepos(accessToken) };
    }
    case "IMPORT_REPOSITORY": {
      const [accessToken, { settings }] = await Promise.all([
        getGitHubAccessToken(),
        getSync("settings")
      ]);
      if (!accessToken || !hasCompletedOnboarding(settings, accessToken)) {
        throw new Error("Finish GitHub setup before backfilling.");
      }
      const imported = await listSolutionFolders(accessToken, settings.owner, settings.repo, settings.branch);
      return { imported: imported.length, updated: 0, submissions: imported };
    }
    case "PUSH_SUBMISSION": {
      const [accessToken, { settings }] = await Promise.all([
        getGitHubAccessToken(),
        getSync("settings")
      ]);
      if (!accessToken || !hasCompletedOnboarding(settings, accessToken)) throw new Error("Finish GitHub setup first.");
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
      const [accessToken, { settings }] = await Promise.all([
        getGitHubAccessToken(),
        getSync("settings")
      ]);
      if (!hasCompletedOnboarding(settings, accessToken)) throw new Error("Finish GitHub setup first.");
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
      const [{ settings }, { githubAccessToken }] = await Promise.all([getSync("settings"), getLocal("githubAccessToken")]);
      if (!hasCompletedOnboarding(settings, githubAccessToken)) return { attempt: null };
      const allowed = new Set(["Accepted", "Wrong Answer", "Time Limit Exceeded", "Memory Limit Exceeded", "Runtime Error", "Compile Error", "Output Limit Exceeded"]);
      if (!allowed.has(message.submission?.status) || !message.submission?.code) return { attempt: null };
      return { attempt: await recordAttempt(message.submission) };
    }
    case "SAVE_NOTES": {
      const [accessToken, { settings }] = await Promise.all([
        getGitHubAccessToken(),
        getSync("settings")
      ]);
      if (!hasCompletedOnboarding(settings, accessToken)) throw new Error("Finish GitHub setup first.");
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
      const [accessToken, { settings }] = await Promise.all([
        getGitHubAccessToken(),
        getSync("settings")
      ]);
      if (!hasCompletedOnboarding(settings, accessToken)) throw new Error("Finish GitHub setup first.");
      if (settings?.spacedRepetition === false) throw new Error("Turn on spaced repetition in Settings to schedule reviews.");
      const id = String(message.id || "");
      const normalizedSettings = normalizeSettings(settings);
      return mutateRepository(async () => {
        const submissions = await repositorySubmissions(accessToken, normalizedSettings);
        const existing = submissions.find((item) => item.id === id);
        if (!existing) throw new Error("That review is no longer in your study queue.");
        const now = new Date();
        const updatedSubmission = message.type === "SNOOZE_REVIEW"
          ? snoozeReview(existing, now, 3)
          : scheduleReview(existing, message.type === "MARK_REVIEWED" ? "good" : message.rating, now, studyIntervalDays(settings));
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
    case "SIGN_OUT":
    case "DISCONNECT": {
      await clearAuthentication();
      return { ok: true };
    }
    case "CLEAR_AI_KEY": {
      await chrome.storage.local.remove(["aiApiKey", "groqApiKey", "llmUsage"]);
      const { settings = {} } = await getSync("settings");
      await setSync({ settings: { ...settings, aiEnabled: false, aiConsent: false } });
      return { ok: true };
    }
    case "DELETE_LOCAL_DATA":
    case "DELETE_ACCOUNT": {
      if (accountDeletionInProgress) throw new Error("Account deletion is already in progress.");
      accountDeletionInProgress = true;
      try {
        await Promise.allSettled([localMutationQueue, repositoryMutationQueue]);
        await clearLeetRepoStorage(chrome.storage);
        return { ok: true };
      } finally {
        accountDeletionInProgress = false;
      }
    }
    case "OPEN_DASHBOARD":
      {
        const [{ settings }, { githubAccessToken }] = await Promise.all([getSync("settings"), getLocal("githubAccessToken")]);
        const onboarded = hasCompletedOnboarding(settings, githubAccessToken);
        const path = onboarded ? "src/pages/dashboard/dashboard.html" : "src/pages/onboarding/onboarding.html";
        const query = onboarded && message.view === "study" ? "?view=study" : "";
        await chrome.tabs.create({ url: chrome.runtime.getURL(path) + query });
      }
      return { ok: true };
    case "OPEN_OPTIONS":
      {
        const [{ settings }, { githubAccessToken }] = await Promise.all([getSync("settings"), getLocal("githubAccessToken")]);
        if (hasCompletedOnboarding(settings, githubAccessToken)) await chrome.runtime.openOptionsPage();
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
