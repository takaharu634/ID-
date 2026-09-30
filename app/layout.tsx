import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./report-print.css";
import "./print-preview.css";
import "./pitch-spin-profile.css";
import "./batter-side-report.css";
import "./readability.css";
import "./opponent-report.css";

export const metadata: Metadata = {
  title: "ID東都 | TrackManデータ分析",
  description: "東都大学野球の投球・打球・捕手データを検索、比較、可視化するTrackManデータベース。",
  applicationName: "ID東都",
  alternates: {
    types: {
      "text/plain": "/llms.txt",
      "application/json": "/openapi.json",
    },
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ID東都",
  },
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#153f43",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
