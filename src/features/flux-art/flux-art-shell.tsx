"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ApiClientError,
  createBillingOrder,
  deleteImageAsset,
  createDownloadDecision,
  createImageTask,
  getAccountCredits,
  getCurrentAuthSession,
  listBillingOrders,
  listImageAssets,
  listImageTasks,
  loginWithPassword,
  logoutCurrentSession,
  registerAccount,
  runImageTask
} from "@/features/flux-art/api/image-workspace-client";
import { toTaskType, type ProductPage, type SessionState, useImageWorkspaceStore } from "@/features/flux-art/stores/image-workspace-store";
import type { AuthAccount } from "@/types/auth";
import type { BillingOrder, BillingPlanId } from "@/types/billing";
import type {
  AccountCreditsSummary,
  AssetStatus,
  AssetVersionNode,
  DownloadDecision,
  GenerationMode,
  ImageAsset,
  ImageGenerationTask,
  ListImageAssetsQuery,
  PaginationMeta
} from "@/types/image";

const navItems: Array<{ page: ProductPage; href: string; label: string }> = [
  { page: "workspace", href: "/workspace/image", label: "生图工作台" },
  { page: "assets", href: "/workspace/image/assets", label: "资产中心" },
  { page: "account", href: "/workspace/account", label: "用户体系" },
  { page: "billing", href: "/workspace/billing", label: "积分购买" }
];

const taskTypeOptions: Array<{ value: "" | GenerationMode; label: string }> = [
  { value: "", label: "全部任务类型" },
  { value: "t2i", label: "文生图" },
  { value: "i2i", label: "图生图" }
];

const assetStatusOptions: Array<{ value: "" | AssetStatus; label: string }> = [
  { value: "", label: "全部状态" },
  { value: "succeeded", label: "成功" },
  { value: "reviewing", label: "审核中" },
  { value: "processing", label: "生成中" },
  { value: "failed", label: "失败" }
];

const defaultTextPrompt = "一张用于电商主图的现代香薰产品摄影，暗色背景，柔和边缘光，真实材质，高级商业摄影";
const defaultImagePrompt = "保持源图主体结构，生成更适合电商详情页的高级商业摄影版本";
const defaultNegativePrompt = "低清晰度、畸变、文字水印、过度锐化、卡通玩具感";
const stylePresetOptions = ["商业摄影", "电商海报", "极简产品", "室内空间"];

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

function workspaceErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiClientError) {
    const messages: Record<string, string> = {
      AUTH_REQUIRED: "请先登录后继续。",
      INSUFFICIENT_CREDITS: "积分不足，请购买额度或等待免费额度刷新。",
      TASK_LIMIT_REACHED: "当前队列已满，请等待已有任务完成后再提交。",
      TASK_CAPABILITY_REQUIRED: "当前积分规则不支持这个任务类型。",
      TASK_STATE_TRANSITION_INVALID: "任务状态已变化，请刷新后重试。"
    };
    return error.errorCode ? messages[error.errorCode] || error.message : error.message;
  }
  return errorMessage(error, fallback);
}

function billingPlanLabel(planId: BillingPlanId) {
  const labels: Record<BillingPlanId, string> = {
    "credits-500": "500 积分包",
    "credits-1500": "1,500 积分包",
    "credits-5000": "5,000 积分包",
    "pro-monthly": "历史订阅订单"
  };
  return labels[planId];
}

function orderStatusLabel(order: BillingOrder) {
  if (order.fulfillmentStatus === "fulfilled") return "已履约";
  if (order.fulfillmentStatus === "retryable" || order.status === "failed") return "可重试";
  if (order.status === "paid") return "已支付";
  return "待支付";
}

function getInAppBillingPaymentPath(paymentUrl: string) {
  if (typeof window === "undefined") return undefined;

  try {
    const url = new URL(paymentUrl, window.location.origin);
    if (url.origin === window.location.origin && url.pathname === "/workspace/billing" && url.searchParams.get("mockPayment") === "epay") {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function taskTimestamp(task: ImageGenerationTask) {
  const timestamp = Date.parse(task.updatedAt || task.createdAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function pickTaskForDisplay(sessionTask: ImageGenerationTask, serverTask: ImageGenerationTask) {
  const sessionTimestamp = taskTimestamp(sessionTask);
  const serverTimestamp = taskTimestamp(serverTask);
  if (serverTimestamp >= sessionTimestamp) return serverTask;
  return sessionTask;
}

function mergeVisibleTasks(sessionTasks: ImageGenerationTask[], serverTasks: ImageGenerationTask[]) {
  const serverTaskById = new Map(serverTasks.map(task => [task.id, task]));
  const visibleTasks = sessionTasks.map(task => {
    const serverTask = serverTaskById.get(task.id);
    if (!serverTask) return task;
    serverTaskById.delete(task.id);
    return pickTaskForDisplay(task, serverTask);
  });

  return [...visibleTasks, ...serverTasks.filter(task => serverTaskById.has(task.id))];
}

function taskTypeLabel(taskType: GenerationMode) {
  const labels: Record<GenerationMode, string> = {
    t2i: "文生图",
    i2i: "图生图",
    inpaint: "局部重绘",
    outpaint: "扩图"
  };
  return labels[taskType];
}

function findLatestTask(tasks: ImageGenerationTask[], predicate: (task: ImageGenerationTask) => boolean) {
  return tasks.filter(predicate).sort((left, right) => taskTimestamp(right) - taskTimestamp(left))[0];
}

export function FluxArtShell({ activePage }: { activePage: ProductPage }) {
  const store = useImageWorkspaceStore();
  const [downloadDecision, setDownloadDecision] = useState<DownloadDecision | null>(null);
  const [authModal, setAuthModal] = useState<string | null>(null);
  const [showLogout, setShowLogout] = useState(false);
  const [sessionTasks, setSessionTasks] = useState<ImageGenerationTask[]>([]);
  const [serverAssets, setServerAssets] = useState<ImageAsset[]>([]);
  const [serverVersionNodes, setServerVersionNodes] = useState<AssetVersionNode[]>([]);
  const [serverTasks, setServerTasks] = useState<ImageGenerationTask[]>([]);
  const [creditsSummary, setCreditsSummary] = useState<AccountCreditsSummary | null>(null);
  const [billingOrders, setBillingOrders] = useState<BillingOrder[]>([]);
  const [authAccount, setAuthAccount] = useState<AuthAccount | null>(null);
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const [serverError, setServerError] = useState("");
  const [textPrompt, setTextPrompt] = useState(defaultTextPrompt);
  const [imagePrompt, setImagePrompt] = useState(defaultImagePrompt);
  const [negativePrompt, setNegativePrompt] = useState(defaultNegativePrompt);
  const [selectedSize, setSelectedSize] = useState("1024x1024");
  const [customWidth, setCustomWidth] = useState(1024);
  const [customHeight, setCustomHeight] = useState(1024);
  const [stylePreset, setStylePreset] = useState(stylePresetOptions[0]);

  const credits = creditsSummary?.credits ?? 0;
  const hasServerSession = authAccount !== null;
  const sessionState = hasServerSession ? "logged-in" : store.sessionState === "expired" ? "expired" : "guest";

  const selectedAsset = useMemo(
    () => serverAssets.find(asset => asset.id === store.selectedAssetId) || serverAssets[0],
    [serverAssets, store.selectedAssetId]
  );

  const visibleTasks = useMemo(() => mergeVisibleTasks(sessionTasks, serverTasks), [sessionTasks, serverTasks]);

  const workspaceResult = useMemo(() => {
    const assetById = new Map(serverAssets.map(asset => [asset.id, asset]));
    const completedTask = findLatestTask(
      visibleTasks,
      task => task.status === "succeeded" && task.resultAssetIds.some(assetId => assetById.has(assetId))
    );
    const pendingCompletedTask = findLatestTask(
      visibleTasks,
      task => task.status === "succeeded" && task.resultAssetIds.length > 0 && !task.resultAssetIds.some(assetId => assetById.has(assetId))
    );
    const activeTask = findLatestTask(
      visibleTasks,
      task => task.status === "queued" || task.status === "running" || task.status === "storing" || task.status === "reviewing"
    );
    const failedTask = findLatestTask(
      visibleTasks,
      task => task.status === "failed" || task.status === "refunded"
    );

    if (completedTask) {
      return {
        task: completedTask,
        assets: completedTask.resultAssetIds
          .map(assetId => assetById.get(assetId))
          .filter((asset): asset is ImageAsset => Boolean(asset)),
        pendingAssetIds: [] as string[]
      };
    }

    const task = pendingCompletedTask || activeTask || failedTask;
    return {
      task,
      assets: [] as ImageAsset[],
      pendingAssetIds: pendingCompletedTask?.resultAssetIds || []
    };
  }, [serverAssets, visibleTasks]);

  const clearSessionOwnedState = useCallback(function clearSessionOwnedState() {
    setAuthAccount(null);
    setServerAssets([]);
    setServerVersionNodes([]);
    setServerTasks([]);
    setSessionTasks([]);
    setCreditsSummary(null);
    setBillingOrders([]);
  }, []);

  const loadSessionOwnedState = useCallback(async function loadSessionOwnedState(account?: AuthAccount) {
    const auth = account ? { account } : await getCurrentAuthSession();

    const [assetPayload, taskPayload, creditsPayload, ordersPayload] = await Promise.all([
      listImageAssets({ page: 1, pageSize: 100 }),
      listImageTasks({ page: 1, pageSize: 20 }),
      getAccountCredits(),
      listBillingOrders()
    ]);

    setServerAssets(assetPayload.assets);
    setServerVersionNodes(assetPayload.versionNodes);
    setServerTasks(taskPayload.tasks);
    setCreditsSummary(creditsPayload);
    setBillingOrders(ordersPayload);
    setAuthAccount(auth.account);
    useImageWorkspaceStore.getState().setSessionState("logged-in");
    setServerError("");
  }, []);

  useEffect(() => {
    let active = true;

    async function loadServerState() {
      try {
        await loadSessionOwnedState();
        if (!active) return;
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiClientError && error.status === 401) {
          clearSessionOwnedState();
          useImageWorkspaceStore.getState().setSessionState("guest");
        }
        setServerError(errorMessage(error, "请登录后加载你的资产、任务和积分数据"));
      } finally {
        if (active) setSessionHydrated(true);
      }
    }

    loadServerState();

    return () => {
      active = false;
    };
  }, [clearSessionOwnedState, loadSessionOwnedState]);

  useEffect(() => {
    document.documentElement.dataset.theme = store.theme;
  }, [store.theme]);

  useEffect(() => {
    if (!store.toast) return;
    const timer = window.setTimeout(() => useImageWorkspaceStore.getState().clearToast(), 2400);
    return () => window.clearTimeout(timer);
  }, [store.toast]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setDownloadDecision(null);
      setAuthModal(null);
      setShowLogout(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function requireAuth(action: string, done: () => void | Promise<void>) {
    void (async () => {
      if (!hasServerSession) {
        try {
          const auth = await getCurrentAuthSession();
          setAuthAccount(auth.account);
          useImageWorkspaceStore.getState().setSessionState("logged-in");
          setServerError("");
        } catch (error) {
          if (error instanceof ApiClientError && error.status === 401) {
            clearSessionOwnedState();
            useImageWorkspaceStore.getState().setSessionState("guest");
            setAuthModal(action);
            return;
          }
          store.showToast(`登录状态校验失败：${errorMessage(error, "请稍后重试")}`);
          return;
        }
      }

      await done();
    })();
  }

  function upsertSessionTask(task: ImageGenerationTask) {
    setSessionTasks(current => [task, ...current.filter(item => item.id !== task.id)]);
  }

  function startTaskRunner(task: ImageGenerationTask, label: string) {
    void runImageTask(task.id)
      .then(updatedTask => {
        upsertSessionTask(updatedTask);
        if (updatedTask.status === "succeeded") {
          store.showToast(`${label}完成：${updatedTask.id}`);
          void loadSessionOwnedState(authAccount || undefined);
        } else if (updatedTask.status === "failed" || updatedTask.status === "refunded") {
          store.showToast(`${label}失败：${updatedTask.errorMessage || "请稍后重试"}`);
        }
      })
      .catch(error => {
        store.showToast(`${label}执行失败：${workspaceErrorMessage(error, "请稍后重试")}`);
      });
  }

  async function createGenerationTask() {
    requireAuth("生成图片", async () => {
      if (store.generationMode === "img" && !selectedAsset) {
        store.showToast("请先从你的资产中心选择参考图");
        return;
      }

      const imageMode = store.generationMode === "img";
      const prompt = (imageMode ? imagePrompt : textPrompt).trim();
      const cleanedNegativePrompt = negativePrompt.trim();
      const size = selectedSize === "custom" ? `${customWidth}x${customHeight}` : selectedSize;

      if (!prompt) {
        store.showToast("请先填写 Prompt");
        return;
      }

      try {
        const task = await createImageTask({
          taskType: toTaskType(store.generationMode),
          prompt,
          negativePrompt: imageMode || !cleanedNegativePrompt ? undefined : cleanedNegativePrompt,
          sourceAssetId: imageMode ? store.selectedAssetId : undefined,
          size,
          count: store.generationCount,
          stylePreset,
          strength: imageMode ? store.referenceStrength : undefined
        });
        upsertSessionTask(task);
        store.showToast(`任务已提交：${task.modelProvider}/${task.modelName} · ${task.id}`);
        if (task.status === "queued") startTaskRunner(task, "生成任务");
      } catch (error) {
        store.showToast(`任务提交失败：${workspaceErrorMessage(error, "请稍后重试")}`);
      }
    });
  }

  async function openDownload(assetId = store.selectedAssetId) {
    requireAuth("下载无水印", async () => {
      if (!selectedAsset && !assetId) {
        store.showToast("请先选择要下载的图片");
        return;
      }

      try {
        const decision = await createDownloadDecision(assetId);
        setDownloadDecision(decision);
      } catch (error) {
        store.showToast(`下载失败：${errorMessage(error, "请稍后重试")}`);
      }
    });
  }

  async function removeAsset(assetId = store.selectedAssetId) {
    requireAuth("删除资产", async () => {
      try {
        await deleteImageAsset(assetId);
        setServerAssets(current => {
          const next = current.filter(asset => asset.id !== assetId);
          if (store.selectedAssetId === assetId && next[0]) {
            store.setSelectedAssetId(next[0].id);
          }
          return next;
        });
        store.showToast("资产已删除：服务端会按保留策略清理对象");
      } catch (error) {
        store.showToast(`删除失败：${errorMessage(error, "请稍后重试")}`);
      }
    });
  }

  async function createOrder(planId: BillingPlanId) {
    requireAuth("购买积分", async () => {
      try {
        const order = await createBillingOrder(planId);
        setBillingOrders(current => [order, ...current.filter(item => item.orderId !== order.orderId)]);
        store.showToast("订单已创建：正在进入支付流程");
        if (order.paymentUrl) {
          const inAppPaymentPath = getInAppBillingPaymentPath(order.paymentUrl);
          if (inAppPaymentPath) {
            window.history.pushState(null, "", inAppPaymentPath);
          } else {
            window.location.assign(order.paymentUrl);
          }
        }
      } catch (error) {
        store.showToast(`订单创建失败：${errorMessage(error, "请稍后重试")}`);
      }
    });
  }

  async function refreshSessionState() {
    try {
      const auth = await getCurrentAuthSession();
      await loadSessionOwnedState(auth.account);
      store.showToast("登录状态已刷新");
    } catch (error) {
      clearSessionOwnedState();
      store.setSessionState("guest");
      store.showToast(`登录状态无效：${errorMessage(error, "请重新登录")}`);
    }
  }

  async function submitAuthCredentials(input: { mode: "login" | "register"; username: string; password: string; displayName?: string }) {
    try {
      const auth = input.mode === "register"
        ? await registerAccount(input.username, input.password, input.displayName)
        : await loginWithPassword(input.username, input.password);
      await loadSessionOwnedState(auth.account);
      setAuthModal(null);
      store.showToast("登录成功：已恢复 Prompt 和尺寸参数");
    } catch (error) {
      store.showToast(`登录失败：${errorMessage(error, "请稍后重试")}`);
    }
  }

  async function logoutSession() {
    try {
      await logoutCurrentSession();
    } catch {
      // A failed logout request still clears local presentation state.
    }
    setShowLogout(false);
    clearSessionOwnedState();
    store.setSessionState("guest");
    store.showToast("已退出当前 session");
  }

  return (
    <main className="app">
      <Header
        activePage={activePage}
        sessionLabel={hasServerSession ? `已登录 · ${authAccount.displayName || "Flux Art 用户"}` : sessionState === "expired" ? "登录已过期" : "游客模式"}
        credits={credits}
        theme={store.theme}
        onToggleTheme={() => store.setTheme(store.theme === "light" ? "dark" : "light")}
        onAuthClick={() => (hasServerSession ? setShowLogout(true) : setAuthModal(""))}
      />
      {activePage === "workspace" && (
        <WorkspacePage
          generationMode={store.generationMode}
          textPrompt={textPrompt}
          imagePrompt={imagePrompt}
          negativePrompt={negativePrompt}
          referenceStrength={store.referenceStrength}
          customSizeVisible={store.customSizeVisible}
          selectedSize={selectedSize}
          customWidth={customWidth}
          customHeight={customHeight}
          generationCount={store.generationCount}
          stylePreset={stylePreset}
          onModeChange={store.setGenerationMode}
          onTextPromptChange={setTextPrompt}
          onImagePromptChange={setImagePrompt}
          onNegativePromptChange={setNegativePrompt}
          onReferenceStrengthChange={store.setReferenceStrength}
          onCustomSizeChange={store.setCustomSizeVisible}
          onSelectedSizeChange={setSelectedSize}
          onCustomWidthChange={setCustomWidth}
          onCustomHeightChange={setCustomHeight}
          onGenerationCountChange={store.setGenerationCount}
          onStylePresetChange={setStylePreset}
          onGenerate={createGenerationTask}
          onDownload={openDownload}
          onUseAsSource={assetId => {
            store.setSelectedAssetId(assetId);
            store.setGenerationMode("img");
            store.showToast("已把结果设为参考图，可继续图生图");
          }}
          onShortcutToImageMode={() => {
            store.setGenerationMode("img");
            store.showToast("已切换到图生图：请确认 sourceAssetId 或上传参考图后再提交");
          }}
          visibleTasks={visibleTasks}
          resultTask={workspaceResult.task}
          resultAssets={workspaceResult.assets}
          pendingResultAssetIds={workspaceResult.pendingAssetIds}
          credits={credits}
          serverError={serverError}
        />
      )}

      {activePage === "assets" && (
        <AssetsPage
          key={authAccount?.userId || "guest"}
          selectedAssetId={store.selectedAssetId}
          sessionState={sessionState}
          sessionHydrated={sessionHydrated}
          initialAssets={serverAssets}
          initialVersionNodes={serverVersionNodes}
          onSelectAsset={store.setSelectedAssetId}
          onDownload={openDownload}
          onDelete={removeAsset}
          onImageToImage={() => {
            store.setGenerationMode("img");
            store.showToast("已切换到图生图：历史资产已作为 sourceAssetId");
          }}
        />
      )}

      {activePage === "account" && <AccountPage account={authAccount} credits={credits} orders={billingOrders} sessionState={sessionState} onRefreshSession={refreshSessionState} onLogout={logoutSession} />}
      {activePage === "billing" && <BillingPage credits={credits} orders={billingOrders} onCreateOrder={createOrder} />}

      <DownloadModal decision={downloadDecision} onClose={() => setDownloadDecision(null)} />
      <AuthModal
        action={authModal}
        open={authModal !== null}
        onClose={() => setAuthModal(null)}
        onSubmit={submitAuthCredentials}
      />
      <LogoutModal
        open={showLogout}
        onCancel={() => setShowLogout(false)}
        onConfirm={logoutSession}
      />
      <div className={`toast ${store.toast ? "show" : ""}`} role="status" aria-live="polite">{store.toast}</div>
    </main>
  );
}

function Header({
  activePage,
  sessionLabel,
  credits,
  theme,
  onToggleTheme,
  onAuthClick
}: {
  activePage: ProductPage;
  sessionLabel: string;
  credits: number;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onAuthClick: () => void;
}) {
  return (
    <header className="top">
      <Link className="brand" href="/workspace/image">
        <span className="mark" />
        <span>Flux Art 生图工作台</span>
      </Link>
      <nav className="nav" aria-label="产品导航">
        {navItems.map(item => (
          <Link key={item.page} className={activePage === item.page ? "active" : ""} href={item.href}>
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="wallet">
        <span className="badge">{sessionLabel}</span>
        <span className="badge">积分 {credits.toLocaleString()}</span>
        <button className="btn" type="button" onClick={onToggleTheme} aria-pressed={theme === "light"}>
          {theme === "light" ? "深色模式" : "浅色模式"}
        </button>
        <button className="btn" type="button" onClick={onAuthClick}>
          {sessionLabel.startsWith("已登录") ? "退出" : "登录"}
        </button>
      </div>
    </header>
  );
}

function WorkspacePage({
  generationMode,
  textPrompt,
  imagePrompt,
  negativePrompt,
  referenceStrength,
  customSizeVisible,
  selectedSize,
  customWidth,
  customHeight,
  generationCount,
  stylePreset,
  onModeChange,
  onTextPromptChange,
  onImagePromptChange,
  onNegativePromptChange,
  onReferenceStrengthChange,
  onCustomSizeChange,
  onSelectedSizeChange,
  onCustomWidthChange,
  onCustomHeightChange,
  onGenerationCountChange,
  onStylePresetChange,
  onGenerate,
  onDownload,
  onUseAsSource,
  onShortcutToImageMode,
  visibleTasks,
  resultTask,
  resultAssets,
  pendingResultAssetIds,
  credits,
  serverError
}: {
  generationMode: "txt" | "img";
  textPrompt: string;
  imagePrompt: string;
  negativePrompt: string;
  referenceStrength: number;
  customSizeVisible: boolean;
  selectedSize: string;
  customWidth: number;
  customHeight: number;
  generationCount: number;
  stylePreset: string;
  onModeChange: (mode: "txt" | "img") => void;
  onTextPromptChange: (prompt: string) => void;
  onImagePromptChange: (prompt: string) => void;
  onNegativePromptChange: (prompt: string) => void;
  onReferenceStrengthChange: (value: number) => void;
  onCustomSizeChange: (visible: boolean) => void;
  onSelectedSizeChange: (size: string) => void;
  onCustomWidthChange: (width: number) => void;
  onCustomHeightChange: (height: number) => void;
  onGenerationCountChange: (count: number) => void;
  onStylePresetChange: (stylePreset: string) => void;
  onGenerate: () => void;
  onDownload: (assetId?: string) => void;
  onUseAsSource: (assetId: string) => void;
  onShortcutToImageMode: () => void;
  visibleTasks: ImageGenerationTask[];
  resultTask?: ImageGenerationTask;
  resultAssets: ImageAsset[];
  pendingResultAssetIds: string[];
  credits: number;
  serverError: string;
}) {
  const imageMode = generationMode === "img";
  return (
    <section aria-label="AI 生图工作台">
      <div className="mode" role="tablist" aria-label="生成模式">
        <button className={!imageMode ? "active" : ""} type="button" role="tab" aria-selected={!imageMode} onClick={() => onModeChange("txt")}>文生图</button>
        <button className={imageMode ? "active" : ""} type="button" role="tab" aria-selected={imageMode} onClick={() => onModeChange("img")}>图生图</button>
      </div>
      <section className="workspace-grid">
        <aside className="panel">
          <div className="panel-head"><h2>{imageMode ? "图生图参数" : "文生图参数"}</h2><span className="badge">预计 {imageMode ? 32 : 18} 积分</span></div>
          <div className="panel-body">
            {imageMode && <UploadField />}
            <div className="field">
              <label>{imageMode ? "修改方向说明" : "Prompt"}</label>
              <textarea
                aria-label={imageMode ? "修改方向说明" : "Prompt"}
                value={imageMode ? imagePrompt : textPrompt}
                onChange={event => imageMode ? onImagePromptChange(event.target.value) : onTextPromptChange(event.target.value)}
              />
            </div>
            {!imageMode && (
              <div className="field">
                <label>Negative Prompt</label>
                <textarea
                  aria-label="Negative Prompt"
                  value={negativePrompt}
                  onChange={event => onNegativePromptChange(event.target.value)}
                />
              </div>
            )}
            {imageMode && (
              <>
                <div className="field"><label>参考强度 <span>{referenceStrength}%</span></label><input className="slider" type="range" aria-label="参考强度" min="10" max="90" value={referenceStrength} onChange={event => onReferenceStrengthChange(Number(event.target.value))} /></div>
                <div className="field"><label>结构保持模式</label><select className="select" aria-label="结构保持模式"><option>balanced · 平衡结构与风格</option><option>outline · 保持轮廓</option><option>pose · 保持姿态</option></select></div>
              </>
            )}
            <div className="field">
              <label>风格预设</label>
              <div className="chips">
                {stylePresetOptions.map(option => (
                  <button
                    className={`chip ${option === stylePreset ? "active" : ""}`}
                    key={option}
                    type="button"
                    aria-pressed={option === stylePreset}
                    onClick={() => onStylePresetChange(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
            <div className="row">
              <div className="field">
                <label>尺寸</label>
                <select
                  className="select"
                  aria-label="尺寸"
                  value={selectedSize}
                  onChange={event => {
                    onSelectedSizeChange(event.target.value);
                    onCustomSizeChange(event.target.value === "custom");
                  }}
                >
                  <option value="1024x1024">1024 x 1024</option>
                  <option value="1344x768">1344 x 768</option>
                  <option value="768x1344">768 x 1344</option>
                  <option value="custom">手动输入</option>
                </select>
              </div>
              <div className="field"><label>数量</label><select className="select" aria-label="数量" value={generationCount} onChange={event => onGenerationCountChange(Number(event.target.value))}><option value={4}>4 张</option><option value={2}>2 张</option><option value={1}>1 张</option></select></div>
            </div>
            {customSizeVisible && (
              <div className="field">
                <label>手动尺寸</label>
                <div className="size-custom">
                  <input className="input" type="number" aria-label="手动宽度" min="512" max="2048" step="64" value={customWidth} onChange={event => onCustomWidthChange(Number(event.target.value))} />
                  <input className="input" type="number" aria-label="手动高度" min="512" max="2048" step="64" value={customHeight} onChange={event => onCustomHeightChange(Number(event.target.value))} />
                </div>
                <span className="small">支持 512-2048px，建议使用 64 的倍数。</span>
              </div>
            )}
            <div className="cost"><span>预计消耗 / 当前余额</span><strong>{imageMode ? "32" : "18"} / {credits.toLocaleString()} 积分</strong></div>
            <button className="btn primary full" type="button" onClick={onGenerate}>生成图片</button>
          </div>
        </aside>
        <section className="panel canvas">
          <WorkspaceResultStage
            task={resultTask}
            assets={resultAssets}
            pendingAssetIds={pendingResultAssetIds}
            onDownload={onDownload}
            onUseAsSource={onUseAsSource}
          />
        </section>
        <AsideTasks onShortcutToImageMode={onShortcutToImageMode} visibleTasks={visibleTasks} serverError={serverError} />
      </section>
    </section>
  );
}

function WorkspaceResultStage({
  task,
  assets,
  pendingAssetIds,
  onDownload,
  onUseAsSource
}: {
  task?: ImageGenerationTask;
  assets: ImageAsset[];
  pendingAssetIds: string[];
  onDownload: (assetId?: string) => void;
  onUseAsSource: (assetId: string) => void;
}) {
  const hasAssets = assets.length > 0;
  const isActive = task?.status === "queued" || task?.status === "running" || task?.status === "storing" || task?.status === "reviewing";
  const isFailed = task?.status === "failed" || task?.status === "refunded";

  return (
    <div className="stage">
      {hasAssets ? (
        <div className="stage-results">
          <div className="stage-head">
            <div>
              <span className="small">{task ? `${taskTypeLabel(task.taskType)} · ${task.status} · ${task.id}` : "生成结果"}</span>
              <strong>{assets.length > 1 ? "本次生成结果" : assets[0].title}</strong>
            </div>
            <span className="status ok">已保存到资产中心</span>
          </div>
          <div className="result-grid">
            {assets.map(asset => (
              <article className="result-card" key={asset.id}>
                <div className="result-image" role="img" aria-label={asset.title} style={{ backgroundImage: `url(${asset.imageUrl})` }} />
                <div className="result-meta">
                  <div>
                    <strong>{asset.title}</strong>
                    <span className="small">{asset.id} · {asset.width} x {asset.height}</span>
                  </div>
                  <div className="result-actions">
                    <button className="mini" type="button" onClick={() => onDownload(asset.id)}>下载</button>
                    <button className="mini" type="button" onClick={() => onUseAsSource(asset.id)}>图生图</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : (
        <div className={`stage-empty ${isFailed ? "failed" : isActive ? "working" : ""}`}>
          <div>
            {isActive && <span className="status wait">{task.status}</span>}
            {isFailed && <span className="status bad">{task.status}</span>}
            <strong>
              {isActive ? "正在生成结果" : isFailed ? "本次生成未完成" : pendingAssetIds.length > 0 ? "正在加载生成结果" : "结果将在这里生成"}
            </strong>
            <span>
              {isActive
                ? `${taskTypeLabel(task.taskType)}任务 ${task.id} 正在处理，完成后会在这里显示图片。`
                : isFailed
                  ? task.errorMessage || "请调整 Prompt 或参数后重试。"
                  : pendingAssetIds.length > 0
                    ? `任务已完成，正在同步资产 ${pendingAssetIds.join(", ")}。`
                    : "完成左侧参数后提交任务，文生图和图生图结果都会显示在这里。"}
            </span>
            {isActive && <div className="bar"><span /></div>}
          </div>
        </div>
      )}
    </div>
  );
}

function UploadField() {
  return (
    <div className="field">
      <label>参考图 / sourceAssetId</label>
      <div className="upload-card">
        <div className="upload-preview" />
        <strong>拖拽上传 JPG / PNG / WebP，单图不超过 10MB</strong>
        <span className="small">也可以从历史资产选择源图。上传后会先做格式、大小和图片合规校验。</span>
        <div className="chips"><span className="chip active">使用 IMG-1832</span><span className="chip">从资产中心选择</span><span className="status bad">格式错误</span><span className="status bad">上传违规</span></div>
      </div>
    </div>
  );
}

function AsideTasks({ onShortcutToImageMode, visibleTasks, serverError }: { onShortcutToImageMode: () => void; visibleTasks: ImageGenerationTask[]; serverError: string }) {
  return (
    <aside className="panel">
      <div className="panel-head"><h2>任务与继续编辑</h2><span className="badge">状态映射</span></div>
      <div className="panel-body recent">
        {serverError && <div className="api-state bad">{serverError}</div>}
        {visibleTasks.map(task => <div className="task" key={task.id}><strong>{task.status} · {task.id}</strong><span>{task.prompt}</span><p className="code">model={task.modelProvider}/{task.modelName} · chargedCredits={task.chargedCredits}</p>{(task.status === "running" || task.status === "storing") && <div className="bar"><span /></div>}</div>)}
        <div className="task"><strong>failed · Prompt 合规拦截</strong><span>原因：包含受限品牌商标描述，请修改后重试。</span><button className="btn" type="button">修改 Prompt</button></div>
        <div className="history"><span className="thumb" /><div><strong>图生图入口</strong><span className="small">可先从资产中心选择历史图片作为 sourceAssetId。</span></div></div>
        <button className="btn" type="button" onClick={onShortcutToImageMode}>选择历史资产后继续图生图</button>
      </div>
    </aside>
  );
}

function AssetsPage({
  selectedAssetId,
  sessionState,
  sessionHydrated,
  initialAssets,
  initialVersionNodes,
  onSelectAsset,
  onDownload,
  onDelete,
  onImageToImage
}: {
  selectedAssetId: string;
  sessionState: SessionState;
  sessionHydrated: boolean;
  initialAssets: ImageAsset[];
  initialVersionNodes: AssetVersionNode[];
  onSelectAsset: (assetId: string) => void;
  onDownload: (assetId?: string) => void;
  onDelete: (assetId?: string) => void;
  onImageToImage: () => void;
}) {
  const [filteredAssets, setFilteredAssets] = useState<ImageAsset[] | null>(null);
  const [filteredVersionNodes, setFilteredVersionNodes] = useState<AssetVersionNode[] | null>(null);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [query, setQuery] = useState("");
  const [taskType, setTaskType] = useState<"" | GenerationMode>("");
  const [status, setStatus] = useState<"" | AssetStatus>("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const visibleAssets = filteredAssets || initialAssets;
  const visibleVersionNodes = filteredVersionNodes || initialVersionNodes;
  const selected = visibleAssets.find(asset => asset.id === selectedAssetId) || initialAssets.find(asset => asset.id === selectedAssetId) || visibleAssets[0] || initialAssets[0];
  const filtersActive = Boolean(query || taskType || status);

  useEffect(() => {
    let active = true;

    async function loadAssets() {
      if (!sessionHydrated) return;

      if (sessionState !== "logged-in") {
        setFilteredAssets([]);
        setFilteredVersionNodes([]);
        setPagination(null);
        setLoadError("");
        setLoading(false);
        return;
      }

      const filters: ListImageAssetsQuery = {
        page: 1,
        pageSize: 20,
        q: query,
        taskType: taskType || undefined,
        status: status || undefined
      };

      setLoading(true);
      try {
        const payload = await listImageAssets(filters);
        if (!active) return;
        setFilteredAssets(payload.assets);
        setFilteredVersionNodes(payload.versionNodes);
        setPagination(payload.pagination);
        setLoadError("");
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiClientError && error.status === 401) {
          setFilteredAssets([]);
          setFilteredVersionNodes([]);
        }
        setLoadError(errorMessage(error, "请登录后查看你的资产列表"));
      } finally {
        if (active) setLoading(false);
      }
    }

    loadAssets();

    return () => {
      active = false;
    };
  }, [query, sessionHydrated, sessionState, taskType, status]);

  if (!selected) {
    const emptyMessage = !sessionHydrated
      ? "正在校验登录状态..."
      : sessionState !== "logged-in"
        ? "登录后可查看你的资产、版本链和下载权限。"
        : filtersActive
          ? "没有匹配的资产。请调整搜索词、任务类型或状态筛选。"
          : "暂无资产。生成图片成功后，结果会进入资产中心并显示版本链和下载权限。";

    return (
      <section aria-label="图片资产中心">
        <div className="empty-card">{emptyMessage}</div>
        {loadError && <div className="api-state bad">{loadError}</div>}
      </section>
    );
  }

  return (
    <section aria-label="图片资产中心">
      <section className="toolbar" aria-label="筛选区">
        <input className="input" aria-label="搜索资产" placeholder="搜索 Prompt、任务 ID、文件名" value={query} onChange={event => setQuery(event.target.value)} />
        <select className="select" aria-label="任务类型筛选" value={taskType} onChange={event => setTaskType(event.target.value as "" | GenerationMode)}>
          {taskTypeOptions.map(option => <option key={option.value || "all"} value={option.value}>{option.label}</option>)}
        </select>
        <select className="select" aria-label="资产状态筛选" value={status} onChange={event => setStatus(event.target.value as "" | AssetStatus)}>
          {assetStatusOptions.map(option => <option key={option.value || "all"} value={option.value}>{option.label}</option>)}
        </select>
        <select className="select" aria-label="资产排序"><option>按最近生成排序</option><option>按下载时间排序</option></select>
      </section>
      <div className="api-state" role="status" aria-live="polite">
        {loading ? "正在从 API 加载资产列表..." : pagination ? `API 列表：第 ${pagination.page} 页，共 ${pagination.total} 张资产` : "本地资产列表"}
      </div>
      {loadError && <div className="api-state bad">{loadError}</div>}
      <section className="asset-layout">
        <div className="masonry">
          {visibleAssets.length === 0 && <div className="empty-card">没有匹配的资产。请调整搜索词、任务类型或状态筛选。</div>}
          {visibleAssets.map(asset => <button className={`asset ${asset.id === selectedAssetId ? "active" : ""}`} key={asset.id} type="button" onClick={() => onSelectAsset(asset.id)}><div className="pic" style={{ backgroundImage: `linear-gradient(135deg, rgba(124, 92, 255, 0.28), rgba(24, 214, 194, 0.12)), url(${asset.imageUrl})` }} /><div className="meta"><div className="line"><strong>{asset.title}</strong><span className={`status ${asset.status === "succeeded" ? "ok" : asset.status === "processing" || asset.status === "reviewing" ? "wait" : "bad"}`}>{asset.status}</span></div><p className="small">{asset.id} · {asset.taskType} · {asset.createdAt} · {asset.modelProvider}/{asset.modelName}</p></div></button>)}
        </div>
        <aside className="asset-side">
          <h2>{selected.title}</h2>
          <div className="preview-img" style={{ backgroundImage: `linear-gradient(135deg, rgba(124, 92, 255, 0.3), rgba(24, 214, 194, 0.13)), url(${selected.imageUrl})` }} />
          <p className="small">{selected.id} · {selected.taskType} · {selected.status} · 来源任务 {selected.taskId}</p>
          {selected.commercialAuthorizationStatement && <p className="notice">{selected.commercialAuthorizationStatement}</p>}
          <div className="actions"><button className="btn primary" type="button" onClick={() => onDownload(selected.id)}>下载</button><Link className="btn" href="/workspace/image" onClick={onImageToImage}>继续图生图</Link><button className="btn" type="button" onClick={() => onDelete(selected.id)}>删除</button></div>
          <div className="timeline"><strong>版本链</strong>{visibleVersionNodes.map(node => <div className="node" key={node.id}><span className="dot" /><div className="rel">{node.label}</div></div>)}</div>
        </aside>
      </section>
    </section>
  );
}

function AccountPage({
  account,
  credits,
  orders,
  sessionState,
  onRefreshSession,
  onLogout
}: {
  account: AuthAccount | null;
  credits: number;
  orders: BillingOrder[];
  sessionState: "logged-in" | "guest" | "expired";
  onRefreshSession: () => void;
  onLogout: () => void;
}) {
  const displayName = account?.displayName || "未登录用户";
  const avatar = displayName.slice(0, 1).toUpperCase();
  const visibleOrders = orders.slice(0, 2);

  return (
    <section aria-label="用户体系">
      <section className="auth-hero">
        <div className="auth-panel">
          <span className="eyebrow">Flux Art Account</span>
          <h1>账户只回答三件事：登录、积分、订单。</h1>
          <p className="lead">所有功能只看积分余额；支付积分后即可生成、图生图、保存和下载。</p>
          <div className="auth-state">
            <div className="avatar">{avatar}</div>
            <div>
              <div className="line"><h2 style={{ margin: 0 }}>{displayName} · {sessionState === "logged-in" ? "已登录" : "未登录"}</h2><span className={`status ${sessionState === "logged-in" ? "ok" : "wait"}`}>{sessionState === "logged-in" ? "登录有效" : "未登录"}</span></div>
              <p className="small">{account?.username ? `${account.username} · 积分充足，全部功能可用` : "游客可浏览能力和填写参数；生成、保存、下载和购买积分前需要登录。"}</p>
            </div>
          </div>
          <div className="auth-actions"><button className="btn primary" type="button" onClick={onRefreshSession}>刷新 session</button><button className="btn" type="button" onClick={onLogout}>退出</button></div>
        </div>
        <aside className="auth-panel"><h2>登录状态</h2><div className="stack"><div className={`status ${sessionState === "logged-in" ? "ok" : "wait"}`}>{sessionState === "logged-in" ? "server session 已验证" : "需要登录后继续"}</div><button className="btn primary full" type="button" onClick={onRefreshSession}>刷新 session</button><button className="btn full" type="button" onClick={onLogout}>退出当前 session</button></div></aside>
      </section>
      <section className="account-grid">
        <article className="account-card stack"><div className="panel-head compact"><h2>积分</h2><span className="badge">生成前校验</span></div><div className="metric"><span>可用积分</span><strong>{credits}</strong><small>当前任务预估 18 积分</small></div><button className="btn full" type="button">购买积分</button></article>
        <article className="account-card stack"><div className="panel-head compact"><h2>订单</h2><span className="badge">积分到账依据</span></div>{visibleOrders.length === 0 && <div className="invoice"><div><strong>暂无订单</strong><p className="small">购买积分后显示支付状态</p></div><span className="status wait">待购买</span></div>}{visibleOrders.map(order => <div className="invoice" key={order.orderId}><div><strong>{billingPlanLabel(order.planId)}</strong><p className="small">{order.outTradeNo || order.orderId}</p></div><span className={`status ${order.fulfillmentStatus === "fulfilled" ? "ok" : "wait"}`}>{orderStatusLabel(order)}</span></div>)}</article>
        <article className="account-card stack"><div className="panel-head compact"><h2>积分校验</h2><span className={`status ${sessionState === "logged-in" ? "ok" : "wait"}`}>{sessionState === "logged-in" ? "已登录" : "未登录"}</span></div>{["生成图片", "图生图", "下载原图"].map(item => <div className="account-row" key={item}><span>{item}</span><strong>{sessionState === "logged-in" ? "余额足够即可用" : "需登录"}</strong></div>)}</article>
      </section>
    </section>
  );
}

const creditPackOptions: Array<{ planId: BillingPlanId; label: string; price: string }> = [
  { planId: "credits-500", label: "500 积分", price: "¥29" },
  { planId: "credits-1500", label: "1,500 积分", price: "¥79" },
  { planId: "credits-5000", label: "5,000 积分", price: "¥199" }
];

function BillingPage({
  credits,
  orders,
  onCreateOrder
}: {
  credits: number;
  orders: BillingOrder[];
  onCreateOrder: (planId: BillingPlanId) => void;
}) {
  const visibleOrders = orders.slice(0, 5);

  return (
    <section aria-label="积分购买">
      <section className="billing-hero">
        <div className="billing-panel">
          <h1>购买积分后解锁全部功能。</h1>
          <p className="lead">Flux Art 统一使用积分。文生图、图生图、保存资产、高清无水印下载都按积分消耗处理。</p>
          <div className="balance"><div className="metric"><span>当前积分余额</span><strong>{credits}</strong><small>可用于所有生成与下载操作</small></div><div className="metric"><span>当前订单状态</span><strong>{visibleOrders[0] ? orderStatusLabel(visibleOrders[0]) : "暂无订单"}</strong><small>支付成功后积分立即到账</small></div></div>
          <div className="notice">统一规则：余额足够即可使用全部功能；余额不足时只引导购买积分。</div>
        </div>
        <aside className="billing-panel"><h2>积分包</h2><div className="packs">{creditPackOptions.map(pack => <button className="pack" key={pack.planId} type="button" onClick={() => onCreateOrder(pack.planId)} aria-label={`购买 ${pack.label}`}><span>{pack.label}</span><strong>{pack.price}</strong></button>)}</div><button className="btn primary full" type="button" style={{ marginTop: 14 }} onClick={() => onCreateOrder("credits-1500")}>购买积分包</button></aside>
      </section>
      <section className="plans" aria-label="积分包">
        {[
          { title: "试用积分", price: "¥0", items: "注册后领取少量积分,可体验文生图和图生图,余额不足时引导购买", action: "查看余额" },
          { title: "通用积分", price: "按量购买", items: "解锁全部核心功能,失败未扣点自动退回,生成和下载统一扣积分", action: "购买积分", planId: "credits-1500" as const },
          { title: "订单状态", price: "到账即用", items: "支付成功后积分到账,待支付订单不解锁功能,只保留积分购买记录", action: "查看订单" }
        ].map(plan => <article className={`plan ${plan.planId ? "hot" : ""}`} key={plan.title}><h2>{plan.title}</h2><div className="price">{plan.price}</div><div className="list">{plan.items.split(",").map(item => <span className="item" key={item}><i className="dot" />{item}</span>)}</div><button className={`btn ${plan.planId ? "primary" : ""}`} type="button" disabled={!plan.planId} onClick={() => { if (plan.planId) onCreateOrder(plan.planId); }}>{plan.action}</button></article>)}
      </section>
      <section className="account-card stack" aria-label="最近订单">
        <h2>最近订单</h2>
        {visibleOrders.length === 0 && <div className="invoice"><strong>暂无订单</strong><span>购买后会显示支付与履约状态</span></div>}
        {visibleOrders.map(order => (
          <div className="invoice" key={order.orderId}>
            <div>
              <strong>{billingPlanLabel(order.planId)}</strong>
              <p className="small">{order.outTradeNo || order.orderId} · {orderStatusLabel(order)}</p>
            </div>
            {(order.fulfillmentStatus === "retryable" || order.status === "failed") ? (
              <button className="btn" type="button" onClick={() => onCreateOrder(order.planId)}>重新支付</button>
            ) : order.paymentUrl && order.fulfillmentStatus !== "fulfilled" ? (
              <a className="btn" href={order.paymentUrl}>继续支付</a>
            ) : (
              <span className={`status ${order.fulfillmentStatus === "fulfilled" ? "ok" : "wait"}`}>{orderStatusLabel(order)}</span>
            )}
          </div>
        ))}
      </section>
    </section>
  );
}

function DownloadModal({ decision, onClose }: { decision: DownloadDecision | null; onClose: () => void }) {
  function confirmDownload() {
    if (decision?.allowed && decision.downloadUrl) {
      const link = document.createElement("a");
      link.href = decision.downloadUrl;
      link.download = `${decision.assetId}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    onClose();
  }

  return (
    <div className={`modal ${decision ? "show" : ""}`} role="dialog" aria-modal="true" aria-labelledby="download-modal-title" hidden={!decision} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="dialog">
        <h2 id="download-modal-title">积分解锁确认</h2>
        <p>{decision?.reason || "下载前会统一判断登录状态、积分余额和订单生效状态。"}</p>
        <div className="rights"><div className="right"><span>当前余额</span><strong>{decision ? `${decision.costCredits} 积分待扣` : "余额足够即可用"}</strong></div><div className="right"><span>本次下载</span><strong>{decision?.allowed ? `${decision.quality} · ${decision.watermark ? "带水印" : "无水印"} · ${decision.costCredits} credits` : "不可下载"}</strong></div><div className="right"><span>解锁规则</span><strong>生成和下载统一扣积分</strong></div></div>
        <button className="btn primary full" type="button" onClick={confirmDownload}>确认并下载</button>
      </div>
    </div>
  );
}

function AuthModal({
  open,
  action,
  onClose,
  onSubmit
}: {
  open: boolean;
  action: string | null;
  onClose: () => void;
  onSubmit: (input: { mode: "login" | "register"; username: string; password: string; displayName?: string }) => void;
}) {
  const visible = open;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({
      mode: "login",
      username,
      password
    });
  }

  return (
    <div className={`modal ${visible ? "show" : ""}`} role="dialog" aria-modal="true" aria-labelledby="auth-modal-title" hidden={!visible} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="dialog" onSubmit={handleSubmit}>
        <h2 id="auth-modal-title">{action ? `登录后继续：${action}` : "登录后继续创作"}</h2>
        <label>用户名<input className="input" value={username} onChange={event => setUsername(event.target.value)} minLength={3} maxLength={32} required /></label>
        <label className="auth-password-field">密码<input className="input" type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={8} maxLength={128} required /></label>
        <button className="btn primary full" type="submit">立即登录</button>
        <button className="btn full" type="button" style={{ marginTop: 10 }} onClick={onClose}>稍后再说</button>
      </form>
    </div>
  );
}

function LogoutModal({ open, onCancel, onConfirm }: { open: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className={`modal ${open ? "show" : ""}`} role="dialog" aria-modal="true" aria-labelledby="logout-modal-title" hidden={!open}>
      <div className="dialog">
        <h2 id="logout-modal-title">确认退出登录？</h2>
        <p>退出后切换为游客态；积分余额和购买记录仍保留在账号内。</p>
        <div className="rights"><div className="right"><span>登录状态</span><strong>切换为游客</strong></div><div className="right"><span>积分余额</span><strong>账号内保留</strong></div><div className="right"><span>再次使用</span><strong>重新登录</strong></div></div>
        <button className="btn primary full" type="button" onClick={onConfirm}>确认退出</button>
        <button className="btn full" type="button" style={{ marginTop: 10 }} onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}
