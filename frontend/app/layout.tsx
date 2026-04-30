import type { Metadata } from "next";
import { headers } from "next/headers";
import { Amiri, Fraunces, Manrope, Noto_Naskh_Arabic, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/AuthContext";
import QueryProvider from "@/lib/queryClient";
import { I18nProvider } from "@/components/i18n/I18nProvider";
import HtmlLangDirSync from "@/components/i18n/HtmlLangDirSync";
import { getDictionary } from "@/lib/i18n/getDictionary";
import { defaultLocale, isLocale, localeToDirection, type Locale } from "@/lib/i18n/config";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
});

const notoNaskhArabic = Noto_Naskh_Arabic({
  subsets: ["arabic"],
  variable: "--font-arabic",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-serif",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
});

const amiri = Amiri({
  subsets: ["arabic"],
  weight: ["400", "700"],
  variable: "--font-amiri",
});

function resolveLocale(): Locale {
  const headerLocale = headers().get("x-ilm-locale");
  return isLocale(headerLocale) ? headerLocale : defaultLocale;
}

export function generateMetadata(): Metadata {
  const dict = getDictionary(resolveLocale());
  return {
    title: dict["meta.title"],
    description: dict["meta.description"],
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = resolveLocale();
  return (
    <html lang={locale} dir={localeToDirection(locale)} suppressHydrationWarning>
      <body className={`${manrope.variable} ${notoNaskhArabic.variable} ${sourceSerif.variable} ${fraunces.variable} ${amiri.variable}`}>
        <AuthProvider>
          <QueryProvider>
            <I18nProvider>
              <HtmlLangDirSync />
              <div className="flex flex-col h-screen">
                <div className="flex-1 min-h-0 overflow-y-auto">
                  {children}
                </div>
              </div>
            </I18nProvider>
          </QueryProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
