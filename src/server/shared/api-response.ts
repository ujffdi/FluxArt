import type { ApiErrorData, ApiResponse } from "@/types/api";

export function ok<T>(data: T): Response {
  return Response.json({
    code: 200,
    message: "success",
    data
  } satisfies ApiResponse<T>);
}

export function fail(message: string, code = 400, errorCode = "BAD_REQUEST"): Response {
  return Response.json(
    {
      code,
      message,
      data: { errorCode }
    } satisfies ApiResponse<ApiErrorData>,
    { status: code }
  );
}
