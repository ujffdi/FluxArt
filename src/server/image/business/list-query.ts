import {
  assetOrigins,
  assetStatuses,
  generationModes,
  taskStatuses,
  type AssetOrigin,
  type AssetStatus,
  type GenerationMode,
  type ListImageAssetsQuery,
  type ListImageTasksQuery,
  type TaskStatus
} from "@/types/image";

interface QueryParseError {
  message: string;
  errorCode: string;
}

type QueryParseResult<T> = { ok: true; query: T } | { ok: false; error: QueryParseError };

function isGenerationMode(value: string): value is GenerationMode {
  return generationModes.some(mode => mode === value);
}

function isTaskStatus(value: string): value is TaskStatus {
  return taskStatuses.some(status => status === value);
}

function isAssetStatus(value: string): value is AssetStatus {
  return assetStatuses.some(status => status === value);
}

function isAssetOrigin(value: string): value is AssetOrigin {
  return assetOrigins.some(origin => origin === value);
}

function parsePositiveInt(searchParams: URLSearchParams, key: "page" | "pageSize"): number | QueryParseError | undefined {
  const rawValue = searchParams.get(key);
  if (!rawValue) return undefined;

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1) {
    return { message: `${key} must be a positive integer`, errorCode: `${key.toUpperCase()}_INVALID` };
  }

  if (key === "pageSize" && value > 100) {
    return { message: "pageSize must be less than or equal to 100", errorCode: "PAGE_SIZE_TOO_LARGE" };
  }

  return value;
}

function parsePagination(searchParams: URLSearchParams) {
  const page = parsePositiveInt(searchParams, "page");
  if (typeof page === "object") return page;

  const pageSize = parsePositiveInt(searchParams, "pageSize");
  if (typeof pageSize === "object") return pageSize;

  return { page, pageSize };
}

function parseQ(searchParams: URLSearchParams): string | undefined {
  const q = searchParams.get("q")?.trim();
  return q || undefined;
}

export function parseTaskListQuery(searchParams: URLSearchParams): QueryParseResult<ListImageTasksQuery> {
  const pagination = parsePagination(searchParams);
  if ("errorCode" in pagination) return { ok: false, error: pagination };

  const taskType = searchParams.get("taskType");
  let parsedTaskType: GenerationMode | undefined;
  if (taskType) {
    if (!isGenerationMode(taskType)) {
      return { ok: false, error: { message: "unsupported taskType", errorCode: "TASK_TYPE_UNSUPPORTED" } };
    }
    parsedTaskType = taskType;
  }

  const status = searchParams.get("status");
  let parsedStatus: TaskStatus | undefined;
  if (status) {
    if (!isTaskStatus(status)) {
      return { ok: false, error: { message: "unsupported task status", errorCode: "TASK_STATUS_UNSUPPORTED" } };
    }
    parsedStatus = status;
  }

  return {
    ok: true,
    query: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      taskType: parsedTaskType,
      status: parsedStatus,
      q: parseQ(searchParams)
    }
  };
}

export function parseAssetListQuery(searchParams: URLSearchParams): QueryParseResult<ListImageAssetsQuery> {
  const pagination = parsePagination(searchParams);
  if ("errorCode" in pagination) return { ok: false, error: pagination };

  const taskType = searchParams.get("taskType");
  let parsedTaskType: GenerationMode | undefined;
  if (taskType) {
    if (!isGenerationMode(taskType)) {
      return { ok: false, error: { message: "unsupported taskType", errorCode: "TASK_TYPE_UNSUPPORTED" } };
    }
    parsedTaskType = taskType;
  }

  const status = searchParams.get("status");
  let parsedStatus: AssetStatus | undefined;
  if (status) {
    if (!isAssetStatus(status)) {
      return { ok: false, error: { message: "unsupported asset status", errorCode: "ASSET_STATUS_UNSUPPORTED" } };
    }
    parsedStatus = status;
  }

  const origin = searchParams.get("origin");
  let parsedOrigin: AssetOrigin | undefined;
  if (origin) {
    if (!isAssetOrigin(origin)) {
      return { ok: false, error: { message: "unsupported asset origin", errorCode: "ASSET_ORIGIN_UNSUPPORTED" } };
    }
    parsedOrigin = origin;
  }

  return {
    ok: true,
    query: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      taskType: parsedTaskType,
      status: parsedStatus,
      origin: parsedOrigin,
      q: parseQ(searchParams)
    }
  };
}
