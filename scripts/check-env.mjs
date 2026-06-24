const validExecutionModes = new Set(["mock", "live", undefined]);

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

function run() {
  const executionMode = process.env.IMAGE_MODEL_EXECUTION;
  const provider = process.env.IMAGE_MODEL_PROVIDER || "openai";
  const model = process.env.OPENAI_IMAGE_MODEL || process.env.IMAGE_MODEL_NAME || "gpt-image-2";
  const baseUrl = process.env.IMAGE_MODEL_BASE_URL || "https://api.openai.com/v1";
  const apiKeySecretRef = process.env.IMAGE_MODEL_API_KEY_SECRET_REF || "OPENAI_API_KEY";

  if (!validExecutionModes.has(executionMode)) {
    fail("IMAGE_MODEL_EXECUTION must be either mock or live");
  }

  validateUrl(baseUrl, "IMAGE_MODEL_BASE_URL");

  if (executionMode === "live" && !process.env[apiKeySecretRef]) {
    fail(`IMAGE_MODEL_EXECUTION=live requires ${apiKeySecretRef}`);
  }

  if (provider !== "openai" && baseUrl === "https://api.openai.com/v1") {
    warn("custom provider is using the default OpenAI base URL; set IMAGE_MODEL_BASE_URL for a custom endpoint");
  }

  ok(`execution=${executionMode || "mock"} provider=${provider} model=${model} baseUrl=${baseUrl} keyRef=${apiKeySecretRef}`);
}

try {
  run();
} catch (error) {
  process.stderr.write(`[check:env] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
