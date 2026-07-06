"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, BadgeCheck, Clock, Globe, Sparkles } from "lucide-react";

import { useI18n } from "@/components/i18n/I18nProvider";
import { useLocalizedPath } from "@/lib/i18n/navigation";

function useTypingText(phrases: string[], paused: boolean) {
  const [text, setText] = useState("");
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (paused) return;
    const current = phrases[phraseIndex] ?? "";
    const fullyTyped = text === current;
    const fullyErased = text.length === 0;

    let delay: number;
    if (!isDeleting && fullyTyped) {
      delay = 1800;
    } else if (isDeleting && fullyErased) {
      delay = 350;
    } else {
      delay = isDeleting ? 25 : 55;
    }

    const timer = setTimeout(() => {
      if (!isDeleting && !fullyTyped) {
        setText(current.slice(0, text.length + 1));
      } else if (!isDeleting && fullyTyped) {
        setIsDeleting(true);
      } else if (isDeleting && !fullyErased) {
        setText(current.slice(0, text.length - 1));
      } else {
        setIsDeleting(false);
        setPhraseIndex((i) => (i + 1) % phrases.length);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [text, phraseIndex, isDeleting, paused, phrases]);

  return text;
}

export default function HeroSection() {
  const router = useRouter();
  const localizedPath = useLocalizedPath();
  const { t, direction } = useI18n();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const isRtl = direction === "rtl";

  const typingPhrases = useMemo(
    () => [
      t("home.typing.1", "What does Ibn Khaldun say about ʿumrān?"),
      t("home.typing.2", "Compare hadith chains in al-Bukhari"),
      t("home.typing.3", "Tafsir of Surah al-Kahf"),
      t("home.typing.4", "ما رأي ابن خلدون في العمران؟"),
      t("home.typing.5", "Books like al-Ṭabaqāt al-Kubrā, but shorter"),
    ],
    [t],
  );
  const typingText = useTypingText(typingPhrases, query.length > 0);

  const trySuggestions = useMemo(
    () => [
      {
        label: t("home.try.1.label", "Compare hadith chains in al-Bukhari"),
        query: t("home.try.1.query", "Compare hadith chains in al-Bukhari"),
      },
      {
        label: t("home.try.2.label", "Tafsir of Surah al-Kahf"),
        query: t("home.try.2.query", "Tafsir of Surah al-Kahf"),
      },
      {
        label: t("home.try.3.label", "ما رأي ابن خلدون في العمران؟"),
        query: t("home.try.3.query", "ما رأي ابن خلدون في العمران؟"),
      },
    ],
    [t],
  );

  const documentsHref = localizedPath("/documents");
  const ChipArrow = isRtl ? ArrowLeft : ArrowRight;

  const goToLibrary = (q?: string) => {
    const trimmed = (q ?? "").trim();
    router.push(
      trimmed ? `${documentsHref}?q=${encodeURIComponent(trimmed)}` : documentsHref,
    );
  };

  const onSubmitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    goToLibrary(query);
  };

  const onChipClick = (chipQuery: string) => {
    setQuery(chipQuery);
    inputRef.current?.focus();
  };

  return (
    <section className="relative flex flex-col items-center justify-center min-h-[calc(100vh-68px)] px-6 py-8 overflow-hidden">
      <div className="relative w-full max-w-6xl mx-auto text-center flex flex-col items-center">
        {/* Badge with live-indexing dot */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <span className="inline-flex items-center gap-2.5 text-[13px] font-semibold tracking-[0.01em] text-[#9a6b12] bg-gold-soft border border-gold-line px-4 py-2 rounded-full font-body-ar">
            <span className="live-dot" aria-hidden />
            {t("home.hero.badge", "Now indexing classical & modern works")}
          </span>
        </motion.div>

        {/* Headline — two lines, cleanly stacked, accent word feels like emphasis */}
        <div className="relative mt-8">
          <div className="hero-headline-glow" aria-hidden />
          <motion.h1
            initial={{ opacity: 0, y: 16, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.55, ease: [0.2, 0.8, 0.2, 1] }}
            className="relative z-[1] font-reem-kufi font-bold text-ink-deep tracking-tight text-center"
            style={{ fontSize: "clamp(52px, 6.6vw, 92px)", lineHeight: 1.08 }}
          >
            <span className="block">
              {t("home.hero.titleLine1", "A library")}
            </span>
            <span className="block text-gold">
              <span>{t("home.hero.titleAccent", "that reads")}</span>
              <span> </span>
              <span>{t("home.hero.titleTrailing", "with you.")}</span>
            </span>
          </motion.h1>
        </div>

        {/* Subhead */}
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.1, ease: [0.2, 0.8, 0.2, 1] }}
          className="mt-7 max-w-[58ch] mx-auto text-[19px] leading-[1.85] text-ink-warm font-body-ar text-center"
        >
          {t(
            "home.hero.subtitle",
            "ILM Shamela indexes 1,400 years of scholarship across four languages — then answers your questions with a citation, never a guess.",
          )}
        </motion.p>

        {/* Stat strip */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-body-ar text-[14px] text-[#8a7d68]"
        >
          <span className="inline-flex items-center gap-2">
            <Clock className="w-[15px] h-[15px] text-gold" aria-hidden />
            {t("home.hero.stats.heritage", "1,400 years of heritage")}
          </span>
          <span className="hero-stat-divider" aria-hidden />
          <span className="inline-flex items-center gap-2">
            <Globe className="w-[15px] h-[15px] text-gold" aria-hidden />
            {t("home.hero.stats.languages", "4 languages")}
          </span>
          <span className="hero-stat-divider" aria-hidden />
          <span className="inline-flex items-center gap-2">
            <BadgeCheck className="w-[15px] h-[15px] text-gold" aria-hidden />
            {t("home.hero.stats.citation", "Sourced, verifiable citations")}
          </span>
        </motion.div>

        {/* Search bar */}
        <motion.form
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.45, delay: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
          onSubmit={onSubmitSearch}
          className="hero-search-shell relative w-full mx-auto mt-10 max-w-3xl"
        >
          <div className="flex items-center gap-3 px-3 sm:px-4 min-h-[72px]">
            <Sparkles className="w-[22px] h-[22px] text-gold shrink-0 ms-1.5" aria-hidden />
            <div className="relative flex-1 min-w-0">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full bg-transparent border-none outline-none text-[18px] text-ink-deep font-body-ar py-3.5 px-1"
                aria-label={t("home.hero.searchAria", "Search the library")}
              />
              {query.length === 0 && (
                <div
                  aria-hidden
                  className="absolute inset-0 flex items-center px-1 pointer-events-none text-[18px] text-ink-mute font-body-ar"
                >
                  <span className="truncate">{typingText}</span>
                  <span className="ms-0.5 inline-block text-gold animate-cursor-blink">▍</span>
                </div>
              )}
            </div>
            <motion.button
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.96 }}
              type="submit"
              className="shrink-0 inline-flex items-center gap-2 rounded-[14px] bg-gold text-[#fbf6ea] font-semibold px-6 sm:px-7 h-[54px] text-[16px] shadow-[0_8px_20px_-8px_rgba(176,125,43,0.55),inset_0_1px_0_rgba(255,255,255,0.18)] hover:bg-[#9c6c24] transition-colors font-body-ar"
            >
              {t("home.hero.askButton", "Ask")}
              <ChipArrow className="w-4 h-4" aria-hidden />
            </motion.button>
          </div>
        </motion.form>

        {/* Prompt chips */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
          className="mt-5 flex flex-wrap items-center justify-center gap-2"
        >
          <span className="text-[13px] text-ink-mute me-1 font-body-ar">
            {t("home.hero.tryLabel", "Try:")}
          </span>
          {trySuggestions.map((chip, idx) => (
            <motion.button
              key={chip.query}
              type="button"
              onClick={() => onChipClick(chip.query)}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.45 + idx * 0.06, ease: [0.2, 0.8, 0.2, 1] }}
              className="hero-chip font-body-ar"
            >
              <span className="line-clamp-1">{chip.label}</span>
              <ChipArrow className="w-3.5 h-3.5 text-gold shrink-0" aria-hidden />
            </motion.button>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
