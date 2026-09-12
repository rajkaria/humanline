import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";

import { Providers } from "@/components/providers";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { BrandGradientDefs } from "@/components/wordmark";
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

/** Display face. Carries the headlines, the wordmark and every card title. */
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

const title = "Humanline — one human, one credit line";
const description =
  "World ID proof of personhood reaches Creditcoin through the Attestcoin Protocol. A zero-knowledge proof is verified on Creditcoin itself, and a verified human gets an uncollateralised credit line that follows the person, not the wallet.";

/**
 * Absolute base for `og:image` and canonical links. Set
 * `NEXT_PUBLIC_SITE_URL` when a custom domain replaces the Vercel one; the
 * fallback is the production deployment.
 */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://humanline.credit";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
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
  openGraph: { title, description, siteName: "Humanline", type: "website", url: "/" },
  twitter: { card: "summary_large_image", title, description },
};

export const viewport: Viewport = {
  themeColor: "#13131c",
  width: "device-width",
  initialScale: 1,
};

/**
 * The font variables belong on `<html>`, not `<body>`. `html { font-family:
 * var(--font-sans) }` resolves them in the `<html>` scope, and a custom
 * property declared on `<body>` never reaches its parent — declared there,
 * every page silently fell back to the UA serif.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`dark ${inter.variable} ${jetbrainsMono.variable} ${spaceGrotesk.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <BrandGradientDefs />
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
