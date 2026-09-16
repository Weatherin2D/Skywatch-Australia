import type { Metadata } from "next";
import { Source_Sans_3 } from "next/font/google";
import "./globals.css";

const sans = Source_Sans_3({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "SkyWatch Australia | Real weather. Deeper insight.",
  description:
    "Australian weather, observed and forecast — radar, warnings, outlooks, and deeper insight for a safer Australia.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en-AU"
      className={`${sans.variable} h-full`}
      style={{ ["--font-display" as string]: "var(--font-sans)" }}
    >
      <body className="min-h-full bg-[var(--page)] font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
