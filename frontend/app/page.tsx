"use client";

import Link from "next/link";
import { useMemo, useRef } from "react";
import { motion } from "framer-motion";

import { useAuth } from "@/lib/AuthContext";
import { useLocalizedPath } from "@/lib/i18n/navigation";
import { useI18n } from "@/components/i18n/I18nProvider";
import LandingHeader from "@/components/landing/LandingHeader";
import HeroSection from "@/components/landing/HeroSection";
import WhyIlmSection from "@/components/landing/WhyIlmSection";
import HowItWorksSection from "@/components/landing/HowItWorksSection";
import FinalCTASection from "@/components/landing/FinalCTASection";
import Logo from "@/components/brand/Logo";

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

// Jewel-tone spine gradients in the mock's visual (RTL, right→left) order:
// Lisān al-ʿArab, al-Mathnawī, al-Mughnī, al-Muqaddima, Ṣaḥīḥ al-Bukhārī, Tafsīr.
const SHELF_BOOK_VISUALS = [
  { bg: "from-[#41295E] to-[#2c1a42]", color: "text-[#f4ecd8]" },
  { bg: "from-[#5A3E1E] to-[#3f2b14]", color: "text-[#f4ecd8]" },
  { bg: "from-[#1E5236] to-[#143a26]", color: "text-[#f4ecd8]" },
  { bg: "from-[#5C2150] to-[#41163a]", color: "text-[#f4ecd8]" },
  { bg: "from-[#13443D] to-[#0c302b]", color: "text-[#f4ecd8]" },
  { bg: "from-[#5A2A1E] to-[#3f1d14]", color: "text-[#f4ecd8]" },
];

export default function Home() {
  const localizedPath = useLocalizedPath();
  const { t } = useI18n();
  const { isAuthenticated, user } = useAuth();
  // Mirrors the backend upload permission (staff/superuser or editor/admin group).
  const canUpload = Boolean(user?.can_upload);
  const shelfRef = useRef<HTMLDivElement>(null);

  const shelfBooks = useMemo(
    () =>
      SHELF_BOOK_VISUALS.map((visual, i) => {
        // i18n keys run tafsīr(1)…lisān(6); the mock renders lisān first (RTL rightmost).
        const n = 6 - i;
        const meta = t(`home.shelf.book.${n}.meta`, "");
        const [category, year] = meta.split("·").map((part) => part.trim());
        return {
          ...visual,
          category: category || meta,
          year: year || "",
          title: t(`home.shelf.book.${n}.title`, ""),
        };
      }),
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
      <LandingHeader />
      <HeroSection />

      {/* Centres of learning — the mock's "حواضر العِلم" row */}
      <section className="pb-20 px-6">
        <div className="max-w-6xl mx-auto pt-10 border-t border-paper-line flex flex-col items-center gap-4">
          <p className="text-center text-[11.5px] tracking-[0.18em] font-semibold text-ink-mute">{t('home.trust.label', 'Centres of learning')}</p>
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3 opacity-70">
            <span className="font-reem-kufi text-[20px] text-[#7a6f59]">{t('home.trust.alAzhar', 'Al-Azhar')}</span>
            <span className="font-reem-kufi text-[20px] text-[#7a6f59]">{t('home.trust.qarawiyyin', 'Al-Qarawiyyin')}</span>
            <span className="font-reem-kufi text-[20px] text-[#7a6f59]">{t('home.trust.zaytuna', 'Al-Zaytuna')}</span>
            <span className="font-reem-kufi text-[20px] text-[#7a6f59]">{t('home.trust.hartford', 'Al-Nizamiyya')}</span>
            <span className="font-reem-kufi text-[20px] text-[#7a6f59]">{t('home.trust.soas', 'Dar al-Hikma')}</span>
            <span className="font-reem-kufi text-[20px] text-[#7a6f59]">{t('home.trust.oxfordCis', 'Al-Qayrawan')}</span>
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
              <h2 className="font-reem-kufi font-semibold text-[clamp(30px,4.2vw,46px)] leading-[1.22] tracking-tight mt-5 text-ink-deep">
                {t('home.shelf.titleLead', 'Walk the ')}
                <span dangerouslySetInnerHTML={{ __html: t('home.shelf.titleEm', '<em class="text-[var(--gold)] not-italic">shelves</em>, drift through eras.') }} />
              </h2>
              <p className="mt-5 text-[16px] leading-relaxed text-ink-warm">
                {t('home.shelf.body', 'From the formative period to the present, organized the way a librarian would. Click any spine to peer inside.')}
              </p>
            </div>
            <div className="flex gap-2.5">
              <button type="button" onClick={() => scrollShelf("left")} className="w-11 h-11 rounded-full flex items-center justify-center bg-paper-card border border-paper-line text-ink-warm hover:border-gold transition-colors" aria-label={t('home.shelf.scrollLeft', 'Scroll shelf left')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m15 18-6-6 6-6" /></svg>
              </button>
              <button type="button" onClick={() => scrollShelf("right")} className="w-11 h-11 rounded-full flex items-center justify-center bg-ink-deep text-[#f1e7d3] hover:opacity-90 transition-opacity" aria-label={t('home.shelf.scrollRight', 'Scroll shelf right')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m9 18 6-6-6-6" /></svg>
              </button>
            </div>
          </FadeIn>

          <FadeIn delay={0.1}>
            <div ref={shelfRef} className="flex gap-5 pb-2 overflow-x-auto hide-scrollbar">
              {shelfBooks.map((book, i) => (
                <Link
                  key={`shelf-book-${i}`}
                  href={documentsHref}
                  className={`group relative flex-shrink-0 w-[172px] aspect-[5/7] rounded-[9px] p-4 flex flex-col justify-between overflow-hidden shadow-[0_14px_30px_-8px_rgba(44,38,32,0.42)] cursor-pointer transition-transform duration-500 ease-out hover:-translate-y-2 bg-gradient-to-b ${book.bg} ${book.color}`}
                >
                  <span className="pointer-events-none absolute inset-[7px] rounded-[5px] border border-white/20" aria-hidden />
                  <div className="relative flex items-center justify-between text-[10.5px] tracking-wide opacity-70">
                    <span>{book.category}</span>
                    <span>{book.year}</span>
                  </div>
                  <div
                    className="relative text-center font-reem-kufi font-semibold text-[21px] leading-[1.3]"
                    dangerouslySetInnerHTML={{ __html: book.title }}
                  />
                  <span aria-hidden />
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
      <footer className="bg-[#e7dbc1] border-t border-[#dbcdaf] pt-16 pb-8 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-12 gap-10 mb-12">
            <div className="md:col-span-5">
              <Logo className="h-16 w-auto mb-4" />
              <p className="text-[14px] leading-[1.95] max-w-[330px] text-ink-warm">
                {t('home.footer.tagline', "A private digital library and document search engine for the world's classical scholarship — built with care, run with respect.")}
              </p>
            </div>
            <div className="md:col-span-2">
              <p className="text-[12px] tracking-[0.12em] font-semibold text-[#a2926f] mb-4">{t('home.footer.browse', 'Browse')}</p>
              <ul className="space-y-2.5 text-[14px] text-[#5a5240]">
                <li><Link href={documentsHref} className="hover:text-gold transition-colors">{t('nav.documents', 'Library')}</Link></li>
                {canUpload && (
                  <li><Link href={localizedPath("/upload")} className="hover:text-gold transition-colors">{t('nav.upload', 'Upload')}</Link></li>
                )}
              </ul>
            </div>
            <div className="md:col-span-2">
              <p className="text-[12px] tracking-[0.12em] font-semibold text-[#a2926f] mb-4">{t('home.footer.account', 'Account')}</p>
              <ul className="space-y-2.5 text-[14px] text-[#5a5240]">
                {isAuthenticated ? (
                  <li><Link href={localizedPath("/profile")} className="hover:text-gold transition-colors">{t('nav.profile', 'Profile')}</Link></li>
                ) : (
                  <>
                    <li><Link href={localizedPath("/auth/login")} className="hover:text-gold transition-colors">{t('nav.signIn', 'Sign in')}</Link></li>
                    <li><Link href={registerHref} className="hover:text-gold transition-colors">{t('nav.getStarted', 'Get started')}</Link></li>
                  </>
                )}
              </ul>
            </div>
            <div className="md:col-span-3">
              <p className="text-[12px] tracking-[0.12em] font-semibold text-[#a2926f] mb-4">{t('home.footer.explore', 'Explore')}</p>
              <ul className="space-y-2.5 text-[14px] text-[#5a5240]">
                <li><Link href="#why" className="hover:text-gold transition-colors">{t('home.nav.why', 'Why ILM')}</Link></li>
                <li><Link href="#how" className="hover:text-gold transition-colors">{t('home.nav.how', 'How it works')}</Link></li>
                <li><Link href="#cta" className="hover:text-gold transition-colors">{t('nav.getStarted', 'Get started')}</Link></li>
              </ul>
            </div>
          </div>
          <div className="pt-6 border-t border-[#d2c3a4] flex flex-wrap justify-between items-center gap-4">
            <p className="font-amiri text-[17px] text-[#8a7d68]">{t('home.footer.verse', '﴿ وَفَوْقَ كُلِّ ذِي عِلْمٍ عَلِيمٌ ﴾')}</p>
            <p className="text-[13px] text-ink-mute">{t('home.footer.copyright', '© 2026 ILM Shamela · Made with patience for serious readers everywhere.')}</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
