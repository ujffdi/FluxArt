"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { GenerationMode, StructureMode } from "@/types/image";

export type ProductPage = "workspace" | "assets" | "account" | "billing";
export type SessionState = "logged-in" | "guest" | "expired";

interface ImageWorkspaceState {
  page: ProductPage;
  generationMode: "txt" | "img";
  selectedAssetId: string;
  sessionState: SessionState;
  toast: string;
  customSizeVisible: boolean;
  generationCount: number;
  referenceStrength: number;
  structureMode: StructureMode;
  setPage: (page: ProductPage) => void;
  setGenerationMode: (mode: "txt" | "img") => void;
  setSelectedAssetId: (assetId: string) => void;
  setSessionState: (state: SessionState) => void;
  showToast: (toast: string) => void;
  clearToast: () => void;
  setCustomSizeVisible: (visible: boolean) => void;
  setGenerationCount: (count: number) => void;
  setReferenceStrength: (value: number) => void;
  setStructureMode: (mode: StructureMode) => void;
}

export function toTaskType(mode: "txt" | "img"): GenerationMode {
  return mode === "img" ? "i2i" : "t2i";
}

export const useImageWorkspaceStore = create<ImageWorkspaceState>()(
  persist(
    set => ({
      page: "workspace",
      generationMode: "txt",
      selectedAssetId: "IMG-1832",
      sessionState: "guest",
      toast: "",
      customSizeVisible: false,
      generationCount: 4,
      referenceStrength: 62,
      structureMode: "balanced",
      setPage: page => set({ page }),
      setGenerationMode: generationMode => set({ generationMode }),
      setSelectedAssetId: selectedAssetId => set({ selectedAssetId }),
      setSessionState: sessionState => set({ sessionState }),
      showToast: toast => set({ toast }),
      clearToast: () => set({ toast: "" }),
      setCustomSizeVisible: customSizeVisible => set({ customSizeVisible }),
      setGenerationCount: generationCount => set({ generationCount }),
      setReferenceStrength: referenceStrength => set({ referenceStrength }),
      setStructureMode: structureMode => set({ structureMode })
    }),
    {
      name: "flux-art-workspace",
      partialize: state => ({
        generationMode: state.generationMode,
        selectedAssetId: state.selectedAssetId,
        customSizeVisible: state.customSizeVisible,
        generationCount: state.generationCount,
        referenceStrength: state.referenceStrength,
        structureMode: state.structureMode
      })
    }
  )
);
