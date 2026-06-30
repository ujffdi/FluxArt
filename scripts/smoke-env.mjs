import { spawnSync } from "node:child_process";

function runCheck(env) {
  return spawnSync(process.execPath, ["scripts/check-env.mjs"], {
    env: { ...process.env, ...env },
    encoding: "utf8"
  });
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const productionEnv = {
  NODE_ENV: "production",
  FLUXART_DATA_MODE: "prisma",
  DATABASE_URL: "mysql://fluxart:strong-password@db.example.com:3306/fluxart",
  FLUXART_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  MINIO_ENDPOINT: "https://minio.example.com",
  MINIO_PUBLIC_BASE_URL: "https://cdn.example.com/fluxart",
  MINIO_BUCKET: "fluxart-assets",
  MINIO_ACCESS_KEY: "minio-access-key",
  MINIO_SECRET_KEY: "minio-secret-key-123",
  IMAGE_MODEL_EXECUTION: "live",
  IMAGE_MODEL_PROVIDER: "agnes",
  IMAGE_MODEL_NAME: "agnes-image-2.1-flash",
  IMAGE_MODEL_BASE_URL: "https://apihub.agnes-ai.com/v1",
  IMAGE_MODEL_API_KEY_SECRET_REF: "FLUXART_IMAGE_API_KEY",
  FLUXART_IMAGE_API_KEY: "agnes-test-valid-for-env-smoke",
  MAPAY_API_URL: "https://mzf.mapay.cc",
  MAPAY_MERCHANT_ID: "merchant-123",
  MAPAY_SIGNING_SECRET: "mapay-signing-secret-123",
  MAPAY_NOTIFY_URL: "https://app.example.com/api/payments/mapay/notify",
  MAPAY_RETURN_URL: "https://app.example.com/workspace/billing"
};

const production = runCheck(productionEnv);
expect(production.status === 0, `production env should pass: ${production.stderr || production.stdout}`);

const missingSessionSecret = runCheck({ ...productionEnv, FLUXART_SESSION_SECRET: "" });
expect(missingSessionSecret.status !== 0 && missingSessionSecret.stderr.includes("FLUXART_SESSION_SECRET"), "missing session secret should fail production env validation");

const placeholderMapaySecret = runCheck({ ...productionEnv, MAPAY_SIGNING_SECRET: "secret" });
expect(placeholderMapaySecret.status !== 0 && placeholderMapaySecret.stderr.includes("MAPAY_SIGNING_SECRET"), "placeholder MaPay secret should fail env validation");

const incompleteCustomProvider = runCheck({
  ...productionEnv,
  IMAGE_MODEL_PROVIDER: "custom",
  IMAGE_MODEL_NAME: "",
  IMAGE_MODEL_BASE_URL: "",
  IMAGE_MODEL_API_KEY_SECRET_REF: ""
});
expect(incompleteCustomProvider.status !== 0 && incompleteCustomProvider.stderr.includes("IMAGE_MODEL_NAME"), "live custom provider should require explicit custom provider settings");

const customProvider = runCheck({
  ...productionEnv,
  IMAGE_MODEL_PROVIDER: "custom",
  IMAGE_MODEL_NAME: "custom-image-model",
  IMAGE_MODEL_BASE_URL: "https://provider.example.com/v1",
  IMAGE_MODEL_API_KEY_SECRET_REF: "CUSTOM_PROVIDER_API_KEY",
  CUSTOM_PROVIDER_API_KEY: "custom-provider-key"
});
expect(customProvider.status === 0, `complete custom provider env should pass: ${customProvider.stderr || customProvider.stdout}`);

process.stdout.write("[smoke:env] all checks passed\n");
