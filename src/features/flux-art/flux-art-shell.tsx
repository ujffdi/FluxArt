"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ApiClientError,
  createBillingOrder,
  deleteImageAsset,
  createDownloadDecision,
  createImageTask,
  getWorkspaceModelSelection,
  getAccountCredits,
  getCurrentAuthSession,
  listBillingOrders,
  listImageAssets,
  listImageTasks,
  loginWithPassword,
  logoutCurrentSession,
  registerAccount,
  runImageTask,
  savePreferredImageModel,
  type WorkspaceModelSelection,
  uploadImageAsset
} from "@/features/flux-art/api/image-workspace-client";
import { toTaskType, type ProductPage, type SessionState, useImageWorkspaceStore } from "@/features/flux-art/stores/image-workspace-store";
import type { AuthAccount } from "@/types/auth";
import type { BillingOrder, BillingPlanId } from "@/types/billing";
import type {
  AccountCreditsSummary,
  AssetOrigin,
  AssetStatus,
  AssetVersionNode,
  DownloadDecision,
  GenerationMode,
  ImageAsset,
  ImageGenerationTask,
  ListImageAssetsQuery,
  PaginationMeta,
  StructureMode
} from "@/types/image";

type NavItem = { id: string; page?: ProductPage; href: string; label: string };

const navItems: NavItem[] = [
  { id: "workspace", page: "workspace", href: "/workspace/image", label: "生图工作台" },
  { id: "assets", page: "assets", href: "/workspace/image/assets", label: "资产中心" },
  { id: "account", page: "account", href: "/workspace/account", label: "用户体系" },
  { id: "billing", page: "billing", href: "/workspace/billing", label: "积分购买" }
];

const modelAdminNavItem: NavItem = {
  id: "model-admin",
  href: "/admin/model-config",
  label: "模型后台"
};

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

const assetOriginOptions: Array<{ value: "" | AssetOrigin; label: string }> = [
  { value: "", label: "全部来源" },
  { value: "generated", label: "AI 生成" },
  { value: "uploaded", label: "用户上传" }
];

const defaultTextPrompt = "一张用于电商主图的现代香薰产品摄影，暗色背景，柔和边缘光，真实材质，高级商业摄影";
const defaultImagePrompt = "保持源图主体结构，生成更适合电商详情页的高级商业摄影版本";
const defaultNegativePrompt = "低清晰度、畸变、文字水印、过度锐化、卡通玩具感";
const stylePresetOptions = ["商业摄影", "电商海报", "极简产品", "室内空间"];
const structureModeOptions: Array<{ value: StructureMode; label: string }> = [
  { value: "balanced", label: "balanced · 平衡结构与风格" },
  { value: "outline", label: "outline · 保持轮廓" },
  { value: "pose", label: "pose · 保持姿态" }
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
    "credits-5000": "5,000 积分包"
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

function isActiveTask(task: ImageGenerationTask) {
  return task.status === "queued" || task.status === "running" || task.status === "storing" || task.status === "reviewing";
}

function taskStatusLabel(task: ImageGenerationTask) {
  if (isActiveTask(task)) return "已提交";
  if (task.status === "succeeded") return "已完成";
  if (task.status === "failed") return "失败";
  if (task.status === "refunded") return "已退回";
  return task.status;
}

type QueueTone = "ok" | "wait" | "bad";

interface QueueCard {
  id: string;
  title: string;
  prompt: string;
  code: string;
  status: string;
  tone: QueueTone;
  note: string;
}

function queueCardFromTask(task: ImageGenerationTask): QueueCard {
  const statusMap: Record<ImageGenerationTask["status"], { label: string; tone: QueueTone; note: string }> = {
    queued: { label: "等待中", tone: "wait", note: "任务已进入队列，稍后自动同步结果。" },
    running: { label: "生成中", tone: "wait", note: "服务端正在处理，完成后会更新结果区。" },
    storing: { label: "保存中", tone: "wait", note: "结果生成完成，正在写入资产。" },
    reviewing: { label: "审核中", tone: "wait", note: "结果已生成，正在进行内容审核。" },
    succeeded: {
      label: "已保存",
      tone: "ok",
      note: task.resultAssetIds.length > 0 ? `已生成 ${task.resultAssetIds.length} 个结果，可在资产中心查看。` : "任务已完成，正在同步资产信息。"
    },
    failed: { label: "未完成", tone: "bad", note: task.errorMessage || "任务未完成，请调整提示词后重试。" },
    refunded: { label: "已退回", tone: "bad", note: "任务已结束，预扣积分已退回。" }
  };
  const status = statusMap[task.status];

  return {
    id: task.id,
    title: `${taskStatusLabel(task)} · ${task.id}`,
    prompt: task.prompt,
    code: `task=${task.id} · chargedCredits=${task.chargedCredits}`,
    status: status.label,
    tone: status.tone,
    note: status.note
  };
}

const demoQueueCards: QueueCard[] = [
  {
    id: "task_9a21",
    title: "香蕉主图 · 2 张",
    prompt: "优化产品主体光影与背景留白",
    code: "task_9a21 · running",
    status: "生成中",
    tone: "wait",
    note: "服务端正在处理，完成后会更新结果区。"
  },
  {
    id: "task_9a22",
    title: "详情页横图",
    prompt: "等待上一批任务释放并发额度",
    code: "task_9a22 · next",
    status: "等待中",
    tone: "wait",
    note: "任务已进入队列，稍后自动同步结果。"
  },
  {
    id: "task_9a03",
    title: "室内空间背景",
    prompt: "商业摄影背景已生成",
    code: "task_9a03 · 4 分钟前",
    status: "已保存",
    tone: "ok",
    note: "已生成 2 个结果，可在资产中心查看。"
  }
];

function assetOriginLabel(origin: AssetOrigin) {
  return origin === "uploaded" ? "用户上传" : "AI 生成";
}

function assetTypeLabel(asset: ImageAsset) {
  if (asset.origin === "uploaded") return "用户上传";
  if (asset.taskType === "t2i") return "文生图";
  if (asset.taskType === "i2i") return "图生图";
  return asset.taskType || "AI 生成";
}

function assetSourceText(asset: ImageAsset) {
  if (asset.origin === "uploaded") return "用户上传资产";
  return asset.taskId ? `来源任务 ${asset.taskId}` : "来源任务已缺失";
}

function AssetImage({ asset, className }: { asset: ImageAsset; className: string }) {
  return (
    <div className={className}>
      {/* eslint-disable-next-line @next/next/no-img-element -- Asset URLs are dynamic user/storage URLs outside Next image configuration. */}
      <img src={asset.imageUrl} alt={asset.title} loading="lazy" />
    </div>
  );
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
  const [modelSelection, setModelSelection] = useState<WorkspaceModelSelection | null>(null);
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
  const reconciliationInFlight = useRef(false);
  const modelFallbackNoticeRef = useRef("");

  const credits = creditsSummary?.credits ?? 0;
  const hasServerSession = authAccount !== null;
  const sessionState = hasServerSession ? "logged-in" : store.sessionState === "expired" ? "expired" : "guest";

  const selectedAsset = useMemo(
    () => serverAssets.find(asset => asset.id === store.selectedAssetId),
    [serverAssets, store.selectedAssetId]
  );

  const visibleTasks = useMemo(() => mergeVisibleTasks(sessionTasks, serverTasks), [sessionTasks, serverTasks]);
  const activeTaskIds = useMemo(() => sessionTasks.filter(isActiveTask).map(task => task.id).sort().join("|"), [sessionTasks]);

  const workspaceResult = useMemo(() => {
    const assetById = new Map(serverAssets.map(asset => [asset.id, asset]));
    const completedTask = findLatestTask(
      sessionTasks,
      task => task.status === "succeeded" && task.resultAssetIds.some(assetId => assetById.has(assetId))
    );
    const pendingCompletedTask = findLatestTask(
      sessionTasks,
      task => task.status === "succeeded" && task.resultAssetIds.length > 0 && !task.resultAssetIds.some(assetId => assetById.has(assetId))
    );
    const activeTask = findLatestTask(
      sessionTasks,
      isActiveTask
    );
    const failedTask = findLatestTask(
      sessionTasks,
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
  }, [serverAssets, sessionTasks]);

  const clearSessionOwnedState = useCallback(function clearSessionOwnedState() {
    setAuthAccount(null);
    setServerAssets([]);
    setServerVersionNodes([]);
    setServerTasks([]);
    setSessionTasks([]);
    setCreditsSummary(null);
    setBillingOrders([]);
    setModelSelection(null);
  }, []);

  const loadSessionOwnedState = useCallback(async function loadSessionOwnedState(account?: AuthAccount) {
    const auth = account ? { account } : await getCurrentAuthSession();

    const [assetPayload, taskPayload, creditsPayload, ordersPayload, modelPayload] = await Promise.all([
      listImageAssets({ page: 1, pageSize: 100 }),
      listImageTasks({ page: 1, pageSize: 20 }),
      getAccountCredits(),
      listBillingOrders(),
      getWorkspaceModelSelection()
    ]);

    setServerAssets(assetPayload.assets);
    setServerVersionNodes(assetPayload.versionNodes);
    setServerTasks(taskPayload.tasks);
    setCreditsSummary(creditsPayload);
    setBillingOrders(ordersPayload);
    setModelSelection(modelPayload);
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
        setServerError(workspaceErrorMessage(error, "登录后会同步你的资产、任务和积分数据。"));
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
    if (!authAccount || !sessionHydrated) return;
    const account = authAccount;
    let refreshInFlight = false;

    async function refreshVisibleSessionState() {
      if (document.visibilityState === "hidden" || refreshInFlight) return;
      refreshInFlight = true;
      try {
        await loadSessionOwnedState(account);
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 401) {
          clearSessionOwnedState();
          useImageWorkspaceStore.getState().setSessionState("guest");
        } else {
          setServerError(workspaceErrorMessage(error, "账户状态刷新失败，请稍后重试。"));
        }
      } finally {
        refreshInFlight = false;
      }
    }

    window.addEventListener("focus", refreshVisibleSessionState);
    document.addEventListener("visibilitychange", refreshVisibleSessionState);

    return () => {
      window.removeEventListener("focus", refreshVisibleSessionState);
      document.removeEventListener("visibilitychange", refreshVisibleSessionState);
    };
  }, [authAccount, clearSessionOwnedState, loadSessionOwnedState, sessionHydrated]);

  useEffect(() => {
    if (!hasServerSession || !authAccount || !activeTaskIds) return;

    let cancelled = false;
    const account = authAccount;

    async function reconcileActiveTasks() {
      if (reconciliationInFlight.current) return;
      reconciliationInFlight.current = true;

      try {
        await Promise.all(activeTaskIds.split("|").map(taskId => runImageTask(taskId).then(upsertSessionTask)));
        if (!cancelled) await loadSessionOwnedState(account);
      } catch (error) {
        if (!cancelled) setServerError(errorMessage(error, "任务状态同步失败，请稍后刷新"));
      } finally {
        reconciliationInFlight.current = false;
      }
    }

    void reconcileActiveTasks();
    const timer = window.setInterval(() => {
      void reconcileActiveTasks();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeTaskIds, authAccount, hasServerSession, loadSessionOwnedState]);

  useEffect(() => {
    if (modelSelection?.fallbackReason !== "unavailable_preference") return;
    const key = `${authAccount?.userId || "guest"}:${modelSelection.selectedImageModelId}`;
    if (modelFallbackNoticeRef.current === key) return;
    modelFallbackNoticeRef.current = key;
    store.showToast("原模型不可用，已切换到默认模型");
  }, [authAccount?.userId, modelSelection?.fallbackReason, modelSelection?.selectedImageModelId, store]);

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

  async function ensureAuth(action: string) {
    if (hasServerSession) return true;

    try {
      const auth = await getCurrentAuthSession();
      setAuthAccount(auth.account);
      useImageWorkspaceStore.getState().setSessionState("logged-in");
      setServerError("");
      return true;
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) {
        clearSessionOwnedState();
        useImageWorkspaceStore.getState().setSessionState("guest");
        setAuthModal(action);
        return false;
      }
      store.showToast(`登录状态校验失败：${errorMessage(error, "请稍后重试")}`);
      return false;
    }
  }

  function requireAuth(action: string, done: () => void | Promise<void>) {
    void (async () => {
      if (!(await ensureAuth(action))) return;
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
        } else if (updatedTask.status === "failed" || updatedTask.status === "refunded") {
          store.showToast(`${label}失败：${updatedTask.errorMessage || "请稍后重试"}`);
        }
        void loadSessionOwnedState(authAccount || undefined);
      })
      .catch(error => {
        store.showToast(`${label}执行失败：${workspaceErrorMessage(error, "请稍后重试")}`);
        void loadSessionOwnedState(authAccount || undefined);
      });
  }

  async function createGenerationTask() {
    requireAuth("生成图片", async () => {
      if (store.generationMode === "img" && !selectedAsset) {
        store.showToast("请先从你的资产中心选择参考图");
        return;
      }

      const imageMode = store.generationMode === "img";
      const sourceAssetId = imageMode ? selectedAsset?.id : undefined;
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
          sourceAssetId,
          size,
          count: store.generationCount,
          stylePreset,
          strength: imageMode ? store.referenceStrength : undefined,
          structureMode: imageMode ? store.structureMode : undefined,
          selectedImageModelId: modelSelection?.selectedImageModelId
        });
        upsertSessionTask(task);
        store.showToast(`任务已提交：${task.id}`);
        if (task.status === "queued") startTaskRunner(task, "生成任务");
      } catch (error) {
        store.showToast(`任务提交失败：${workspaceErrorMessage(error, "请稍后重试")}`);
      }
    });
  }

  async function changeImageModel(modelId: string) {
    if (!modelSelection?.eligible) {
      store.showToast("购买积分后可选择更多模型");
      window.history.pushState(null, "", "/workspace/billing");
      return;
    }

    try {
      const next = await savePreferredImageModel(modelId);
      setModelSelection(next);
      store.showToast("已保存默认生成模型");
    } catch (error) {
      store.showToast(`模型保存失败：${errorMessage(error, "请稍后重试")}`);
    }
  }

  async function uploadAsset(file: File, options: { useAsSource?: boolean } = {}) {
    if (!(await ensureAuth("上传图片"))) return;

    try {
      const asset = await uploadImageAsset(file);
      setServerAssets(current => [asset, ...current.filter(item => item.id !== asset.id)]);
      store.setSelectedAssetId(asset.id);
      if (options.useAsSource) store.setGenerationMode("img");
      store.showToast(options.useAsSource ? "图片已上传并设为图生图参考图" : "图片已上传到资产中心");
      void loadSessionOwnedState(authAccount || undefined);
    } catch (error) {
      store.showToast(`上传失败：${workspaceErrorMessage(error, "请检查图片格式、大小或稍后重试")}`);
    }
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
      store.showToast(input.mode === "register" ? "注册成功：已创建账号并登录" : "登录成功：已恢复 Prompt 和尺寸参数");
    } catch (error) {
      store.showToast(`${input.mode === "register" ? "注册" : "登录"}失败：${errorMessage(error, "请稍后重试")}`);
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
        showModelAdminLink={authAccount?.isModelAdmin === true}
        onAuthClick={() => (hasServerSession ? setShowLogout(true) : setAuthModal(""))}
      />
      {activePage === "workspace" && (
        <WorkspacePage
          generationMode={store.generationMode}
          textPrompt={textPrompt}
          imagePrompt={imagePrompt}
          negativePrompt={negativePrompt}
          referenceStrength={store.referenceStrength}
          structureMode={store.structureMode}
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
          onStructureModeChange={store.setStructureMode}
          onCustomSizeChange={store.setCustomSizeVisible}
          onSelectedSizeChange={setSelectedSize}
          onCustomWidthChange={setCustomWidth}
          onCustomHeightChange={setCustomHeight}
          onGenerationCountChange={store.setGenerationCount}
          onStylePresetChange={setStylePreset}
          modelSelection={modelSelection}
          onModelChange={changeImageModel}
          onGenerate={createGenerationTask}
          onUploadAsset={file => uploadAsset(file, { useAsSource: true })}
          onDownload={openDownload}
          onUseAsSource={assetId => {
            store.setSelectedAssetId(assetId);
            store.setGenerationMode("img");
            store.showToast("已把结果设为参考图，可继续图生图");
          }}
          visibleTasks={visibleTasks}
          resultTask={workspaceResult.task}
          resultAssets={workspaceResult.assets}
          pendingResultAssetIds={workspaceResult.pendingAssetIds}
          credits={credits}
          serverError={serverError}
          selectedAsset={selectedAsset}
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
          onUploadAsset={file => uploadAsset(file)}
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
  showModelAdminLink,
  onAuthClick
}: {
  activePage: ProductPage;
  sessionLabel: string;
  credits: number;
  showModelAdminLink: boolean;
  onAuthClick: () => void;
}) {
  const visibleNavItems = showModelAdminLink ? [...navItems, modelAdminNavItem] : navItems;

  return (
    <header className="top">
      <Link className="brand" href="/workspace/image">
        <span className="mark" />
        <span>FluxArt</span>
      </Link>
      <nav className="nav" aria-label="产品导航">
        {visibleNavItems.map(item => (
          <Link key={item.id} className={item.page && activePage === item.page ? "active" : ""} href={item.href}>
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="wallet">
        <span className="badge">{sessionLabel}</span>
        <span className="badge">积分 {credits.toLocaleString()}</span>
        <span className="btn studio-toggle" aria-label="AI Studio">
          AI Studio
        </span>
        <button className="btn avatar-btn" type="button" onClick={onAuthClick} aria-label={sessionLabel.startsWith("已登录") ? "退出" : "登录 / 注册"}>
          {sessionLabel.startsWith("已登录") ? "SU" : "登录"}
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
  structureMode,
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
  onStructureModeChange,
  onCustomSizeChange,
  onSelectedSizeChange,
  onCustomWidthChange,
  onCustomHeightChange,
  onGenerationCountChange,
  onStylePresetChange,
  modelSelection,
  onModelChange,
  onGenerate,
  onUploadAsset,
  onDownload,
  onUseAsSource,
  visibleTasks,
  resultTask,
  resultAssets,
  pendingResultAssetIds,
  credits,
  serverError,
  selectedAsset
}: {
  generationMode: "txt" | "img";
  textPrompt: string;
  imagePrompt: string;
  negativePrompt: string;
  referenceStrength: number;
  structureMode: StructureMode;
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
  onStructureModeChange: (mode: StructureMode) => void;
  onCustomSizeChange: (visible: boolean) => void;
  onSelectedSizeChange: (size: string) => void;
  onCustomWidthChange: (width: number) => void;
  onCustomHeightChange: (height: number) => void;
  onGenerationCountChange: (count: number) => void;
  onStylePresetChange: (stylePreset: string) => void;
  modelSelection: WorkspaceModelSelection | null;
  onModelChange: (modelId: string) => void;
  onGenerate: () => void;
  onUploadAsset: (file: File) => Promise<void>;
  onDownload: (assetId?: string) => void;
  onUseAsSource: (assetId: string) => void;
  visibleTasks: ImageGenerationTask[];
  resultTask?: ImageGenerationTask;
  resultAssets: ImageAsset[];
  pendingResultAssetIds: string[];
  credits: number;
  serverError: string;
  selectedAsset?: ImageAsset;
}) {
  const imageMode = generationMode === "img";
  return (
    <section className="ai-workspace" aria-label="AI 生图工作台">
      <section className="workspace-grid">
        <aside className="panel input-panel">
          <div className="panel-head">
            <h2>创作输入</h2>
            <span className="badge">AI 生成</span>
          </div>
          <div className="panel-body">
            <div className="mode mode-cards" role="tablist" aria-label="生成模式">
              <button className={!imageMode ? "active" : ""} type="button" role="tab" aria-selected={!imageMode} onClick={() => onModeChange("txt")}>
                <strong>文生图</strong>
                <span>Text prompt</span>
              </button>
              <button className={imageMode ? "active" : ""} type="button" role="tab" aria-selected={imageMode} onClick={() => onModeChange("img")}>
                <strong>图生图</strong>
                <span>Image remix</span>
              </button>
            </div>
            <div className="coach-card">
              <div><strong>AI prompt coach</strong><span>建议补充镜头焦段、材质关键词和背景留白比例，让生成结果更适合电商主图。</span></div>
              <span aria-hidden="true">•••</span>
            </div>
            {imageMode && <UploadField selectedAsset={selectedAsset} onUploadAsset={onUploadAsset} />}
            <div className="field">
              <label>{imageMode ? "修改方向说明" : "提示词"}</label>
              <textarea
                aria-label={imageMode ? "修改方向说明" : "提示词"}
                value={imageMode ? imagePrompt : textPrompt}
                onChange={event => imageMode ? onImagePromptChange(event.target.value) : onTextPromptChange(event.target.value)}
              />
            </div>
            {!imageMode && (
              <div className="field">
                <label>负向提示词</label>
                <textarea
                  aria-label="负向提示词"
                  value={negativePrompt}
                  onChange={event => onNegativePromptChange(event.target.value)}
                />
              </div>
            )}
            {imageMode && (
              <>
                <div className="field"><label>参考强度 <span>{referenceStrength}%</span></label><input className="slider" type="range" aria-label="参考强度" min="10" max="90" value={referenceStrength} onChange={event => onReferenceStrengthChange(Number(event.target.value))} /></div>
                <div className="field">
                  <label>结构保持模式</label>
                  <select className="select" aria-label="结构保持模式" value={structureMode} onChange={event => onStructureModeChange(event.target.value as StructureMode)}>
                    {structureModeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
              </>
            )}
            <div className="field">
              <label>模型</label>
              <select
                className="select"
                aria-label="模型"
                disabled={!modelSelection || !modelSelection.eligible}
                value={modelSelection?.selectedImageModelId || modelSelection?.defaultModel.id || ""}
                onChange={event => onModelChange(event.target.value)}
              >
                {(modelSelection?.models || []).map(model => (
                  <option key={model.id} value={model.id}>
                    {model.displayName} · {model.model}
                  </option>
                ))}
              </select>
              {modelSelection && !modelSelection.eligible && (
                <p className="small">购买积分后可选择更多模型；当前使用默认模型。<Link href="/workspace/billing">去购买积分</Link></p>
              )}
              {modelSelection?.fallbackReason === "unavailable_preference" && (
                <p className="small">原模型不可用，已切换到默认模型。</p>
              )}
            </div>
            <div className="field">
              <label>风格预设 <span className="small">creative pink</span></label>
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
            <div className="field">
              <label>画幅</label>
              <select
                className="select"
                aria-label="画幅"
                value={selectedSize}
                onChange={event => {
                  onSelectedSizeChange(event.target.value);
                  onCustomSizeChange(event.target.value === "custom");
                }}
              >
                <option value="1024x1024">1024 x 1024 · 方图</option>
                <option value="1344x768">1344 x 768 · 横图</option>
                <option value="768x1344">768 x 1344 · 竖图</option>
                <option value="custom">手动输入</option>
              </select>
            </div>
            <div className="size-custom">
              <div className="field">
                <label>宽</label>
                <input className="input" type="number" aria-label="宽" min="512" max="2048" step="64" value={customSizeVisible ? customWidth : Number(selectedSize.split("x")[0] || 1024)} onChange={event => onCustomWidthChange(Number(event.target.value))} />
              </div>
              <div className="field">
                <label>高</label>
                <input className="input" type="number" aria-label="高" min="512" max="2048" step="64" value={customSizeVisible ? customHeight : Number(selectedSize.split("x")[1] || 1024)} onChange={event => onCustomHeightChange(Number(event.target.value))} />
              </div>
            </div>
            <div className="field"><label>数量</label><select className="select" aria-label="数量" value={generationCount} onChange={event => onGenerationCountChange(Number(event.target.value))}><option value={4}>4 张</option><option value={2}>2 张</option><option value={1}>1 张</option></select></div>
            <div className="cost"><span>预计消耗</span><strong>{imageMode ? "32" : "18"} / {credits.toLocaleString()} 积分</strong></div>
            <button className="btn primary full" type="button" onClick={onGenerate}>生成 {generationCount} 张方案</button>
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
        <AsideTasks visibleTasks={visibleTasks} serverError={serverError} />
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
  const isActive = task ? isActiveTask(task) : false;
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
          <div className="stage-empty-card">
            {isActive && task && <span className="status wait">{task.status}</span>}
            {isFailed && <span className="status bad">{task?.status}</span>}
            <strong>
              {isActive ? "正在生成结果" : isFailed ? "本次生成未完成" : pendingAssetIds.length > 0 ? "正在加载生成结果" : "暂无生成结果"}
            </strong>
            <span>
              {isActive && task
                ? `${taskTypeLabel(task.taskType)}任务 ${task.id} 正在处理，完成后会在这里显示图片。`
                : isFailed
                  ? task?.errorMessage || "请调整提示词或参数后重试。"
                  : pendingAssetIds.length > 0
                    ? `任务已完成，正在同步资产 ${pendingAssetIds.join(", ")}。`
                    : "提交生成任务后，结果会显示在这里。"}
            </span>
            {isActive && <div className="bar"><span /></div>}
          </div>
        </div>
      )}
    </div>
  );
}

function AssetUploadButton({
  onUpload,
  label = "上传图片",
  className = "btn primary"
}: {
  onUpload: (file: File) => Promise<void>;
  label?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  return (
    <>
      <button className={className} type="button" disabled={uploading} onClick={() => inputRef.current?.click()}>
        {uploading ? "上传中..." : label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          setUploading(true);
          void onUpload(file).finally(() => setUploading(false));
        }}
      />
    </>
  );
}

function UploadField({ selectedAsset, onUploadAsset }: { selectedAsset?: ImageAsset; onUploadAsset: (file: File) => Promise<void> }) {
  return (
    <div className="field">
      <label>参考图 / sourceAssetId</label>
      <div className={`upload-card ${selectedAsset ? "" : "empty"}`}>
        <div
          className="upload-preview"
          role="img"
          aria-label={selectedAsset ? `已选择源图 ${selectedAsset.id}` : "未选择源图"}
          style={selectedAsset ? { backgroundImage: `linear-gradient(135deg, rgba(124, 92, 255, 0.24), rgba(24, 214, 194, 0.14)), url(${selectedAsset.imageUrl})` } : undefined}
        >
          <span>{selectedAsset ? `已选择源图 ${selectedAsset.id}` : "未选择源图"}</span>
        </div>
        <strong>{selectedAsset ? selectedAsset.title : "请先从资产中心选择一张历史图片"}</strong>
        <span className="small">{selectedAsset ? `${selectedAsset.width} x ${selectedAsset.height} · ${assetSourceText(selectedAsset)}` : "图生图任务必须带 sourceAssetId，提交前会校验图片归属与状态。"}</span>
        <div className="chips">
          {selectedAsset && <span className="chip active">使用 {selectedAsset.id}</span>}
          <Link className="chip" href="/workspace/image/assets">从资产中心选择</Link>
          <AssetUploadButton className="chip" label="上传参考图" onUpload={onUploadAsset} />
          <span className={`status ${selectedAsset ? "ok" : "wait"}`}>{selectedAsset ? "源图已就绪" : "等待选择"}</span>
        </div>
      </div>
    </div>
  );
}

function AsideTasks({ visibleTasks, serverError }: { visibleTasks: ImageGenerationTask[]; serverError: string }) {
  const cards = visibleTasks.length > 0 ? visibleTasks.map(queueCardFromTask) : demoQueueCards;

  return (
    <aside className="workspace-aside">
      <section className="panel queue-panel">
        <div className="panel-head"><h2>生成队列</h2><span className="badge">live</span></div>
        <div className="panel-body recent">
          {serverError && <div className="api-state bad">{serverError}</div>}
          {cards.map(card => <QueueTaskCard card={card} key={card.id} />)}
        </div>
      </section>
    </aside>
  );
}

function QueueTaskCard({ card }: { card: QueueCard }) {
  return (
    <div className="task queue-task">
      <div className="queue-title">
        <strong>{card.title}</strong>
        <span className={`status ${card.tone}`}>{card.status}</span>
      </div>
      <span className="queue-prompt">{card.prompt}</span>
      <p className="code">{card.code}</p>
      <p className="queue-note">{card.note}</p>
    </div>
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
  onUploadAsset,
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
  onUploadAsset: (file: File) => Promise<void>;
  onImageToImage: () => void;
}) {
  const [filteredAssets, setFilteredAssets] = useState<ImageAsset[] | null>(null);
  const [filteredVersionNodes, setFilteredVersionNodes] = useState<AssetVersionNode[] | null>(null);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [query, setQuery] = useState("");
  const [taskType, setTaskType] = useState<"" | GenerationMode>("");
  const [status, setStatus] = useState<"" | AssetStatus>("");
  const [origin, setOrigin] = useState<"" | AssetOrigin>("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const visibleAssets = filteredAssets || initialAssets;
  const visibleVersionNodes = filteredVersionNodes || initialVersionNodes;
  const selected = visibleAssets.find(asset => asset.id === selectedAssetId) || initialAssets.find(asset => asset.id === selectedAssetId) || visibleAssets[0] || initialAssets[0];
  const filtersActive = Boolean(query || taskType || status || origin);

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
        status: status || undefined,
        origin: origin || undefined
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
  }, [initialAssets, query, sessionHydrated, sessionState, taskType, status, origin]);

  if (!sessionHydrated) {
    return (
      <section className="ai-workspace module-workspace assets-page" aria-label="图片资产中心" aria-busy="true">
        <div className="asset-loading-surface" />
      </section>
    );
  }

  if (!selected) {
    const emptyMessage = sessionState !== "logged-in"
        ? "登录后可查看你的资产、版本链和下载权限。"
        : filtersActive
          ? "没有匹配的资产。请调整搜索词、任务类型或状态筛选。"
          : "暂无资产。生成图片成功后，结果会进入资产中心并显示版本链和下载权限。";

    return (
      <section className="ai-workspace module-workspace assets-page" aria-label="图片资产中心">
        <section className="toolbar asset-actions-toolbar" aria-label="资产操作区">
          <AssetUploadButton className="btn primary asset-upload-button" onUpload={onUploadAsset} />
        </section>
        <div className="empty-card">{emptyMessage}</div>
        {loadError && <div className="api-state bad">{loadError}</div>}
      </section>
    );
  }

  return (
    <section className="ai-workspace module-workspace assets-page" aria-label="图片资产中心">
      <section className="toolbar" aria-label="筛选区">
        <input className="input" aria-label="搜索资产" placeholder="搜索标题、Prompt、任务 ID" value={query} onChange={event => setQuery(event.target.value)} />
        <select className="select" aria-label="资产来源筛选" value={origin} onChange={event => setOrigin(event.target.value as "" | AssetOrigin)}>
          {assetOriginOptions.map(option => <option key={option.value || "all"} value={option.value}>{option.label}</option>)}
        </select>
        <select className="select" aria-label="任务类型筛选" value={taskType} onChange={event => setTaskType(event.target.value as "" | GenerationMode)}>
          {taskTypeOptions.map(option => <option key={option.value || "all"} value={option.value}>{option.label}</option>)}
        </select>
        <select className="select" aria-label="资产状态筛选" value={status} onChange={event => setStatus(event.target.value as "" | AssetStatus)}>
          {assetStatusOptions.map(option => <option key={option.value || "all"} value={option.value}>{option.label}</option>)}
        </select>
        <select className="select" aria-label="资产排序"><option>按最近生成排序</option><option>按下载时间排序</option></select>
        <AssetUploadButton className="btn primary asset-upload-button" onUpload={onUploadAsset} />
      </section>
      <div className="api-state" role="status" aria-live="polite">
        {loading ? "正在从 API 加载资产列表..." : pagination ? `API 列表：第 ${pagination.page} 页，共 ${pagination.total} 张资产` : "本地资产列表"}
      </div>
      {loadError && <div className="api-state bad">{loadError}</div>}
      <section className="asset-layout">
        <div className="masonry">
          {visibleAssets.length === 0 && <div className="empty-card">没有匹配的资产。请调整搜索词、任务类型或状态筛选。</div>}
          {visibleAssets.map(asset => <button className={`asset ${asset.id === selectedAssetId ? "active" : ""}`} key={asset.id} type="button" onClick={() => onSelectAsset(asset.id)}><AssetImage asset={asset} className="pic" /><div className="meta"><div className="line"><strong>{asset.title}</strong><span className={`status ${asset.status === "succeeded" ? "ok" : asset.status === "processing" || asset.status === "reviewing" ? "wait" : "bad"}`}>{asset.status}</span></div><p className="small">{asset.id} · {assetOriginLabel(asset.origin)} · {assetTypeLabel(asset)} · {asset.createdAt}</p></div></button>)}
        </div>
        <aside className="asset-side">
          <h2>{selected.title}</h2>
          <AssetImage asset={selected} className="preview-img" />
          <p className="small">{selected.id} · {assetOriginLabel(selected.origin)} · {assetTypeLabel(selected)} · {selected.status} · {assetSourceText(selected)}</p>
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
    <section className="ai-workspace module-workspace account-page" aria-label="用户体系">
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
        <article className="account-card stack"><div className="panel-head compact"><h2>积分</h2><span className="badge">生成前校验</span></div><div className="metric"><span>可用积分</span><strong>{credits}</strong><small>当前任务预估 18 积分</small></div><Link className="btn full" href="/workspace/billing">购买积分</Link></article>
        <article className="account-card stack"><div className="panel-head compact"><h2>订单</h2><span className="badge">积分到账依据</span></div>{visibleOrders.length === 0 && <div className="invoice"><div><strong>暂无订单</strong><p className="small">购买积分后显示支付状态</p></div><span className="status wait">待购买</span></div>}{visibleOrders.map(order => <div className="invoice" key={order.orderId}><div><strong>{billingPlanLabel(order.planId)}</strong><p className="small">{order.outTradeNo || order.orderId}</p></div><span className={`status ${order.fulfillmentStatus === "fulfilled" ? "ok" : "wait"}`}>{orderStatusLabel(order)}</span></div>)}</article>
        <article className="account-card stack"><div className="panel-head compact"><h2>积分校验</h2><span className={`status ${sessionState === "logged-in" ? "ok" : "wait"}`}>{sessionState === "logged-in" ? "已登录" : "未登录"}</span></div>{["生成图片", "图生图", "下载原图"].map(item => <div className="account-row" key={item}><span>{item}</span><strong>{sessionState === "logged-in" ? "余额足够即可用" : "需登录"}</strong></div>)}</article>
      </section>
    </section>
  );
}

const creditPackOptions: Array<{ planId: BillingPlanId; label: string; price: string }> = [
  { planId: "credits-500", label: "500 积分", price: "¥1 测试价" },
  { planId: "credits-1500", label: "1,500 积分", price: "¥1 测试价" },
  { planId: "credits-5000", label: "5,000 积分", price: "¥1 测试价" }
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
    <section className="ai-workspace module-workspace billing-page" aria-label="积分购买">
      <section className="billing-hero">
        <div className="billing-panel">
          <h1>购买积分后解锁全部功能。</h1>
          <p className="lead">Flux Art 统一使用积分。文生图、图生图、保存资产、高清无水印下载都按积分消耗处理。</p>
          <div className="balance"><div className="metric"><span>当前积分余额</span><strong>{credits}</strong><small>可用于所有生成与下载操作</small></div><div className="metric"><span>当前订单状态</span><strong>{visibleOrders[0] ? orderStatusLabel(visibleOrders[0]) : "暂无订单"}</strong><small>支付成功后积分立即到账</small></div></div>
          <div className="notice">统一规则：余额足够即可使用全部功能；余额不足时只引导购买积分。</div>
        </div>
        <aside className="billing-panel"><h2>积分包</h2><div className="packs">{creditPackOptions.map(pack => <button className="pack" key={pack.planId} type="button" onClick={() => onCreateOrder(pack.planId)} aria-label={`购买 ${pack.label}`}><span>{pack.label}</span><strong>{pack.price}</strong></button>)}</div><button className="btn primary full" type="button" style={{ marginTop: 14 }} onClick={() => onCreateOrder("credits-1500")}>购买积分包</button></aside>
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
      displayName: mode === "register" ? displayName : undefined
    });
  }

  return (
    <div className={`modal ${visible ? "show" : ""}`} role="dialog" aria-modal="true" aria-labelledby="auth-modal-title" hidden={!visible} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="dialog" onSubmit={handleSubmit}>
        <h2 id="auth-modal-title">{action ? `${mode === "register" ? "注册" : "登录"}后继续：${action}` : `${mode === "register" ? "注册" : "登录"}后继续创作`}</h2>
        <div className="auth-tabs" role="tablist" aria-label="账号操作">
          <button className={mode === "login" ? "active" : ""} type="button" role="tab" aria-selected={mode === "login"} onClick={() => setMode("login")}>登录</button>
          <button className={mode === "register" ? "active" : ""} type="button" role="tab" aria-selected={mode === "register"} onClick={() => setMode("register")}>注册</button>
        </div>
        <label>用户名<input className="input" value={username} onChange={event => setUsername(event.target.value)} minLength={3} maxLength={32} required /></label>
        {mode === "register" && (
          <label>显示名<input className="input" value={displayName} onChange={event => setDisplayName(event.target.value)} maxLength={40} placeholder="默认使用用户名" /></label>
        )}
        <label className="auth-password-field">密码<input className="input" type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={8} maxLength={128} required /></label>
        <button className="btn primary full" type="submit">{mode === "register" ? "立即注册" : "立即登录"}</button>
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
