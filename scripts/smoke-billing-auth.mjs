import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const explicitBaseUrl = process.env.SMOKE_BASE_URL;
const port = process.env.SMOKE_PORT || "3119";
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

function log(message) {
  process.stdout.write(`[smoke:billing-auth] ${message}\n`);
}

function fail(message) {
  throw new Error(message);
}

function startServerIfNeeded() {
  if (explicitBaseUrl) return;
  if (!existsSync(nextBin)) fail("Next.js binary not found. Run npm install before this smoke check.");
  if (!existsSync(buildMarker)) fail("Production build not found. Run npm run build before this smoke check, or pass SMOKE_BASE_URL.");

  serverProcess = spawn(nextBin, ["start", "-H", "127.0.0.1", "-p", port], {
    env: { ...process.env, ...mockPaymentEnv, FLUXART_DATA_MODE: process.env.FLUXART_DATA_MODE || "mock" },
    stdio: ["ignore", "pipe", "pipe"]
  });
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
      const response = await fetch(`${baseUrl}/workspace/billing`);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  throw new Error(`server did not become ready at ${baseUrl}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function registerInBrowser(page, displayName) {
  const username = `billing_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const registered = await page.evaluate(async ({ username, displayName }) => {
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "billing-password-1", displayName })
    });
    return { status: response.status, body: await response.json() };
  }, { username, displayName });

  if (registered.status !== 200) {
    fail(`register expected HTTP 200, received ${registered.status} with ${JSON.stringify(registered.body)}`);
  }
}

async function assertCreditPackClickDoesNotOpenLogin(page) {
  await page.evaluate(() => {
    window.__fluxArtNoReloadMarker = "still-here";
  });
  await page.getByRole("button", { name: "购买 500 积分" }).click();
  await page.waitForTimeout(300);

  const authDialogVisible = await page.getByRole("dialog").filter({ hasText: "登录后继续：购买积分" }).isVisible().catch(() => false);
  if (authDialogVisible) fail("logged-in user saw the login dialog after clicking a credit pack");
  const marker = await page.evaluate(() => window.__fluxArtNoReloadMarker).catch(() => undefined);
  if (marker !== "still-here") fail("clicking a credit pack reloaded or navigated the page");

  await page.waitForFunction(() => {
    const toast = document.querySelector(".toast.show")?.textContent || "";
    return window.location.href.includes("outTradeNo=") || toast.includes("订单已创建");
  }, undefined, { timeout: 12000 });
}

async function run() {
  log(`using ${baseUrl}`);
  startServerIfNeeded();
  await waitForServer();

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const normalPage = await context.newPage();
    await normalPage.goto(`${baseUrl}/workspace/billing`, { waitUntil: "domcontentloaded" });
    await registerInBrowser(normalPage, "Billing Smoke");
    await normalPage.reload({ waitUntil: "networkidle" });
    await normalPage.getByText("已登录 · Billing Smoke").waitFor({ timeout: 10000 });
    await assertCreditPackClickDoesNotOpenLogin(normalPage);

    await context.route("**/api/auth/me", async route => {
      await delay(3000);
      await route.continue();
    });
    const delayedPage = await context.newPage();
    await delayedPage.goto(`${baseUrl}/workspace/billing`, { waitUntil: "domcontentloaded" });
    await delayedPage.waitForTimeout(500);
    await assertCreditPackClickDoesNotOpenLogin(delayedPage);
    await delayedPage.close();
    await context.unroute("**/api/auth/me");
    await context.close();
  } finally {
    await browser.close();
  }

  log("all checks passed");
}

run()
  .catch(error => {
    process.stderr.write(`[smoke:billing-auth] ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(stopServer);
