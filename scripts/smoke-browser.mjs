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
const hintContrastSelectors = [".toast.show", ".notice", ".chip", ".status", ".badge", ".small", ".api-state"];
const minimumTextContrast = 4.5;
const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

let serverProcess;

function log(message) {
  process.stdout.write(`[smoke:browser] ${message}\n`);
}

function fail(message) {
  throw new Error(message);
}

function parseRgbColor(value) {
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) return undefined;

  const [r, g, b, alpha] = match[1].split(",").map(part => part.trim());
  return {
    r: Number(r),
    g: Number(g),
    b: Number(b),
    a: alpha === undefined ? 1 : Number(alpha)
  };
}

function blendColor(foreground, background) {
  const alpha = foreground.a + background.a * (1 - foreground.a);
  if (alpha === 0) return { r: 255, g: 255, b: 255, a: 1 };

  return {
    r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
    g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
    b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
    a: alpha
  };
}

function relativeLuminance(color) {
  const [r, g, b] = [color.r, color.g, color.b].map(channel => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(first, second) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

async function assertLightThemeHintContrast(page) {
  const failures = [];

  for (const route of routes) {
    await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "light";
      const toast = document.querySelector(".toast");
      if (toast) {
        toast.textContent = "任务提交失败：积分不足，请购买额度或等待免费额度刷新。";
        toast.classList.add("show");
      }
    });

    const samples = await page.evaluate(selectors => {
      function isVisible(element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      }

      return selectors.flatMap(selector => Array.from(document.querySelectorAll(selector))
        .filter(isVisible)
        .slice(0, 10)
        .map(element => {
          const style = window.getComputedStyle(element);
          let backgroundColor = style.backgroundColor;
          let parent = element.parentElement;
          while ((backgroundColor === "rgba(0, 0, 0, 0)" || backgroundColor === "transparent") && parent) {
            backgroundColor = window.getComputedStyle(parent).backgroundColor;
            parent = parent.parentElement;
          }

          return {
            selector,
            text: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
            color: style.color,
            backgroundColor
          };
        }));
    }, hintContrastSelectors);

    for (const sample of samples) {
      const foreground = parseRgbColor(sample.color);
      const background = parseRgbColor(sample.backgroundColor);
      if (!foreground || !background) continue;

      const blendedBackground = blendColor(background, { r: 255, g: 255, b: 255, a: 1 });
      const ratio = contrastRatio(foreground, blendedBackground);
      if (ratio < minimumTextContrast) {
        failures.push(`${route} ${sample.selector} "${sample.text}" contrast ${ratio.toFixed(2)} (${sample.color} on ${sample.backgroundColor})`);
      }
    }
  }

  if (failures.length) fail(`light theme hint contrast below ${minimumTextContrast}: ${failures.join("; ")}`);
}

async function assertAiStudioIsNotThemeToggle(page) {
  await page.goto(`${baseUrl}/workspace/image`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });

  const themeToggleCount = await page.getByRole("button", { name: "AI Studio" }).count();
  if (themeToggleCount > 0) fail("AI Studio should be a section label, not a theme toggle button");

  const beforeTheme = await page.evaluate(() => document.documentElement.dataset.theme || "");
  await page.getByText("AI Studio", { exact: true }).click();
  const afterTheme = await page.evaluate(() => document.documentElement.dataset.theme || "");
  if (afterTheme !== beforeTheme) fail(`AI Studio changed theme from ${beforeTheme || "(unset)"} to ${afterTheme || "(unset)"}`);
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
    await assertAiStudioIsNotThemeToggle(page);
    await assertLightThemeHintContrast(page);

    await page.goto(`${baseUrl}/workspace/account`);
    await page.getByText("游客模式").first().waitFor({ state: "attached", timeout: 10000 });
    await page.getByText("积分 0").first().waitFor({ state: "attached", timeout: 10000 });
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
    await page.getByText("已登录 · Browser Smoke").first().waitFor({ state: "attached", timeout: 10000 });
    await page.getByText("积分 60").first().waitFor({ state: "attached", timeout: 10000 });

    await page.locator("header").getByRole("button", { name: "退出", exact: true }).click();
    await page.getByRole("button", { name: "确认退出" }).click();
    await page.getByText("游客模式").first().waitFor({ state: "attached", timeout: 10000 });
    await page.getByText("积分 0").first().waitFor({ state: "attached", timeout: 10000 });

    await page.getByRole("button", { name: "登录" }).click();
    await page.getByLabel("用户名").fill(username);
    await page.getByLabel("密码").fill("browser-password-1");
    await page.getByRole("button", { name: "立即登录" }).click();
    await page.getByText("已登录 · Browser Smoke").first().waitFor({ state: "attached", timeout: 10000 });
    await page.getByText("server session 已验证").waitFor({ timeout: 10000 });
    await page.getByText(`${username} · 积分充足`).waitFor({ timeout: 10000 });
    await page.getByText("积分校验").waitFor({ timeout: 10000 });

    const uploadedAssetPayload = await page.evaluate(async base64 => {
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
      const form = new FormData();
      form.set("file", new File([bytes], "browser-upload.png", { type: "image/png" }));
      const response = await fetch("/api/image/assets/upload", { method: "POST", body: form });
      return { status: response.status, body: await response.json() };
    }, tinyPngBase64);
    if (uploadedAssetPayload.status !== 200) fail(`upload browser smoke asset: expected HTTP 200, received ${uploadedAssetPayload.status}`);
    const uploadedAsset = uploadedAssetPayload.body?.data?.asset;
    if (uploadedAsset?.origin !== "uploaded") fail("browser smoke uploaded asset should have uploaded origin");
    await page.goto(`${baseUrl}/workspace/image/assets`);
    await page.getByText("browser-upload").first().waitFor({ timeout: 10000 });
    await page.getByLabel("资产来源筛选").selectOption("uploaded");
    await page.getByText(uploadedAsset.id).first().waitFor({ timeout: 10000 });
    await page.getByText(`${uploadedAsset.id} · 用户上传`, { exact: false }).first().waitFor({ timeout: 10000 });
    await page.getByText(uploadedAsset.id).first().click();
    await page.getByRole("link", { name: "继续图生图" }).click();
    await page.getByText(`使用 ${uploadedAsset.id}`).waitFor({ timeout: 10000 });

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
    await page.getByRole("button", { name: "下载" }).first().click();
    await page.getByText("积分解锁确认").waitFor({ timeout: 10000 });
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "确认并下载" }).click();
    const download = await downloadPromise;
    const downloadFailure = await download.failure();
    if (downloadFailure) fail(`browser download failed: ${downloadFailure}`);
    if (!download.suggestedFilename().endsWith(".png")) fail(`browser download should save a PNG file, received ${download.suggestedFilename()}`);

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
