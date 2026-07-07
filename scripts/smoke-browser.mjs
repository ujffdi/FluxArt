import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const explicitBaseUrl = process.env.SMOKE_BASE_URL;
const port = process.env.SMOKE_PORT || "3118";
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

function epaySigningSecret() {
  return process.env.MAPAY_SIGNING_SECRET
    || process.env.MAPAY_SECRET
    || process.env.MAPAY_KEY
    || process.env.EPAY_SIGNING_SECRET
    || process.env.EPAY_SECRET
    || process.env.EPAY_KEY
    || mockPaymentEnv.MAPAY_SIGNING_SECRET
    || "mock-epay-secret";
}

function epayMerchantId() {
  return process.env.MAPAY_MERCHANT_ID || process.env.MAPAY_PID || process.env.EPAY_MERCHANT_ID || process.env.EPAY_PID || mockPaymentEnv.MAPAY_MERCHANT_ID || "mock-merchant";
}

function signEpayParams(params, secret = epaySigningSecret()) {
  const query = Object.entries(params)
    .filter(([key, value]) => key !== "sign" && key !== "sign_type" && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return createHash("md5").update(`${query}${secret}`).digest("hex");
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
      ...mockPaymentEnv,
      FLUXART_DATA_MODE: process.env.FLUXART_DATA_MODE || "mock",
      FLUXART_ADMIN_USERNAMES: process.env.FLUXART_ADMIN_USERNAMES || "tongsr",
      FLUXART_ADMIN_SECRET: process.env.FLUXART_ADMIN_SECRET || "browser-smoke-admin-secret-valid-123",
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

    if (!explicitBaseUrl) {
      const adminRegistrationPayload = await page.evaluate(async () => {
        const response = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "tongsr", displayName: "Admin Smoke", password: "admin-browser-password-1" })
        });
        return { status: response.status, body: await response.json() };
      });
      if (adminRegistrationPayload.status !== 200) fail(`register admin browser smoke account: expected HTTP 200, received ${adminRegistrationPayload.status}`);
      if (adminRegistrationPayload.body?.data?.account?.isModelAdmin !== true) fail("tongsr auth payload should be marked as model admin");
      await page.reload();
      await page.getByText("已登录 · Admin Smoke").first().waitFor({ state: "attached", timeout: 10000 });
      const adminNavLink = page.getByRole("link", { name: "模型后台" });
      await adminNavLink.waitFor({ timeout: 10000 });
      const adminLinkCount = await page.locator('a[href="/admin/model-config"]').count();
      if (adminLinkCount !== 1) fail(`admin browser smoke should expose one model admin link, received ${adminLinkCount}`);
      await adminNavLink.click();
      await page.getByText("Selectable Image Models").waitFor({ timeout: 10000 });
      const smokeModel = `smoke-model-${Date.now().toString(36)}`;
      const smokeBaseUrl = "https://provider.example.test/smoke/v1";
      const smokeSecretRef = "provider.api-key";
      await page.getByLabel("Provider").selectOption("custom");
      await page.getByLabel("Model").fill(smokeModel);
      await page.getByLabel("Base URL").fill(smokeBaseUrl);
      await page.getByLabel("Secret Ref").fill(smokeSecretRef);
      const modelTestResponse = page.waitForResponse(response => response.url().includes("/api/admin/model-config/test") && response.request().method() === "POST");
      await page.getByRole("button", { name: "测试" }).click();
      const modelTest = await modelTestResponse;
      if (modelTest.status() !== 200) fail(`admin model test request should return HTTP 200, received ${modelTest.status()}`);
      await page.getByText("mock configuration accepted").waitFor({ timeout: 10000 });
      if (await page.getByLabel("Model").inputValue() !== smokeModel) fail("admin model test should preserve the unsaved model input");
      if (await page.getByLabel("Base URL").inputValue() !== smokeBaseUrl) fail("admin model test should preserve the unsaved base URL input");
      if (await page.getByLabel("Secret Ref").inputValue() !== smokeSecretRef) fail("admin model test should preserve the unsaved secret ref input");
      const savedSelectableModels = await page.evaluate(async () => {
        const response = await fetch("/api/admin/model-config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            models: [{
              id: "agnes-image-2-1-flash",
              displayName: "Agnes Image 2.1 Flash",
              provider: "agnes",
              model: "agnes-image-2.1-flash",
              baseUrl: "https://apihub.agnes-ai.com/v1",
              apiKeySecretRef: "FLUXART_IMAGE_API_KEY",
              executionMode: "mock",
              requestTimeoutMs: 120000,
              enabled: true,
              isDefault: true
            }, {
              id: "premium-model",
              displayName: "Premium Smoke Model",
              provider: "custom",
              model: "premium-smoke-model",
              baseUrl: "https://provider.example.test/premium/v1",
              apiKeySecretRef: "premium.api-key",
              executionMode: "mock",
              requestTimeoutMs: 660000,
              enabled: true,
              isDefault: false
            }]
          })
        });
        return { status: response.status, body: await response.json() };
      });
      if (savedSelectableModels.status !== 200) fail(`admin selectable model save should return HTTP 200, received ${savedSelectableModels.status}`);
      await page.goto(`${baseUrl}/workspace/account`);
      await page.locator("header").getByRole("button", { name: "退出", exact: true }).click();
      await page.getByRole("button", { name: "确认退出" }).click();
      await page.getByText("游客模式").first().waitFor({ state: "attached", timeout: 10000 });
    }

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
    await page.goto(`${baseUrl}/workspace/image`, { waitUntil: "networkidle" });
    const freeModelSelect = page.getByLabel("模型");
    await freeModelSelect.waitFor({ timeout: 10000 });
    if (!(await freeModelSelect.isDisabled())) fail("free users should see a disabled model dropdown");
    const freeModelText = await freeModelSelect.locator("option:checked").textContent();
    if (!freeModelText?.includes("Agnes Image 2.1 Flash")) fail(`free model dropdown should show the default model, received ${freeModelText || "(empty)"}`);
    await page.getByText("购买积分后可选择更多模型").waitFor({ timeout: 10000 });
    const purchasePromptHref = await page.getByRole("link", { name: "去购买积分" }).getAttribute("href");
    if (purchasePromptHref !== "/workspace/billing") fail(`free model purchase prompt should link to billing, received ${purchasePromptHref}`);

    const creditOrderPayload = await page.evaluate(async () => {
      const response = await fetch("/api/orders/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: "credits-500" })
      });
      return { status: response.status, body: await response.json() };
    });
    if (creditOrderPayload.status !== 200) fail(`create browser credit pack order: expected HTTP 200, received ${creditOrderPayload.status}`);
    const notifyParams = {
      pid: epayMerchantId(),
      out_trade_no: creditOrderPayload.body?.data?.order?.outTradeNo,
      trade_no: `browser_${Date.now().toString(36)}`,
      trade_status: "TRADE_SUCCESS",
      money: "1"
    };
    const signedNotifyParams = { ...notifyParams, sign: signEpayParams(notifyParams), sign_type: "MD5" };
    const notifyPayload = await page.evaluate(async params => {
      const response = await fetch("/api/payments/epay/notify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params)
      });
      return { status: response.status, text: await response.text() };
    }, signedNotifyParams);
    if (notifyPayload.status !== 200 || notifyPayload.text !== "success") fail(`browser credit pack notify should succeed, received HTTP ${notifyPayload.status} ${notifyPayload.text}`);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForFunction(() => {
      const select = document.querySelector('select[aria-label="模型"]');
      return select && !select.disabled;
    }, undefined, { timeout: 10000 });
    await page.goto(`${baseUrl}/workspace/image`, { waitUntil: "networkidle" });
    const paidModelSelect = page.getByLabel("模型");
    await paidModelSelect.waitFor({ timeout: 10000 });
    if (await paidModelSelect.isDisabled()) fail("credit pack users should see an enabled model dropdown");
    const paidOptions = await paidModelSelect.locator("option").allTextContents();
    if (!paidOptions.some(option => option.includes("Premium Smoke Model"))) fail(`credit pack model dropdown should include premium model, received ${paidOptions.join(" | ")}`);
    await paidModelSelect.selectOption("premium-model");
    await page.getByText("已保存默认生成模型").waitFor({ timeout: 10000 });

    const insufficientTaskRoute = async route => {
      if (route.request().method() !== "POST") return route.continue();
      return route.fulfill({
        status: 402,
        contentType: "application/json",
        body: JSON.stringify({ code: 402, message: "积分不足，请购买额度或等待免费额度刷新。", data: { errorCode: "INSUFFICIENT_CREDITS" } })
      });
    };
    await page.route("**/api/image/tasks", insufficientTaskRoute);
    await page.getByRole("button", { name: /生成 \d+ 张方案/ }).click();
    await page.getByText("积分不足，请购买额度或等待免费额度刷新。").waitFor({ timeout: 10000 });
    if (await paidModelSelect.isDisabled()) fail("insufficient credits should not disable model selection for credit pack users");
    await page.unroute("**/api/image/tasks", insufficientTaskRoute);
    const disabledPreferredPayload = await page.evaluate(async () => {
      const response = await fetch("/api/admin/model-config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-fluxart-admin-secret": "browser-smoke-admin-secret-valid-123"
        },
        body: JSON.stringify({
          models: [{
            id: "agnes-image-2-1-flash",
            displayName: "Agnes Image 2.1 Flash",
            provider: "agnes",
            model: "agnes-image-2.1-flash",
            baseUrl: "https://apihub.agnes-ai.com/v1",
            apiKeySecretRef: "FLUXART_IMAGE_API_KEY",
            executionMode: "mock",
            requestTimeoutMs: 120000,
            enabled: true,
            isDefault: true
          }, {
            id: "premium-model",
            displayName: "Premium Smoke Model",
            provider: "custom",
            model: "premium-smoke-model",
            baseUrl: "https://provider.example.test/premium/v1",
            apiKeySecretRef: "premium.api-key",
            executionMode: "mock",
            requestTimeoutMs: 660000,
            enabled: false,
            isDefault: false
          }]
        })
      });
      return { status: response.status, body: await response.json() };
    });
    if (disabledPreferredPayload.status !== 200) fail(`disable browser preferred model should return HTTP 200, received ${disabledPreferredPayload.status}`);
    await page.goto(`${baseUrl}/workspace/image`, { waitUntil: "networkidle" });
    const fallbackModelSelect = page.getByLabel("模型");
    await fallbackModelSelect.waitFor({ timeout: 10000 });
    const fallbackModelValue = await fallbackModelSelect.inputValue();
    if (fallbackModelValue !== "agnes-image-2-1-flash") fail(`disabled preferred model should fall back to default, received ${fallbackModelValue}`);
    const fallbackOptions = await fallbackModelSelect.locator("option").allTextContents();
    if (fallbackOptions.some(option => option.includes("Premium Smoke Model"))) fail("disabled model should disappear from workspace options");
    await page.getByText("原模型不可用，已切换到默认模型。").waitFor({ timeout: 10000 });

    await page.locator("header").getByRole("button", { name: "退出", exact: true }).click();
    await page.getByRole("button", { name: "确认退出" }).click();
    await page.getByText("游客模式").first().waitFor({ state: "attached", timeout: 10000 });
    await page.getByText("积分 0").first().waitFor({ state: "attached", timeout: 10000 });

    await page.getByRole("button", { name: "登录" }).click();
    await page.getByLabel("用户名").fill(username);
    await page.getByLabel("密码").fill("browser-password-1");
    await page.getByRole("button", { name: "立即登录" }).click();
    await page.getByText("已登录 · Browser Smoke").first().waitFor({ state: "attached", timeout: 10000 });
    await page.goto(`${baseUrl}/workspace/account`);
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
    const uploadedFilterResponse = page.waitForResponse(response => response.url().includes("/api/image/assets") && response.url().includes("origin=uploaded") && response.status() === 200);
    await page.getByLabel("资产来源筛选").selectOption("uploaded");
    await uploadedFilterResponse;
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
    await page.getByText(`已完成 · ${taskId}`).waitFor({ timeout: 10000 });
    await page.getByText("已生成 1 个结果，可在资产中心查看。").first().waitFor({ timeout: 10000 });
    await page.goto(`${baseUrl}/workspace/image/assets`);
    await page.getByText(generatedAsset.id).first().waitFor({ timeout: 10000 });
    await page.getByText(generatedAsset.id).first().click();
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
    await page.getByText(`已完成 · ${imageToImageTaskId}`).waitFor({ timeout: 10000 });
    await page.getByText("已生成 1 个结果，可在资产中心查看。").first().waitFor({ timeout: 10000 });

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
