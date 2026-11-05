// Defines root document metadata, viewport settings, and global styles.
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Enginuity — Robot Simulation & Offline Programming",
  description: "Simulate robots, build programs and generate robot code — with an AI copilot that can operate every feature.",
};

export const viewport: Viewport = {
  themeColor: "#f2f2f0",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="light">
      <body>{children}</body>
    </html>
  );
}
