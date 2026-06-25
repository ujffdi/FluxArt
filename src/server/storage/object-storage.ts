import { createHash, createHmac, randomUUID } from "node:crypto";

interface PutObjectInput {
  objectKey: string;
  body: Buffer;
  contentType: string;
}

function trimSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function encodeObjectKey(objectKey: string) {
  return objectKey.split("/").map(segment => encodeURIComponent(segment)).join("/");
}

function publicUrlFor(objectKey: string) {
  const baseUrl = process.env.MINIO_PUBLIC_BASE_URL;
  if (!baseUrl) return `/mock-storage/${objectKey}`;
  return `${trimSlash(baseUrl)}/${encodeObjectKey(objectKey)}`;
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function sign(key: string, dateStamp: string, region: string, service: string) {
  const dateKey = hmac(`AWS4${key}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  return hmac(serviceKey, "aws4_request");
}

function timestamp(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function shouldUseMockStorage() {
  return (process.env.FLUXART_DATA_MODE || "mock") !== "prisma" || !process.env.MINIO_ENDPOINT;
}

export function createObjectKey(input: { userId: string; kind: "source" | "mask" | "asset"; extension: string; taskId?: string }) {
  const safeExtension = input.extension.replace(/^\./, "");
  const scope = input.taskId ? `tasks/${input.taskId}` : `users/${input.userId}`;
  return `${input.kind === "asset" ? "assets" : "uploads"}/${scope}/${input.kind}/${randomUUID()}.${safeExtension}`;
}

export async function putObject(input: PutObjectInput) {
  if (shouldUseMockStorage()) {
    return { objectKey: input.objectKey, publicUrl: publicUrlFor(input.objectKey) };
  }

  const endpoint = process.env.MINIO_ENDPOINT;
  const bucket = process.env.MINIO_BUCKET;
  const accessKey = process.env.MINIO_ACCESS_KEY;
  const secretKey = process.env.MINIO_SECRET_KEY;
  if (!endpoint || !bucket || !accessKey || !secretKey) {
    throw new Error("Missing MinIO storage configuration");
  }

  const endpointUrl = new URL(endpoint);
  const region = process.env.MINIO_REGION || "us-east-1";
  const service = "s3";
  const now = timestamp();
  const dateStamp = now.slice(0, 8);
  const payloadHash = createHash("sha256").update(input.body).digest("hex");
  const pathname = `/${bucket}/${encodeObjectKey(input.objectKey)}`;
  const host = endpointUrl.host;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = [
    `content-type:${input.contentType}`,
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${now}`
  ].join("\n") + "\n";
  const canonicalRequest = ["PUT", pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    now,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex")
  ].join("\n");
  const signature = createHmac("sha256", sign(secretKey, dateStamp, region, service)).update(stringToSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const body = input.body.buffer.slice(input.body.byteOffset, input.body.byteOffset + input.body.byteLength) as ArrayBuffer;
  const response = await fetch(new URL(pathname, endpointUrl), {
    method: "PUT",
    headers: {
      Authorization: authorization,
      "Content-Type": input.contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": now
    },
    body
  });

  if (!response.ok) {
    throw new Error(`MinIO object upload failed: ${response.status} ${await response.text()}`);
  }

  return { objectKey: input.objectKey, publicUrl: publicUrlFor(input.objectKey) };
}

export async function assertObjectReadable(objectKey: string) {
  if (shouldUseMockStorage()) return;

  const endpoint = process.env.MINIO_ENDPOINT;
  const bucket = process.env.MINIO_BUCKET;
  const accessKey = process.env.MINIO_ACCESS_KEY;
  const secretKey = process.env.MINIO_SECRET_KEY;
  if (!endpoint || !bucket || !accessKey || !secretKey) {
    throw new Error("Missing MinIO storage configuration");
  }

  const endpointUrl = new URL(endpoint);
  const region = process.env.MINIO_REGION || "us-east-1";
  const service = "s3";
  const now = timestamp();
  const dateStamp = now.slice(0, 8);
  const payloadHash = createHash("sha256").update("").digest("hex");
  const pathname = `/${bucket}/${encodeObjectKey(objectKey)}`;
  const host = endpointUrl.host;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = [
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${now}`
  ].join("\n") + "\n";
  const canonicalRequest = ["HEAD", pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    now,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex")
  ].join("\n");
  const signature = createHmac("sha256", sign(secretKey, dateStamp, region, service)).update(stringToSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch(new URL(pathname, endpointUrl), {
    method: "HEAD",
    headers: {
      Authorization: authorization,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": now
    }
  });

  if (!response.ok) {
    throw new Error(`MinIO object read check failed: ${response.status}`);
  }
}
