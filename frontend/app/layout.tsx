import type { Metadata } from "next";
import { headers } from "next/headers";
import {
  Amiri,
  Aref_Ruqaa,
  Fraunces,
  IBM_Plex_Sans_Arabic,
  Inter,
  Manrope,
  Noto_Kufi_Arabic,
  Readex_Pro,
  Reem_Kufi,
  Source_Serif_4,
} from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/AuthContext";
import QueryProvider from "@/lib/queryClient";
import { I18nProvider } from "@/components/i18n/I18nProvider";
import HtmlLangDirSync from "@/components/i18n/HtmlLangDirSync";
import Navbar from "@/components/Navbar";
import { getDictionary } from "@/lib/i18n/getDictionary";
import { defaultLocale, isLocale, localeToDirection, type Locale } from "@/lib/i18n/config";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
});

const notoKufiArabic = Noto_Kufi_Arabic({
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

// Real Amiri (Naskh serif) — used for the scholarly answer body in the Catalog.
const amiri = Amiri({
  subsets: ["arabic", "latin"],
  weight: ["400", "700"],
  variable: "--font-amiri",
});

// Readex Pro — primary UI font for the Atlas screen.
const readexPro = Readex_Pro({
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-readex",
  display: "swap",
});

// Hero/landing typography pairing — Aref Ruqaa for the display headline,
// IBM Plex Sans Arabic for Arabic body & UI, Inter for Latin UI chrome.
const arefRuqaa = Aref_Ruqaa({
  subsets: ["arabic"],
  weight: ["700"],
  variable: "--font-display-ar",
});

const ibmPlexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600"],
  variable: "--font-body-ar",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-inter",
});

const reemKufi = Reem_Kufi({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-reem-kufi",
  display: "swap",
});

async function resolveLocale(): Promise<Locale> {
  const headerStore = await headers();
  const headerLocale = headerStore.get("x-ilm-locale");
  return isLocale(headerLocale) ? headerLocale : defaultLocale;
}

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await resolveLocale());
  return {
    title: dict["meta.title"],
    description: dict["meta.description"],
    icons: {
      icon: "/logo.svg",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await resolveLocale();
  return (
    <html lang={locale} dir={localeToDirection(locale)} suppressHydrationWarning>
      <body className={`${manrope.variable} ${notoKufiArabic.variable} ${sourceSerif.variable} ${fraunces.variable} ${amiri.variable} ${readexPro.variable} ${arefRuqaa.variable} ${ibmPlexArabic.variable} ${inter.variable} ${reemKufi.variable}`}>
        <AuthProvider>
          <QueryProvider>
            <I18nProvider>
              <HtmlLangDirSync />
              <div className="flex flex-col h-screen">
                <div className="flex-1 min-h-0 overflow-y-auto">
                  <Navbar />
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
