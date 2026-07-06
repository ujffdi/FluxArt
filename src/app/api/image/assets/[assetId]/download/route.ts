import { confirmDownload, getAsset } from "@/server/image/business/image-service";
import { getRequestSession, renewSessionCookie } from "@/server/auth/request-auth";
import { fail, ok } from "@/server/shared/api-response";
import { getObject } from "@/server/storage/object-storage";
import type { ImageAsset } from "@/types/image";

interface RouteContext {
  params: Promise<{ assetId: string }>;
}

function extensionFor(asset: ImageAsset) {
  const objectExtension = asset.objectKey.split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (objectExtension) return objectExtension === "jpeg" ? "jpg" : objectExtension;
  if (asset.mimeType === "image/jpeg") return "jpg";
  if (asset.mimeType === "image/webp") return "webp";
  return "png";
}

function asciiFileName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "fluxart-image";
}

function contentDispositionFor(asset: ImageAsset) {
  const extension = extensionFor(asset);
  const utf8Name = `${asset.title || asset.id}.${extension}`;
  const fallbackName = `${asciiFileName(asset.title || asset.id)}.${extension}`;
  return `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`;
}

function bufferBody(buffer: Buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

async function readAssetBytes(asset: ImageAsset, request: Request) {
  try {
    return await getObject(asset.objectKey);
  } catch (error) {
    if (!asset.publicUrl) throw error;
    const response = await fetch(new URL(asset.publicUrl, request.url));
    if (!response.ok) throw error;
    return {
      body: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") || undefined
    };
  }
}

export async function GET(request: Request, context: RouteContext) {
  const session = await getRequestSession();
  if (!session) return fail("authentication is required", 401, "AUTH_REQUIRED");

  const { assetId } = await context.params;
  const asset = await getAsset(assetId, session.account.userId);
  if (!asset) {
    return fail("image asset not found", 404, "ASSET_NOT_FOUND");
  }

  if (asset.status !== "succeeded") {
    return fail("image asset is not ready for download", 409, "ASSET_NOT_DOWNLOADABLE");
  }
  if (asset.downloadState !== "hd") {
    return fail("download must be confirmed first", 409, "DOWNLOAD_NOT_CONFIRMED");
  }

  try {
    const stored = await readAssetBytes(asset, request);
    const response = new Response(bufferBody(stored.body), {
      headers: {
        "Content-Type": stored.contentType || asset.mimeType || "application/octet-stream",
        "Content-Length": String(stored.body.byteLength),
        "Content-Disposition": contentDispositionFor(asset),
        "Cache-Control": "private, max-age=60"
      }
    });
    return renewSessionCookie(response, session.sessionToken, session.session);
  } catch (error) {
    const message = error instanceof Error ? error.message : "image asset download failed";
    return fail(message, 502, "DOWNLOAD_STORAGE_FAILED");
  }
}

export async function POST(_request: Request, context: RouteContext) {
  const session = await getRequestSession();
  if (!session) return fail("authentication is required", 401, "AUTH_REQUIRED");

  const { assetId } = await context.params;
  if (!(await getAsset(assetId, session.account.userId))) {
    return fail("image asset not found", 404, "ASSET_NOT_FOUND");
  }
  const decision = await confirmDownload(assetId, session.account.userId);
  return renewSessionCookie(ok({
    decision: decision.allowed
      ? { ...decision, downloadUrl: `/api/image/assets/${encodeURIComponent(assetId)}/download` }
      : decision
  }), session.sessionToken, session.session);
}
