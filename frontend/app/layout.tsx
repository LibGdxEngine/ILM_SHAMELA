import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ILM Shamela - Document Search",
  description: "Upload and search documents",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
