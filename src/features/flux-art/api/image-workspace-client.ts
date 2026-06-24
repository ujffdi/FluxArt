import type { ApiResponse } from "@/types/api";
import type { BillingOrder, BillingPlanId } from "@/types/billing";
import type {
  AccountCreditsSummary,
  AccountMembershipSummary,
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

export async function createBillingOrder(planId: BillingPlanId): Promise<BillingOrder> {
  const payload = await requestApi<{ order: BillingOrder }>("/api/billing/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ planId })
  });

  return payload.order;
}

export async function getAccountCredits(): Promise<AccountCreditsSummary> {
  const payload = await requestApi<{ credits: AccountCreditsSummary }>("/api/account/credits");
  return payload.credits;
}

export async function getAccountMembership(): Promise<AccountMembershipSummary> {
  const payload = await requestApi<{ membership: AccountMembershipSummary }>("/api/account/membership");
  return payload.membership;
}
