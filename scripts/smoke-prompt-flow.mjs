import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const explicitBaseUrl = process.env.SMOKE_BASE_URL;
const port = process.env.SMOKE_PORT || "3121";
const baseUrl = explicitBaseUrl || `http://127.0.0.1:${port}`;
const nextBin = "./node_modules/.bin/next";
const buildMarker = ".next/BUILD_ID";

let serverProcess;

function log(message) {
  process.stdout.write(`[smoke:prompt-flow] ${message}\n`);
}

function fail(message) {
  throw new Error(message);
}

function apiOk(data) {
  return {
    code: 200,
    message: "ok",
    data
  };
}

function startServerIfNeeded() {
  if (explicitBaseUrl) return;
  if (!existsSync(nextBin)) fail("Next.js binary not found. Run npm install before npm run smoke:prompt-flow.");

  const command = existsSync(buildMarker) ? "start" : "dev";

  serverProcess = spawn(nextBin, [command, "-H", "127.0.0.1", "-p", port], {
    env: {
      ...process.env,
      FLUXART_DATA_MODE: "mock",
      IMAGE_MODEL_EXECUTION: "mock"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (process.env.SMOKE_VERBOSE === "1") {
    serverProcess.stdout.on("data", chunk => process.stdout.write(chunk.toString()));
    serverProcess.stderr.on("data", chunk => process.stderr.write(chunk.toString()));
  }
}

async function stopServer() {
  if (!serverProcess) return;
  serverProcess.kill("SIGTERM");
  await delay(300);
  if (!serverProcess.killed) serverProcess.kill("SIGKILL");
}

async function waitForServer() {
  const deadline = Date.now() + 30000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/workspace/image`);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }

  throw new Error(`server did not become ready at ${baseUrl}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function fulfillJson(route, body) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

async function run() {
  log(`using ${baseUrl}`);
  startServerIfNeeded();
  await waitForServer();

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const customPrompt = `电商主图测试：蓝色玻璃香水瓶放在白色大理石台面上 ${Date.now()}`;
    const customNegativePrompt = "不要暗色背景，不要香薰，不要木质台面";
    const customImagePrompt = "保持香水瓶主体结构，替换为浅色电商详情页摄影光线";
    const sourceAssetId = "IMG-1832";
    const capturedCreateTaskBodies = [];

    await page.route("**/api/auth/me", route => fulfillJson(route, apiOk({
      account: {
        userId: "usr-prompt-flow",
        username: "prompt_flow",
        displayName: "Prompt Flow",
        memberStatus: "pro",
        credits: 999,
        proDaysRemaining: 30,
        canUseOutpaint: true,
        canDownloadHd: true,
        canDownloadWithoutWatermark: true
      },
      session: {
        id: "session-prompt-flow",
        userId: "usr-prompt-flow",
        createdAt: new Date().toISOString(),
        slidingExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        absoluteExpiresAt: new Date(Date.now() + 86400000 * 30).toISOString()
      }
    })));

    await page.route("**/api/image/assets*", route => fulfillJson(route, apiOk({
      assets: [{
        id: sourceAssetId,
        userId: "usr-prompt-flow",
        title: "香薰产品主图",
        taskId: "T2I-PROMPT-FLOW-SOURCE",
        taskType: "t2i",
        status: "succeeded",
        prompt: "暗色背景商业摄影，现代香薰产品，柔和边缘光",
        imageUrl: "/flux-art-reference.png",
        objectKey: "assets/demo/prompt-flow-source.png",
        publicUrl: "/flux-art-reference.png",
        mimeType: "image/png",
        sizeBytes: 228390,
        width: 1024,
        height: 1024,
        reviewStatus: "approved",
        downloadState: "hd",
        modelProvider: "openai",
        modelName: "gpt-image-2",
        createdAt: new Date().toISOString()
      }],
      versionNodes: [],
      pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 }
    })));

    await page.route("**/api/account/credits", route => fulfillJson(route, apiOk({
      credits: {
        userId: "usr-prompt-flow",
        credits: 999,
        estimatedStandardGenerations: 55,
        recentChanges: []
      }
    })));

    await page.route("**/api/billing/orders", route => fulfillJson(route, apiOk({ orders: [] })));

    await page.route("**/api/image/tasks*", async route => {
      const request = route.request();
      if (request.method() === "POST") {
        const capturedCreateTaskBody = request.postDataJSON();
        capturedCreateTaskBodies.push(capturedCreateTaskBody);
        const taskId = `TSK-PROMPT-FLOW-${capturedCreateTaskBodies.length}`;
        await fulfillJson(route, apiOk({
          task: {
            id: taskId,
            userId: "usr-prompt-flow",
            taskType: capturedCreateTaskBody.taskType,
            status: "queued",
            prompt: capturedCreateTaskBody.prompt,
            requestPayload: capturedCreateTaskBody,
            modelProvider: "agnes",
            modelName: "agnes-image-2.1-flash",
            chargedCredits: capturedCreateTaskBody.taskType === "i2i" ? 32 : 18,
            resultAssetIds: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        }));
        return;
      }

      await fulfillJson(route, apiOk({
        tasks: [],
        pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 }
      }));
    });

    await page.route("**/api/image/tasks/TSK-PROMPT-FLOW", route => fulfillJson(route, apiOk({
      task: {
        id: "TSK-PROMPT-FLOW",
        userId: "usr-prompt-flow",
        taskType: "t2i",
        status: "running",
        prompt: customPrompt,
        requestPayload: { taskType: "t2i", prompt: customPrompt, count: 1, size: "1024x1024" },
        modelProvider: "agnes",
        modelName: "agnes-image-2.1-flash",
        chargedCredits: 18,
        resultAssetIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    })));

    await page.goto(`${baseUrl}/workspace/image`);
    await page.getByText("已登录 · Prompt Flow").waitFor({ timeout: 10000 });
    await page.getByRole("textbox", { name: "Prompt", exact: true }).fill(customPrompt);
    await page.getByRole("textbox", { name: "Negative Prompt", exact: true }).fill(customNegativePrompt);
    await page.getByRole("button", { name: "电商海报" }).click();
    await page.getByLabel("尺寸").selectOption("1344x768");
    await page.getByLabel("数量").selectOption("2");
    await page.getByRole("button", { name: "生成图片" }).click();

    const deadline = Date.now() + 5000;
    while (capturedCreateTaskBodies.length < 1 && Date.now() < deadline) {
      await delay(100);
    }

    const capturedCreateTaskBody = capturedCreateTaskBodies[0];
    if (!capturedCreateTaskBody) fail("did not capture POST /api/image/tasks");
    if (capturedCreateTaskBody.prompt !== customPrompt) {
      fail(`expected create task prompt ${JSON.stringify(customPrompt)}, received ${JSON.stringify(capturedCreateTaskBody.prompt)}`);
    }
    if (capturedCreateTaskBody.negativePrompt !== customNegativePrompt) {
      fail(`expected create task negativePrompt ${JSON.stringify(customNegativePrompt)}, received ${JSON.stringify(capturedCreateTaskBody.negativePrompt)}`);
    }
    if (capturedCreateTaskBody.stylePreset !== "电商海报") {
      fail(`expected create task stylePreset "电商海报", received ${JSON.stringify(capturedCreateTaskBody.stylePreset)}`);
    }
    if (capturedCreateTaskBody.size !== "1344x768") {
      fail(`expected create task size "1344x768", received ${JSON.stringify(capturedCreateTaskBody.size)}`);
    }
    if (capturedCreateTaskBody.count !== 2) {
      fail(`expected create task count 2, received ${JSON.stringify(capturedCreateTaskBody.count)}`);
    }
    if (capturedCreateTaskBody.sourceAssetId !== undefined) {
      fail(`expected text-to-image sourceAssetId undefined, received ${JSON.stringify(capturedCreateTaskBody.sourceAssetId)}`);
    }

    await page.getByRole("tab", { name: "图生图" }).click();
    try {
      await page.getByText(`已选择源图 ${sourceAssetId}`).waitFor({ timeout: 10000 });
    } catch {
      const uploadCardText = await page.locator(".upload-card").textContent({ timeout: 1000 }).catch(() => "<upload-card missing>");
      fail(`expected selected source asset ${sourceAssetId} to be visible, upload card text was: ${JSON.stringify(uploadCardText)}`);
    }
    await page.getByRole("textbox", { name: "修改方向说明" }).fill(customImagePrompt);
    await page.getByLabel("参考强度").fill("82");
    await page.getByLabel("结构保持模式").selectOption("outline");
    await page.getByRole("button", { name: "生成图片" }).click();

    const imageDeadline = Date.now() + 5000;
    while (capturedCreateTaskBodies.length < 2 && Date.now() < imageDeadline) {
      await delay(100);
    }

    const capturedImageTaskBody = capturedCreateTaskBodies[1];
    if (!capturedImageTaskBody) fail("did not capture image-to-image POST /api/image/tasks");
    if (capturedImageTaskBody.taskType !== "i2i") {
      fail(`expected image taskType "i2i", received ${JSON.stringify(capturedImageTaskBody.taskType)}`);
    }
    if (capturedImageTaskBody.prompt !== customImagePrompt) {
      fail(`expected image prompt ${JSON.stringify(customImagePrompt)}, received ${JSON.stringify(capturedImageTaskBody.prompt)}`);
    }
    if (capturedImageTaskBody.sourceAssetId !== sourceAssetId) {
      fail(`expected image sourceAssetId ${JSON.stringify(sourceAssetId)}, received ${JSON.stringify(capturedImageTaskBody.sourceAssetId)}`);
    }
    if (capturedImageTaskBody.strength !== 82) {
      fail(`expected image strength 82, received ${JSON.stringify(capturedImageTaskBody.strength)}`);
    }
    if (capturedImageTaskBody.structureMode !== "outline") {
      fail(`expected image structureMode "outline", received ${JSON.stringify(capturedImageTaskBody.structureMode)}`);
    }
    if (capturedImageTaskBody.stylePreset !== "电商海报") {
      fail(`expected image stylePreset to persist as "电商海报", received ${JSON.stringify(capturedImageTaskBody.stylePreset)}`);
    }
    if (capturedImageTaskBody.negativePrompt !== undefined) {
      fail(`expected image negativePrompt undefined, received ${JSON.stringify(capturedImageTaskBody.negativePrompt)}`);
    }

    log("all checks passed");
  } finally {
    await browser.close();
  }
}

run()
  .catch(error => {
    process.stderr.write(`[smoke:prompt-flow] ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(stopServer);
