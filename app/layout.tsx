import type { Metadata } from "next";
import { Inter, Roboto_Mono } from "next/font/google";
import "@/styles/globals.css";
import "@xterm/xterm/css/xterm.css";
import { RealtimeProvider } from "@/components/realtime/realtime-provider";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const robotoMono = Roboto_Mono({
  variable: "--font-roboto-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Vibe Coding",
  description: "Internal development workspace platform",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      className={`${inter.variable} ${robotoMono.variable} h-full bg-primary antialiased`}
    >
      <body className="min-h-full"><RealtimeProvider>{children}</RealtimeProvider></body>
    </html>
  );
}
