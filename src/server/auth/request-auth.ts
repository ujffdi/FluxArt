import { cookies } from "next/headers";
import { getCurrentSession, serializeSessionCookie, sessionCookieName, sessionSlidingTtlMs } from "@/server/auth/auth-service";
import type { CurrentSessionResult } from "@/types/auth";

export async function getSessionTokenFromCookies() {
  return (await cookies()).get(sessionCookieName)?.value;
}

export async function getRequestSession() {
  const sessionToken = await getSessionTokenFromCookies();
  const session = await getCurrentSession(sessionToken);
  return session && sessionToken ? { ...session, sessionToken } : undefined;
}

export async function requireRequestSession() {
  const session = await getRequestSession();
  if (!session) throw new Error("AUTH_REQUIRED");
  return session;
}

export async function requireRequestUserId() {
  return (await requireRequestSession()).account.userId;
}

export function renewSessionCookie<T extends Response>(response: T, sessionToken: string, session?: CurrentSessionResult["session"]): T {
  const remainingAbsoluteMs = session ? Date.parse(session.absoluteExpiresAt) - Date.now() : sessionSlidingTtlMs;
  const maxAgeSeconds = Math.max(0, Math.floor(Math.min(sessionSlidingTtlMs, remainingAbsoluteMs) / 1000));
  response.headers.append("Set-Cookie", serializeSessionCookie(sessionToken, maxAgeSeconds));
  return response;
}
