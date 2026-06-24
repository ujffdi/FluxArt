import { account, assets, tasks, versionNodes } from "@/features/flux-art/data/demo-data";
import type { BillingOrder, BillingPlanId } from "@/types/billing";
import type { AccountEntitlement, AssetVersionNode, ImageAsset, ImageGenerationTask } from "@/types/image";

export interface ImageRepository {
  listAssets: () => Promise<ImageAsset[]>;
  getAsset: (assetId: string) => Promise<ImageAsset | undefined>;
  listTasks: () => Promise<ImageGenerationTask[]>;
  getTask: (taskId: string) => Promise<ImageGenerationTask | undefined>;
  createTask: (task: ImageGenerationTask) => Promise<ImageGenerationTask>;
  listVersionNodes: () => Promise<AssetVersionNode[]>;
}

export interface AccountRepository {
  getCurrentAccount: () => Promise<AccountEntitlement>;
}

export interface BillingRepository {
  createOrder: (input: CreateOrderRecordInput) => Promise<BillingOrder>;
}

export interface CreateOrderRecordInput {
  planId: BillingPlanId;
  userId: string;
  creditsAfterPayment: number;
  memberStatusAfterPayment: AccountEntitlement["memberStatus"];
}

export interface AppRepositories {
  image: ImageRepository;
  account: AccountRepository;
  billing: BillingRepository;
}

const taskRecords = [...tasks];
const orderRecords: BillingOrder[] = [];

const mockRepositories: AppRepositories = {
  image: {
    async listAssets() {
      return assets;
    },
    async getAsset(assetId) {
      return assets.find(asset => asset.id === assetId);
    },
    async listTasks() {
      return taskRecords;
    },
    async getTask(taskId) {
      return taskRecords.find(task => task.id === taskId);
    },
    async createTask(task) {
      taskRecords.unshift(task);
      return task;
    },
    async listVersionNodes() {
      return versionNodes;
    }
  },
  account: {
    async getCurrentAccount() {
      return account;
    }
  },
  billing: {
    async createOrder(input) {
      const order: BillingOrder = {
        ...input,
        orderId: `ORD-${Date.now().toString(36).toUpperCase()}`,
        status: "pending_payment",
        createdAt: new Date().toISOString()
      };
      orderRecords.unshift(order);
      return order;
    }
  }
};

export function getRepositories(): AppRepositories {
  return mockRepositories;
}
