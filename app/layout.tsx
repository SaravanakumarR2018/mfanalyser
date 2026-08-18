import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3001";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "FolioVista — Mutual Fund CAS Dashboard";
  const description = "Turn a CAMS or KFintech CAS PDF into a private, interactive mutual fund portfolio dashboard. Your statement never leaves your browser.";
  return {
    metadataBase: new URL(origin),
    title,
    description,
    openGraph: {
      title: "FolioVista",
      description: "Your mutual funds, finally in focus.",
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1200, height: 630, alt: "FolioVista mutual fund dashboard" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "FolioVista",
      description: "Your mutual funds, finally in focus.",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN">
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="shortcut icon" href="/favicon.svg" />
      </head>
      <body>{children}</body>
    </html>
  );
}
