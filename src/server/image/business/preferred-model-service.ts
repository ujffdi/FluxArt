import { getRepositories } from "@/server/data/repositories";
import { getUserModelSelectionState } from "@/server/image/ai/model-config";

export class PreferredModelError extends Error {
  constructor(message: string, public code: string, public status = 400) {
    super(message);
    this.name = "PreferredModelError";
  }
}

export async function savePreferredImageModel(userId: string, modelId: unknown) {
  if (typeof modelId !== "string" || !modelId.trim()) {
    throw new PreferredModelError("selected model is not available", "MODEL_SELECTION_UNAVAILABLE");
  }

  const repositories = getRepositories();
  const account = await repositories.account.getCurrentAccount(userId);
  if (account.memberStatus !== "credit_pack") {
    throw new PreferredModelError("model selection requires purchased credits", "MODEL_SELECTION_REQUIRES_PURCHASE", 403);
  }

  const state = await getUserModelSelectionState(account, modelId);
  if (!state.models.some(model => model.id === modelId)) {
    throw new PreferredModelError("selected model is not available", "MODEL_SELECTION_UNAVAILABLE");
  }

  await repositories.account.updatePreferredImageModel(userId, modelId);
  return getUserModelSelectionState({ ...account, preferredImageModelId: modelId }, modelId);
}
