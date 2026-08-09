export function assertSafeGitHubAppPermissions(installations = []) {
  const hasAdministrationAccess = installations.some((installation) => installation?.permissions?.administration);
  if (hasAdministrationAccess) {
    throw new Error("LeetRepo's GitHub App must not request Repository administration permission.");
  }
}
