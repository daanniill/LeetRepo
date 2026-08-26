export const LOCAL_AUTH_KEYS = ["githubAccessToken", "githubUser"];

export function hasCompletedOnboarding(settings = {}, githubToken = "") {
  return Boolean(
    githubToken
    && settings?.connected === true
    && String(settings.owner || "").trim()
    && String(settings.repo || "").trim()
  );
}

export function settingsForSync(settings = {}, synchronizedSettings = {}) {
  const sharedSettings = settings && typeof settings === "object" ? settings : {};
  return {
    ...sharedSettings,
    connected: sharedSettings.connected === true || synchronizedSettings?.connected === true
  };
}

export async function clearDeviceAuthentication(storage) {
  await storage.local.remove(LOCAL_AUTH_KEYS);
}
