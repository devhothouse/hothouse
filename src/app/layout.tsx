import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Hothouse",
  description: "A local-first social simulation sandbox — swipe, match, and chat with customizable AI characters.",
  icons: {
    shortcut: "/favicon.ico",
    icon: [
      { url: "/icon-24x24.png", sizes: "24x24", type: "image/png" },
      { url: "/icon-64x64.png", sizes: "64x64", type: "image/png" },
      { url: "/icon-256x256.png", sizes: "256x256", type: "image/png" },
    ],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
