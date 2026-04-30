"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

import { useAuth } from "@/lib/AuthContext";
import { useLocalizedPath } from "@/lib/i18n/navigation";

const TYPING_PHRASES = [
  'What does Ibn Khaldun say about ʿumrān?',
  'Compare hadith chains in al-Bukhari',
  'Tafsir of Surah al-Kahf',
  'ما رأي ابن خلدون في العمران؟',
  'Books like al-Ṭabaqāt al-Kubrā, but shorter',
];

function useTypingText(phrases: string[], paused: boolean) {
  const [text, setText] = useState('');
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (paused) return;
    const current = phrases[phraseIndex] ?? '';
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

const trySuggestions = [
  {
    label: "↗ Compare hadith chains in al-Bukhari",
    query: "Compare hadith chains in al-Bukhari",
    fontClass: "font-fraunces",
  },
  {
    label: "↗ Tafsir of Surah al-Kahf",
    query: "Tafsir of Surah al-Kahf",
    fontClass: "font-fraunces",
  },
  {
    label: "↗ ما رأي ابن خلدون في العمران؟",
    query: "ما رأي ابن خلدون في العمران؟",
    fontClass: "font-amiri",
  },
];

const shelfBooks = [
  { bg: "from-[#2a1a10] to-[#4a2818]", color: "text-[#e8d4b4]", meta: "Tafsīr · 1373", title: "تفسير<br/>ابن كثير" },
  { bg: "from-[#1a2a2e] to-[#2c4145]", color: "text-[#d4e0e2]", meta: "Hadīth · 870", title: "صحيح<br/>البخاري" },
  { bg: "from-[#2e1a26] to-[#4a2c3e]", color: "text-[#e6d2dc]", meta: "Tārīkh · 1377", title: "المقدّمة<br/>ابن خلدون" },
  { bg: "from-[#1a2818] to-[#2a4424]", color: "text-[#d4e2cc]", meta: "Fiqh · 1014", title: "المغني<br/>ابن قدامة" },
  { bg: "from-[#2e2418] to-[#4a3a24]", color: "text-[#ecdcb8]", meta: "Adab · 1273", title: "المثنوي<br/>الرومي" },
  { bg: "from-[#1f1a2c] to-[#2e2848]", color: "text-[#d8d4e6]", meta: "Lugha · 1311", title: "لسان<br/>العرب" },
];

const featureCards = [
  {
    title: "Multilingual mastery",
    desc: "Native handling of Arabic, English, Urdu, and Turkish — including diacritics, ligatures, and right-to-left context.",
    icon: <path d="m5 8 6 6 6-6M19 12h2M3 12h2M12 3v2M12 19v2" />,
  },
  {
    title: "Privacy by design",
    desc: "Your queries, notes, and uploads stay encrypted. No training on your reading, ever. You own the corpus you build.",
    icon: (
      <>
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </>
    ),
  },
  {
    title: "Citation-first answers",
    desc: "Every reply links to the exact line in the exact edition. If a claim isn't in the corpus, ILM tells you so.",
    icon: (
      <>
        <path d="M16 4h4v4" />
        <path d="m20 4-7 7" />
        <path d="M8 20H4v-4" />
        <path d="m4 20 7-7" />
      </>
    ),
  },
  {
    title: "Manuscript-grade rendering",
    desc: "Beautiful typography with proper kashida justification, marginalia support, and footnote linking.",
    icon: (
      <>
        <path d="M2 3h20v14H2z" />
        <path d="M2 7h20" />
        <path d="M8 21h8" />
        <path d="M12 17v4" />
      </>
    ),
  },
];

export default function Home() {
  const router = useRouter();
  const localizedPath = useLocalizedPath();
  const { isAuthenticated } = useAuth();
  const shelfRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const typingText = useTypingText(TYPING_PHRASES, query.length > 0);

  const documentsHref = localizedPath("/documents");
  const registerHref = localizedPath("/auth/register");
  const startReadingHref = isAuthenticated ? documentsHref : registerHref;

  const goToLibrary = (q?: string) => {
    const trimmed = (q ?? "").trim();
    router.push(trimmed ? `${documentsHref}?q=${encodeURIComponent(trimmed)}` : documentsHref);
  };

  const onSubmitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    goToLibrary(query);
  };

  const scrollShelf = (direction: "left" | "right") => {
    if (shelfRef.current) {
      shelfRef.current.scrollBy({ left: direction === "left" ? -400 : 400, behavior: "smooth" });
    }
  };

  return (
    <main className="landing-shell min-h-screen">
      {/* NAVBAR */}
      <nav className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-[#0f0c09]/55 backdrop-blur-xl border border-white/5 rounded-full px-6 py-2 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.03)] flex items-center gap-9 whitespace-nowrap">
        <Link href={localizedPath("/")} className="flex items-center gap-2">
          <span className="font-fraunces text-[20px] text-accent-2">ع</span>
          <span className="font-fraunces text-[16px] tracking-tight">
            ILM <em className="italic text-text-2">Shamela</em>
          </span>
        </Link>
        <div className="hidden md:flex items-center gap-7">
          <Link href="#why" className="nav-link">Why ILM</Link>
          <Link href={documentsHref} className="nav-link">Library</Link>
          <Link href="#how" className="nav-link">How it works</Link>
          <Link href="#cta" className="nav-link">Get started</Link>
        </div>
        <Link href={documentsHref} className="btn-primary ml-auto">
          Open Library
        </Link>
      </nav>

      {/* HERO */}
      <section className="pt-44 pb-32 px-6">
        <div className="max-w-6xl mx-auto">
          <FadeIn className="text-center">
            <span className="inline-flex items-center gap-2 text-[12px] tracking-[0.12em] uppercase text-accent-2 bg-accent-soft border border-accent/20 px-3.5 py-1.5 rounded-full mb-8">
              <svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="3" fill="currentColor" /></svg>
              Now indexing classical & modern works
            </span>
          </FadeIn>

          <FadeIn delay={0.1}>
            <h1 className="font-fraunces font-light text-[clamp(48px,7.5vw,104px)] leading-[0.96] tracking-tight text-center max-w-5xl mx-auto text-text">
              A library<br />that <em className="italic text-accent-2 font-normal">reads</em> with you.
            </h1>
          </FadeIn>

          <FadeIn delay={0.2}>
            <p className="text-center mt-8 max-w-xl mx-auto text-[17px] leading-relaxed text-text-2">
              ILM Shamela indexes 1,400 years of scholarship across four languages — then answers your questions with a citation, never a guess.
            </p>
          </FadeIn>

          {/* Search Interface */}
          <FadeIn delay={0.3} className="max-w-3xl mx-auto mt-14">
            <form
              onSubmit={onSubmitSearch}
              className="search-shell bg-gradient-to-b from-card-2/90 to-card/90 border border-border rounded-[24px] p-1.5 shadow-2xl relative"
            >
              <div className="flex items-center gap-3 px-4">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent">
                  <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
                </svg>
                <div className="relative flex-1 min-w-0">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="bg-transparent border-none outline-none font-fraunces text-lg text-text w-full py-3.5 px-2"
                    aria-label="Search the library"
                  />
                  {query.length === 0 && (
                    <div
                      aria-hidden
                      className="absolute inset-0 flex items-center px-2 pointer-events-none font-fraunces italic text-lg text-text-3 truncate"
                    >
                      <span className="truncate">{typingText}</span>
                      <span className="ml-0.5 inline-block text-accent-2 animate-cursor-blink">▍</span>
                    </div>
                  )}
                </div>
                <button type="submit" className="btn-primary flex-shrink-0 flex items-center gap-2">
                  Ask
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
                </button>
              </div>
            </form>

            <div className="flex flex-wrap items-center justify-center gap-2 mt-6">
              <span className="text-[12px] text-text-3">Try:</span>
              {trySuggestions.map((suggestion) => (
                <button
                  key={suggestion.query}
                  type="button"
                  onClick={() => goToLibrary(suggestion.query)}
                  className={`text-[12.5px] text-text-2 bg-white/5 border border-border px-3.5 py-1.5 rounded-full hover:border-accent hover:text-accent-2 hover:bg-accent-soft transition-all ${suggestion.fontClass}`}
                >
                  {suggestion.label}
                </button>
              ))}
            </div>
          </FadeIn>

          {/* Trust Bar */}
          <FadeIn delay={0.5} className="mt-24 pt-10 border-t border-border">
            <p className="text-center text-[11.5px] tracking-[0.18em] uppercase mb-6 text-text-3">Trusted by scholars at</p>
            <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-4 opacity-50 text-text-2">
              <span className="font-fraunces text-lg italic">Al-Azhar</span>
              <span className="font-fraunces text-lg">Hartford Seminary</span>
              <span className="font-fraunces text-lg italic">Zaytuna</span>
              <span className="font-fraunces text-lg">SOAS · London</span>
              <span className="font-fraunces text-lg italic">Qarawiyyin</span>
              <span className="font-fraunces text-lg">Oxford CIS</span>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* WHY ILM */}
      <section id="why" className="py-32 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-12 gap-12 mb-20">
            <FadeIn className="lg:col-span-5">
              <span className="section-eyebrow">Why ILM</span>
              <h2 className="font-fraunces font-light text-[clamp(32px,4.5vw,56px)] leading-[1.05] tracking-tight mt-5">
                A library built for <em className="italic text-accent-2">thinkers</em>, not feeds.
              </h2>
            </FadeIn>
            <FadeIn delay={0.15} className="lg:col-span-6 lg:col-start-7 lg:pt-2">
              <p className="text-[17px] leading-relaxed text-text-2">
                Most search engines flatten knowledge into ten blue links. ILM treats each text as it deserves — with provenance, edition, and context preserved. Your reading is private, your sources are verifiable, and your assistant never invents what isn&apos;t there.
              </p>
            </FadeIn>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {featureCards.map((feature, i) => (
              <FadeIn
                key={feature.title}
                delay={0.05 * i}
                className="bg-gradient-to-b from-card-2 to-card border border-border rounded-[22px] p-7 relative overflow-hidden group"
              >
                <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
                <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-7 bg-accent-soft text-accent-2">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">{feature.icon}</svg>
                </div>
                <h3 className="font-fraunces text-[22px] leading-tight mb-3">{feature.title}</h3>
                <p className="text-[14px] leading-relaxed text-text-2">{feature.desc}</p>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* BOOKSHELF */}
      <section id="shelf" className="py-32 px-6 overflow-hidden">
        <div className="max-w-6xl mx-auto">
          <FadeIn className="flex flex-wrap items-end justify-between gap-8 mb-14">
            <div className="max-w-2xl">
              <span className="section-eyebrow">The Shelf</span>
              <h2 className="font-fraunces font-light text-[clamp(32px,4.5vw,56px)] leading-[1.05] tracking-tight mt-5">
                Walk the <em className="italic text-accent-2">shelves</em>, drift through eras.
              </h2>
              <p className="mt-5 text-[16px] leading-relaxed text-text-2">
                From the formative period to the present, organized the way a librarian would. Click any spine to peer inside.
              </p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => scrollShelf("left")} className="btn-ghost !p-3" aria-label="Scroll shelf left">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
              </button>
              <button type="button" onClick={() => scrollShelf("right")} className="btn-ghost !p-3" aria-label="Scroll shelf right">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>
              </button>
            </div>
          </FadeIn>

          <FadeIn delay={0.1}>
            <div ref={shelfRef} className="flex gap-4 pb-2 overflow-x-auto hide-scrollbar">
              {shelfBooks.map((book) => (
                <Link
                  key={book.meta}
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
              {[
                { cat: "Tafsīr", count: 412 },
                { cat: "Hadīth", count: 638 },
                { cat: "Fiqh", count: 521 },
                { cat: "Tārīkh", count: 287 },
                { cat: "Adab", count: 196 },
                { cat: "Falsafa", count: 134 },
              ].map(({ cat, count }) => (
                <Link
                  key={cat}
                  href={documentsHref}
                  className="bg-gradient-to-b from-card-2 to-card border border-border rounded-xl p-4 text-center hover:border-accent transition-colors"
                >
                  <div className="font-fraunces text-[17px]">{cat}</div>
                  <div className="text-[12px] text-text-3 mt-1 tracking-wide">{count} works</div>
                </Link>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="py-32 px-6 bg-gradient-to-b from-transparent to-bg-2">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-end flex-wrap gap-8 mb-12">
            <FadeIn className="max-w-2xl">
              <span className="section-eyebrow">How it works</span>
              <h2 className="font-fraunces font-light text-[clamp(32px,4.5vw,56px)] leading-[1.05] tracking-tight mt-5">
                The full product on <em className="italic text-accent-2">one page</em>.
              </h2>
            </FadeIn>
            <FadeIn className="hidden md:block">
              <div className="text-[11px] tracking-widest text-text-3">CHAPTER 03 · PAGE 47</div>
            </FadeIn>
          </div>

          <FadeIn delay={0.1} className="grid lg:grid-cols-2 gap-5" dir="rtl">
            {/* Book Panel (RTL native) */}
            <div className="bg-gradient-to-b from-[#16110c] to-[#100c08] border border-border rounded-[18px] p-8 md:p-10 relative" lang="ar">
              <div className="flex justify-between items-center mb-8">
                <div className="text-[11px] tracking-widest text-text-3">الفصل الثالث</div>
                <div className="text-[11px] tracking-widest text-text-3">صفحة ٤٧</div>
              </div>
              <div className="font-amiri text-right text-[22px] leading-[2.2] text-text">
                وإذا تأمَّلتَ أحوالَ العُمران الحضريّ رأيتَه يتدرَّج على سُنن ثابتة تجمع بين بداوة الأصل وتعقيد الدولة.
                <br /><br />
                <span className="bg-gradient-to-b from-accent/25 to-accent/15 border border-accent/50 px-2.5 py-1 rounded-md inline-block">
                  فالعصبيّة قاعدة المُلك، ومتى انفكَّت فقد المُلكُ عمودَه الأوّل.
                </span>
                <br /><br />
                ثم إنّ لأطوار الدولة أعمارًا محدودةً كأعمار الأشخاص، ولكلِّ طورٍ منها شواهدُ تُعرَف بها.
              </div>
              <div className="flex items-center justify-center gap-3.5 text-accent mt-10">
                <div className="h-[1px] w-10 bg-gradient-to-r from-transparent to-accent" />
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" /></svg>
                <div className="h-[1px] w-10 bg-gradient-to-r from-accent to-transparent" />
              </div>
            </div>

            {/* AI Assistant Panel */}
            <div className="bg-gradient-to-b from-[#16110c] to-[#100c08] border border-border rounded-[18px] p-8 md:p-10 relative" dir="ltr">
              <div className="flex justify-between items-center mb-8">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-accent-soft text-accent-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6z" />
                    </svg>
                  </div>
                  <span className="text-[11px] tracking-widest text-text-3">READING ASSISTANT</span>
                </div>
                <span className="text-[11px] text-text-3">●●● online</span>
              </div>

              <div className="space-y-3">
                <div className="bg-gradient-to-b from-accent/15 to-accent/5 border border-accent shadow-[0_0_30px_-10px_rgba(192,133,82,0.3)] rounded-xl p-5 cursor-pointer">
                  <div className="flex items-center gap-2 mb-1.5">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-2)" strokeWidth="1.5"><path d="M3 7h18M3 12h18M3 17h12" /></svg>
                    <h4 className="font-fraunces text-[16px] text-text">Highlight a passage → get the context</h4>
                  </div>
                  <p className="text-[13.5px] leading-relaxed text-text-2">
                    Hover any sentence. ILM surfaces the historical background and cross-references from other works.
                  </p>
                </div>

                <div className="mt-6 p-5 rounded-2xl bg-accent-soft border border-accent/20 relative overflow-hidden">
                  <div className="text-[10.5px] tracking-widest mb-3 text-accent-2">ASSISTANT REPLY · LIVE</div>
                  <p className="font-fraunces text-[14.5px] leading-relaxed text-text">
                    Ibn Khaldūn frames <em className="italic text-accent-2">ʿaṣabiyya</em> as the cohesive force underwriting any sovereign order — when it dissolves, dynasties lose their structural pillar.
                    <span className="animate-cursor-blink text-accent-2">▍</span>
                  </p>
                  <div className="mt-4 inline-flex items-center px-2.5 py-1 rounded bg-card-2 text-[11px] text-text-3">
                    ↗ Muqaddima · ch. 3 · §47
                  </div>
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* CTA SECTION */}
      <section id="cta" className="py-32 px-6">
        <div className="max-w-5xl mx-auto">
          <FadeIn className="relative bg-gradient-to-b from-[#19140e] to-[#110d09] border border-border-strong rounded-[32px] p-12 md:p-20 text-center overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_0%,rgba(192,133,82,0.18),transparent_60%),radial-gradient(ellipse_at_80%_100%,rgba(192,133,82,0.10),transparent_60%)]" />

            <div className="relative z-10">
              <div className="flex items-center justify-center gap-3.5 text-accent mb-8">
                <div className="h-[1px] w-10 bg-gradient-to-r from-transparent to-accent" />
                <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" /></svg>
                <div className="h-[1px] w-10 bg-gradient-to-r from-accent to-transparent" />
              </div>
              <h2 className="font-fraunces font-light text-[clamp(36px,5vw,64px)] leading-[1.05] tracking-tight mb-6 max-w-3xl mx-auto text-text">
                Open the library.<br />
                <em className="italic text-accent-2">Begin where the question takes you.</em>
              </h2>
              <p className="text-[16.5px] leading-relaxed max-w-xl mx-auto mb-10 text-text-2">
                A working account in under a minute. No card. The first 12,000 pages are already waiting.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <Link href={startReadingHref} className="btn-primary !px-7 !py-3.5 !text-[15px]">
                  Start reading — free
                </Link>
                <Link href={documentsHref} className="btn-ghost !px-7 !py-3.5 !text-[15px]">
                  Browse the library
                </Link>
              </div>
              <p className="mt-8 text-[11.5px] tracking-widest text-text-3">
                ✦ NO CREDIT CARD ✦ NO SPAM ✦ NO TRAINING ON YOUR READING ✦
              </p>
            </div>
          </FadeIn>
        </div>
      </section>

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
                A private digital library and document search engine for the world&apos;s classical scholarship — built with care, run with respect.
              </p>
            </div>
            <div className="md:col-span-2">
              <p className="text-[11px] tracking-[0.18em] uppercase text-text-3 mb-4">Browse</p>
              <ul className="space-y-2 text-[14px]">
                <li><Link href={documentsHref} className="text-text-2 hover:text-accent-2 transition-colors">Library</Link></li>
                <li><Link href={localizedPath("/upload")} className="text-text-2 hover:text-accent-2 transition-colors">Upload</Link></li>
              </ul>
            </div>
            <div className="md:col-span-2">
              <p className="text-[11px] tracking-[0.18em] uppercase text-text-3 mb-4">Account</p>
              <ul className="space-y-2 text-[14px]">
                {isAuthenticated ? (
                  <li><Link href={localizedPath("/profile")} className="text-text-2 hover:text-accent-2 transition-colors">Profile</Link></li>
                ) : (
                  <>
                    <li><Link href={localizedPath("/auth/login")} className="text-text-2 hover:text-accent-2 transition-colors">Sign in</Link></li>
                    <li><Link href={registerHref} className="text-text-2 hover:text-accent-2 transition-colors">Get started</Link></li>
                  </>
                )}
              </ul>
            </div>
            <div className="md:col-span-3">
              <p className="text-[11px] tracking-[0.18em] uppercase text-text-3 mb-4">Explore</p>
              <ul className="space-y-2 text-[14px]">
                <li><Link href="#why" className="text-text-2 hover:text-accent-2 transition-colors">Why ILM</Link></li>
                <li><Link href="#how" className="text-text-2 hover:text-accent-2 transition-colors">How it works</Link></li>
                <li><Link href="#cta" className="text-text-2 hover:text-accent-2 transition-colors">Get started</Link></li>
              </ul>
            </div>
          </div>
          <div className="pt-8 border-t border-border flex flex-wrap justify-between items-center gap-4">
            <p className="text-[12.5px] text-text-3">© 2026 ILM Shamela · Made with patience for serious readers everywhere.</p>
            <p className="font-amiri text-[15px] text-text-3">﴿ وَفَوْقَ كُلِّ ذِي عِلْمٍ عَلِيمٌ ﴾</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
