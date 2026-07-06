import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";

const explicitBaseUrl = process.env.SMOKE_BASE_URL;
const port = process.env.SMOKE_PORT || "3117";
const baseUrl = explicitBaseUrl || `http://127.0.0.1:${port}`;
const nextBin = "./node_modules/.bin/next";
const buildMarker = ".next/BUILD_ID";
const mockPaymentEnv = {
  MAPAY_API_URL: "",
  MAPAY_MERCHANT_ID: "mock-merchant",
  MAPAY_SIGNING_SECRET: "mock-epay-secret",
  MAPAY_NOTIFY_URL: `http://127.0.0.1:${port}/api/payments/mapay/notify`,
  MAPAY_RETURN_URL: `http://127.0.0.1:${port}/api/payments/mapay/return`,
  EPAY_API_URL: "",
  EPAY_MERCHANT_ID: "mock-merchant",
  EPAY_SIGNING_SECRET: "mock-epay-secret",
  EPAY_NOTIFY_URL: `http://127.0.0.1:${port}/api/payments/epay/notify`,
  EPAY_RETURN_URL: `http://127.0.0.1:${port}/api/payments/epay/return`
};

let serverProcess;
const cookieJar = new Map();

function log(message) {
  process.stdout.write(`[smoke:api] ${message}\n`);
}

function fail(message) {
  throw new Error(message);
}

async function request(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body && !isFormData ? { "Content-Type": "application/json" } : {}),
      ...(cookieJar.size ? { Cookie: [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join("; ") } : {}),
      ...options.headers
    }
  });
  const setCookies = response.headers.getSetCookie?.() || (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")] : []);
  for (const value of setCookies) {
    const [pair] = value.split(";");
    const [name, cookieValue] = pair.split("=");
    if (cookieValue) cookieJar.set(name, cookieValue);
    else cookieJar.delete(name);
  }
  const contentType = response.headers.get("content-type") || "";
  if (contentType.startsWith("image/")) {
    const body = Buffer.from(await response.arrayBuffer());
    return { response, body, setCookies };
  }

  const text = await response.text();
  let body;

  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  return { response, body, setCookies };
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

async function expectAssetDownload(assetId, label) {
  const result = await request(`/api/image/assets/${assetId}/download`);
  expectStatus(result, 200, label);
  expect(result.response.headers.get("content-disposition")?.includes("attachment"), `${label} should return an attachment response`);
  expect(result.response.headers.get("content-type")?.startsWith("image/"), `${label} should return an image MIME type`);
  expect(Buffer.isBuffer(result.body) && result.body.byteLength > 0, `${label} should return image bytes`);
  return result;
}

function daysBetween(fromMs, toIso) {
  return (Date.parse(toIso) - fromMs) / 86400000;
}

function signEpayParams(params, secret = "mock-epay-secret") {
  const query = Object.entries(params)
    .filter(([key, value]) => key !== "sign" && key !== "sign_type" && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return createHash("md5").update(`${query}${secret}`).digest("hex");
}

async function makeImage(width, height, format) {
  const image = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 20, g: 160, b: 180, alpha: 0.75 }
    }
  });
  if (format === "jpeg") return image.jpeg().toBuffer();
  if (format === "webp") return image.webp().toBuffer();
  return image.png().toBuffer();
}

async function uploadImage(kind, buffer, fileName, type) {
  const form = new FormData();
  form.set("kind", kind);
  form.set("file", new Blob([buffer], { type }), fileName);
  return request("/api/image/uploads", { method: "POST", body: form });
}

async function uploadVisibleAsset(buffer, fileName, type) {
  const form = new FormData();
  form.set("file", new Blob([buffer], { type }), fileName);
  return request("/api/image/assets/upload", { method: "POST", body: form });
}

async function waitForServer() {
  const deadline = Date.now() + 30000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const result = await request("/api/auth/me");
      if (result.response.status === 200 || result.response.status === 401) return;
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
    env: {
      ...process.env,
      ...mockPaymentEnv,
      FLUXART_DATA_MODE: process.env.FLUXART_DATA_MODE || "mock",
      IMAGE_MODEL_EXECUTION: "mock"
    },
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

  const anonymousAssets = await request("/api/image/assets");
  expectStatus(anonymousAssets, 401, "anonymous list assets");
  expect(anonymousAssets.body.data.errorCode === "AUTH_REQUIRED", "anonymous workspace API should require a server session");

  const testToolsRejected = await request("/api/dev/credits", {
    method: "POST",
    body: JSON.stringify({ username: "tongsr", targetCredits: 0 })
  });
  expectStatus(testToolsRejected, 403, "test credit tools in production smoke");
  expect(testToolsRejected.body.data.errorCode === "TEST_TOOLS_LOCAL_ONLY", "test credit tools should be local-development only");

  const demoLogin = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: "demo", password: "demo-password-1" })
  });
  expectStatus(demoLogin, 200, "demo login");
  expect(cookieJar.has("fluxart_session"), "demo login should set a session cookie");

  const demoLogout = await request("/api/auth/logout", { method: "POST" });
  expectStatus(demoLogout, 200, "demo logout");
  expect(!cookieJar.has("fluxart_session"), "logout should clear the session cookie");

  const postLogoutAssets = await request("/api/image/assets");
  expectStatus(postLogoutAssets, 401, "post-logout list assets");

  const anonymousAssetUpload = await uploadVisibleAsset(await makeImage(12, 12, "png"), "anonymous.png", "image/png");
  expectStatus(anonymousAssetUpload, 401, "anonymous visible asset upload");
  expect(anonymousAssetUpload.body.data.errorCode === "AUTH_REQUIRED", "visible asset upload should require authentication");

  const secondDemoLogin = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: "demo", password: "demo-password-1" })
  });
  expectStatus(secondDemoLogin, 200, "second demo login");

  const sourceUpload = await uploadImage("source", await makeImage(32, 24, "jpeg"), "source.jpg", "image/jpeg");
  expectStatus(sourceUpload, 200, "source image upload");
  expect(sourceUpload.body.data.upload.mimeType === "image/jpeg", "source upload should preserve accepted JPEG metadata");
  expect(sourceUpload.body.data.upload.width === 32 && sourceUpload.body.data.upload.height === 24, "source upload should store decoded dimensions");
  expect(/\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/i.test(sourceUpload.body.data.upload.objectKey), "source upload object key should include a UUID");

  const maskUpload = await uploadImage("mask", await makeImage(18, 12, "webp"), "mask.webp", "image/webp");
  expectStatus(maskUpload, 200, "mask image upload");
  expect(maskUpload.body.data.upload.mimeType === "image/png", "mask upload should normalize provider-compatible alpha-capable PNG data");
  expect(maskUpload.body.data.upload.objectKey.endsWith(".png"), "mask upload object key should use normalized PNG extension");

  const invalidMaskUpload = await uploadImage("mask", await makeImage(8, 8, "jpeg"), "bad-mask.jpg", "image/jpeg");
  expectStatus(invalidMaskUpload, 400, "invalid mask upload");
  expect(invalidMaskUpload.body.data.errorCode === "UPLOAD_TYPE_UNSUPPORTED", "mask uploads should reject JPEG");

  const oversizedDimensionUpload = await uploadImage("source", await makeImage(4097, 1, "png"), "too-wide.png", "image/png");
  expectStatus(oversizedDimensionUpload, 400, "oversized dimension upload");
  expect(oversizedDimensionUpload.body.data.errorCode === "UPLOAD_DIMENSIONS_TOO_LARGE", "source uploads should reject maximum edge above 4096px");

  const assets = await request("/api/image/assets");
  expectStatus(assets, 200, "list assets");
  expectApiCode(assets, 200, "list assets");
  expect(Array.isArray(assets.body.data.assets) && assets.body.data.assets.length >= 1, "list assets should return assets");
  expect(assets.body.data.pagination.total >= assets.body.data.assets.length, "list assets should include pagination totals");

  const filteredAssets = await request("/api/image/assets?taskType=i2i&status=processing&page=1&pageSize=2");
  expectStatus(filteredAssets, 200, "filtered assets");
  expect(filteredAssets.body.data.assets.length === 1, "filtered assets should return the processing image-to-image asset");
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

  const deletedAsset = await request("/api/image/assets/IMG-1832", { method: "DELETE" });
  expectStatus(deletedAsset, 200, "soft delete asset");
  expect(typeof deletedAsset.body.data.asset.deletedAt === "string", "soft delete should set deletedAt");
  const deletedAssetDetail = await request("/api/image/assets/IMG-1832");
  expectStatus(deletedAssetDetail, 404, "soft-deleted asset detail");

  const tasks = await request("/api/image/tasks");
  expectStatus(tasks, 200, "list tasks");
  expect(Array.isArray(tasks.body.data.tasks), "list tasks should return an array");
  expect(tasks.body.data.pagination.total >= tasks.body.data.tasks.length, "list tasks should include pagination totals");

  const filteredTasks = await request("/api/image/tasks?taskType=i2i&status=running&page=1&pageSize=1");
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
  expect(createdTask.body.data.task.modelProvider === "agnes", "create task should use agnes provider by default");
  expect(createdTask.body.data.task.modelName === "agnes-image-2.1-flash", "create task should use agnes-image-2.1-flash by default");
  expect(createdTask.body.data.task.status === "queued", "created tasks should start in queued state");
  expect(createdTask.body.data.task.priority === 100, "pro trial task creation should store priority 100");
  expect(typeof createdTask.body.data.task.creditHoldId === "string", "created tasks should include a credit hold id");

  const invalidTask = await request("/api/image/tasks", {
    method: "POST",
    body: JSON.stringify({ taskType: "bad_task", prompt: "api smoke task", count: 1, size: "1024x1024" })
  });
  expectStatus(invalidTask, 400, "invalid task type");
  expect(invalidTask.body.data.errorCode === "TASK_TYPE_UNSUPPORTED", "invalid task should return TASK_TYPE_UNSUPPORTED");

  const missingSourceAssetTask = await request("/api/image/tasks", {
    method: "POST",
    body: JSON.stringify({ taskType: "i2i", prompt: "api smoke source-based task", count: 1, size: "1024x1024" })
  });
  expectStatus(missingSourceAssetTask, 400, "missing source asset");
  expect(missingSourceAssetTask.body.data.errorCode === "SOURCE_ASSET_REQUIRED", "source-based tasks should require a source asset");

  const unknownSourceAssetTask = await request("/api/image/tasks", {
    method: "POST",
    body: JSON.stringify({ taskType: "i2i", prompt: "api smoke source-based task", sourceAssetId: "NOPE", count: 1, size: "1024x1024" })
  });
  expectStatus(unknownSourceAssetTask, 404, "unknown source asset");
  expect(unknownSourceAssetTask.body.data.errorCode === "SOURCE_ASSET_NOT_FOUND", "source-based tasks should validate source asset existence");

  const credits = await request("/api/account/credits");
  expectStatus(credits, 200, "account credits");
  expect(credits.body.data.credits.credits === 1270, "account credits should reflect the demo task credit hold");
  expect(credits.body.data.credits.recentChanges.some(entry => entry.label === "Generation Credit Hold" && entry.amount === -10), "demo task creation should write a hold ledger entry");
  expect(!credits.body.data.credits.recentChanges.some(entry => entry.label === "Generation Credit Spend" && entry.amount === -10), "task creation should not write spend entries before approved usable output");

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

  const invalidUsername = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username: "1_bad_name", password: "correct-password-1" })
  });
  expectStatus(invalidUsername, 400, "invalid registration username");
  expect(invalidUsername.body.data.errorCode === "USERNAME_INVALID", "invalid username should return USERNAME_INVALID");

  const registerUsername = `smoke_${Date.now().toString(36)}`;
  const registerStartedAt = Date.now();
  const registered = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username: registerUsername, password: "correct-password-1", displayName: "Smoke User" })
  });
  expectStatus(registered, 200, "register account");
  expect(registered.body.data.account.username === registerUsername, "registration should return the created username");
  expect(cookieJar.has("fluxart_session"), "registration should set an httpOnly session cookie");
  const registerCookie = registered.setCookies.join("; ");
  expect(registerCookie.includes("HttpOnly"), "registration cookie should be HttpOnly");
  expect(registerCookie.includes("SameSite=Lax"), "registration cookie should use SameSite=Lax");
  expect(registerCookie.includes("Max-Age=2592000"), "registration cookie should use a 30-day sliding Max-Age");
  const slidingDays = daysBetween(registerStartedAt, registered.body.data.session.slidingExpiresAt);
  const absoluteDays = daysBetween(registerStartedAt, registered.body.data.session.absoluteExpiresAt);
  expect(slidingDays > 29 && slidingDays <= 31, "registration session should expose about 30 days sliding expiry");
  expect(absoluteDays > 89 && absoluteDays <= 91, "registration session should expose about 90 days absolute expiry");

  const duplicateRegistration = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username: registerUsername, password: "correct-password-1" })
  });
  expectStatus(duplicateRegistration, 409, "duplicate registration");
  expect(duplicateRegistration.body.data.errorCode === "USERNAME_TAKEN", "duplicate registration should enforce username uniqueness");

  const me = await request("/api/auth/me");
  expectStatus(me, 200, "current session");
  expect(me.body.data.account.username === registerUsername, "current session should resolve from cookie");
  expect((me.response.headers.get("set-cookie") || "").includes("fluxart_session="), "current session should renew the session cookie");

  const authedCredits = await request("/api/account/credits");
  expectStatus(authedCredits, 200, "authed account credits");
  expect(authedCredits.body.data.credits.userId === registered.body.data.account.userId, "account API should resolve user from server session");
  expect(authedCredits.body.data.credits.credits === 60, "balance check should include registration and lazy daily free credits");
  expect(authedCredits.body.data.credits.groups.some(group => group.amount === 50), "new account credits should include the 50-credit registration bucket");
  expect(authedCredits.body.data.credits.groups.some(group => group.amount === 10), "new account credits should include a lazy 10-credit daily free bucket");
  expect(authedCredits.body.data.credits.recentChanges.some(entry => entry.label === "Registration Credit Grant"), "new account ledger should include the registration grant");
  expect(authedCredits.body.data.credits.recentChanges.some(entry => entry.label === "Daily Free Credit Grant"), "new account ledger should include the lazy daily free grant");
  expect(!authedCredits.body.data.credits.recentChanges.some(entry => String(entry.id).includes("demo")), "new account ledger should not include demo entries");

  const repeatedCredits = await request("/api/account/credits");
  expectStatus(repeatedCredits, 200, "repeated account credits");
  expect(repeatedCredits.body.data.credits.credits === 60, "daily free grant should be idempotent for the current day");

  const tasksBeforeAssetUpload = await request("/api/image/tasks");
  expectStatus(tasksBeforeAssetUpload, 200, "tasks before visible asset upload");
  const visibleAssetUpload = await uploadVisibleAsset(await makeImage(36, 28, "png"), "reference-upload.png", "image/png");
  expectStatus(visibleAssetUpload, 200, "visible asset upload");
  const uploadedAsset = visibleAssetUpload.body.data.asset;
  expect(uploadedAsset.origin === "uploaded", "visible asset upload should create an uploaded asset");
  expect(uploadedAsset.title === "reference-upload", "visible asset upload should default the title from the file name");
  expect(uploadedAsset.reviewStatus === "skipped", "visible asset upload should skip generated-output review");
  expect(uploadedAsset.status === "succeeded", "visible asset upload should be immediately usable");
  expect(!uploadedAsset.taskId, "visible asset upload should not create a task id");
  expect(!uploadedAsset.taskType, "visible asset upload should not pretend to have a generation task type");
  expect(!uploadedAsset.commercialAuthorizationStatement, "visible asset upload should not expose commercial authorization");
  expect(uploadedAsset.width === 36 && uploadedAsset.height === 28, "visible asset upload should store decoded dimensions");
  const uploadedAssetDetail = await request(`/api/image/assets/${uploadedAsset.id}`);
  expectStatus(uploadedAssetDetail, 200, "uploaded asset detail");
  expect(uploadedAssetDetail.body.data.detail.asset.origin === "uploaded", "uploaded asset detail should preserve origin");
  const uploadedAssetFilter = await request("/api/image/assets?origin=uploaded");
  expectStatus(uploadedAssetFilter, 200, "uploaded asset origin filter");
  expect(uploadedAssetFilter.body.data.assets.some(asset => asset.id === uploadedAsset.id), "origin=uploaded should include the uploaded asset");
  const invalidAssetOrigin = await request("/api/image/assets?origin=external");
  expectStatus(invalidAssetOrigin, 400, "invalid asset origin filter");
  expect(invalidAssetOrigin.body.data.errorCode === "ASSET_ORIGIN_UNSUPPORTED", "invalid asset origin should return ASSET_ORIGIN_UNSUPPORTED");
  const oversizedVisibleAsset = await uploadVisibleAsset(Buffer.alloc(10 * 1024 * 1024 + 1), "too-large.png", "image/png");
  expectStatus(oversizedVisibleAsset, 400, "oversized visible asset upload");
  expect(oversizedVisibleAsset.body.data.errorCode === "UPLOAD_TOO_LARGE", "visible asset upload should reject files above 10MB");
  const creditsAfterAssetUpload = await request("/api/account/credits");
  expectStatus(creditsAfterAssetUpload, 200, "credits after visible asset upload");
  expect(creditsAfterAssetUpload.body.data.credits.credits === 60, "visible asset upload should not spend or hold credits");
  const tasksAfterAssetUpload = await request("/api/image/tasks");
  expectStatus(tasksAfterAssetUpload, 200, "tasks after visible asset upload");
  expect(tasksAfterAssetUpload.body.data.pagination.total === tasksBeforeAssetUpload.body.data.pagination.total, "visible asset upload should not create image tasks");

  const creditPackOrder = await request("/api/orders/credits", {
    method: "POST",
    body: JSON.stringify({ planId: "credits-500" })
  });
  expectStatus(creditPackOrder, 200, "create 500 credit pack order");
  expect(creditPackOrder.body.data.order.outTradeNo, "credit pack order should create outTradeNo before payment adapter");
  expect(creditPackOrder.body.data.order.paymentUrl.includes("outTradeNo="), "credit pack order should include a server-created payment URL");
  const notifyParams = {
    pid: "mock-merchant",
    out_trade_no: creditPackOrder.body.data.order.outTradeNo,
    trade_no: `provider_${Date.now().toString(36)}`,
    trade_status: "TRADE_SUCCESS",
    money: "1"
  };
  const invalidSignatureNotify = await request("/api/payments/epay/notify", {
    method: "POST",
    body: new URLSearchParams({ ...notifyParams, sign: "invalid-signature", sign_type: "MD5" }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });
  expectStatus(invalidSignatureNotify, 400, "invalid Epay signature notify");
  expect(invalidSignatureNotify.body === "EPAY_SIGNATURE_INVALID", "invalid signature notify should be rejected");

  const wrongMerchantParams = { ...notifyParams, pid: "wrong-merchant", trade_no: `wrong_merchant_${Date.now().toString(36)}` };
  const wrongMerchantNotify = await request("/api/payments/epay/notify", {
    method: "POST",
    body: new URLSearchParams({ ...wrongMerchantParams, sign: signEpayParams(wrongMerchantParams), sign_type: "MD5" }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });
  expectStatus(wrongMerchantNotify, 400, "wrong Epay merchant notify");
  expect(wrongMerchantNotify.body === "EPAY_MERCHANT_INVALID", "wrong merchant notify should be rejected");

  const wrongAmountParams = { ...notifyParams, trade_no: `wrong_amount_${Date.now().toString(36)}`, money: "30.00" };
  const wrongAmountNotify = await request("/api/payments/epay/notify", {
    method: "POST",
    body: new URLSearchParams({ ...wrongAmountParams, sign: signEpayParams(wrongAmountParams), sign_type: "MD5" }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });
  expectStatus(wrongAmountNotify, 400, "wrong Epay amount notify");
  expect(wrongAmountNotify.body === "EPAY_AMOUNT_MISMATCH", "wrong amount notify should be rejected");
  const ordersAfterWrongAmount = await request("/api/billing/orders");
  expectStatus(ordersAfterWrongAmount, 200, "orders after wrong amount notify");
  expect(ordersAfterWrongAmount.body.data.orders.some(order => order.outTradeNo === notifyParams.out_trade_no && order.fulfillmentStatus === "retryable"), "wrong amount notify should leave the order visibly retryable");

  const unknownOrderParams = { ...notifyParams, out_trade_no: "unknown-order-smoke", trade_no: `unknown_${Date.now().toString(36)}` };
  const unknownOrderNotify = await request("/api/payments/epay/notify", {
    method: "POST",
    body: new URLSearchParams({ ...unknownOrderParams, sign: signEpayParams(unknownOrderParams), sign_type: "MD5" }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });
  expectStatus(unknownOrderNotify, 404, "unknown Epay order notify");
  expect(unknownOrderNotify.body === "ORDER_NOT_FOUND", "unknown order notify should be rejected");

  const failedStatusParams = { ...notifyParams, trade_no: `failed_status_${Date.now().toString(36)}`, trade_status: "TRADE_CLOSED" };
  const failedStatusNotify = await request("/api/payments/epay/notify", {
    method: "POST",
    body: new URLSearchParams({ ...failedStatusParams, sign: signEpayParams(failedStatusParams), sign_type: "MD5" }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });
  expectStatus(failedStatusNotify, 400, "failed Epay status notify");
  expect(failedStatusNotify.body === "EPAY_STATUS_UNSUCCESSFUL", "failed status notify should be rejected");

  const creditsAfterInvalidNotifies = await request("/api/account/credits");
  expectStatus(creditsAfterInvalidNotifies, 200, "credits after invalid Epay notifies");
  expect(creditsAfterInvalidNotifies.body.data.credits.credits === 60, "invalid Epay notifies should not grant credits");

  const signedNotifyParams = { ...notifyParams, sign: signEpayParams(notifyParams), sign_type: "MD5" };
  const notify = await request("/api/payments/epay/notify", {
    method: "POST",
    body: new URLSearchParams(signedNotifyParams),
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });
  expectStatus(notify, 200, "credit pack notify");
  expect(notify.body === "success", "successful Epay notify should return success");

  const creditsAfterPack = await request("/api/account/credits");
  expectStatus(creditsAfterPack, 200, "credits after credit pack notify");
  expect(creditsAfterPack.body.data.credits.credits === 560, "verified credit pack notify should grant purchased credits once");
  expect(creditsAfterPack.body.data.credits.groups.some(group => group.label.includes("已购") && group.amount === 500), "credit pack notify should add a purchased credit bucket");
  expect(creditsAfterPack.body.data.credits.recentChanges.some(entry => entry.label === "Purchased Credit Pack" && entry.amount === 500), "credit pack notify should write a purchased credit ledger entry");

  const duplicateNotify = await request("/api/payments/epay/notify", {
    method: "POST",
    body: new URLSearchParams(signedNotifyParams),
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });
  expectStatus(duplicateNotify, 200, "duplicate credit pack notify");
  const creditsAfterDuplicatePack = await request("/api/account/credits");
  expectStatus(creditsAfterDuplicatePack, 200, "credits after duplicate credit pack notify");
  expect(creditsAfterDuplicatePack.body.data.credits.credits === 560, "duplicate Epay notify should not duplicate purchased credit grants");

  const authedTask = await request("/api/image/tasks", {
    method: "POST",
    body: JSON.stringify({ taskType: "t2i", prompt: "api smoke authenticated task", count: 1, size: "1024x1024" })
  });
  expectStatus(authedTask, 200, "authenticated create task");
  expect(authedTask.body.data.task.userId === registered.body.data.account.userId, "workspace API should create tasks for the session user");
  expect(authedTask.body.data.task.status === "queued", "authenticated task creation should start in queued state");
  expect(authedTask.body.data.task.priority === 10, "free user task creation should store priority 10");
  expect(authedTask.body.data.task.chargedCredits === 10, "t2i tasks should use the fixed V1 credit cost");
  expect(typeof authedTask.body.data.task.creditHoldId === "string", "task creation should reserve credits and attach a credit hold");

  const creditsAfterTask = await request("/api/account/credits");
  expectStatus(creditsAfterTask, 200, "credits after authenticated task");
  expect(creditsAfterTask.body.data.credits.credits === 550, "task creation should deduct held credits from available balance");
  expect(creditsAfterTask.body.data.credits.recentChanges.some(entry => entry.label === "Generation Credit Hold" && entry.amount === -10), "task creation should write a hold ledger entry");
  expect(!creditsAfterTask.body.data.credits.recentChanges.some(entry => entry.label === "Generation Credit Spend" && entry.amount === -10), "task creation should not write spend ledger entries before approved usable output");

  const overLimitTask = await request("/api/image/tasks", {
    method: "POST",
    body: JSON.stringify({ taskType: "t2i", prompt: "api smoke over limit task", count: 1, size: "1024x1024" })
  });
  expectStatus(overLimitTask, 409, "free user running task limit");
  expect(overLimitTask.body.data.errorCode === "TASK_LIMIT_REACHED", "free users should be limited to one active task");

  const creditsAfterOverLimit = await request("/api/account/credits");
  expectStatus(creditsAfterOverLimit, 200, "credits after over-limit task");
  expect(creditsAfterOverLimit.body.data.credits.credits === 550, "over-limit task creation should not create another hold");

  const ranTask = await request(`/api/image/tasks/${authedTask.body.data.task.id}`, { method: "POST" });
  expectStatus(ranTask, 200, "run authenticated task");
  expect(ranTask.body.data.task.status === "succeeded", "server task runner should move approved output to succeeded");
  expect(Array.isArray(ranTask.body.data.task.resultAssetIds) && ranTask.body.data.task.resultAssetIds.length === 1, "server task runner should attach a generated asset id");
  const generatedAssetId = ranTask.body.data.task.resultAssetIds[0];
  const generatedAsset = await request(`/api/image/assets/${generatedAssetId}`);
  expectStatus(generatedAsset, 200, "generated asset detail");
  expect(generatedAsset.body.data.detail.asset.objectKey.includes(`/tasks/${authedTask.body.data.task.id}/asset/`), "generated asset should use a task-scoped object key");
  expect(generatedAsset.body.data.detail.asset.mimeType === "image/png", "generated asset should store MIME type");
  expect(generatedAsset.body.data.detail.asset.width === 1024 && generatedAsset.body.data.detail.asset.height === 1024, "generated asset should store dimensions");
  const creditsAfterRun = await request("/api/account/credits");
  expectStatus(creditsAfterRun, 200, "credits after task run");
  expect(creditsAfterRun.body.data.credits.credits === 550, "final spend should not double-deduct already held credits");
  expect(creditsAfterRun.body.data.credits.recentChanges.some(entry => entry.label === "Generation Credit Spend" && entry.amount === -10), "approved usable output should write a spend ledger entry");

  const nonProDownload = await request(`/api/image/assets/${generatedAssetId}/download`, { method: "POST" });
  expectStatus(nonProDownload, 200, "non-Pro HD download");
  expect(nonProDownload.body.data.decision.quality === "hd" && nonProDownload.body.data.decision.watermark === false, "non-Pro downloads should provide HD no-watermark output");
  expect(nonProDownload.body.data.decision.costCredits === 5, "non-Pro HD no-watermark downloads should cost 5 credits");
  expect(nonProDownload.body.data.decision.downloadUrl === `/api/image/assets/${generatedAssetId}/download`, "non-Pro download should return the owned attachment endpoint");
  await expectAssetDownload(generatedAssetId, "non-Pro HD download file");
  const creditsAfterNonProDownload = await request("/api/account/credits");
  expectStatus(creditsAfterNonProDownload, 200, "credits after non-Pro download");
  expect(creditsAfterNonProDownload.body.data.credits.credits === 545, "non-Pro HD no-watermark download should spend 5 credits");
  expect(creditsAfterNonProDownload.body.data.credits.recentChanges.some(entry => entry.label === "Download Credit Spend" && entry.amount === -5), "download spend should write a ledger entry");
  const repeatedNonProDownload = await request(`/api/image/assets/${generatedAssetId}/download`, { method: "POST" });
  expectStatus(repeatedNonProDownload, 200, "repeat non-Pro HD download");
  expect(repeatedNonProDownload.body.data.decision.costCredits === 0, "already unlocked non-Pro downloads should not spend credits again");
  const creditsAfterRepeatedNonProDownload = await request("/api/account/credits");
  expectStatus(creditsAfterRepeatedNonProDownload, 200, "credits after repeat non-Pro download");
  expect(creditsAfterRepeatedNonProDownload.body.data.credits.credits === 545, "repeat non-Pro HD download should not spend credits again");

  const proOrder = await request("/api/orders/membership", {
    method: "POST",
    body: JSON.stringify({ planId: "pro-monthly" })
  });
  expectStatus(proOrder, 200, "create Pro membership order");
  expect(proOrder.body.data.order.paymentUrl.includes("outTradeNo="), "Pro membership order should include a server-created payment URL");
  const proNotifyParams = {
    pid: "mock-merchant",
    out_trade_no: proOrder.body.data.order.outTradeNo,
    trade_no: `provider_pro_${Date.now().toString(36)}`,
    trade_status: "TRADE_SUCCESS",
    money: "69.00"
  };
  const signedProNotifyParams = { ...proNotifyParams, sign: signEpayParams(proNotifyParams), sign_type: "MD5" };
  const proNotify = await request("/api/payments/epay/notify", {
    method: "POST",
    body: new URLSearchParams(signedProNotifyParams),
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });
  expectStatus(proNotify, 200, "Pro membership notify");
  expect(proNotify.body === "success", "successful Pro Epay notify should return success");
  const membershipAfterPro = await request("/api/account/membership");
  expectStatus(membershipAfterPro, 200, "membership after Pro notify");
  expect(membershipAfterPro.body.data.membership.memberStatus === "pro", "verified Pro notify should activate Pro membership");
  expect(membershipAfterPro.body.data.membership.includedHdDownloadsRemaining === 300, "new Pro cycle should include 300 HD no-watermark downloads");
  expect(typeof membershipAfterPro.body.data.membership.commercialAuthorizationStatement === "string", "Pro membership should expose commercial authorization statement");
  const creditsAfterPro = await request("/api/account/credits");
  expectStatus(creditsAfterPro, 200, "credits after Pro notify");
  expect(creditsAfterPro.body.data.credits.credits === 1545, "verified Pro notify should grant 1000 monthly promotional credits");
  expect(creditsAfterPro.body.data.credits.groups.some(group => group.label.includes("membership") && group.amount === 1000), "Pro notify should add a membership credit bucket");
  expect(creditsAfterPro.body.data.credits.recentChanges.some(entry => entry.label === "Pro Membership Monthly Credit Grant" && entry.amount === 1000), "Pro notify should write a membership credit ledger entry");
  const duplicateProNotify = await request("/api/payments/epay/notify", {
    method: "POST",
    body: new URLSearchParams(signedProNotifyParams),
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });
  expectStatus(duplicateProNotify, 200, "duplicate Pro membership notify");
  const creditsAfterDuplicatePro = await request("/api/account/credits");
  expectStatus(creditsAfterDuplicatePro, 200, "credits after duplicate Pro notify");
  expect(creditsAfterDuplicatePro.body.data.credits.credits === 1545, "duplicate Pro notify should not duplicate monthly credits");

  const proTask = await request("/api/image/tasks", {
    method: "POST",
    body: JSON.stringify({ taskType: "t2i", prompt: "api smoke pro generated asset", count: 1, size: "1024x1024" })
  });
  expectStatus(proTask, 200, "Pro create task");
  expect(proTask.body.data.task.priority === 100, "Pro tasks should use priority 100");
  const ranProTask = await request(`/api/image/tasks/${proTask.body.data.task.id}`, { method: "POST" });
  expectStatus(ranProTask, 200, "run Pro task");
  const proGeneratedAssetId = ranProTask.body.data.task.resultAssetIds[0];
  const proGeneratedAsset = await request(`/api/image/assets/${proGeneratedAssetId}`);
  expectStatus(proGeneratedAsset, 200, "Pro generated asset detail");
  expect(proGeneratedAsset.body.data.detail.asset.entitlementSnapshot?.memberStatus === "pro", "Pro-generated assets should store an entitlement snapshot");
  expect(typeof proGeneratedAsset.body.data.detail.asset.commercialAuthorizationStatement === "string", "Pro-generated assets should store commercial authorization");
  const proDownload = await request(`/api/image/assets/${proGeneratedAssetId}/download`, { method: "POST" });
  expectStatus(proDownload, 200, "Pro HD download");
  expect(proDownload.body.data.decision.costCredits === 0 && proDownload.body.data.decision.fairUseApplied === true, "Pro downloads within fair-use cap should cost 0 credits");
  expect(proDownload.body.data.decision.downloadUrl === `/api/image/assets/${proGeneratedAssetId}/download`, "Pro download should return the owned attachment endpoint");
  await expectAssetDownload(proGeneratedAssetId, "Pro HD download file");
  const membershipAfterProDownload = await request("/api/account/membership");
  expectStatus(membershipAfterProDownload, 200, "membership after Pro download");
  expect(membershipAfterProDownload.body.data.membership.includedHdDownloadsRemaining === 299, "Pro HD download should consume one included download");
  const creditsAfterProDownload = await request("/api/account/credits");
  expectStatus(creditsAfterProDownload, 200, "credits after Pro download");
  expect(creditsAfterProDownload.body.data.credits.credits === 1535, "Pro fair-use download should not spend credits beyond the Pro task cost");

  const returnOrder = await request("/api/orders/credits", {
    method: "POST",
    body: JSON.stringify({ planId: "credits-500" })
  });
  expectStatus(returnOrder, 200, "create return-route credit pack order");
  const returnParams = {
    pid: "mock-merchant",
    out_trade_no: returnOrder.body.data.order.outTradeNo,
    trade_no: `return_${Date.now().toString(36)}`,
    trade_status: "TRADE_SUCCESS",
    money: "1.00"
  };
  const signedReturnParams = { ...returnParams, sign: signEpayParams(returnParams), sign_type: "MD5" };
  const returnResult = await request(`/api/payments/mapay/return?${new URLSearchParams(signedReturnParams)}`, {
    redirect: "manual"
  });
  expect(returnResult.response.status === 307 || returnResult.response.status === 308, "signed payment return should redirect to billing");
  expect(returnResult.response.headers.get("location")?.includes("/workspace/billing?payment=success"), "signed payment return should redirect with success state");
  const creditsAfterReturn = await request("/api/account/credits");
  expectStatus(creditsAfterReturn, 200, "credits after payment return");
  expect(creditsAfterReturn.body.data.credits.credits === 2035, "signed payment return should fulfill the credit pack once");

  const uploadedSourceTask = await request("/api/image/tasks", {
    method: "POST",
    body: JSON.stringify({ taskType: "i2i", prompt: "api smoke uploaded source task", sourceAssetId: uploadedAsset.id, count: 1, size: "1024x1024" })
  });
  expectStatus(uploadedSourceTask, 200, "create task from uploaded asset source");
  expect(uploadedSourceTask.body.data.task.sourceAssetId === uploadedAsset.id, "uploaded assets should be usable as image-to-image source assets");

  const passwordChanged = await request("/api/auth/password", {
    method: "POST",
    body: JSON.stringify({ currentPassword: "correct-password-1", nextPassword: "correct-password-2" })
  });
  expectStatus(passwordChanged, 200, "password change");
  expect(passwordChanged.body.data.passwordChanged === true, "password change should succeed");

  const oldSession = await request("/api/auth/me");
  expectStatus(oldSession, 401, "password change revokes current session");

  const relogin = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: registerUsername, password: "correct-password-2" })
  });
  expectStatus(relogin, 200, "login after password change");
  expect(relogin.body.data.account.username === registerUsername, "login should return username");
  const firstPostChangeSession = cookieJar.get("fluxart_session");

  for (let index = 0; index < 5; index += 1) {
    const extraLogin = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: registerUsername, password: "correct-password-2" })
    });
    expectStatus(extraLogin, 200, `session limit login ${index + 1}`);
  }

  const oldestSession = await request("/api/auth/me", {
    headers: { Cookie: `fluxart_session=${firstPostChangeSession}` }
  });
  expectStatus(oldestSession, 401, "sixth login revokes oldest active session");

  const newestSession = await request("/api/auth/me");
  expectStatus(newestSession, 200, "newest session remains active after session limit enforcement");

  log("all checks passed");
}

runSmoke()
  .catch(error => {
    process.stderr.write(`[smoke:api] ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(stopServer);
