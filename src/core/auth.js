export function hasCompletedOnboarding(settings = {}, sessionToken = "") {
  return Boolean(
    sessionToken
    && settings?.connected === true
    && String(settings.owner || "").trim()
    && String(settings.repo || "").trim()
  );
}
