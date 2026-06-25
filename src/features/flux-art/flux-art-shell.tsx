"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Brush, Eraser, Eye, Undo2 } from "lucide-react";
import {
  ApiClientError,
  createBillingOrder,
  deleteImageAsset,
  createDownloadDecision,
  createImageTask,
  getAccountCredits,
  getAccountMembership,
  getCurrentAuthSession,
  listBillingOrders,
  listImageAssets,
  listImageTasks,
  loginWithPassword,
  logoutCurrentSession,
  registerAccount
} from "@/features/flux-art/api/image-workspace-client";
import { toTaskType, type ProductPage, useImageWorkspaceStore } from "@/features/flux-art/stores/image-workspace-store";
import type { AuthAccount } from "@/types/auth";
import type { BillingOrder, BillingPlanId } from "@/types/billing";
import type {
  AccountCreditsSummary,
  AccountMembershipSummary,
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
  { page: "edit", href: "/workspace/image/edit/IMG-1832", label: "图片编辑" },
  { page: "assets", href: "/workspace/image/assets", label: "资产中心" },
  { page: "account", href: "/workspace/account", label: "用户体系" },
  { page: "billing", href: "/workspace/billing", label: "权益购买" }
];

const stateCards = [
  ["初始空态", "示例图和能力说明"],
  ["参数编辑态", "可调整尺寸、数量、结构模式"],
  ["提交中", "参数锁定，创建任务"],
  ["任务处理中", "queued / processing / reviewing"],
  ["结果展示态", "succeeded 后进入资产"],
  ["权益不足态", "积分不足或 Pro 权益不足"],
  ["合规拦截态", "Prompt / 上传图拦截"],
  ["失败重试态", "超时、审核失败可重试"]
];

const taskTypeOptions: Array<{ value: "" | GenerationMode; label: string }> = [
  { value: "", label: "全部任务类型" },
  { value: "t2i", label: "文生图" },
  { value: "i2i", label: "图生图" },
  { value: "inpaint", label: "局部重绘" },
  { value: "outpaint", label: "扩图" }
];

const assetStatusOptions: Array<{ value: "" | AssetStatus; label: string }> = [
  { value: "", label: "全部状态" },
  { value: "succeeded", label: "成功" },
  { value: "reviewing", label: "审核中" },
  { value: "processing", label: "生成中" },
  { value: "failed", label: "失败" }
];

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
      TASK_CAPABILITY_REQUIRED: "当前会员权益不支持这个任务类型。",
      TASK_STATE_TRANSITION_INVALID: "任务状态已变化，请刷新后重试。"
    };
    return error.errorCode ? messages[error.errorCode] || error.message : error.message;
  }
  return errorMessage(error, fallback);
}

function memberStatusLabel(status: AccountMembershipSummary["memberStatus"]) {
  const labels: Record<AccountMembershipSummary["memberStatus"], string> = {
    free: "免费用户",
    credit_pack: "积分额度用户",
    pro_trial: "Pro 试用",
    pro: "Pro 用户"
  };
  return labels[status];
}

function billingPlanLabel(planId: BillingPlanId) {
  const labels: Record<BillingPlanId, string> = {
    "credits-500": "500 credits",
    "credits-1500": "1,500 credits",
    "credits-5000": "5,000 credits",
    "pro-monthly": "Pro 月度会员"
  };
  return labels[planId];
}

function orderStatusLabel(order: BillingOrder) {
  if (order.fulfillmentStatus === "fulfilled") return "已履约";
  if (order.fulfillmentStatus === "retryable" || order.status === "failed") return "可重试";
  if (order.status === "paid") return "已支付";
  return "待支付";
}

export function FluxArtShell({ activePage, initialAssetId }: { activePage: ProductPage; initialAssetId?: string }) {
  const store = useImageWorkspaceStore();
  const [downloadDecision, setDownloadDecision] = useState<DownloadDecision | null>(null);
  const [authModal, setAuthModal] = useState<string | null>(null);
  const [showLogout, setShowLogout] = useState(false);
  const [sessionTasks, setSessionTasks] = useState<ImageGenerationTask[]>([]);
  const [serverAssets, setServerAssets] = useState<ImageAsset[]>([]);
  const [serverVersionNodes, setServerVersionNodes] = useState<AssetVersionNode[]>([]);
  const [serverTasks, setServerTasks] = useState<ImageGenerationTask[]>([]);
  const [creditsSummary, setCreditsSummary] = useState<AccountCreditsSummary | null>(null);
  const [membershipSummary, setMembershipSummary] = useState<AccountMembershipSummary | null>(null);
  const [billingOrders, setBillingOrders] = useState<BillingOrder[]>([]);
  const [authAccount, setAuthAccount] = useState<AuthAccount | null>(null);
  const [serverError, setServerError] = useState("");

  const credits = creditsSummary?.credits ?? 0;
  const proDaysRemaining = membershipSummary?.proDaysRemaining ?? 0;
  const memberStatus = membershipSummary?.memberStatus ?? "free";
  const hasServerSession = authAccount !== null;
  const sessionState = hasServerSession ? "logged-in" : store.sessionState === "expired" ? "expired" : "guest";

  const selectedAsset = useMemo(
    () => serverAssets.find(asset => asset.id === store.selectedAssetId) || serverAssets[0],
    [serverAssets, store.selectedAssetId]
  );

  useEffect(() => {
    if (initialAssetId && serverAssets.some(asset => asset.id === initialAssetId)) {
      useImageWorkspaceStore.getState().setSelectedAssetId(initialAssetId);
    }
  }, [initialAssetId, serverAssets]);

  const clearSessionOwnedState = useCallback(function clearSessionOwnedState() {
    setAuthAccount(null);
    setServerAssets([]);
    setServerVersionNodes([]);
    setServerTasks([]);
    setSessionTasks([]);
    setCreditsSummary(null);
    setMembershipSummary(null);
    setBillingOrders([]);
  }, []);

  const loadSessionOwnedState = useCallback(async function loadSessionOwnedState(account?: AuthAccount) {
    const auth = account ? { account } : await getCurrentAuthSession();

    const [assetPayload, taskPayload, creditsPayload, membershipPayload, ordersPayload] = await Promise.all([
      listImageAssets({ page: 1, pageSize: 100 }),
      listImageTasks({ page: 1, pageSize: 20 }),
      getAccountCredits(),
      getAccountMembership(),
      listBillingOrders()
    ]);

    setServerAssets(assetPayload.assets);
    setServerVersionNodes(assetPayload.versionNodes);
    setServerTasks(taskPayload.tasks);
    setCreditsSummary(creditsPayload);
    setMembershipSummary(membershipPayload);
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
        setServerError(errorMessage(error, "请登录后加载你的资产、任务和权益数据"));
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

  function requireAuth(action: string, done: () => void) {
    if (!hasServerSession) {
      setAuthModal(action);
      return;
    }
    done();
  }

  async function createGenerationTask() {
    requireAuth("生成图片", async () => {
      if (store.generationMode === "img" && !selectedAsset) {
        store.showToast("请先从你的资产中心选择参考图");
        return;
      }

      try {
        const task = await createImageTask({
          taskType: toTaskType(store.generationMode),
          prompt: store.generationMode === "img" ? "参考源图，生成同结构商业摄影变体" : "一张用于电商主图的现代香薰产品摄影",
          negativePrompt: store.generationMode === "img" ? undefined : "低清晰度、畸变、文字水印",
          sourceAssetId: store.generationMode === "img" ? store.selectedAssetId : undefined,
          size: "1024x1024",
          count: store.generationCount,
          stylePreset: "商业摄影"
        });
        setSessionTasks(current => [task, ...current]);
        store.showToast(`任务已提交：${task.modelProvider}/${task.modelName} · ${task.id}`);
      } catch (error) {
        store.showToast(`任务提交失败：${workspaceErrorMessage(error, "请稍后重试")}`);
      }
    });
  }

  async function createEditTask() {
    requireAuth("生成新资产", async () => {
      if (!selectedAsset) {
        store.showToast("请先从你的资产中心选择要编辑的图片");
        return;
      }

      try {
        const task = await createImageTask({
          taskType: toTaskType("txt", store.editMode),
          prompt: store.editMode === "inpaint" ? "替换背景材质，保留主体和光线方向" : "保持摄影棚光线，扩展背景和阴影",
          sourceAssetId: store.selectedAssetId
        });
        setSessionTasks(current => [task, ...current]);
        store.showToast(`编辑任务已提交：${task.id}，结果会生成新资产`);
      } catch (error) {
        store.showToast(`编辑任务提交失败：${workspaceErrorMessage(error, "请稍后重试")}`);
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
    requireAuth("购买权益", async () => {
      try {
        const order = await createBillingOrder(planId);
        setBillingOrders(current => [order, ...current.filter(item => item.orderId !== order.orderId)]);
        store.showToast("订单已创建：正在进入支付流程");
        if (order.paymentUrl) window.location.assign(order.paymentUrl);
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
      store.showToast("登录成功：已恢复 Prompt、尺寸和编辑草稿");
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
        memberLabel={memberStatusLabel(memberStatus)}
        theme={store.theme}
        onToggleTheme={() => store.setTheme(store.theme === "light" ? "dark" : "light")}
        onAuthClick={() => (hasServerSession ? setShowLogout(true) : setAuthModal(""))}
      />

      <Overview />

      {activePage === "workspace" && (
        <WorkspacePage
          generationMode={store.generationMode}
          referenceStrength={store.referenceStrength}
          customSizeVisible={store.customSizeVisible}
          generationCount={store.generationCount}
          onModeChange={store.setGenerationMode}
          onReferenceStrengthChange={store.setReferenceStrength}
          onCustomSizeChange={store.setCustomSizeVisible}
          onGenerationCountChange={store.setGenerationCount}
          onGenerate={createGenerationTask}
          onOpenBilling={() => store.showToast("权益页面包含积分、Pro 和下载权限承接")}
          onShortcutToImageMode={() => {
            store.setGenerationMode("img");
            store.showToast("已切换到图生图：请确认 sourceAssetId 或上传参考图后再提交");
          }}
          onOpenEdit={mode => {
            store.setEditMode(mode);
            store.showToast(`${mode === "outpaint" ? "扩图" : "局部重绘"}已带入当前资产，编辑结果将生成新资产`);
          }}
          sessionTasks={sessionTasks}
          serverTasks={serverTasks}
          credits={credits}
          serverError={serverError}
        />
      )}

      {activePage === "edit" && (
        <EditPage
          selectedAssetId={selectedAsset?.id || store.selectedAssetId}
          editMode={store.editMode}
          paintStrength={store.paintStrength}
          onEditModeChange={store.setEditMode}
          onPaintStrengthChange={store.setPaintStrength}
          onRunEdit={createEditTask}
        />
      )}

      {activePage === "assets" && (
        <AssetsPage
          key={authAccount?.userId || "guest"}
          selectedAssetId={store.selectedAssetId}
          initialAssets={serverAssets}
          initialVersionNodes={serverVersionNodes}
          onSelectAsset={store.setSelectedAssetId}
          onDownload={openDownload}
          onDelete={removeAsset}
          onImageToImage={() => {
            store.setGenerationMode("img");
            store.showToast("已切换到图生图：历史资产已作为 sourceAssetId");
          }}
          onOpenEdit={mode => {
            store.setEditMode(mode);
            store.showToast(`${mode === "outpaint" ? "扩图" : "局部重绘"}已带入当前资产`);
          }}
        />
      )}

      {activePage === "account" && <AccountPage account={authAccount} credits={credits} membership={membershipSummary} memberStatus={memberStatus} proDaysRemaining={proDaysRemaining} sessionState={sessionState} onRefreshSession={refreshSessionState} onLogout={logoutSession} />}
      {activePage === "billing" && <BillingPage credits={credits} memberStatus={memberStatus} proDaysRemaining={proDaysRemaining} includedHdDownloadsRemaining={membershipSummary?.includedHdDownloadsRemaining} orders={billingOrders} onCreateOrder={createOrder} />}

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
  memberLabel,
  theme,
  onToggleTheme,
  onAuthClick
}: {
  activePage: ProductPage;
  sessionLabel: string;
  credits: number;
  memberLabel: string;
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
        <span className="badge pro">{memberLabel}</span>
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

function Overview() {
  return (
    <section className="overview" aria-label="产品概览">
      <div className="overview-card">
        <span className="eyebrow">Flux Art · AI Image SaaS · V1.0</span>
        <h1>从第一次生成到付费下载的完整创作闭环。</h1>
        <p className="lead">面向个人创作者、中小企业、电商运营和内容编辑。Next.js 版本包含生图工作台、图片编辑页、资产中心、用户权益体系和购买承接。</p>
        <div className="flow">
          {["生成图片", "继续编辑", "资产沉淀", "用户体系", "权益转化"].map((title, index) => (
            <div key={title}>
              <strong>{title}</strong>
              <p className="small">{["文生图 / 图生图", "基于已有资产进入重绘 / 扩图", "任务记录、版本链、下载", "登录状态、积分、会员、权限、订单", "积分、Pro、高清无水印"][index]}</p>
            </div>
          ))}
        </div>
      </div>
      <aside className="overview-card metric-grid">
        <div className="metric"><span>默认模型</span><strong>OpenAI gpt-image-2</strong><small>可配置 custom provider / model / baseUrl</small></div>
        <div className="metric"><span>今日任务</span><strong>18</strong><small>成功 12 · 生成中 4 · 权益不足 2</small></div>
      </aside>
    </section>
  );
}

function WorkspacePage({
  generationMode,
  referenceStrength,
  customSizeVisible,
  generationCount,
  onModeChange,
  onReferenceStrengthChange,
  onCustomSizeChange,
  onGenerationCountChange,
  onGenerate,
  onOpenBilling,
  onShortcutToImageMode,
  onOpenEdit,
  sessionTasks,
  serverTasks,
  credits,
  serverError
}: {
  generationMode: "txt" | "img";
  referenceStrength: number;
  customSizeVisible: boolean;
  generationCount: number;
  onModeChange: (mode: "txt" | "img") => void;
  onReferenceStrengthChange: (value: number) => void;
  onCustomSizeChange: (visible: boolean) => void;
  onGenerationCountChange: (count: number) => void;
  onGenerate: () => void;
  onOpenBilling: () => void;
  onShortcutToImageMode: () => void;
  onOpenEdit: (mode: "inpaint" | "outpaint") => void;
  sessionTasks: ImageGenerationTask[];
  serverTasks: ImageGenerationTask[];
  credits: number;
  serverError: string;
}) {
  const imageMode = generationMode === "img";
  return (
    <section aria-label="AI 生图工作台">
      <div className="mode" role="tablist" aria-label="生成模式">
        <button className={!imageMode ? "active" : ""} type="button" role="tab" aria-selected={!imageMode} onClick={() => onModeChange("txt")}>文生图</button>
        <button className={imageMode ? "active" : ""} type="button" role="tab" aria-selected={imageMode} onClick={() => onModeChange("img")}>图生图</button>
        <button className="entry" type="button" onClick={() => onOpenEdit("inpaint")}><strong>局部重绘</strong> · 需选择资产</button>
        <button className="entry" type="button" onClick={() => onOpenEdit("outpaint")}><strong>扩图</strong> · Pro 资产编辑</button>
      </div>
      <section className="workspace-grid">
        <aside className="panel">
          <div className="panel-head"><h2>{imageMode ? "图生图参数" : "文生图参数"}</h2><span className="badge">预计 {imageMode ? 60 : 40} 积分</span></div>
          <div className="panel-body">
            {imageMode && <UploadField />}
            <div className="field"><label>{imageMode ? "修改方向说明" : "Prompt"}</label><textarea aria-label={imageMode ? "修改方向说明" : "Prompt"} defaultValue={imageMode ? "保持源图主体结构，生成更适合电商详情页的高级商业摄影版本" : "一张用于电商主图的现代香薰产品摄影，暗色背景，柔和边缘光，真实材质，高级商业摄影"} /></div>
            {!imageMode && <div className="field"><label>Negative Prompt</label><textarea aria-label="Negative Prompt" defaultValue="低清晰度、畸变、文字水印、过度锐化、卡通玩具感" /></div>}
            {imageMode && (
              <>
                <div className="field"><label>参考强度 <span>{referenceStrength}%</span></label><input className="slider" type="range" aria-label="参考强度" min="10" max="90" value={referenceStrength} onChange={event => onReferenceStrengthChange(Number(event.target.value))} /></div>
                <div className="field"><label>结构保持模式</label><select className="select" aria-label="结构保持模式"><option>balanced · 平衡结构与风格</option><option>outline · 保持轮廓</option><option>pose · 保持姿态</option></select></div>
              </>
            )}
            <div className="field"><label>风格预设</label><div className="chips"><span className="chip active">商业摄影</span><span className="chip">电商海报</span><span className="chip">极简产品</span><span className="chip">室内空间</span></div></div>
            <div className="row">
              <div className="field"><label>尺寸</label><select className="select" aria-label="尺寸" onChange={event => onCustomSizeChange(event.target.value === "custom")}><option>1024 x 1024</option><option>1344 x 768</option><option>768 x 1344</option><option value="custom">手动输入</option></select></div>
              <div className="field"><label>数量</label><select className="select" aria-label="数量" value={generationCount} onChange={event => onGenerationCountChange(Number(event.target.value))}><option value={4}>4 张</option><option value={2}>2 张</option><option value={1}>1 张</option></select></div>
            </div>
            {customSizeVisible && <div className="field"><label>手动尺寸</label><div className="size-custom"><input className="input" type="number" aria-label="手动宽度" min="512" max="2048" step="64" defaultValue="1024" /><input className="input" type="number" aria-label="手动高度" min="512" max="2048" step="64" defaultValue="1024" /></div><span className="small">支持 512-2048px，建议使用 64 的倍数。</span></div>}
            <div className="cost"><span>预计消耗 / 当前余额</span><strong>{imageMode ? "60" : "40"} / {credits.toLocaleString()} 积分</strong></div>
            <button className="btn primary full" type="button" onClick={onGenerate}>生成图片</button>
          </div>
        </aside>
        <section className="panel canvas">
          <div className="benefit"><span>权益提示：生成前校验登录、积分和输入合规；下载前再判断水印、高清和商用权限。</span><Link className="btn" href="/workspace/billing" onClick={onOpenBilling}>查看权益</Link></div>
          <div className="stage">
            <div className="state-strip" aria-label="页面状态示例">
              {stateCards.map(([title, text]) => <div className="state-card" key={title}><strong>{title}</strong><span className="small">{text}</span></div>)}
            </div>
            <div className="result-grid">
              <ImageResult status="succeeded" statusClass="ok" actions={<><button className="mini" type="button">下载</button><button className="mini" type="button" onClick={onShortcutToImageMode}>作为参考图</button><Link className="mini btn" href="/workspace/image/edit/IMG-1832">去重绘</Link></>} />
              <ImageResult status="reviewing" statusClass="wait" variant="alt" actions={<><button className="mini" type="button">输出审核中</button><Link className="mini btn" href="/workspace/image/assets">入库后查看</Link></>} />
              <ImageResult status="processing 68%" statusClass="wait" actions={<button className="mini" type="button">queued → processing</button>} />
              <ImageResult status="failed · 积分不足" statusClass="bad" variant="fail" actions={<><Link className="mini btn" href="/workspace/billing">补充积分</Link><button className="mini" type="button">重试任务</button></>} />
            </div>
          </div>
        </section>
        <AsideTasks onShortcutToImageMode={onShortcutToImageMode} sessionTasks={sessionTasks} serverTasks={serverTasks} serverError={serverError} />
      </section>
    </section>
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

function ImageResult({ status, statusClass, variant = "", actions }: { status: string; statusClass: string; variant?: string; actions: React.ReactNode }) {
  return <article className={`image-card ${variant}`}><span className={`status ${statusClass}`}>{status}</span><div className="card-actions">{actions}</div></article>;
}

function AsideTasks({ onShortcutToImageMode, sessionTasks, serverTasks, serverError }: { onShortcutToImageMode: () => void; sessionTasks: ImageGenerationTask[]; serverTasks: ImageGenerationTask[]; serverError: string }) {
  const visibleTasks = [...sessionTasks, ...serverTasks];

  return (
    <aside className="panel">
      <div className="panel-head"><h2>任务与继续编辑</h2><span className="badge">状态映射</span></div>
      <div className="panel-body recent">
        {serverError && <div className="api-state bad">{serverError}</div>}
        {visibleTasks.map(task => <div className="task" key={task.id}><strong>{task.status} · {task.id}</strong><span>{task.prompt}</span><p className="code">model={task.modelProvider}/{task.modelName} · chargedCredits={task.chargedCredits}</p>{(task.status === "running" || task.status === "storing") && <div className="bar"><span /></div>}</div>)}
        <div className="task"><strong>failed · Prompt 合规拦截</strong><span>原因：包含受限品牌商标描述，请修改后重试。</span><button className="btn" type="button">修改 Prompt</button></div>
        <div className="history"><span className="thumb" /><div><strong>局部重绘 / 扩图入口</strong><span className="small">需先从结果图或资产中心选择 sourceAssetId。</span></div></div>
        <button className="btn" type="button" onClick={onShortcutToImageMode}>选择历史资产后继续编辑</button>
      </div>
    </aside>
  );
}

function EditPage({ selectedAssetId, editMode, paintStrength, onEditModeChange, onPaintStrengthChange, onRunEdit }: { selectedAssetId: string; editMode: "inpaint" | "outpaint"; paintStrength: number; onEditModeChange: (mode: "inpaint" | "outpaint") => void; onPaintStrengthChange: (value: number) => void; onRunEdit: () => void }) {
  return (
    <section className="edit-layout" aria-label="图片编辑页">
      <aside className="rail" aria-label="编辑工具">
        <button className="tool active" title="画笔" type="button" aria-label="画笔"><Brush size={22} /></button>
        <button className="tool" title="橡皮擦" type="button" aria-label="橡皮擦"><Eraser size={22} /></button>
        <button className="tool" title="蒙版显示" type="button" aria-label="蒙版显示"><Eye size={22} /></button>
        <button className="tool" title="撤销" type="button" aria-label="撤销"><Undo2 size={22} /></button>
      </aside>
      <section className="panel edit-canvas">
        <div className="canvas-head"><strong>中央画布 · 基于已有资产编辑</strong><span className="small">当前画笔 42px · 蒙版显示开启</span></div>
        <div className="asset-info">
          <div className="asset-kv"><span>Asset ID</span><strong>{selectedAssetId}</strong></div>
          <div className="asset-kv"><span>来源任务</span><strong>T2I-240618-0912</strong></div>
          <div className="asset-kv"><span>生成时间</span><strong>今天 10:24</strong></div>
          <div className="asset-kv"><span>源图状态</span><strong className="status ok">审核通过</strong></div>
        </div>
        <div className="artboard"><div className="edit-image" /></div>
        <div className="compare"><div className="card"><strong>原图</strong><p className="small">{selectedAssetId} 保持可访问，不会被覆盖。</p></div><div className="card"><strong>新图预览</strong><p className="small">提交后生成新资产。</p></div><div className="card"><strong>版本链</strong><p className="small">sourceAssetId={selectedAssetId} -&gt; newAssetId</p></div></div>
      </section>
      <aside className="panel side">
        <h2>编辑参数</h2>
        <div className="notice">编辑页必须从已有资产进入。局部重绘和扩图都会创建新的资产记录。</div>
        <div className="seg" role="tablist" aria-label="编辑模式"><button className={editMode === "inpaint" ? "active" : ""} type="button" role="tab" aria-selected={editMode === "inpaint"} onClick={() => onEditModeChange("inpaint")}>局部重绘</button><button className={editMode === "outpaint" ? "active" : ""} type="button" role="tab" aria-selected={editMode === "outpaint"} onClick={() => onEditModeChange("outpaint")}>扩图</button></div>
        {editMode === "inpaint" ? <div><div className="field"><label>编辑指令</label><textarea aria-label="编辑指令" defaultValue="将画面左侧的背景替换为深色岩石台面，保留产品主体和光线方向" /></div><div className="field"><label>重绘强度 <span>{paintStrength}%</span></label><input className="slider" type="range" aria-label="重绘强度" value={paintStrength} min="10" max="90" onChange={event => onPaintStrengthChange(Number(event.target.value))} /></div></div> : <div><div className="field"><label>扩展方向</label><div className="chips"><span className="chip active">top</span><span className="chip">bottom</span><span className="chip">left</span><span className="chip">right</span></div></div><div className="field"><label>扩展比例</label><div className="chips"><span className="chip active">1.5x</span><span className="chip">2x</span></div></div><div className="field"><label>补充说明</label><textarea aria-label="补充说明" defaultValue="保持同一摄影棚光线，延展背景材质和阴影，不改变主体比例" /></div></div>}
        <div className="field"><label>画笔大小</label><input className="slider" type="range" aria-label="画笔大小" defaultValue="42" min="8" max="96" /></div>
        <div className="notice">默认模型 OpenAI gpt-image-2；如配置自定义模型，服务端会统一适配。</div>
        <button className="btn primary full" type="button" onClick={onRunEdit}>生成新资产</button>
        <button className="btn full" type="button" style={{ marginTop: 10 }}>保存蒙版草稿</button>
      </aside>
    </section>
  );
}

function AssetsPage({
  selectedAssetId,
  initialAssets,
  initialVersionNodes,
  onSelectAsset,
  onDownload,
  onDelete,
  onImageToImage,
  onOpenEdit
}: {
  selectedAssetId: string;
  initialAssets: ImageAsset[];
  initialVersionNodes: AssetVersionNode[];
  onSelectAsset: (assetId: string) => void;
  onDownload: (assetId?: string) => void;
  onDelete: (assetId?: string) => void;
  onImageToImage: () => void;
  onOpenEdit: (mode: "inpaint" | "outpaint") => void;
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

  useEffect(() => {
    let active = true;

    async function loadAssets() {
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
  }, [query, taskType, status]);

  if (!selected) {
    return (
      <section aria-label="图片资产中心">
        <div className="empty-card">登录后可查看你的资产、版本链和下载权限。</div>
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
          <div className="actions"><button className="btn primary" type="button" onClick={() => onDownload(selected.id)}>下载</button><Link className="btn" href="/workspace/image" onClick={onImageToImage}>继续图生图</Link><Link className="btn" href={`/workspace/image/edit/${selected.id}`} onClick={() => onOpenEdit("inpaint")}>带入局部重绘</Link><Link className="btn" href={`/workspace/image/edit/${selected.id}`} onClick={() => onOpenEdit("outpaint")}>带入扩图</Link><button className="btn" type="button" onClick={() => onDelete(selected.id)}>删除</button></div>
          <div className="timeline"><strong>版本链</strong>{visibleVersionNodes.map(node => <div className="node" key={node.id}><span className="dot" /><div className="rel">{node.label}</div></div>)}</div>
        </aside>
      </section>
    </section>
  );
}

function AccountPage({
  account,
  credits,
  membership,
  memberStatus,
  proDaysRemaining,
  sessionState,
  onRefreshSession,
  onLogout
}: {
  account: AuthAccount | null;
  credits: number;
  membership: AccountMembershipSummary | null;
  memberStatus: AccountMembershipSummary["memberStatus"];
  proDaysRemaining: number;
  sessionState: "logged-in" | "guest" | "expired";
  onRefreshSession: () => void;
  onLogout: () => void;
}) {
  const displayName = account?.displayName || "未登录用户";
  const avatar = displayName.slice(0, 1).toUpperCase();
  const includedDownloads = membership?.includedHdDownloadsRemaining;

  return (
    <section aria-label="用户体系">
      <section className="account-hero">
        <div className="account-card">
          <div className="account-title"><div className="profile-line"><div className="avatar">{avatar}</div><div><h1>{displayName}</h1><p className="lead">{account?.username ? `@${account.username}` : "请登录后查看账号、积分和会员权益。"}</p></div></div><span className={`status ${sessionState === "logged-in" ? "ok" : "wait"}`}>{sessionState === "logged-in" ? "登录有效" : "未登录"}</span></div>
          <div className="balance"><div className="metric"><span>积分余额</span><strong>{credits}</strong><small>预计可生成 {Math.floor(credits / 10)} 张标准图</small></div><div className="metric"><span>会员状态</span><strong>{memberStatusLabel(memberStatus)}</strong><small>剩余 {proDaysRemaining} 天</small></div></div>
        </div>
        <aside className="auth-panel"><h2>登录状态</h2><div className="stack"><div className={`status ${sessionState === "logged-in" ? "ok" : "wait"}`}>{sessionState === "logged-in" ? "server session 已验证" : "需要登录后继续"}</div><button className="btn primary full" type="button" onClick={onRefreshSession}>刷新 session</button><button className="btn full" type="button" onClick={onLogout}>退出当前 session</button></div></aside>
      </section>
      <section className="account-grid">
        <article className="account-card stack"><h2>权益明细</h2><div className="account-row"><span>扩图能力</span><strong>{membership?.canUseOutpaint ? "可用" : "需 Pro"}</strong></div><div className="account-row"><span>高清无水印</span><strong>{membership?.canDownloadWithoutWatermark ? "Pro 额度优先" : "5 credits / 张"}</strong></div><div className="account-row"><span>本周期含量</span><strong>{typeof includedDownloads === "number" ? `${includedDownloads} 次剩余` : "未开通"}</strong></div></article>
        <article className="account-card stack"><h2>权限守卫</h2>{["生成图片", "保存资产", "无水印下载", "购买权益"].map(item => <div className="account-row" key={item}><span>{item}</span><strong>{sessionState === "logged-in" ? "server session" : "需登录"}</strong></div>)}</article>
        <article className="account-card stack"><h2>订单状态说明</h2>{["待支付：权益未生效", "已支付：即时发放", "可重试：支付回调异常后可重新发起"].map(item => <div className="invoice" key={item}><strong>{item}</strong></div>)}</article>
      </section>
    </section>
  );
}

const creditPackOptions: Array<{ planId: BillingPlanId; label: string; price: string }> = [
  { planId: "credits-500", label: "500 credits", price: "¥29" },
  { planId: "credits-1500", label: "1,500 credits", price: "¥79" },
  { planId: "credits-5000", label: "5,000 credits", price: "¥199" }
];

function BillingPage({
  credits,
  memberStatus,
  proDaysRemaining,
  includedHdDownloadsRemaining,
  orders,
  onCreateOrder
}: {
  credits: number;
  memberStatus: AccountMembershipSummary["memberStatus"];
  proDaysRemaining: number;
  includedHdDownloadsRemaining?: number;
  orders: BillingOrder[];
  onCreateOrder: (planId: BillingPlanId) => void;
}) {
  const visibleOrders = orders.slice(0, 5);

  return (
    <section aria-label="权益与购买">
      <section className="billing-hero">
        <div className="billing-panel">
          <h1>把权益说明放在生成与下载的关键时刻。</h1>
          <p className="lead">当用户遇到积分不足、扩图限制、高清无水印下载或商用说明时，页面直接给出当前状态、升级收益和可购买方案。</p>
          <div className="balance"><div className="metric"><span>当前积分余额</span><strong>{credits}</strong><small>预计可生成 {Math.floor(credits / 10)} 张标准图</small></div><div className="metric"><span>当前会员状态</span><strong>{memberStatusLabel(memberStatus)}</strong><small>{memberStatus === "pro" ? `剩余 ${proDaysRemaining} 天，扩图能力已开启` : "开通 Pro 后启用扩图和每月 HD 下载额度"}</small></div></div>
          <div className="notice">下载说明：高清无水印下载默认扣 5 credits；Pro 每月含 300 次，{typeof includedHdDownloadsRemaining === "number" ? `本周期剩余 ${includedHdDownloadsRemaining} 次` : "开通后按周期统计"}，超额后同样扣 5 credits。</div>
        </div>
        <aside className="billing-panel"><h2>积分额度</h2><div className="packs">{creditPackOptions.map(pack => <button className="pack" key={pack.planId} type="button" onClick={() => onCreateOrder(pack.planId)} aria-label={`购买 ${pack.label}`}><span>{pack.label}</span><strong>{pack.price}</strong></button>)}</div></aside>
      </section>
      <section className="plans">
        {[
          { title: "免费用户", price: "¥0", items: "每日少量试用积分,标准清晰度预览,高清无水印下载按次扣 credits", action: "当前方案" },
          { title: "积分额度用户", price: "按量购买", items: "更多生成额度,任务历史长期保留,高清下载按次扣 credits", action: "购买额度", planId: "credits-1500" as const },
          { title: "Pro 用户", price: "¥69/月", items: "无水印下载,高清下载,扩图能力,更高并发额度", action: "订阅 Pro", planId: "pro-monthly" as const }
        ].map(plan => <article className={`plan ${plan.planId === "pro-monthly" ? "hot" : ""}`} key={plan.title}><h2>{plan.title}</h2><div className="price">{plan.price}</div><div className="list">{plan.items.split(",").map(item => <span className="item" key={item}><i className="dot" />{item}</span>)}</div><button className={`btn ${plan.planId === "pro-monthly" ? "primary" : ""}`} type="button" disabled={!plan.planId} onClick={() => { if (plan.planId) onCreateOrder(plan.planId); }}>{plan.action}</button></article>)}
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
        <h2 id="download-modal-title">权益与下载权限确认</h2>
        <p>{decision?.reason || "下载前会统一判断登录状态、积分余额、会员权限和订单生效状态。"}</p>
        <div className="rights"><div className="right"><span>非 Pro 用户</span><strong>高清无水印 · 5 credits</strong></div><div className="right"><span>Pro 用户</span><strong>每月 300 次免费</strong></div><div className="right"><span>Pro 超额</span><strong>5 credits / 张</strong></div><div className="right"><span>本次下载</span><strong>{decision?.allowed ? `${decision.quality} · ${decision.watermark ? "带水印" : "无水印"} · ${decision.costCredits} credits` : "不可下载"}</strong></div></div>
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
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({
      mode,
      username,
      password,
      displayName: displayName.trim() || undefined
    });
  }

  return (
    <div className={`modal ${visible ? "show" : ""}`} role="dialog" aria-modal="true" aria-labelledby="auth-modal-title" hidden={!visible} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="dialog" onSubmit={handleSubmit}>
        <h2 id="auth-modal-title">{action ? `登录后继续：${action}` : "登录后继续创作"}</h2>
        <p>生成、保存资产、下载无水印图片和购买订阅都需要绑定到你的 Flux Art 账号。</p>
        <div className="auth-tabs" role="tablist" aria-label="认证方式"><button className={mode === "login" ? "active" : ""} type="button" onClick={() => setMode("login")}>登录</button><button className={mode === "register" ? "active" : ""} type="button" onClick={() => setMode("register")}>注册</button></div>
        <label>用户名<input className="input" value={username} onChange={event => setUsername(event.target.value)} minLength={3} maxLength={32} required /></label>
        {mode === "register" && <label>显示名称<input className="input" value={displayName} onChange={event => setDisplayName(event.target.value)} maxLength={64} /></label>}
        <label>密码<input className="input" type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={8} maxLength={128} required /></label>
        <div className="rights"><div className="right"><span>登录方式</span><strong>用户名 / 密码</strong></div><div className="right"><span>登录后恢复</span><strong>Prompt 与尺寸参数</strong></div><div className="right"><span>权限校验</span><strong>积分、Pro、商用授权</strong></div></div>
        <button className="btn primary full" type="submit">{mode === "register" ? "注册并登录" : "立即登录"}</button>
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
        <p>退出登录后，本地登录状态会被清除；云端生成任务会继续处理，重新登录后可在资产中心查看。</p>
        <div className="rights"><div className="right"><span>登录状态</span><strong>切换为游客</strong></div><div className="right"><span>生成中任务</span><strong>云端继续</strong></div><div className="right"><span>积分与会员</span><strong>账号内保留</strong></div></div>
        <button className="btn primary full" type="button" onClick={onConfirm}>确认退出</button>
        <button className="btn full" type="button" style={{ marginTop: 10 }} onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}
