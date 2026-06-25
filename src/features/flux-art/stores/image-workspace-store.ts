"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { GenerationMode } from "@/types/image";

export type ProductPage = "workspace" | "edit" | "assets" | "account" | "billing";
export type SessionState = "logged-in" | "guest" | "expired";
export type ThemeName = "dark" | "light";

interface ImageWorkspaceState {
  page: ProductPage;
  generationMode: "txt" | "img";
  editMode: "inpaint" | "outpaint";
  selectedAssetId: string;
  sessionState: SessionState;
  theme: ThemeName;
  toast: string;
  customSizeVisible: boolean;
  generationCount: number;
  paintStrength: number;
  referenceStrength: number;
  setPage: (page: ProductPage) => void;
  setGenerationMode: (mode: "txt" | "img") => void;
  setEditMode: (mode: "inpaint" | "outpaint") => void;
  setSelectedAssetId: (assetId: string) => void;
  setSessionState: (state: SessionState) => void;
  setTheme: (theme: ThemeName) => void;
  showToast: (toast: string) => void;
  clearToast: () => void;
  setCustomSizeVisible: (visible: boolean) => void;
  setGenerationCount: (count: number) => void;
  setPaintStrength: (value: number) => void;
  setReferenceStrength: (value: number) => void;
}

export function toTaskType(mode: "txt" | "img", editMode?: "inpaint" | "outpaint"): GenerationMode {
  if (editMode) return editMode;
  return mode === "img" ? "i2i" : "t2i";
}

export const useImageWorkspaceStore = create<ImageWorkspaceState>()(
  persist(
    set => ({
      page: "workspace",
      generationMode: "txt",
      editMode: "inpaint",
      selectedAssetId: "IMG-1832",
      sessionState: "guest",
      theme: "dark",
      toast: "",
      customSizeVisible: false,
      generationCount: 4,
      paintStrength: 58,
      referenceStrength: 62,
      setPage: page => set({ page }),
      setGenerationMode: generationMode => set({ generationMode }),
      setEditMode: editMode => set({ editMode }),
      setSelectedAssetId: selectedAssetId => set({ selectedAssetId }),
      setSessionState: sessionState => set({ sessionState }),
      setTheme: theme => set({ theme }),
      showToast: toast => set({ toast }),
      clearToast: () => set({ toast: "" }),
      setCustomSizeVisible: customSizeVisible => set({ customSizeVisible }),
      setGenerationCount: generationCount => set({ generationCount }),
      setPaintStrength: paintStrength => set({ paintStrength }),
      setReferenceStrength: referenceStrength => set({ referenceStrength })
    }),
    {
      name: "flux-art-workspace",
      partialize: state => ({
        generationMode: state.generationMode,
        editMode: state.editMode,
        selectedAssetId: state.selectedAssetId,
        theme: state.theme,
        customSizeVisible: state.customSizeVisible,
        generationCount: state.generationCount,
        paintStrength: state.paintStrength,
        referenceStrength: state.referenceStrength
      })
    }
  )
);
