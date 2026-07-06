import type { ApiResponse } from "@/types/api";
import type { AuthAccount, AuthSession } from "@/types/auth";
import type { BillingOrder, BillingPlanId } from "@/types/billing";
import type {
  AccountCreditsSummary,
  AssetVersionNode,
  CreateImageTaskInput,
  DownloadDecision,
  ImageAsset,
  ImageAssetDetail,
  ImageGenerationTask,
  ListImageAssetsQuery,
  ListImageTasksQuery,
  PaginationMeta
} from "@/types/image";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: number;
  readonly errorCode?: string;

  constructor(message: string, options: { status: number; code: number; errorCode?: string }) {
    super(message);
    this.name = "ApiClientError";
    this.status = options.status;
    this.code = options.code;
    this.errorCode = options.errorCode;
  }
}

interface AssetListPayload {
  assets: ImageAsset[];
  versionNodes: AssetVersionNode[];
  pagination: PaginationMeta;
}

interface TaskListPayload {
  tasks: ImageGenerationTask[];
  pagination: PaginationMeta;
}

export interface WorkspaceSelectableImageModel {
  id: string;
  displayName: string;
  provider: string;
  model: string;
  enabled: boolean;
  isDefault: boolean;
}

export interface WorkspaceModelSelection {
  eligible: boolean;
  defaultModel: WorkspaceSelectableImageModel;
  models: WorkspaceSelectableImageModel[];
  preferredImageModelId?: string;
  selectedImageModelId: string;
  fallbackReason?: "not_eligible" | "missing_preference" | "unavailable_preference" | "unavailable_selection";
}

interface AuthSessionPayload {
  account: AuthAccount;
  session: AuthSession;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isApiResponse(value: unknown): value is ApiResponse<unknown> {
  return isRecord(value) && typeof value.code === "number" && typeof value.message === "string" && "data" in value;
}

function getErrorCode(data: unknown): string | undefined {
  if (!isRecord(data) || typeof data.errorCode !== "string") return undefined;
  return data.errorCode;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function requestApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await readJson(response);

  if (!isApiResponse(payload)) {
    throw new ApiClientError("API returned an invalid response", {
      status: response.status,
      code: response.status || 500
    });
  }

  if (!response.ok || payload.code >= 400) {
    throw new ApiClientError(payload.message, {
      status: response.status,
      code: payload.code,
      errorCode: getErrorCode(payload.data)
    });
  }

  return payload.data as T;
}

function toSearchParams(query: ListImageAssetsQuery | ListImageTasksQuery) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export async function listImageAssets(query: ListImageAssetsQuery = {}): Promise<AssetListPayload> {
  return requestApi<AssetListPayload>(`/api/image/assets${toSearchParams(query)}`);
}

export async function getImageAssetDetail(assetId: string): Promise<ImageAssetDetail> {
  const payload = await requestApi<{ detail: ImageAssetDetail }>(`/api/image/assets/${assetId}`);
  return payload.detail;
}

export async function getImageTask(taskId: string): Promise<ImageGenerationTask> {
  const payload = await requestApi<{ task: ImageGenerationTask }>(`/api/image/tasks/${taskId}`);
  return payload.task;
}

export async function listImageTasks(query: ListImageTasksQuery = {}): Promise<TaskListPayload> {
  return requestApi<TaskListPayload>(`/api/image/tasks${toSearchParams(query)}`);
}

export async function runImageTask(taskId: string): Promise<ImageGenerationTask> {
  const payload = await requestApi<{ task: ImageGenerationTask }>(`/api/image/tasks/${taskId}`, {
    method: "POST"
  });

  return payload.task;
}

export async function createImageTask(input: CreateImageTaskInput): Promise<ImageGenerationTask> {
  const payload = await requestApi<{ task: ImageGenerationTask }>("/api/image/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  return payload.task;
}

export async function createDownloadDecision(assetId: string): Promise<DownloadDecision> {
  const payload = await requestApi<{ decision: DownloadDecision }>(`/api/image/assets/${assetId}/download`, {
    method: "POST"
  });

  return payload.decision;
}

export async function deleteImageAsset(assetId: string): Promise<ImageAsset> {
  const payload = await requestApi<{ asset: ImageAsset }>(`/api/image/assets/${assetId}`, {
    method: "DELETE"
  });

  return payload.asset;
}

export async function uploadImageAsset(file: File): Promise<ImageAsset> {
  const form = new FormData();
  form.set("file", file);
  const payload = await requestApi<{ asset: ImageAsset }>("/api/image/assets/upload", {
    method: "POST",
    body: form
  });

  return payload.asset;
}

export async function createBillingOrder(planId: BillingPlanId): Promise<BillingOrder> {
  const payload = await requestApi<{ order: BillingOrder }>("/api/orders/credits", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ planId })
  });

  return payload.order;
}

export async function listBillingOrders(): Promise<BillingOrder[]> {
  const payload = await requestApi<{ orders: BillingOrder[] }>("/api/billing/orders");
  return payload.orders;
}

export async function getCurrentAuthSession(): Promise<AuthSessionPayload> {
  return requestApi<AuthSessionPayload>("/api/auth/me");
}

export async function loginWithPassword(username: string, password: string): Promise<AuthSessionPayload> {
  return requestApi<AuthSessionPayload>("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
}

export async function registerAccount(username: string, password: string, displayName?: string): Promise<AuthSessionPayload> {
  return requestApi<AuthSessionPayload>("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, displayName })
  });
}

export async function logoutCurrentSession(): Promise<void> {
  await requestApi<{ loggedOut: boolean }>("/api/auth/logout", {
    method: "POST"
  });
}

export async function getAccountCredits(): Promise<AccountCreditsSummary> {
  const payload = await requestApi<{ credits: AccountCreditsSummary }>("/api/account/credits");
  return payload.credits;
}

export async function getWorkspaceModelSelection(): Promise<WorkspaceModelSelection> {
  const payload = await requestApi<{ modelSelection: WorkspaceModelSelection }>("/api/image/models");
  return payload.modelSelection;
}

export async function savePreferredImageModel(modelId: string): Promise<WorkspaceModelSelection> {
  const payload = await requestApi<{ modelSelection: WorkspaceModelSelection }>("/api/account/preferred-model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelId })
  });
  return payload.modelSelection;
}
