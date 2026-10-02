import type { Metadata } from "next";
import { DM_Sans, Syne } from "next/font/google";
import "./globals.css";

const sans = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const display = Syne({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

export const metadata: Metadata = {
  title: "SkyWatch Australia | Real weather. Deeper insight.",
  description:
    "Australian weather, observed and forecast — radar, warnings, outlooks, and deeper insight for a safer Australia.",
  applicationName: "SkyWatch Australia",
  icons: {
    icon: [{ url: "/icon", type: "image/png" }],
    apple: [{ url: "/apple-icon", type: "image/png" }],
  },
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
      </body>
    </html>
  );
}
