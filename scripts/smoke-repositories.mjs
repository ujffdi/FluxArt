import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

const requiredModels = [
  "User",
  "UserCredential",
  "UserSession",
  "AuthRateLimitBucket",
  "CreditBucket",
  "CreditLedgerEntry",
  "CreditHold",
  "CreditPackSku",
  "Order",
  "PaymentNotification",
  "ImageUpload",
  "ImageTask",
  "ProviderSubmission",
  "ProviderResult",
  "ImageAsset",
  "AssetVersionNode",
  "DownloadEvent",
  "AssetCleanupJob",
  "ActiveImageModelConfiguration",
  "ModelConfigurationChange"
];

const requiredTables = [
  "users",
  "user_credentials",
  "user_sessions",
  "auth_rate_limit_buckets",
  "credit_buckets",
  "credit_ledger_entries",
  "credit_holds",
  "credit_pack_skus",
  "orders",
  "payment_notifications",
  "image_uploads",
  "image_tasks",
  "provider_submissions",
  "provider_results",
  "image_assets",
  "asset_version_nodes",
  "download_events",
  "asset_cleanup_jobs",
  "active_image_model_configurations",
  "model_configuration_changes"
];

function log(message) {
  process.stdout.write(`[smoke:repositories] ${message}\n`);
}

function fail(message) {
  throw new Error(message);
}

function expect(condition, message) {
  if (!condition) fail(message);
}

function expectSourceContains(source, snippet, message) {
  expect(source.includes(snippet), message);
}

function readMigrationSql() {
  return readdirSync("prisma/migrations", { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => `prisma/migrations/${entry.name}/migration.sql`)
    .sort()
    .map(file => readFileSync(file, "utf8"))
    .join("\n");
}

const repositoryCookies = new Map();

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(repositoryCookies.size ? { Cookie: [...repositoryCookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ") } : {}),
      ...options.headers
    }
  });
  const setCookies = response.headers.getSetCookie?.() || (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")] : []);
  for (const value of setCookies) {
    const [pair] = value.split(";");
    const [name, cookieValue] = pair.split("=");
    if (cookieValue) repositoryCookies.set(name, cookieValue);
    else repositoryCookies.delete(name);
  }
  const body = await response.json();
  return { response, body };
}

async function smokeApiRepositoryFlow(baseUrl) {
  const login = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: "demo", password: "demo-password-1" })
  });
  expect(login.response.status === 200, "repository API flow should log in before protected API checks");

  const assets = await request(baseUrl, "/api/image/assets");
  expect(assets.response.status === 200, "asset list should be readable through the repository boundary");
  expect(Array.isArray(assets.body.data.assets), "asset list should include assets array");

  const task = await request(baseUrl, "/api/image/tasks", {
    method: "POST",
    body: JSON.stringify({ taskType: "t2i", prompt: "repository smoke task", count: 1, size: "1024x1024" })
  });
  expect(task.response.status === 200, "task creation should create a repository record");
  const taskId = task.body.data.task.id;

  const taskDetail = await request(baseUrl, `/api/image/tasks/${taskId}`);
  expect(taskDetail.response.status === 200, "created task should be readable by id");
  expect(taskDetail.body.data.task.id === taskId, "created task id should round-trip");

  const order = await request(baseUrl, "/api/billing/orders", {
    method: "POST",
    body: JSON.stringify({ planId: "credits-500" })
  });
  expect(order.response.status === 200, "billing order should be creatable through the repository boundary");
  expect(order.body.data.order.outTradeNo, "billing order should include outTradeNo");
}

async function run() {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readMigrationSql();
  const adapter = readFileSync("src/server/data/prisma-adapter.ts", "utf8");

  for (const model of requiredModels) {
    expect(schema.includes(`model ${model} `), `schema should define model ${model}`);
  }

  for (const table of requiredTables) {
    expect(migration.includes(`CREATE TABLE \`${table}\``), `migration should create table ${table}`);
  }

  for (const table of requiredTables) {
    expect(schema.includes(`@@map("${table}")`), `schema should map a Prisma model to ${table}`);
  }

  const adapterSnippets = [
    ["prisma.imageAsset.findMany", "Prisma adapter should list image assets"],
    ["prisma.imageAsset.findUnique", "Prisma adapter should read one image asset"],
    ["prisma.imageAsset.create", "Prisma adapter should create image assets"],
    ["prisma.imageAsset.update", "Prisma adapter should update image assets"],
    ["prisma.assetCleanupJob.create", "Prisma adapter should create asset cleanup jobs"],
    ["prisma.imageTask.findMany", "Prisma adapter should list image tasks"],
    ["prisma.imageTask.findUnique", "Prisma adapter should read one image task"],
    ["prisma.imageTask.create", "Prisma adapter should create image tasks"],
    ["prisma.imageTask.update", "Prisma adapter should update image tasks"],
    ["prisma.user.findUnique", "Prisma adapter should read accounts"],
    ["prisma.user.create", "Prisma adapter should create accounts"],
    ["prisma.authRateLimitBucket.findUnique", "Prisma adapter should read auth rate limits"],
    ["prisma.authRateLimitBucket.create", "Prisma adapter should create auth rate limits"],
    ["prisma.authRateLimitBucket.update", "Prisma adapter should update auth rate limits"],
    ["prisma.$executeRawUnsafe", "Prisma adapter should use an atomic auth rate-limit write"],
    ["ON DUPLICATE KEY UPDATE", "Prisma adapter should atomically upsert auth rate limits"],
    ["prisma.creditBucket.findMany", "Prisma adapter should list credit buckets"],
    ["prisma.creditBucket.create", "Prisma adapter should create credit buckets"],
    ["prisma.creditBucket.update", "Prisma adapter should update credit buckets"],
    ["prisma.order.findMany", "Prisma adapter should list billing orders"],
    ["prisma.order.findUnique", "Prisma adapter should read billing orders"],
    ["prisma.order.create", "Prisma adapter should create billing orders"],
    ["prisma.order.update", "Prisma adapter should update billing orders"],
    ["fulfillCreditPackOrder", "Prisma adapter should expose transactional credit pack fulfillment"],
    ["tx.order.updateMany", "Prisma credit pack fulfillment should atomically claim orders before granting credits"],
    ["tx.creditBucket.create", "Prisma credit pack fulfillment should create purchased buckets in a transaction"],
    ["tx.creditLedgerEntry.create", "Prisma credit pack fulfillment should create ledger grants in a transaction"],
    ["client.activeImageModelConfiguration?.findMany", "Prisma adapter should read selectable image model configurations through generated delegates"],
    ["CREATE TABLE IF NOT EXISTS", "Prisma adapter should initialize missing model configuration tables before raw fallback queries"],
    ["INSERT INTO active_image_model_configurations", "Prisma adapter should raw-fallback upsert the active image model configuration"],
    ["UPDATE active_image_model_configurations", "Prisma adapter should raw-fallback update model test results"],
    ["client.modelConfigurationChange.create", "Prisma adapter should create model configuration change records through generated delegates"],
    ["INSERT INTO model_configuration_changes", "Prisma adapter should raw-fallback create model configuration change records"],
    ["client.modelConfigurationChange.findMany", "Prisma adapter should list model configuration change records through generated delegates"],
    ["FROM model_configuration_changes", "Prisma adapter should raw-fallback read model configuration change records"]
  ];

  for (const [snippet, message] of adapterSnippets) {
    expectSourceContains(adapter, snippet, message);
  }

  log(`validated ${requiredModels.length} Prisma models, ${requiredTables.length} MySQL tables, and ${adapterSnippets.length} adapter contract operations`);

  rmSync(".tmp/smoke-repositories", { recursive: true, force: true });
  mkdirSync(".tmp/smoke-repositories", { recursive: true });
  const tsc = spawnSync(
    "./node_modules/.bin/tsc",
    [
      "--module",
      "commonjs",
      "--noEmit",
      "false",
      "--incremental",
      "false",
      "--outDir",
      ".tmp/smoke-repositories"
    ],
    { stdio: "inherit" }
  );
  expect(tsc.status === 0, "repository smoke runner should compile");

  const runner = spawnSync("node", [".tmp/smoke-repositories/scripts/smoke-repositories-runner.js"], { stdio: "inherit" });
  expect(runner.status === 0, "repository smoke runner should prove Prisma adapter create/read/update/list behavior");
  rmSync(".tmp/smoke-repositories", { recursive: true, force: true });
  log("Prisma adapter contract runner passed");

  const baseUrl = process.env.REPOSITORY_SMOKE_BASE_URL || process.env.SMOKE_BASE_URL;
  if (!baseUrl) {
    log("skipping live repository API flow; set REPOSITORY_SMOKE_BASE_URL to include create/read/list checks");
    return;
  }

  await smokeApiRepositoryFlow(baseUrl);
  log("repository API flow checks passed");
}

run().catch(error => {
  process.stderr.write(`[smoke:repositories] ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
