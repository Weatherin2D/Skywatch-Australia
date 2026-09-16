import type { Metadata } from "next";
import { Outfit, Source_Sans_3 } from "next/font/google";
import "./globals.css";

const display = Outfit({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

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
    <html lang="en-AU" className={`${display.variable} ${sans.variable} h-full`}>
      <body className="min-h-full bg-[var(--navy-deep)] font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
