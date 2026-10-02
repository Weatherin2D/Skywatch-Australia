import type { Metadata, Viewport } from "next";
import { DM_Sans, Oswald } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/site/sw-register";
import "./globals.css";

const sans = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

/** Tall condensed display — narrower glyph width than Syne / Barlow. */
const display = Oswald({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "SkyWatch Australia | Real weather. Deeper insight.",
  description:
    "Australian weather, observed and forecast — radar, warnings, outlooks, and deeper insight for a safer Australia.",
  applicationName: "SkyWatch Australia",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SkyWatch",
  },
  icons: {
    icon: [{ url: "/icon", type: "image/png" }],
    apple: [{ url: "/apple-icon", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#070b16",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en-AU"
      className={`${sans.variable} ${display.variable} h-full dark`}
    >
      <body className="min-h-full bg-[var(--page)] font-sans text-foreground antialiased">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
