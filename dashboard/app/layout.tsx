import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UI Capture & Analyzer",
  description: "DOM/CSS reference scraper + screenshot capture dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
