import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import { Providers } from "@/components/providers";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

const title = "Humanline — one human, one credit line";
const description =
  "World ID proof of personhood reaches Creditcoin through the Attestcoin Protocol. A zero-knowledge proof is verified on Creditcoin itself, and a verified human gets an uncollateralised credit line that follows the person, not the wallet.";

export const metadata: Metadata = {
  title: { default: title, template: "%s — Humanline" },
  description,
  applicationName: "Humanline",
  keywords: [
    "Creditcoin",
    "Attestcoin",
    "World ID",
    "proof of personhood",
    "uncollateralised credit",
    "zero-knowledge",
    "Semaphore",
  ],
  openGraph: { title, description, siteName: "Humanline", type: "website" },
  twitter: { card: "summary_large_image", title, description },
};

export const viewport: Viewport = {
  themeColor: "#13131c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${inter.variable} ${jetbrainsMono.variable} antialiased`}>
        <Providers>
          <div className="relative flex min-h-dvh flex-col">
            <SiteHeader />
            <main className="flex-1">{children}</main>
            <SiteFooter />
          </div>
          <Toaster position="bottom-right" theme="dark" closeButton richColors />
        </Providers>
      </body>
    </html>
  );
}
