export type ImageModelExecutionMode = "mock" | "live";
export type ModelConfigurationTestStatus = "untested" | "passed" | "failed";
export type ModelConfigurationChangeType = "save" | "restore";

export interface EditableImageModelConfiguration {
  provider: string;
  model: string;
  baseUrl: string;
  apiKeySecretRef: string;
  executionMode: ImageModelExecutionMode;
  requestTimeoutMs: number;
}

export interface EditableSelectableImageModel extends EditableImageModelConfiguration {
  id: string;
  displayName: string;
  enabled: boolean;
  isDefault: boolean;
}

export interface SelectableImageModel extends EditableSelectableImageModel {
  lastTestStatus: ModelConfigurationTestStatus;
  lastTestedAt?: string;
  lastTestError?: string;
  updatedByUserId?: string;
  createdAt: string;
  updatedAt: string;
}

export type ActiveImageModelConfiguration = SelectableImageModel;

export interface ModelConfigurationChange {
  id: string;
  changedByUserId: string;
  changeType: ModelConfigurationChangeType;
  beforeConfig?: EditableSelectableImageModel[];
  afterConfig: EditableSelectableImageModel[];
  testStatus: ModelConfigurationTestStatus;
  testError?: string;
  restoredFromChangeId?: string;
  createdAt: string;
}
