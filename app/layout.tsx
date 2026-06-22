import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cognisee · Hospitality Knowledge Engineer",
  description: "Expert hospitality knowledge elicitation and live graph capture"
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
