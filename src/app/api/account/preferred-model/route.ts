import { getRepositories } from "@/server/data/repositories";
import { getRequestSession, renewSessionCookie } from "@/server/auth/request-auth";
import { getUserModelSelectionState } from "@/server/image/ai/model-config";
import { fail, ok } from "@/server/shared/api-response";

export async function POST(request: Request) {
  const session = await getRequestSession();
  if (!session) return fail("authentication is required", 401, "AUTH_REQUIRED");
  const repositories = getRepositories();
  const account = await repositories.account.getCurrentAccount(session.account.userId);
  if (account.memberStatus !== "credit_pack") {
    return fail("model selection requires purchased credits", 403, "MODEL_SELECTION_REQUIRES_PURCHASE");
  }

  const body = await request.json().catch(() => ({})) as { modelId?: unknown };
  const modelId = typeof body.modelId === "string" ? body.modelId : undefined;
  const state = await getUserModelSelectionState(account, modelId);
  if (!modelId || !state.models.some(model => model.id === modelId)) {
    return fail("selected model is not available", 400, "MODEL_SELECTION_UNAVAILABLE");
  }

  await repositories.account.updatePreferredImageModel(session.account.userId, modelId);
  const nextState = await getUserModelSelectionState({ ...account, preferredImageModelId: modelId }, modelId);
  return renewSessionCookie(ok({ modelSelection: nextState }), session.sessionToken, session.session);
}
