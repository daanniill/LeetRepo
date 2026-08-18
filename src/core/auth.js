export const LOCAL_AUTH_KEYS = [
  "leetrepoSessionToken",
  "githubAccessToken",
  "githubAccessTokenExpiresAt",
  "githubDeviceFlow",
  "githubToken",
  "githubUser"
];

export function hasCompletedOnboarding(settings = {}, sessionToken = "") {
  return Boolean(
    sessionToken
    && String(settings.owner || "").trim()
    && String(settings.repo || "").trim()
  );
}

export function settingsForSync(settings = {}) {
  const { connected: _connected, ...sharedSettings } = settings && typeof settings === "object" ? settings : {};
  return sharedSettings;
}

export async function clearDeviceAuthentication(storage) {
  await storage.local.remove(LOCAL_AUTH_KEYS);
}
