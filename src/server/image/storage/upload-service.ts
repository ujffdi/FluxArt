import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { getRepositories } from "@/server/data/repositories";
import type { ImageUploadRecord, UploadKind } from "@/server/data/records";
import type { ImageAsset, ImageGenerationTask } from "@/types/image";
import { createObjectKey, putObject } from "@/server/storage/object-storage";

const maxUploadBytes = 10 * 1024 * 1024;
const maxImageEdge = 4096;

const sourceFormats = new Set(["jpeg", "png", "webp"]);
const maskFormats = new Set(["png", "webp"]);

export interface StoredGeneratedOutput {
  objectKey: string;
  publicUrl: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
}

export class UploadValidationError extends Error {
  readonly code: string;
  readonly status = 400;

  constructor(message: string, code: string) {
    super(message);
    this.name = "UploadValidationError";
    this.code = code;
  }
}

function mimeForFormat(format: string) {
  if (format === "jpeg") return "image/jpeg";
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";
  return "application/octet-stream";
}

function extensionForFormat(format: string) {
  return format === "jpeg" ? "jpg" : format;
}

function displayTitleFromFileName(fileName?: string) {
  const trimmed = fileName?.trim();
  if (!trimmed) return "用户上传图片";
  const baseName = trimmed.split(/[\\/]/).pop() || trimmed;
  const withoutExtension = baseName.replace(/\.[^.]+$/, "").trim();
  return (withoutExtension || "用户上传图片").slice(0, 80);
}

async function prepareUploadBuffer(kind: UploadKind, input: Buffer) {
  if (input.byteLength > maxUploadBytes) {
    throw new UploadValidationError("image upload must be 10MB or smaller", "UPLOAD_TOO_LARGE");
  }

  let image = sharp(input, { failOn: "error" });
  const metadata = await image.metadata().catch(() => {
    throw new UploadValidationError(kind === "mask" ? "mask uploads must be PNG or WebP" : "source uploads must be JPEG, PNG, or WebP", "UPLOAD_TYPE_UNSUPPORTED");
  });
  const format = metadata.format || "";
  const allowedFormats = kind === "mask" ? maskFormats : sourceFormats;

  if (!allowedFormats.has(format)) {
    throw new UploadValidationError(kind === "mask" ? "mask uploads must be PNG or WebP" : "source uploads must be JPEG, PNG, or WebP", "UPLOAD_TYPE_UNSUPPORTED");
  }

  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (!width || !height) {
    throw new UploadValidationError("image dimensions could not be read", "UPLOAD_DIMENSIONS_INVALID");
  }
  if (Math.max(width, height) > maxImageEdge) {
    throw new UploadValidationError("image maximum edge must be 4096px or smaller", "UPLOAD_DIMENSIONS_TOO_LARGE");
  }

  if (kind === "mask") {
    const normalized = await image.ensureAlpha().png().toBuffer();
    image = sharp(normalized, { failOn: "error" });
    const normalizedMetadata = await image.metadata();
    return {
      body: normalized,
      width: normalizedMetadata.width || width,
      height: normalizedMetadata.height || height,
      mimeType: "image/png",
      extension: "png"
    };
  }

  return {
    body: input,
    width,
    height,
    mimeType: mimeForFormat(format),
    extension: extensionForFormat(format)
  };
}

export async function createImageUpload(input: { userId: string; kind: UploadKind; fileName?: string; bytes: Buffer }) {
  const prepared = await prepareUploadBuffer(input.kind, input.bytes);
  const objectKey = createObjectKey({ userId: input.userId, kind: input.kind, extension: prepared.extension });
  const stored = await putObject({
    objectKey,
    body: prepared.body,
    contentType: prepared.mimeType
  });
  const now = new Date().toISOString();
  const upload: ImageUploadRecord = {
    id: `upload-${randomUUID()}`,
    userId: input.userId,
    kind: input.kind,
    objectKey: stored.objectKey,
    publicUrl: stored.publicUrl,
    mimeType: prepared.mimeType,
    sizeBytes: prepared.body.byteLength,
    width: prepared.width,
    height: prepared.height,
    validationStatus: "accepted",
    createdAt: now
  };

  return getRepositories().image.createUpload(upload);
}

export async function createUserUploadedAsset(input: { userId: string; fileName?: string; bytes: Buffer }) {
  const prepared = await prepareUploadBuffer("source", input.bytes);
  const objectKey = createObjectKey({
    userId: input.userId,
    kind: "asset",
    extension: prepared.extension
  });
  const stored = await putObject({
    objectKey,
    body: prepared.body,
    contentType: prepared.mimeType
  });
  const now = new Date().toISOString();
  const asset: ImageAsset = {
    id: `asset-${randomUUID()}`,
    userId: input.userId,
    title: displayTitleFromFileName(input.fileName),
    origin: "uploaded",
    status: "succeeded",
    prompt: "",
    imageUrl: stored.publicUrl,
    objectKey: stored.objectKey,
    publicUrl: stored.publicUrl,
    mimeType: prepared.mimeType,
    sizeBytes: prepared.body.byteLength,
    width: prepared.width,
    height: prepared.height,
    reviewStatus: "skipped",
    downloadState: "not_downloaded",
    modelProvider: "user",
    modelName: "uploaded-image",
    createdAt: now
  };

  return getRepositories().image.createAsset(asset);
}

export async function storeGeneratedOutput(input: { task: ImageGenerationTask; bytes: Buffer }): Promise<StoredGeneratedOutput> {
  const prepared = await prepareUploadBuffer("source", input.bytes);
  const objectKey = createObjectKey({
    userId: input.task.userId,
    kind: "asset",
    taskId: input.task.id,
    extension: prepared.extension
  });
  const stored = await putObject({
    objectKey,
    body: prepared.body,
    contentType: prepared.mimeType
  });

  return {
    objectKey: stored.objectKey,
    publicUrl: stored.publicUrl,
    mimeType: prepared.mimeType,
    sizeBytes: prepared.body.byteLength,
    width: prepared.width,
    height: prepared.height
  };
}

export async function createGeneratedAsset(input: { task: ImageGenerationTask; title?: string; output: StoredGeneratedOutput; reviewStatus?: ImageAsset["reviewStatus"] }) {
  const repositories = getRepositories();
  const now = new Date().toISOString();
  const reviewStatus = input.reviewStatus || "approved";
  const asset: ImageAsset = {
    id: `asset-${randomUUID()}`,
    userId: input.task.userId,
    title: input.title || input.task.prompt.slice(0, 80) || "Generated asset",
    origin: "generated",
    taskId: input.task.id,
    taskType: input.task.taskType,
    status: reviewStatus === "approved" ? "succeeded" : "reviewing",
    prompt: input.task.prompt,
    imageUrl: input.output.publicUrl,
    objectKey: input.output.objectKey,
    publicUrl: input.output.publicUrl,
    mimeType: input.output.mimeType,
    sizeBytes: input.output.sizeBytes,
    width: input.output.width,
    height: input.output.height,
    reviewStatus,
    sourceAssetId: input.task.sourceAssetId,
    downloadState: "not_downloaded",
    modelProvider: input.task.modelProvider,
    modelName: input.task.modelName,
    createdAt: now
  };

  return repositories.image.createAsset(asset);
}

export async function storeGeneratedAsset(input: { task: ImageGenerationTask; title?: string; bytes: Buffer }) {
  const output = await storeGeneratedOutput({ task: input.task, bytes: input.bytes });
  return createGeneratedAsset({ task: input.task, title: input.title, output, reviewStatus: "pending" });
}
