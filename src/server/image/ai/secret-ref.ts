import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const secretValuePatterns = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g
];

const encryptedSecretPrefix = "enc:v1:";
const environmentVariableNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const preferredSecretRefs = [
  "FLUXART_IMAGE_API_KEY",
  "OPENAI_API_KEY",
  "CUSTOM_PROVIDER_API_KEY"
];

function base64Url(buffer: Buffer) {
  return buffer.toString("base64url");
}

function secretEncryptionKey() {
  const material = process.env.FLUXART_MODEL_SECRET_KEY
    || process.env.FLUXART_SESSION_SECRET
    || process.env.FLUXART_ADMIN_SECRET
    || (process.env.NODE_ENV === "production" ? "" : "fluxart-local-model-secret");
  if (!material) {
    throw new Error("FLUXART_MODEL_SECRET_KEY or FLUXART_SESSION_SECRET is required to store model API keys from the admin form");
  }
  return createHash("sha256").update(material).digest();
}

export function redactSecretValues(value: string) {
  return secretValuePatterns.reduce(
    (redacted, pattern) => redacted.replace(pattern, "sk-...[redacted]"),
    value
  );
}

export function looksLikeSecretValue(value: string) {
  return secretValuePatterns.some(pattern => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

export function isEnvironmentSecretRef(value: string) {
  return environmentVariableNamePattern.test(value);
}

export function isEncryptedSecretRef(value: string) {
  return value.startsWith(encryptedSecretPrefix);
}

export function encryptSecretValue(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${encryptedSecretPrefix}${base64Url(iv)}.${base64Url(tag)}.${base64Url(ciphertext)}`;
}

export function decryptSecretRef(value: string) {
  if (!isEncryptedSecretRef(value)) return undefined;
  const [ivText, tagText, ciphertextText] = value.slice(encryptedSecretPrefix.length).split(".");
  if (!ivText || !tagText || !ciphertextText) {
    throw new Error("Stored model API key is invalid");
  }
  const decipher = createDecipheriv("aes-256-gcm", secretEncryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export function resolveEnvironmentSecretRef(value: string) {
  if (!looksLikeSecretValue(value)) return undefined;
  for (const key of preferredSecretRefs) {
    if (process.env[key] === value) return key;
  }
  return Object.entries(process.env).find(([key, candidate]) => {
    return isEnvironmentSecretRef(key) && candidate === value;
  })?.[0];
}

export function normalizeSecretRef(value: string) {
  if (isEncryptedSecretRef(value)) return value;
  const existingRef = resolveEnvironmentSecretRef(value);
  if (existingRef) return existingRef;
  return looksLikeSecretValue(value) ? encryptSecretValue(value) : value;
}

export function resolveApiKeySecret(value: string) {
  const normalized = normalizeSecretRef(value);
  if (isEncryptedSecretRef(normalized)) return decryptSecretRef(normalized);
  if (looksLikeSecretValue(normalized)) return normalized;
  return process.env[normalized];
}

export function liveSecretRefProblem(value: string) {
  if (isEncryptedSecretRef(value)) {
    try {
      decryptSecretRef(value);
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : "Stored model API key is invalid";
    }
  }
  if (looksLikeSecretValue(value)) {
    if (resolveEnvironmentSecretRef(value)) return undefined;
    return undefined;
  }
  if (!isEnvironmentSecretRef(value)) {
    return "apiKeySecretRef must be an environment variable name like OPENAI_API_KEY, or a model API key entered from the admin form";
  }
  return undefined;
}
