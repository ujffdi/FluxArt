const validExecutionModes = new Set(["mock", "live", undefined]);
const validDataModes = new Set(["mock", "prisma", undefined]);

function fail(message) {
  throw new Error(message);
}

function warn(message) {
  process.stdout.write(`[check:env] warning: ${message}\n`);
}

function ok(message) {
  process.stdout.write(`[check:env] ${message}\n`);
}

function validateUrl(value, name) {
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      fail(`${name} must use http or https`);
    }
  } catch {
    fail(`${name} must be a valid URL`);
  }
}

function validateSecret(value, name, options = {}) {
  if (!value) return;
  if (value.length < (options.minLength || 24)) {
    fail(`${name} must be at least ${options.minLength || 24} characters`);
  }
  if (/^(change-me|mock|test|secret|password|fluxart-local-session-secret)$/i.test(value)) {
    fail(`${name} must not use a placeholder value`);
  }
}

function validateMysqlUrl(value, name) {
  if (!value) return;
  try {
    const url = new URL(value);
    if (!["mysql:", "mysql2:"].includes(url.protocol)) {
      fail(`${name} must use mysql:// or mysql2://`);
    }
    if (!url.username || !url.hostname || !url.pathname || url.pathname === "/") {
      fail(`${name} must include username, host, and database name`);
    }
  } catch {
    fail(`${name} must be a valid MySQL connection URL`);
  }
}

function requireWhenProduction(value, name, mode) {
  if ((mode === "prisma" || process.env.NODE_ENV === "production") && !value) {
    fail(`${name} is required when FLUXART_DATA_MODE=prisma or NODE_ENV=production`);
  }
}

function run() {
  const executionMode = process.env.IMAGE_MODEL_EXECUTION;
  const dataMode = process.env.FLUXART_DATA_MODE || process.env.APP_DATA_MODE;
  const provider = process.env.IMAGE_MODEL_PROVIDER || "agnes";
  const model = process.env.IMAGE_MODEL_NAME || process.env.OPENAI_IMAGE_MODEL || "agnes-image-2.1-flash";
  const baseUrl = process.env.IMAGE_MODEL_BASE_URL || "https://apihub.agnes-ai.com/v1";
  const apiKeySecretRef = process.env.IMAGE_MODEL_API_KEY_SECRET_REF || "FLUXART_IMAGE_API_KEY";
  const minioEndpoint = process.env.MINIO_ENDPOINT;
  const minioPublicBaseUrl = process.env.MINIO_PUBLIC_BASE_URL;
  const mapayApiUrl = process.env.MAPAY_API_URL || process.env.EPAY_API_URL;
  const mapayMerchantId = process.env.MAPAY_MERCHANT_ID || process.env.EPAY_MERCHANT_ID;
  const mapaySigningSecret = process.env.MAPAY_SIGNING_SECRET || process.env.EPAY_SIGNING_SECRET;
  const mapayNotifyUrl = process.env.MAPAY_NOTIFY_URL || process.env.EPAY_NOTIFY_URL;
  const mapayReturnUrl = process.env.MAPAY_RETURN_URL || process.env.EPAY_RETURN_URL;
  const sessionSecret = process.env.FLUXART_SESSION_SECRET;
  const testToolsEnabled = process.env.FLUXART_ENABLE_TEST_TOOLS === "1";
  const testToolsSecret = process.env.FLUXART_TEST_TOOLS_SECRET;
  const testToolsMaxCreditDelta = process.env.FLUXART_TEST_TOOLS_MAX_CREDIT_DELTA;

  if (!validExecutionModes.has(executionMode)) {
    fail("IMAGE_MODEL_EXECUTION must be either mock or live");
  }

  if (!validDataModes.has(dataMode)) {
    fail("FLUXART_DATA_MODE must be either mock or prisma");
  }

  if (process.env.NODE_ENV === "production" && dataMode !== "prisma") {
    fail("NODE_ENV=production requires FLUXART_DATA_MODE=prisma");
  }

  if (dataMode === "prisma" && !process.env.DATABASE_URL) {
    fail("FLUXART_DATA_MODE=prisma or NODE_ENV=production requires DATABASE_URL");
  }

  validateMysqlUrl(process.env.DATABASE_URL, "DATABASE_URL");
  requireWhenProduction(minioEndpoint, "MINIO_ENDPOINT", dataMode);
  requireWhenProduction(process.env.MINIO_BUCKET, "MINIO_BUCKET", dataMode);
  requireWhenProduction(process.env.MINIO_ACCESS_KEY, "MINIO_ACCESS_KEY", dataMode);
  requireWhenProduction(process.env.MINIO_SECRET_KEY, "MINIO_SECRET_KEY", dataMode);
  requireWhenProduction(minioPublicBaseUrl, "MINIO_PUBLIC_BASE_URL", dataMode);
  requireWhenProduction(sessionSecret, "FLUXART_SESSION_SECRET", dataMode);
  requireWhenProduction(mapayApiUrl, "MAPAY_API_URL", dataMode);
  requireWhenProduction(mapayMerchantId, "MAPAY_MERCHANT_ID", dataMode);
  requireWhenProduction(mapaySigningSecret, "MAPAY_SIGNING_SECRET", dataMode);
  requireWhenProduction(mapayNotifyUrl, "MAPAY_NOTIFY_URL", dataMode);
  requireWhenProduction(mapayReturnUrl, "MAPAY_RETURN_URL", dataMode);

  validateUrl(baseUrl, "IMAGE_MODEL_BASE_URL");
  validateUrl(minioEndpoint, "MINIO_ENDPOINT");
  validateUrl(minioPublicBaseUrl, "MINIO_PUBLIC_BASE_URL");
  validateUrl(mapayApiUrl, "MAPAY_API_URL");
  validateUrl(mapayNotifyUrl, "MAPAY_NOTIFY_URL");
  validateUrl(mapayReturnUrl, "MAPAY_RETURN_URL");
  validateSecret(sessionSecret, "FLUXART_SESSION_SECRET", { minLength: 32 });
  validateSecret(process.env.MINIO_SECRET_KEY, "MINIO_SECRET_KEY", { minLength: 16 });
  validateSecret(mapaySigningSecret, "MAPAY_SIGNING_SECRET", { minLength: 16 });
  validateSecret(testToolsSecret, "FLUXART_TEST_TOOLS_SECRET", { minLength: 24 });

  if (testToolsEnabled && !testToolsSecret) {
    fail("FLUXART_TEST_TOOLS_SECRET is required when FLUXART_ENABLE_TEST_TOOLS=1");
  }
  if (testToolsEnabled && process.env.NODE_ENV === "production") {
    fail("FLUXART_ENABLE_TEST_TOOLS=1 is only allowed for local development, never NODE_ENV=production");
  }
  if (testToolsEnabled && !process.env.FLUXART_TEST_TOOLS_ALLOWED_USERNAMES) {
    warn("FLUXART_TEST_TOOLS_ALLOWED_USERNAMES is not set; test tools default to tongsr only");
  }
  if (testToolsMaxCreditDelta && (!Number.isInteger(Number(testToolsMaxCreditDelta)) || Number(testToolsMaxCreditDelta) <= 0)) {
    fail("FLUXART_TEST_TOOLS_MAX_CREDIT_DELTA must be a positive integer");
  }

  if (executionMode === "live" && !process.env[apiKeySecretRef]) {
    fail(`IMAGE_MODEL_EXECUTION=live requires ${apiKeySecretRef}`);
  }
  if (executionMode === "live") validateSecret(process.env[apiKeySecretRef], apiKeySecretRef, { minLength: 8 });

  if (provider === "custom" && executionMode === "live") {
    if (!process.env.IMAGE_MODEL_NAME || model === "agnes-image-2.1-flash") {
      fail("live custom providers require IMAGE_MODEL_NAME");
    }
    if (!process.env.IMAGE_MODEL_BASE_URL || baseUrl === "https://apihub.agnes-ai.com/v1") {
      fail("live custom providers require a custom IMAGE_MODEL_BASE_URL");
    }
    if (!process.env.IMAGE_MODEL_API_KEY_SECRET_REF || apiKeySecretRef === "FLUXART_IMAGE_API_KEY") {
      fail("live custom providers require IMAGE_MODEL_API_KEY_SECRET_REF that references the custom provider secret");
    }
  } else if (provider === "custom" && baseUrl === "https://apihub.agnes-ai.com/v1") {
    warn("custom provider is using the default Agnes base URL; set IMAGE_MODEL_BASE_URL for a custom endpoint before live execution");
  }

  if (!minioEndpoint) warn("MINIO_ENDPOINT is not set; asset storage remains in local mock mode");
  if (!mapayApiUrl) warn("MAPAY_API_URL is not set; payment adapter remains in local mock mode");
  if (!sessionSecret) warn("FLUXART_SESSION_SECRET is not set; local session hashes use a development-only fallback");

  ok(`data=${dataMode || "mock"} execution=${executionMode || "mock"} provider=${provider} model=${model} baseUrl=${baseUrl} keyRef=${apiKeySecretRef}`);
}

try {
  run();
} catch (error) {
  process.stderr.write(`[check:env] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
