"use client";

import Link from "next/link";
import { useMemo, useRef } from "react";
import { motion } from "framer-motion";

import { useAuth } from "@/lib/AuthContext";
import { useLocalizedPath } from "@/lib/i18n/navigation";
import { useI18n } from "@/components/i18n/I18nProvider";
import HeroSection from "@/components/landing/HeroSection";
import WhyIlmSection from "@/components/landing/WhyIlmSection";
import HowItWorksSection from "@/components/landing/HowItWorksSection";
import FinalCTASection from "@/components/landing/FinalCTASection";

const FadeIn = ({
  children,
  delay = 0,
  className = "",
  dir,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  dir?: "ltr" | "rtl";
}) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: "-10%" }}
    transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1], delay }}
    className={className}
    dir={dir}
  >
    {children}
  </motion.div>
);

const SHELF_BOOK_VISUALS = [
  { bg: "from-[#2a1a10] to-[#4a2818]", color: "text-[#e8d4b4]" },
  { bg: "from-[#1a2a2e] to-[#2c4145]", color: "text-[#d4e0e2]" },
  { bg: "from-[#2e1a26] to-[#4a2c3e]", color: "text-[#e6d2dc]" },
  { bg: "from-[#1a2818] to-[#2a4424]", color: "text-[#d4e2cc]" },
  { bg: "from-[#2e2418] to-[#4a3a24]", color: "text-[#ecdcb8]" },
  { bg: "from-[#1f1a2c] to-[#2e2848]", color: "text-[#d8d4e6]" },
];

export default function Home() {
  const localizedPath = useLocalizedPath();
  const { t } = useI18n();
  const { isAuthenticated, user } = useAuth();
  const canUpload = Boolean(user?.is_staff || user?.is_superuser);
  const shelfRef = useRef<HTMLDivElement>(null);

  const shelfBooks = useMemo(
    () =>
      SHELF_BOOK_VISUALS.map((visual, i) => ({
        ...visual,
        meta: t(`home.shelf.book.${i + 1}.meta`, ''),
        title: t(`home.shelf.book.${i + 1}.title`, ''),
      })),
    [t]
  );

  const categories = useMemo(
    () => [
      { cat: t('home.shelf.category.tafsir', 'Tafsīr'), count: 412 },
      { cat: t('home.shelf.category.hadith', 'Hadīth'), count: 638 },
      { cat: t('home.shelf.category.fiqh', 'Fiqh'), count: 521 },
      { cat: t('home.shelf.category.tarikh', 'Tārīkh'), count: 287 },
      { cat: t('home.shelf.category.adab', 'Adab'), count: 196 },
      { cat: t('home.shelf.category.falsafa', 'Falsafa'), count: 134 },
    ],
    [t]
  );

  const documentsHref = localizedPath("/documents");
  const registerHref = localizedPath("/auth/register");
  const startReadingHref = isAuthenticated ? documentsHref : registerHref;

  const scrollShelf = (direction: "left" | "right") => {
    if (shelfRef.current) {
      shelfRef.current.scrollBy({ left: direction === "left" ? -400 : 400, behavior: "smooth" });
    }
  };

  return (
    <main className="landing-shell min-h-screen">
      <HeroSection />

      {/* Trust Bar */}
      <section className="pb-20 px-6">
        <div className="max-w-6xl mx-auto pt-10 border-t border-border">
          <p className="text-center text-[11.5px] tracking-[0.18em] uppercase mb-6 text-text-3">{t('home.trust.label', 'Trusted by scholars at')}</p>
          <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-4 opacity-60 text-text-2">
            <span className="font-fraunces text-lg italic">{t('home.trust.alAzhar', 'Al-Azhar')}</span>
            <span className="font-fraunces text-lg">{t('home.trust.hartford', 'Hartford Seminary')}</span>
            <span className="font-fraunces text-lg italic">{t('home.trust.zaytuna', 'Zaytuna')}</span>
            <span className="font-fraunces text-lg">{t('home.trust.soas', 'SOAS · London')}</span>
            <span className="font-fraunces text-lg italic">{t('home.trust.qarawiyyin', 'Qarawiyyin')}</span>
            <span className="font-fraunces text-lg">{t('home.trust.oxfordCis', 'Oxford CIS')}</span>
          </div>
        </div>
      </section>

      <WhyIlmSection />

      {/* BOOKSHELF */}
      <section id="shelf" className="py-32 px-6 overflow-hidden">
        <div className="max-w-6xl mx-auto">
            <FadeIn className="flex flex-wrap items-end justify-between gap-8 mb-14">
            <div className="max-w-2xl">
              <span className="section-eyebrow">{t('home.shelf.eyebrow', 'The Shelf')}</span>
              <h2 className="font-display-ar font-light text-[clamp(32px,4.5vw,56px)] leading-[1.05] tracking-tight mt-5">
                {t('home.shelf.titleLead', 'Walk the ')}
                <span dangerouslySetInnerHTML={{ __html: t('home.shelf.titleEm', '<em class="italic text-accent-2">shelves</em>, drift through eras.') }} />
              </h2>
              <p className="mt-5 text-[16px] leading-relaxed text-text-2">
                {t('home.shelf.body', 'From the formative period to the present, organized the way a librarian would. Click any spine to peer inside.')}
              </p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => scrollShelf("left")} className="btn-ghost !p-3" aria-label={t('home.shelf.scrollLeft', 'Scroll shelf left')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
              </button>
              <button type="button" onClick={() => scrollShelf("right")} className="btn-ghost !p-3" aria-label={t('home.shelf.scrollRight', 'Scroll shelf right')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>
              </button>
            </div>
          </FadeIn>

          <FadeIn delay={0.1}>
            <div ref={shelfRef} className="flex gap-4 pb-2 overflow-x-auto hide-scrollbar">
              {shelfBooks.map((book, i) => (
                <Link
                  key={`shelf-book-${i}`}
                  href={documentsHref}
                  className={`flex-shrink-0 w-[175px] h-[260px] rounded-l-md rounded-r-xl p-5 flex flex-col justify-between border border-black/40 shadow-[inset_8px_0_0_rgba(0,0,0,0.25),inset_11px_0_0_rgba(255,255,255,0.04),0_12px_30px_-8px_rgba(0,0,0,0.5)] cursor-pointer transition-transform duration-500 ease-out hover:-translate-y-2 hover:-rotate-3 bg-gradient-to-br ${book.bg} ${book.color}`}
                >
                  <div className="text-[10.5px] tracking-widest uppercase opacity-70">{book.meta}</div>
                  <div
                    className="font-amiri text-[26px] leading-tight font-bold text-right"
                    dangerouslySetInnerHTML={{ __html: book.title }}
                  />
                </Link>
              ))}
            </div>

            {/* Categories */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-12">
              {categories.map(({ cat, count }) => (
                <Link
                  key={cat}
                  href={documentsHref}
                  className="bg-gradient-to-b from-card-2 to-card border border-border rounded-xl p-4 text-center hover:border-accent transition-colors"
                >
                  <div className="font-fraunces text-[17px]">{cat}</div>
                  <div className="text-[12px] text-text-3 mt-1 tracking-wide">
                    {t('home.shelf.worksCount', '{count} works', { count })}
                  </div>
                </Link>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      <HowItWorksSection />

      <FinalCTASection
        startReadingHref={startReadingHref}
        documentsHref={documentsHref}
      />

      {/* FOOTER */}
      <footer className="pt-24 pb-12 px-6 border-t border-border">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-12 gap-10 mb-16">
            <div className="md:col-span-5">
              <div className="flex items-center gap-2 mb-5">
                <span className="font-fraunces text-[28px] text-accent-2">ع</span>
                <span className="font-fraunces text-[22px]">ILM <em className="italic text-text-2">Shamela</em></span>
              </div>
              <p className="text-[14.5px] leading-relaxed max-w-sm mb-6 text-text-2">
                {t('home.footer.tagline', "A private digital library and document search engine for the world's classical scholarship — built with care, run with respect.")}
              </p>
            </div>
            <div className="md:col-span-2">
              <p className="text-[11px] tracking-[0.18em] uppercase text-text-3 mb-4">{t('home.footer.browse', 'Browse')}</p>
              <ul className="space-y-2 text-[14px]">
                <li><Link href={documentsHref} className="text-text-2 hover:text-accent-2 transition-colors">{t('nav.documents', 'Library')}</Link></li>
                {canUpload && (
                  <li><Link href={localizedPath("/upload")} className="text-text-2 hover:text-accent-2 transition-colors">{t('nav.upload', 'Upload')}</Link></li>
                )}
              </ul>
            </div>
            <div className="md:col-span-2">
              <p className="text-[11px] tracking-[0.18em] uppercase text-text-3 mb-4">{t('home.footer.account', 'Account')}</p>
              <ul className="space-y-2 text-[14px]">
                {isAuthenticated ? (
                  <li><Link href={localizedPath("/profile")} className="text-text-2 hover:text-accent-2 transition-colors">{t('nav.profile', 'Profile')}</Link></li>
                ) : (
                  <>
                    <li><Link href={localizedPath("/auth/login")} className="text-text-2 hover:text-accent-2 transition-colors">{t('nav.signIn', 'Sign in')}</Link></li>
                    <li><Link href={registerHref} className="text-text-2 hover:text-accent-2 transition-colors">{t('nav.getStarted', 'Get started')}</Link></li>
                  </>
                )}
              </ul>
            </div>
            <div className="md:col-span-3">
              <p className="text-[11px] tracking-[0.18em] uppercase text-text-3 mb-4">{t('home.footer.explore', 'Explore')}</p>
              <ul className="space-y-2 text-[14px]">
                <li><Link href="#why" className="text-text-2 hover:text-accent-2 transition-colors">{t('home.nav.why', 'Why ILM')}</Link></li>
                <li><Link href="#how" className="text-text-2 hover:text-accent-2 transition-colors">{t('home.nav.how', 'How it works')}</Link></li>
                <li><Link href="#cta" className="text-text-2 hover:text-accent-2 transition-colors">{t('nav.getStarted', 'Get started')}</Link></li>
              </ul>
            </div>
          </div>
          <div className="pt-8 border-t border-border flex flex-wrap justify-between items-center gap-4">
            <p className="text-[12.5px] text-text-3">{t('home.footer.copyright', '© 2026 ILM Shamela · Made with patience for serious readers everywhere.')}</p>
            <p className="font-amiri text-[15px] text-text-3">{t('home.footer.verse', '﴿ وَفَوْقَ كُلِّ ذِي عِلْمٍ عَلِيمٌ ﴾')}</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
