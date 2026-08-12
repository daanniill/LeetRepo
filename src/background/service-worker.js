import { buildReview, DEFAULT_SETTINGS, isSubmissionPushReady, mergeSubmissionSolutions, normalizeSubmission, normalizeTheme, sameProblem } from "../core/submissions.js";
import { createRepo, listRepos, listSolutionFolders, pushSubmission, verifyToken } from "../core/github.js";
import { addTokenUsage, generateExplanation, LLM_PROVIDERS, normalizeDailyLimit, normalizeLlmBaseUrl, normalizeLlmModel, normalizeLlmProvider, reserveUsage, usageForToday } from "../core/llm.js";
import { hasCompletedOnboarding } from "../core/auth.js";
import { clearLeetRepoStorage } from "../core/storage.js";
import { normalizeStudyInterval, rescheduleFirstReview, reviewDateAfter, scheduleReview, snoozeReview, studyIntervalDays } from "../core/study.js";

const getLocal = (keys) => chrome.storage.local.get(keys);
const setLocal = (value) => chrome.storage.local.set(value);
const getSync = (keys) => chrome.storage.sync.get(keys);
const setSync = (value) => chrome.storage.sync.set(value);
let localMutationQueue = Promise.resolve();

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
  if (settings.includeReadme === false || !settings.aiEnabled) {
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
    const item = mergeSubmissionSolutions(existing, {
      ...normalized,
      solvedAt: existing.solvedAt || normalized.solvedAt || existing.syncedAt || syncedAt,
      review: review || normalized.review || buildReview(normalized),
      syncedAt,
      commitUrl: result.url,
      commitSha: result.sha
    });
    item.reviewDueAt = settings.spacedRepetition === false
      ? null
      : reviewDateAfter(syncedAt, studyIntervalDays(settings));
    const next = [item, ...submissions.filter((stored) => !sameProblem(stored, item))].slice(0, 500);
    await setLocal({ submissions: next, lastSubmission: item });
    return item;
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

async function handle(message) {
  switch (message.type) {
    case "GET_STATE": {
      const [{ settings }, local] = await Promise.all([
        getSync("settings"),
        getLocal(["submissions", "lastSubmission", "attempts", "submissionNotes", "githubAccessToken"])
      ]);
      const normalized = normalizeSettings(settings);
      const connected = hasCompletedOnboarding(normalized, local.githubAccessToken);
      return {
        settings: { ...normalized, connected },
        submissions: local.submissions || [],
        attempts: local.attempts || [],
        notes: local.submissionNotes || {},
        lastSubmission: local.lastSubmission || null,
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
      const previousInterval = normalizeStudyInterval(settings.studyIntervalValue, settings.studyIntervalUnit);
      if (previousInterval.value !== next.studyIntervalValue || previousInterval.unit !== next.studyIntervalUnit) {
        await mutateLocal(async () => {
          const { submissions = [], lastSubmission } = await getLocal(["submissions", "lastSubmission"]);
          const nextSubmissions = submissions.map((item) => rescheduleFirstReview(item, studyIntervalDays(next)));
          const nextLast = lastSubmission ? rescheduleFirstReview(lastSubmission, studyIntervalDays(next)) : lastSubmission;
          await setLocal({ submissions: nextSubmissions, lastSubmission: nextLast });
        });
      }
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
      return mutateLocal(async () => {
        const { submissions = [] } = await getLocal("submissions");
        const next = submissions.slice();
        let added = 0;
        let updated = 0;
        for (const importedItem of imported.map(normalizeSubmission)) {
          const index = next.findIndex((existing) => sameProblem(existing, importedItem));
          if (index === -1) {
            next.push(mergeSubmissionSolutions({}, importedItem));
            added += 1;
          } else {
            const merged = mergeSubmissionSolutions(next[index], importedItem);
            if (JSON.stringify(merged) !== JSON.stringify(next[index])) updated += 1;
            next[index] = merged;
          }
        }
        next.sort((left, right) => (Date.parse(right.syncedAt) || 0) - (Date.parse(left.syncedAt) || 0));
        await setLocal({ submissions: next.slice(0, 500) });
        return { imported: added, updated };
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
      const [{ settings }, { githubAccessToken }] = await Promise.all([getSync("settings"), getLocal("githubAccessToken")]);
      if (!hasCompletedOnboarding(settings, githubAccessToken)) throw new Error("Finish GitHub setup first.");
      const normalizedSettings = normalizeSettings(settings);
      const explanation = await explanationFor({ ...normalizedSettings, includeReadme: true }, message.submission);
      const review = explanation.review || buildReview(message.submission);
      const normalized = normalizeSubmission(message.submission);
      let updatedSubmission = null;
      await mutateLocal(async () => {
        const { submissions = [], lastSubmission } = await getLocal(["submissions", "lastSubmission"]);
        if (!submissions.some((item) => sameProblem(item, normalized))) return;
        const next = submissions.map((item) => {
          if (!sameProblem(item, normalized)) return item;
          updatedSubmission = mergeSubmissionSolutions(item, { ...normalized, review });
          return updatedSubmission;
        });
        const nextLast = lastSubmission && sameProblem(lastSubmission, normalized)
          ? mergeSubmissionSolutions(lastSubmission, { ...normalized, review })
          : lastSubmission;
        await setLocal({ submissions: next, lastSubmission: nextLast });
      });
      return { review, submission: updatedSubmission, ai: explanation.ai };
    }
    case "RECORD_ATTEMPT": {
      const [{ settings }, { githubAccessToken }] = await Promise.all([getSync("settings"), getLocal("githubAccessToken")]);
      if (!hasCompletedOnboarding(settings, githubAccessToken)) return { attempt: null };
      const allowed = new Set(["Accepted", "Wrong Answer", "Time Limit Exceeded", "Memory Limit Exceeded", "Runtime Error", "Compile Error", "Output Limit Exceeded"]);
      if (!allowed.has(message.submission?.status) || !message.submission?.code) return { attempt: null };
      return { attempt: await recordAttempt(message.submission) };
    }
    case "SAVE_NOTES": {
      const [{ settings }, { githubAccessToken }] = await Promise.all([getSync("settings"), getLocal("githubAccessToken")]);
      if (!hasCompletedOnboarding(settings, githubAccessToken)) throw new Error("Finish GitHub setup first.");
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
    case "MARK_REVIEWED":
    case "RATE_REVIEW": {
      const [{ settings }, { githubAccessToken }] = await Promise.all([getSync("settings"), getLocal("githubAccessToken")]);
      if (!hasCompletedOnboarding(settings, githubAccessToken)) throw new Error("Finish GitHub setup first.");
      if (settings?.spacedRepetition === false) throw new Error("Turn on spaced repetition in Settings to schedule reviews.");
      const id = String(message.id || "");
      return mutateLocal(async () => {
        const { submissions = [] } = await getLocal("submissions");
        const now = new Date();
        let updatedSubmission = null;
        const next = submissions.map((item) => {
          if (item.id !== id) return item;
          updatedSubmission = message.type === "SNOOZE_REVIEW"
            ? snoozeReview(item, now, 3)
            : scheduleReview(item, message.type === "MARK_REVIEWED" ? "good" : message.rating, now, studyIntervalDays(settings));
          return updatedSubmission;
        });
        if (!updatedSubmission) throw new Error("That review is no longer in your study queue.");
        await setLocal({ submissions: next });
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
      await localMutationQueue;
      await clearLeetRepoStorage(chrome.storage);
      return { ok: true };
    }
    case "OPEN_DASHBOARD":
      {
        const [{ settings }, { githubAccessToken }] = await Promise.all([getSync("settings"), getLocal("githubAccessToken")]);
        const path = hasCompletedOnboarding(settings, githubAccessToken)
          ? "src/pages/dashboard/dashboard.html"
          : "src/pages/onboarding/onboarding.html";
        await chrome.tabs.create({ url: chrome.runtime.getURL(path) });
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
