import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ProofBrief — Evidence review for draft replies (working title)",
  description:
    "Checks every claim of a draft reply against your own documents using Clocked Rerank, Verify, and Compare. Nothing is sent; a human makes the final call.",
  keywords: ["evidence review", "Clocked", "Rerank", "Verify", "Compare", "grounding"],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "ProofBrief — Evidence review for draft replies",
    description:
      "Every claim checked against your own documents. Clocked Build Challenge 2026 entry (working title).",
    siteName: "ProofBrief",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
