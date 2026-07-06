import type { AccountEntitlement, GenerationMode, ImageGenerationTask, TaskStatus } from "@/types/image";

export const activeTaskStates: TaskStatus[] = ["queued", "running", "storing", "reviewing"];

export const taskPriorityByTier: Record<AccountEntitlement["memberStatus"], number> = {
  free: 10,
  credit_pack: 50
};

export const runningTaskLimitByTier: Record<AccountEntitlement["memberStatus"], number> = {
  free: 1,
  credit_pack: 4
};

const capabilitiesByTier: Record<AccountEntitlement["memberStatus"], GenerationMode[]> = {
  free: ["t2i", "i2i"],
  credit_pack: ["t2i", "i2i", "inpaint", "outpaint"]
};

const allowedTransitions: Record<TaskStatus, TaskStatus[]> = {
  queued: ["running", "failed", "refunded"],
  running: ["storing", "failed", "refunded"],
  storing: ["reviewing", "failed", "refunded"],
  reviewing: ["succeeded", "failed", "refunded"],
  succeeded: ["refunded"],
  failed: ["refunded"],
  refunded: []
};

export class TaskCapabilityError extends Error {
  readonly code = "TASK_CAPABILITY_REQUIRED";
  readonly status = 403;

  constructor(memberStatus: AccountEntitlement["memberStatus"], taskType: GenerationMode) {
    super(`${memberStatus} accounts cannot create ${taskType} tasks`);
    this.name = "TaskCapabilityError";
  }
}

export class TaskConcurrencyError extends Error {
  readonly code = "TASK_LIMIT_REACHED";
  readonly status = 409;

  constructor(limit: number) {
    super(`running task limit reached: ${limit}`);
    this.name = "TaskConcurrencyError";
  }
}

export class TaskStateTransitionError extends Error {
  readonly code = "TASK_STATE_TRANSITION_INVALID";
  readonly status = 409;

  constructor(from: TaskStatus, to: TaskStatus) {
    super(`invalid task state transition: ${from} -> ${to}`);
    this.name = "TaskStateTransitionError";
  }
}

export function getTaskPriority(memberStatus: AccountEntitlement["memberStatus"]) {
  return taskPriorityByTier[memberStatus];
}

export function assertTaskCapability(account: AccountEntitlement, taskType: GenerationMode) {
  if (!capabilitiesByTier[account.memberStatus].includes(taskType)) {
    throw new TaskCapabilityError(account.memberStatus, taskType);
  }
}

export function assertRunningTaskLimit(account: AccountEntitlement, tasks: ImageGenerationTask[]) {
  const limit = runningTaskLimitByTier[account.memberStatus];
  const activeCount = tasks.filter(task => activeTaskStates.includes(task.status)).length;
  if (activeCount >= limit) throw new TaskConcurrencyError(limit);
}

export function assertTaskStateTransition(from: TaskStatus, to: TaskStatus) {
  if (!allowedTransitions[from].includes(to)) {
    throw new TaskStateTransitionError(from, to);
  }
}
