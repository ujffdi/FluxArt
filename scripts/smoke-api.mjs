import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const explicitBaseUrl = process.env.SMOKE_BASE_URL;
const port = process.env.SMOKE_PORT || "3117";
const baseUrl = explicitBaseUrl || `http://127.0.0.1:${port}`;
const nextBin = "./node_modules/.bin/next";
const buildMarker = ".next/BUILD_ID";

let serverProcess;

function log(message) {
  process.stdout.write(`[smoke:api] ${message}\n`);
}

function fail(message) {
  throw new Error(message);
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  const text = await response.text();
  let body;

  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  return { response, body };
}

function expectStatus(result, expectedStatus, label) {
  if (result.response.status !== expectedStatus) {
    fail(`${label}: expected HTTP ${expectedStatus}, received ${result.response.status} with ${JSON.stringify(result.body)}`);
  }
}

function expectApiCode(result, expectedCode, label) {
  if (!result.body || result.body.code !== expectedCode) {
    fail(`${label}: expected API code ${expectedCode}, received ${JSON.stringify(result.body)}`);
  }
}

function expect(condition, label) {
  if (!condition) fail(label);
}

async function waitForServer() {
  const deadline = Date.now() + 30000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const result = await request("/api/image/assets");
      if (result.response.ok) return;
      lastError = new Error(`HTTP ${result.response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }

  throw new Error(`server did not become ready at ${baseUrl}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function startServerIfNeeded() {
  if (explicitBaseUrl) return;
  if (!existsSync(nextBin)) {
    fail("Next.js binary not found. Run npm install before npm run smoke:api.");
  }
  if (!existsSync(buildMarker)) {
    fail("Production build not found. Run npm run build before npm run smoke:api, or pass SMOKE_BASE_URL for an already running server.");
  }

  serverProcess = spawn(nextBin, ["start", "-H", "127.0.0.1", "-p", port], {
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"]
  });

  serverProcess.stdout.on("data", chunk => {
    const text = chunk.toString();
    if (process.env.SMOKE_VERBOSE === "1") process.stdout.write(text);
  });
  serverProcess.stderr.on("data", chunk => {
    const text = chunk.toString();
    if (process.env.SMOKE_VERBOSE === "1") process.stderr.write(text);
  });
}

async function stopServer() {
  if (!serverProcess) return;
  serverProcess.kill("SIGTERM");
  await delay(300);
  if (!serverProcess.killed) serverProcess.kill("SIGKILL");
}

async function runSmoke() {
  log(`using ${baseUrl}`);
  startServerIfNeeded();
  await waitForServer();

  const assets = await request("/api/image/assets");
  expectStatus(assets, 200, "list assets");
  expectApiCode(assets, 200, "list assets");
  expect(Array.isArray(assets.body.data.assets) && assets.body.data.assets.length >= 1, "list assets should return assets");
  expect(assets.body.data.pagination.total >= assets.body.data.assets.length, "list assets should include pagination totals");

  const filteredAssets = await request("/api/image/assets?taskType=outpaint&status=processing&page=1&pageSize=2");
  expectStatus(filteredAssets, 200, "filtered assets");
  expect(filteredAssets.body.data.assets.length === 1, "filtered assets should return the processing outpaint asset");
  expect(filteredAssets.body.data.assets[0].id === "IMG-2088", "filtered assets should match IMG-2088");

  const invalidAssetStatus = await request("/api/image/assets?status=bad_status");
  expectStatus(invalidAssetStatus, 400, "invalid asset status");
  expect(invalidAssetStatus.body.data.errorCode === "ASSET_STATUS_UNSUPPORTED", "invalid asset status should return ASSET_STATUS_UNSUPPORTED");

  const assetDetail = await request("/api/image/assets/IMG-1832");
  expectStatus(assetDetail, 200, "asset detail");
  expect(assetDetail.body.data.detail.asset.id === "IMG-1832", "asset detail should return requested asset");
  expect(assetDetail.body.data.detail.downloadDecision.allowed === true, "asset detail should include allowed download decision");

  const missingAsset = await request("/api/image/assets/NOPE");
  expectStatus(missingAsset, 404, "missing asset");
  expect(missingAsset.body.data.errorCode === "ASSET_NOT_FOUND", "missing asset should return ASSET_NOT_FOUND");

  const tasks = await request("/api/image/tasks");
  expectStatus(tasks, 200, "list tasks");
  expect(Array.isArray(tasks.body.data.tasks), "list tasks should return an array");
  expect(tasks.body.data.pagination.total >= tasks.body.data.tasks.length, "list tasks should include pagination totals");

  const filteredTasks = await request("/api/image/tasks?taskType=outpaint&status=processing&page=1&pageSize=1");
  expectStatus(filteredTasks, 200, "filtered tasks");
  expect(filteredTasks.body.data.tasks.length === 1, "filtered tasks should return one item for pageSize=1");
  expect(filteredTasks.body.data.tasks[0].id === "TSK-240618-1105", "filtered tasks should match TSK-240618-1105");

  const invalidTaskPage = await request("/api/image/tasks?page=0");
  expectStatus(invalidTaskPage, 400, "invalid task page");
  expect(invalidTaskPage.body.data.errorCode === "PAGE_INVALID", "invalid task page should return PAGE_INVALID");

  const taskDetail = await request("/api/image/tasks/TSK-240618-0912");
  expectStatus(taskDetail, 200, "task detail");
  expect(taskDetail.body.data.task.id === "TSK-240618-0912", "task detail should return requested task");

  const missingTask = await request("/api/image/tasks/NOPE");
  expectStatus(missingTask, 404, "missing task");
  expect(missingTask.body.data.errorCode === "TASK_NOT_FOUND", "missing task should return TASK_NOT_FOUND");

  const createdTask = await request("/api/image/tasks", {
    method: "POST",
    body: JSON.stringify({ taskType: "t2i", prompt: "api smoke task", count: 1, size: "1024x1024" })
  });
  expectStatus(createdTask, 200, "create task");
  expect(createdTask.body.data.task.modelProvider === "openai", "create task should use openai provider by default");
  expect(createdTask.body.data.task.modelName === "gpt-image-2", "create task should use gpt-image-2 by default");

  const invalidTask = await request("/api/image/tasks", {
    method: "POST",
    body: JSON.stringify({ taskType: "bad_task", prompt: "api smoke task", count: 1, size: "1024x1024" })
  });
  expectStatus(invalidTask, 400, "invalid task type");
  expect(invalidTask.body.data.errorCode === "TASK_TYPE_UNSUPPORTED", "invalid task should return TASK_TYPE_UNSUPPORTED");

  const missingSourceAssetTask = await request("/api/image/tasks", {
    method: "POST",
    body: JSON.stringify({ taskType: "inpaint", prompt: "api smoke edit task", count: 1, size: "1024x1024" })
  });
  expectStatus(missingSourceAssetTask, 400, "missing edit source asset");
  expect(missingSourceAssetTask.body.data.errorCode === "SOURCE_ASSET_REQUIRED", "edit tasks should require a source asset");

  const unknownSourceAssetTask = await request("/api/image/tasks", {
    method: "POST",
    body: JSON.stringify({ taskType: "outpaint", prompt: "api smoke edit task", sourceAssetId: "NOPE", count: 1, size: "1024x1024" })
  });
  expectStatus(unknownSourceAssetTask, 404, "unknown edit source asset");
  expect(unknownSourceAssetTask.body.data.errorCode === "SOURCE_ASSET_NOT_FOUND", "edit tasks should validate source asset existence");

  const credits = await request("/api/account/credits");
  expectStatus(credits, 200, "account credits");
  expect(credits.body.data.credits.credits === 1280, "account credits should return demo balance");

  const membership = await request("/api/account/membership");
  expectStatus(membership, 200, "account membership");
  expect(membership.body.data.membership.memberStatus === "pro_trial", "membership should return demo pro trial status");

  const order = await request("/api/billing/orders", {
    method: "POST",
    body: JSON.stringify({ planId: "credits-1500" })
  });
  expectStatus(order, 200, "create order");
  expect(order.body.data.order.status === "pending_payment", "created order should be pending payment");

  const creditsOrder = await request("/api/orders/credits", {
    method: "POST",
    body: JSON.stringify({ planId: "credits-5000" })
  });
  expectStatus(creditsOrder, 200, "create credits order");
  expect(creditsOrder.body.data.order.planId === "credits-5000", "credits order should preserve the selected credits plan");

  const membershipOrder = await request("/api/orders/membership", {
    method: "POST",
    body: JSON.stringify({ planId: "pro-monthly" })
  });
  expectStatus(membershipOrder, 200, "create membership order");
  expect(membershipOrder.body.data.order.memberStatusAfterPayment === "pro", "membership order should upgrade member status after payment");

  const invalidMembershipOrder = await request("/api/orders/membership", {
    method: "POST",
    body: JSON.stringify({ planId: "credits-1500" })
  });
  expectStatus(invalidMembershipOrder, 400, "invalid membership order plan");
  expect(invalidMembershipOrder.body.data.errorCode === "MEMBERSHIP_PLAN_REQUIRED", "invalid membership order should return MEMBERSHIP_PLAN_REQUIRED");

  const invalidOrder = await request("/api/billing/orders", {
    method: "POST",
    body: JSON.stringify({ planId: "bad-plan" })
  });
  expectStatus(invalidOrder, 400, "invalid order plan");
  expect(invalidOrder.body.data.errorCode === "PLAN_ID_REQUIRED", "invalid order should return PLAN_ID_REQUIRED");

  log("all checks passed");
}

runSmoke()
  .catch(error => {
    process.stderr.write(`[smoke:api] ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(stopServer);
