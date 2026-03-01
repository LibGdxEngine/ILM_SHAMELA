import type { Metadata } from "next";
import { Manrope, Noto_Naskh_Arabic } from "next/font/google";
import "./globals.css";
import Navigation from "@/components/Navigation";
import { AuthProvider } from "@/lib/AuthContext";
import { I18nProvider } from "@/components/i18n/I18nProvider";
import HtmlLangDirSync from "@/components/i18n/HtmlLangDirSync";
import arDictionary from "@/lib/i18n/dictionaries/ar.json";
import { defaultLocale, localeToDirection } from "@/lib/i18n/config";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
});

const notoNaskhArabic = Noto_Naskh_Arabic({
  subsets: ["arabic"],
  variable: "--font-arabic",
});

export const metadata: Metadata = {
  title: arDictionary["meta.title"],
  description: arDictionary["meta.description"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang={defaultLocale} dir={localeToDirection(defaultLocale)} suppressHydrationWarning>
      <body className={`${manrope.variable} ${notoNaskhArabic.variable}`}>
        <AuthProvider>
          <I18nProvider>
            <HtmlLangDirSync />
            <div className="flex flex-col h-screen">
              <Navigation />
              <div className="flex-1 min-h-0 overflow-y-auto">
                {children}
              </div>
            </div>
          </I18nProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
