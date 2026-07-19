import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Odiina",
    template: "%s · Odiina",
  },
  description:
    "Odiina is a private raw-life and work feed that turns your daily activity into traceable personal intelligence.",
  applicationName: "Odiina",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
