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

export interface ActiveImageModelConfiguration extends EditableImageModelConfiguration {
  id: string;
  lastTestStatus: ModelConfigurationTestStatus;
  lastTestedAt?: string;
  lastTestError?: string;
  updatedByUserId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModelConfigurationChange {
  id: string;
  changedByUserId: string;
  changeType: ModelConfigurationChangeType;
  beforeConfig?: EditableImageModelConfiguration;
  afterConfig: EditableImageModelConfiguration;
  testStatus: ModelConfigurationTestStatus;
  testError?: string;
  restoredFromChangeId?: string;
  createdAt: string;
}
