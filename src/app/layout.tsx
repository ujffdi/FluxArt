import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flux Art · 在线 AI 生图产品 V1.0",
  description: "Next.js V1 implementation for Flux Art online AI image generation workflows."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
