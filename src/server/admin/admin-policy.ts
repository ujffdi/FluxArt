function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export function modelAdminUsernames() {
  const configured = process.env.FLUXART_ADMIN_USERNAMES;
  const usernames = configured === undefined ? ["tongsr"] : configured.split(",");
  return new Set(usernames.map(normalizeUsername).filter(Boolean));
}

export function isModelAdminUsername(username: string) {
  return modelAdminUsernames().has(normalizeUsername(username));
}
