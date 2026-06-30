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
    let capturedCreateTaskBody;

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
      assets: [],
      versionNodes: [],
      pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 }
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
        capturedCreateTaskBody = request.postDataJSON();
        await fulfillJson(route, apiOk({
          task: {
            id: "TSK-PROMPT-FLOW",
            userId: "usr-prompt-flow",
            taskType: "t2i",
            status: "queued",
            prompt: capturedCreateTaskBody.prompt,
            requestPayload: capturedCreateTaskBody,
            modelProvider: "agnes",
            modelName: "agnes-image-2.1-flash",
            chargedCredits: 18,
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
    while (!capturedCreateTaskBody && Date.now() < deadline) {
      await delay(100);
    }

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
