import type { AccountEntitlement } from "@/types/image";

export interface AuthAccount {
  userId: string;
  username: string;
  displayName: string;
  memberStatus: AccountEntitlement["memberStatus"];
  isModelAdmin: boolean;
}

export interface AuthSession {
  sessionId: string;
  userId: string;
  slidingExpiresAt: string;
  absoluteExpiresAt: string;
}

export interface AuthResult {
  account: AuthAccount;
  session: AuthSession;
  sessionToken: string;
}

export interface CurrentSessionResult {
  account: AuthAccount;
  session: AuthSession;
}
