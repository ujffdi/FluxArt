import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const explicitBaseUrl = process.env.SMOKE_BASE_URL;
const port = process.env.SMOKE_PORT || "3118";
const baseUrl = explicitBaseUrl || `http://127.0.0.1:${port}`;
const nextBin = "./node_modules/.bin/next";
const buildMarker = ".next/BUILD_ID";

const routes = [
  "/workspace/image",
  "/workspace/image/assets",
  "/workspace/account",
  "/workspace/billing"
];

let serverProcess;

function log(message) {
  process.stdout.write(`[smoke:browser] ${message}\n`);
}

function fail(message) {
  throw new Error(message);
}

function startServerIfNeeded() {
  if (explicitBaseUrl) return;
  if (!existsSync(nextBin)) fail("Next.js binary not found. Run npm install before npm run smoke:browser.");
  if (!existsSync(buildMarker)) fail("Production build not found. Run npm run build before npm run smoke:browser.");

  serverProcess = spawn(nextBin, ["start", "-H", "127.0.0.1", "-p", port], {
    env: {
      ...process.env,
      FLUXART_DATA_MODE: process.env.FLUXART_DATA_MODE || "mock",
      IMAGE_MODEL_EXECUTION: "mock"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
}

async function stopServer() {
  if (!serverProcess) return;
  serverProcess.kill("SIGTERM");
  await delay(300);
  if (!serverProcess.killed) serverProcess.kill("SIGKILL");
}

async function request(path) {
  const response = await fetch(`${baseUrl}${path}`);
  const text = await response.text();
  return { response, text };
}

async function waitForServer() {
  const deadline = Date.now() + 30000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await request("/workspace/image");
      if (result.response.ok) return;
      lastError = new Error(`HTTP ${result.response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  throw new Error(`server did not become ready at ${baseUrl}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function run() {
  log(`using ${baseUrl}`);
  startServerIfNeeded();
  await waitForServer();

  for (const route of routes) {
    const result = await request(route);
    if (result.response.status !== 200) fail(`${route}: expected HTTP 200, received ${result.response.status}`);
    if (!result.text.includes("Flux Art")) fail(`${route}: expected Flux Art shell markup`);
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/workspace/account`);
    await page.getByText("游客模式").waitFor({ timeout: 10000 });
    await page.getByText("积分 0").waitFor({ timeout: 10000 });
    await page.getByText("未登录", { exact: true }).first().waitFor({ timeout: 10000 });

    const username = `browser_${Date.now().toString(36)}`;
    const registrationPayload = await page.evaluate(async username => {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, displayName: "Browser Smoke", password: "browser-password-1" })
      });
      return { status: response.status, body: await response.json() };
    }, username);
    if (registrationPayload.status !== 200) fail(`register browser smoke account: expected HTTP 200, received ${registrationPayload.status}`);
    await page.reload();
    await page.getByText("已登录 · Browser Smoke").waitFor({ timeout: 10000 });
    await page.getByText("积分 60").waitFor({ timeout: 10000 });

    await page.locator("header").getByRole("button", { name: "退出", exact: true }).click();
    await page.getByRole("button", { name: "确认退出" }).click();
    await page.getByText("游客模式").waitFor({ timeout: 10000 });
    await page.getByText("积分 0").waitFor({ timeout: 10000 });

    await page.getByRole("button", { name: "登录" }).click();
    await page.getByLabel("用户名").fill(username);
    await page.getByLabel("密码").fill("browser-password-1");
    await page.getByRole("button", { name: "立即登录" }).click();
    await page.getByText("已登录 · Browser Smoke").waitFor({ timeout: 10000 });
    await page.getByText("server session 已验证").waitFor({ timeout: 10000 });
    await page.getByText(`${username} · 积分充足`).waitFor({ timeout: 10000 });
    await page.getByText("积分校验").waitFor({ timeout: 10000 });

    const prompt = `browser smoke asset for asset UI ${Date.now()}`;
    const taskPayload = await page.evaluate(async prompt => {
      const response = await fetch("/api/image/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskType: "t2i", prompt, count: 1, size: "1024x1024" })
      });
      return { status: response.status, body: await response.json() };
    }, prompt);
    if (taskPayload.status !== 200) fail(`create browser smoke task: expected HTTP 200, received ${taskPayload.status}`);
    const taskId = taskPayload.body?.data?.task?.id;
    if (!taskId) fail("create browser smoke task: missing task id");
    const runTaskPayload = await page.evaluate(async id => {
      const response = await fetch(`/api/image/tasks/${id}`, { method: "POST" });
      return { status: response.status, body: await response.json() };
    }, taskId);
    if (runTaskPayload.status !== 200) fail(`run browser smoke task: expected HTTP 200, received ${runTaskPayload.status}`);
    const assetListPayload = await page.evaluate(async () => {
      const response = await fetch("/api/image/assets?page=1&pageSize=20");
      return { status: response.status, body: await response.json() };
    });
    if (assetListPayload.status !== 200) fail(`list browser smoke assets: expected HTTP 200, received ${assetListPayload.status}`);
    const generatedAsset = assetListPayload.body?.data?.assets?.find(asset => asset.prompt === prompt);
    if (!generatedAsset) fail("browser smoke generated asset should appear in the asset list");

    await page.goto(`${baseUrl}/workspace/image`);
    await page.getByText(generatedAsset.id).waitFor({ timeout: 10000 });
    await page.getByText("已保存到资产中心").waitFor({ timeout: 10000 });

    const imageToImagePrompt = `browser smoke image-to-image result ${Date.now()}`;
    const imageToImageTaskPayload = await page.evaluate(async ({ prompt, sourceAssetId }) => {
      const response = await fetch("/api/image/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskType: "i2i", prompt, sourceAssetId, count: 1, size: "1024x1024" })
      });
      return { status: response.status, body: await response.json() };
    }, { prompt: imageToImagePrompt, sourceAssetId: generatedAsset.id });
    if (imageToImageTaskPayload.status !== 200) fail(`create browser smoke image-to-image task: expected HTTP 200, received ${imageToImageTaskPayload.status}`);
    const imageToImageTaskId = imageToImageTaskPayload.body?.data?.task?.id;
    if (!imageToImageTaskId) fail("create browser smoke image-to-image task: missing task id");
    const runImageToImageTaskPayload = await page.evaluate(async id => {
      const response = await fetch(`/api/image/tasks/${id}`, { method: "POST" });
      return { status: response.status, body: await response.json() };
    }, imageToImageTaskId);
    if (runImageToImageTaskPayload.status !== 200) fail(`run browser smoke image-to-image task: expected HTTP 200, received ${runImageToImageTaskPayload.status}`);
    const imageToImageAssetId = runImageToImageTaskPayload.body?.data?.task?.resultAssetIds?.[0];
    if (!imageToImageAssetId) fail("run browser smoke image-to-image task: missing generated asset id");

    await page.goto(`${baseUrl}/workspace/image`);
    await page.getByText(imageToImageAssetId).waitFor({ timeout: 10000 });
    await page.getByText("图生图 · succeeded").waitFor({ timeout: 10000 });

    await page.goto(`${baseUrl}/workspace/image/assets`);
    await page.getByRole("button", { name: "删除" }).waitFor({ timeout: 10000 });
    await page.getByText(generatedAsset.id).first().click();
    const removedEditLinks = await page.getByRole("link", { name: /带入局部重绘|带入扩图/ }).count();
    if (removedEditLinks !== 0) fail("asset center should not expose removed image edit entry links");
    const editRouteLinks = await page.locator('a[href^="/workspace/image/edit/"]').count();
    if (editRouteLinks !== 0) fail("asset center should not link to removed image edit routes");

    await page.goto(`${baseUrl}/workspace/billing`);
    await page.getByRole("button", { name: "购买 500 积分" }).waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: "购买 1,500 积分" }).waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: "购买 5,000 积分" }).waitFor({ timeout: 10000 });
    await page.getByText("最近订单").waitFor({ timeout: 10000 });
  } finally {
    await browser.close();
  }

  log("all checks passed");
}

run()
  .catch(error => {
    process.stderr.write(`[smoke:browser] ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(stopServer);
