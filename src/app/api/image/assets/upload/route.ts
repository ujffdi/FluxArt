import { getRequestSession, renewSessionCookie } from "@/server/auth/request-auth";
import { createUserUploadedAsset, UploadValidationError } from "@/server/image/storage/upload-service";
import { fail, ok } from "@/server/shared/api-response";

export async function POST(request: Request) {
  const session = await getRequestSession();
  if (!session) return fail("authentication is required", 401, "AUTH_REQUIRED");

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return fail("request body must be multipart form data", 400, "UPLOAD_FORM_INVALID");
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return fail("file is required", 400, "UPLOAD_FILE_REQUIRED");
  }

  try {
    const asset = await createUserUploadedAsset({
      userId: session.account.userId,
      fileName: file.name,
      bytes: Buffer.from(await file.arrayBuffer())
    });
    return renewSessionCookie(ok({ asset }), session.sessionToken, session.session);
  } catch (error) {
    if (error instanceof UploadValidationError) {
      return fail(error.message, error.status, error.code);
    }
    const message = error instanceof Error ? error.message : "image asset upload failed";
    return fail(message, 502, "UPLOAD_STORAGE_FAILED");
  }
}
