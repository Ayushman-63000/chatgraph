import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cognisee · Knowledge Graph Interviews",
  description: "Domain-specific knowledge elicitation and live graph capture"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
