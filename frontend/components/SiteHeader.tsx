"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/AuthContext";
import { useLocalizedPath } from "@/lib/i18n/navigation";
import { stripLocalePrefix } from "@/lib/i18n/config";
import { useI18n } from "@/components/i18n/I18nProvider";
import LanguageSwitcher from "@/components/i18n/LanguageSwitcher";

export default function SiteHeader() {
  const localizedPath = useLocalizedPath();
  const pathname = usePathname();
  const { t } = useI18n();
  const { isAuthenticated, user } = useAuth();
  const [elevated, setElevated] = useState(false);

  // The reader workspace ships its own purpose-built header — skip the global navbar there.
  const barePath = stripLocalePrefix(pathname ?? "/");
  const isReaderRoute = /^\/documents\/[^/]+/.test(barePath);

  useEffect(() => {
    const onScroll = () => setElevated(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const homeHref = localizedPath("/");
  const documentsHref = localizedPath("/documents");
  const profileHref = localizedPath("/profile");
  const whyHref = `${homeHref}#why`;
  const howHref = `${homeHref}#how`;

  const displayName =
    (user?.first_name && user.first_name.trim()) ||
    user?.username ||
    user?.email?.split("@")[0] ||
    "";
  const avatarInitial = (displayName[0] || user?.email?.[0] || "U").toUpperCase();

  if (isReaderRoute) return null;

  return (
    <header
      className={`sticky top-0 z-50 w-full backdrop-blur-xl transition-shadow duration-300 ${
        elevated
          ? "bg-bg/75 shadow-[0_1px_0_rgba(0,0,0,0.04),0_10px_30px_-20px_rgba(120,80,40,0.18)]"
          : "bg-bg/55"
      }`}
    >
      <div className="mx-auto flex h-[68px] max-w-6xl items-center gap-6 px-6">
        {/* Brand (RTL start = far right) */}
        <Link href={homeHref} className="flex items-center shrink-0" aria-label="ILM Shamela">
          <Image
            src="/logo.svg"
            alt="ILM Shamela"
            width={44}
            height={44}
            priority
            className="h-11 w-11 object-contain"
          />
        </Link>

        {/* Centered nav links */}
        <nav className="hidden md:flex flex-1 justify-center items-center gap-8 font-arabic" dir="rtl">
          <Link href={whyHref} className="nav-link">{t("home.nav.why", "لماذا علم")}</Link>
          <Link href={howHref} className="nav-link">{t("home.nav.how", "كيف تعمل")}</Link>
          <Link href={documentsHref} className="nav-link">{t("home.nav.library", "المكتبة")}</Link>
        </nav>

        {/* RTL end (far left) — language + CTA, plus avatar if signed in. */}
        <div
          className="ml-auto flex items-center gap-2 font-arabic"
          title={t("home.hero.tooltip.language", "Language")}
        >
          <LanguageSwitcher variant="compact" />

          {isAuthenticated && (
            <Link
              href={profileHref}
              className="flex items-center gap-1.5 rounded-full p-1 transition-colors hover:bg-black/[0.04]"
              aria-label={displayName ? `${t("nav.profile", "Profile")} — ${displayName}` : t("nav.profile", "Profile")}
            >
              {user?.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.avatar}
                  alt=""
                  className="w-7 h-7 rounded-full object-cover border border-border-strong"
                />
              ) : (
                <span className="w-7 h-7 rounded-full bg-gradient-to-br from-accent-2 to-accent flex items-center justify-center text-white font-arabic text-[12px] font-semibold leading-none shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]">
                  {avatarInitial}
                </span>
              )}
            </Link>
          )}

          <Link href={documentsHref} className="btn-primary font-arabic">
            {t("home.nav.openLibrary", "افتح المكتبة")}
          </Link>
        </div>
      </div>
    </header>
  );
}
