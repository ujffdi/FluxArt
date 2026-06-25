import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { getRepositories } from "@/server/data/repositories";
import type { AuthAccount, AuthResult, CurrentSessionResult } from "@/types/auth";

const scrypt = promisify(scryptCallback);

export const sessionCookieName = "fluxart_session";
export const sessionSlidingTtlMs = 30 * 24 * 60 * 60 * 1000;
export const sessionAbsoluteTtlMs = 90 * 24 * 60 * 60 * 1000;
export const maxActiveSessions = 5;

const usernamePattern = /^[a-zA-Z][a-zA-Z0-9_]{2,31}$/;
const passwordHashVersion = "scrypt-v1";
const authRateLimitWindowMs = 5 * 60 * 1000;
const authRateLimitUsernameMaxAttempts = 20;
const authRateLimitIpMaxAttempts = 80;
const authRateLimitGlobalMaxAttempts = 1000;

interface AuthRateLimitScope {
  scope: string;
  maxAttempts: number;
}

export class AuthServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "AuthServiceError";
    this.code = code;
    this.status = status;
  }
}

function now() {
  return new Date();
}

function iso(date: Date) {
  return date.toISOString();
}

function addMs(date: Date, ms: number) {
  return new Date(date.getTime() + ms);
}

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

async function assertAuthRateLimit(scopes: AuthRateLimitScope[]) {
  const current = now();
  const nowIso = iso(current);
  const resetAt = iso(addMs(current, authRateLimitWindowMs));

  for (const item of scopes) {
    const bucket = await getRepositories().auth.consumeRateLimit({
      scope: item.scope.toLowerCase(),
      now: nowIso,
      resetAt,
      maxAttempts: item.maxAttempts
    });

    if (!bucket.allowed) {
      throw new AuthServiceError("too many authentication attempts, please try again later", "AUTH_RATE_LIMITED", 429);
    }
  }
}

function authRateLimitScopes(kind: "login" | "register", username: string, ipAddress?: string) {
  return [
    { scope: `${kind}:global`, maxAttempts: authRateLimitGlobalMaxAttempts },
    { scope: `${kind}:username:${username}`, maxAttempts: authRateLimitUsernameMaxAttempts },
    ...(ipAddress ? [{ scope: `${kind}:ip:${ipAddress}`, maxAttempts: authRateLimitIpMaxAttempts }] : [])
  ];
}

export function validateUsername(username: string) {
  const normalized = normalizeUsername(username);
  if (!usernamePattern.test(normalized)) {
    throw new AuthServiceError("username must start with a letter and contain 3-32 letters, numbers, or underscores", "USERNAME_INVALID");
  }
  return normalized;
}

function validatePassword(password: string) {
  if (password.length < 8 || password.length > 128) {
    throw new AuthServiceError("password must be between 8 and 128 characters", "PASSWORD_INVALID");
  }
}

function sessionSecret() {
  return process.env.FLUXART_SESSION_SECRET || "fluxart-local-session-secret";
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${passwordHashVersion}$${salt}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encodedHash: string) {
  const [version, salt, digest] = encodedHash.split("$");
  if (version !== passwordHashVersion || !salt || !digest) return false;
  const derived = await scrypt(password, salt, 64) as Buffer;
  const expected = Buffer.from(digest, "base64url");
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(`${sessionSecret()}:${token}`).digest("hex");
}

function toAuthAccount(input: { id: string; username: string; displayName: string; memberStatus: AuthAccount["memberStatus"] }): AuthAccount {
  return {
    userId: input.id,
    username: input.username,
    displayName: input.displayName,
    memberStatus: input.memberStatus
  };
}

async function enforceSessionLimit(userId: string, createdSessionId: string, nowIso: string) {
  const repositories = getRepositories();
  const sessions = await repositories.auth.listActiveSessions(userId, nowIso);
  const overflow = sessions.filter(session => session.id !== createdSessionId).slice(0, Math.max(0, sessions.length - maxActiveSessions));
  await Promise.all(overflow.map(session => repositories.auth.revokeSession(session.id, nowIso)));
}

async function createSession(userId: string, metadata: { userAgent?: string; ipAddress?: string } = {}) {
  const repositories = getRepositories();
  const { sessionToken, session: sessionInput } = createSessionInput(metadata);
  const session = await repositories.auth.createSession({ ...sessionInput, userId });

  await enforceSessionLimit(userId, session.id, session.createdAt);

  return {
    sessionToken,
    session: {
      sessionId: session.id,
      userId: session.userId,
      slidingExpiresAt: session.slidingExpiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt
    }
  };
}

function createSessionInput(metadata: { userAgent?: string; ipAddress?: string } = {}) {
  const issuedAt = now();
  const sessionToken = randomBytes(32).toString("base64url");
  return {
    sessionToken,
    session: {
      id: `sess-${randomUUID()}`,
      tokenHash: hashSessionToken(sessionToken),
      slidingExpiresAt: iso(addMs(issuedAt, sessionSlidingTtlMs)),
      absoluteExpiresAt: iso(addMs(issuedAt, sessionAbsoluteTtlMs)),
      userAgent: metadata.userAgent,
      ipAddress: metadata.ipAddress,
      createdAt: iso(issuedAt),
      updatedAt: iso(issuedAt)
    }
  };
}

export async function registerSelfDeclaredAccount(input: {
  username: string;
  password: string;
  displayName?: string;
  userAgent?: string;
  ipAddress?: string;
}): Promise<AuthResult> {
  const repositories = getRepositories();
  const username = validateUsername(input.username);
  validatePassword(input.password);
  await assertAuthRateLimit(authRateLimitScopes("register", username, input.ipAddress));

  if (await repositories.auth.getCredentialByUsername(username)) {
    throw new AuthServiceError("username is already taken", "USERNAME_TAKEN", 409);
  }

  const createdAt = iso(now());
  const passwordHash = await hashPassword(input.password);
  const registrationBucketId = `bucket-${randomUUID()}`;
  const { sessionToken, session: sessionInput } = createSessionInput({
    userAgent: input.userAgent,
    ipAddress: input.ipAddress
  });
  const registration = await repositories.auth.createRegistration({
    user: {
      username,
      displayName: input.displayName?.trim() || username,
      memberStatus: "free"
    },
    credential: {
      id: `cred-${randomUUID()}`,
      passwordHash,
      hashVersion: passwordHashVersion,
      passwordChangedAt: createdAt
    },
    creditBucket: {
      id: registrationBucketId,
      sourceType: "registration",
      creditType: "promotional",
      originalAmount: 50,
      remainingAmount: 50,
      validFrom: createdAt,
      validUntil: iso(addMs(new Date(createdAt), sessionAbsoluteTtlMs)),
      priority: 10,
      createdAt,
      updatedAt: createdAt
    },
    ledgerEntry: {
      id: `ledger-${randomUUID()}`,
      entryType: "grant",
      amount: 50,
      balanceAfter: 50,
      sourceRefType: "registration",
      label: "Registration Credit Grant",
      createdAt
    },
    session: sessionInput
  });

  return {
    account: toAuthAccount({ id: registration.user.id, username, displayName: registration.user.displayName, memberStatus: registration.user.memberStatus }),
    session: {
      sessionId: registration.session.id,
      userId: registration.session.userId,
      slidingExpiresAt: registration.session.slidingExpiresAt,
      absoluteExpiresAt: registration.session.absoluteExpiresAt
    },
    sessionToken
  };
}

export async function loginWithPassword(input: {
  username: string;
  password: string;
  userAgent?: string;
  ipAddress?: string;
}): Promise<AuthResult> {
  const repositories = getRepositories();
  const username = validateUsername(input.username);
  await assertAuthRateLimit(authRateLimitScopes("login", username, input.ipAddress));
  const credential = await repositories.auth.getCredentialByUsername(username);
  if (!credential || !(await verifyPassword(input.password, credential.passwordHash))) {
    throw new AuthServiceError("username or password is incorrect", "INVALID_CREDENTIALS", 401);
  }

  const user = await repositories.account.getUserById(credential.userId);
  if (!user || user.status !== "active") {
    throw new AuthServiceError("account is unavailable", "ACCOUNT_UNAVAILABLE", 403);
  }

  const { sessionToken, session } = await createSession(user.id, {
    userAgent: input.userAgent,
    ipAddress: input.ipAddress
  });

  return {
    account: toAuthAccount({ id: user.id, username: credential.username, displayName: user.displayName, memberStatus: user.memberStatus }),
    session,
    sessionToken
  };
}

export async function getCurrentSession(sessionToken?: string | null): Promise<CurrentSessionResult | undefined> {
  if (!sessionToken) return undefined;
  const repositories = getRepositories();
  const nowIso = iso(now());
  const session = await repositories.auth.getSessionByTokenHash(hashSessionToken(sessionToken));
  if (!session || session.revokedAt || session.slidingExpiresAt <= nowIso || session.absoluteExpiresAt <= nowIso) return undefined;

  const nextSlidingExpiry = iso(new Date(Math.min(Date.now() + sessionSlidingTtlMs, Date.parse(session.absoluteExpiresAt))));
  if (nextSlidingExpiry > session.slidingExpiresAt) {
    await repositories.auth.touchSession(session.id, nextSlidingExpiry);
    session.slidingExpiresAt = nextSlidingExpiry;
  }

  const user = await repositories.account.getUserById(session.userId);
  const credential = await repositories.auth.getCredentialByUserId(session.userId);
  if (!user || !credential) return undefined;

  return {
    account: toAuthAccount({ id: user.id, username: credential.username, displayName: user.displayName, memberStatus: user.memberStatus }),
    session: {
      sessionId: session.id,
      userId: session.userId,
      slidingExpiresAt: session.slidingExpiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt
    }
  };
}

export async function changePassword(input: {
  userId: string;
  currentPassword: string;
  nextPassword: string;
}): Promise<void> {
  const repositories = getRepositories();
  validatePassword(input.nextPassword);
  const credential = await repositories.auth.getCredentialByUserId(input.userId);
  if (!credential || !(await verifyPassword(input.currentPassword, credential.passwordHash))) {
    throw new AuthServiceError("current password is incorrect", "INVALID_CREDENTIALS", 401);
  }

  const changedAt = iso(now());
  await repositories.auth.updatePasswordHash(input.userId, await hashPassword(input.nextPassword), changedAt);
  await repositories.auth.revokeUserSessions(input.userId, changedAt);
}

export async function logoutSession(sessionToken?: string | null): Promise<void> {
  if (!sessionToken) return;
  const repositories = getRepositories();
  const session = await repositories.auth.getSessionByTokenHash(hashSessionToken(sessionToken));
  if (session && !session.revokedAt) {
    await repositories.auth.revokeSession(session.id, iso(now()));
  }
}

export function getSessionCookieOptions(maxAgeSeconds = Math.floor(sessionSlidingTtlMs / 1000)) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds
  };
}

export function serializeSessionCookie(value: string, maxAgeSeconds?: number) {
  const options = getSessionCookieOptions(maxAgeSeconds);
  const parts = [
    `${sessionCookieName}=${value}`,
    `Max-Age=${options.maxAge}`,
    `Path=${options.path}`,
    "SameSite=Lax",
    "HttpOnly"
  ];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}
