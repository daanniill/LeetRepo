export function hasCompletedOnboarding(settings = {}, githubToken = "") {
  return Boolean(
    githubToken
    && settings?.connected === true
    && String(settings.owner || "").trim()
    && String(settings.repo || "").trim()
  );
}
