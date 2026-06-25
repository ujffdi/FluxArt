import { getRequestSession, renewSessionCookie } from "@/server/auth/request-auth";
import { createImageUpload, UploadValidationError } from "@/server/image/storage/upload-service";
import { fail, ok } from "@/server/shared/api-response";
import type { UploadKind } from "@/server/data/records";

function parseUploadKind(value: FormDataEntryValue | null): UploadKind | undefined {
  return value === "source" || value === "mask" ? value : undefined;
}

export async function POST(request: Request) {
  const session = await getRequestSession();
  if (!session) return fail("authentication is required", 401, "AUTH_REQUIRED");

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return fail("request body must be multipart form data", 400, "UPLOAD_FORM_INVALID");
  }

  const kind = parseUploadKind(formData.get("kind"));
  if (!kind) {
    return fail("kind must be source or mask", 400, "UPLOAD_KIND_INVALID");
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return fail("file is required", 400, "UPLOAD_FILE_REQUIRED");
  }

  try {
    const upload = await createImageUpload({
      userId: session.account.userId,
      kind,
      fileName: file.name,
      bytes: Buffer.from(await file.arrayBuffer())
    });
    return renewSessionCookie(ok({ upload }), session.sessionToken, session.session);
  } catch (error) {
    if (error instanceof UploadValidationError) {
      return fail(error.message, error.status, error.code);
    }
    const message = error instanceof Error ? error.message : "image upload failed";
    return fail(message, 502, "UPLOAD_STORAGE_FAILED");
  }
}
