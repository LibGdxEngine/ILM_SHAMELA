'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/lib/AuthContext';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import { useI18n } from '@/components/i18n/I18nProvider';
import ContinueReadingShelf from '@/components/ContinueReadingShelf';

type ShelfBook = {
  title: string;
  author: string;
  pitch: string;
  accent: 'terracotta' | 'ink' | 'moss' | 'ochre';
};

const shelfAccentClass: Record<ShelfBook['accent'], string> = {
  terracotta: 'from-[#c96442] to-[#7c4a2b]',
  ink: 'from-[#2c3a4a] to-[#141413]',
  moss: 'from-[#3a4a34] to-[#1f2a1b]',
  ochre: 'from-[#a16207] to-[#4d3210]',
};

export default function Home() {
  const localizedPath = useLocalizedPath();
  const { t } = useI18n();
  const { isAuthenticated, isLoading } = useAuth();
  const year = new Date().getFullYear();

  /* ─── Hero AI search demo ─── */
  const demoQueries = useMemo(
    () => [
      {
        q: t(
          'landing.demo.q1',
          'كتب تشبه "الطبقات الكبرى" لكن أقصر'
        ),
        a: t(
          'landing.demo.a1',
          'اقترحت ٤ كتب تراجم موجزة، رتّبتها حسب التغطية الزمنية وعدد الصفحات — أبرزها "المختصر في أخبار البشر" لأبي الفداء.'
        ),
      },
      {
        q: t(
          'landing.demo.q2',
          'اشرح لي نهاية الفصل الرابع من كتاب الفصوص'
        ),
        a: t(
          'landing.demo.a2',
          'الفصل يختم بربط مفهوم الأسماء الإلهية بالأعيان الثابتة، مع مقارنة بين روايتَي النسخة الدمشقية والقونوية للمخطوط.'
        ),
      },
      {
        q: t(
          'landing.demo.q3',
          'ابحث عن مقاطع يذكر فيها المؤلف "العدل والإحسان"'
        ),
        a: t(
          'landing.demo.a3',
          'وجدت ٧ مقاطع في ٣ كتب — أعلاها مطابقةً فصل في "إحياء علوم الدين" يربط المفهوم بآداب الولاية العامة.'
        ),
      },
    ],
    [t]
  );

  const [demoIndex, setDemoIndex] = useState(0);
  const [demoTyping, setDemoTyping] = useState('');
  const [demoUserInput, setDemoUserInput] = useState('');
  const [isDemoPaused, setIsDemoPaused] = useState(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const demoPausedRef = useRef(false);

  useEffect(() => {
    demoPausedRef.current = isDemoPaused;
  }, [isDemoPaused]);

  useEffect(() => {
    const current = demoQueries[demoIndex]?.a ?? '';
    setDemoTyping('');
    let i = 0;
    const tick = () => {
      if (demoPausedRef.current) {
        typingTimerRef.current = setTimeout(tick, 220);
        return;
      }
      i += 1;
      setDemoTyping(current.slice(0, i));
      if (i < current.length) {
        typingTimerRef.current = setTimeout(tick, 18);
      } else {
        typingTimerRef.current = setTimeout(() => {
          setDemoIndex((prev) => (prev + 1) % demoQueries.length);
        }, 3800);
      }
    };
    typingTimerRef.current = setTimeout(tick, 550);
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
  }, [demoIndex, demoQueries]);

  const onSubmitDemoSearch = (e: React.FormEvent) => {
    e.preventDefault();
    // Route the user to the real library with the query pre-filled.
    const q = (demoUserInput || demoQueries[demoIndex]?.q || '').trim();
    const url = q
      ? `${localizedPath('/documents')}?q=${encodeURIComponent(q)}`
      : localizedPath('/documents');
    window.location.href = url;
  };

  /* ─── Section datasets ─── */
  const valueCards = [
    {
      title: t('landing.values.rare.title', 'اكتشاف نادر'),
      proof: t('landing.values.rare.proof', '+12K صفحة مفهرسة'),
      description: t(
        'landing.values.rare.description',
        'نصوص مخطوطة وكتب مجهولة التداول، مرتبة لتصل إلى ما تبحث عنه بسرعة.'
      ),
      icon: (
        <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden>
          <path
            d="M16 3.5L19 12.5L28.5 16L19 19.5L16 28.5L13 19.5L3.5 16L13 12.5Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
    {
      title: t('landing.values.focused.title', 'قراءة مركزة'),
      proof: t('landing.values.focused.proof', 'قراءة وبحث في موضع واحد'),
      description: t(
        'landing.values.focused.description',
        'واجهة قراءة هادئة تدعم البحث داخل الكتاب والتنقل الدقيق بين الصفحات.'
      ),
      icon: (
        <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden>
          <path
            d="M4 6C4 6 10 4 16 4C22 4 28 6 28 6V28C28 28 22 26 16 26C10 26 4 28 4 28V6Z"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path d="M16 4V26" stroke="currentColor" strokeWidth="1.25" />
        </svg>
      ),
    },
    {
      title: t('landing.values.organized.title', 'تنظيم معرفي'),
      proof: t('landing.values.organized.proof', 'مؤلفون وتصنيفات وعناوين بديلة'),
      description: t(
        'landing.values.organized.description',
        'تصنيفات ومؤلفون وعناوين بديلة تساعدك على بناء مكتبة بحثية متماسكة.'
      ),
      icon: (
        <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden>
          <rect x="4" y="8" width="7" height="20" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
          <rect x="13" y="5" width="7" height="23" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
          <rect x="22" y="10" width="6" height="18" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      ),
    },
  ];

  const shelves: { label: string; books: ShelfBook[] }[] = [
    {
      label: t('landing.shelves.staff', 'اختيارات المحررين'),
      books: [
        {
          title: t('landing.shelves.book1.title', 'رحلة ابن بطوطة'),
          author: t('landing.shelves.book1.author', 'محمد بن عبد الله بن بطوطة'),
          pitch: t(
            'landing.shelves.book1.pitch',
            'توثيق رحلة عبر ثلاث قارات، موجز ذكي لأسلوب السرد.'
          ),
          accent: 'terracotta',
        },
        {
          title: t('landing.shelves.book2.title', 'مقدمة ابن خلدون'),
          author: t('landing.shelves.book2.author', 'عبد الرحمن بن خلدون'),
          pitch: t(
            'landing.shelves.book2.pitch',
            'فلسفة العمران الاجتماعي — مفاتيح قراءة عصرية.'
          ),
          accent: 'ink',
        },
        {
          title: t('landing.shelves.book3.title', 'الفهرست'),
          author: t('landing.shelves.book3.author', 'ابن النديم'),
          pitch: t(
            'landing.shelves.book3.pitch',
            'خارطة معرفة القرن العاشر — مرجع للبحث التراثي.'
          ),
          accent: 'moss',
        },
        {
          title: t('landing.shelves.book4.title', 'طبقات الأطباء'),
          author: t('landing.shelves.book4.author', 'ابن أبي أصيبعة'),
          pitch: t(
            'landing.shelves.book4.pitch',
            'سير علماء الطب — تصفح بالزمن والمدرسة.'
          ),
          accent: 'ochre',
        },
      ],
    },
    {
      label: t('landing.shelves.winter', 'قراءات هادئة'),
      books: [
        {
          title: t('landing.shelves.book5.title', 'إحياء علوم الدين'),
          author: t('landing.shelves.book5.author', 'أبو حامد الغزالي'),
          pitch: t(
            'landing.shelves.book5.pitch',
            'تصفح موضوعي مع فهرسة معاصرة للفصول.'
          ),
          accent: 'moss',
        },
        {
          title: t('landing.shelves.book6.title', 'البيان والتبيين'),
          author: t('landing.shelves.book6.author', 'الجاحظ'),
          pitch: t(
            'landing.shelves.book6.pitch',
            'أسلوب أدبي خالص — بحث سريع عن الأمثال والحكم.'
          ),
          accent: 'terracotta',
        },
        {
          title: t('landing.shelves.book7.title', 'تاريخ الطبري'),
          author: t('landing.shelves.book7.author', 'محمد بن جرير الطبري'),
          pitch: t(
            'landing.shelves.book7.pitch',
            'مسار زمني تفاعلي — اقفز لأي سنة هجرية.'
          ),
          accent: 'ink',
        },
        {
          title: t('landing.shelves.book8.title', 'الكامل في الأدب'),
          author: t('landing.shelves.book8.author', 'المبرد'),
          pitch: t(
            'landing.shelves.book8.pitch',
            'لغة، بلاغة، وشعر — مقتطفات بحسب المزاج.'
          ),
          accent: 'ochre',
        },
      ],
    },
  ];

  const howItWorks = [
    {
      title: t('landing.how.item1.title', 'حدد مقطعًا — احصل على السياق'),
      text: t(
        'landing.how.item1.text',
        'مرّر على جملة، فتظهر لك الخلفية التاريخية والمراجع المتقاطعة من كتب أخرى.'
      ),
    },
    {
      title: t('landing.how.item2.title', 'اسأل عن شخصية'),
      text: t(
        'landing.how.item2.text',
        'تعرف على من هو المذكور في النص، مع سيرة موجزة وروابط إلى كتب ترجمته.'
      ),
    },
    {
      title: t('landing.how.item3.title', 'اطلب تحليلًا موضوعيًا'),
      text: t(
        'landing.how.item3.text',
        'استخلص أفكار الكتاب أو فصل منه، مع ذكر المراجع داخل النص.'
      ),
    },
    {
      title: t('landing.how.item4.title', 'تقاطع مع أعمال أخرى'),
      text: t(
        'landing.how.item4.text',
        'قارن المفهوم الواحد كما تناوله أكثر من مؤلف عبر العصور.'
      ),
    },
  ];

  const trustStats = [
    {
      value: '+12K',
      label: t('landing.trust.indexedPages', 'صفحة نصية مفهرسة'),
      detail: t('landing.trust.indexedPages.detail', 'آخر تحديث: مايو ٢٠٢٦'),
    },
    {
      value: '4',
      label: t('landing.trust.languages', 'لغات مدعومة'),
      detail: t('landing.trust.languages.detail', 'العربية، الإنجليزية، الفارسية، والأوردية'),
    },
    {
      value: '98%',
      label: t('landing.trust.processingSuccess', 'نجاح معالجة المستندات'),
      detail: t('landing.trust.processingSuccess.detail', 'مستندات اكتملت معالجتها دون تدخل يدوي'),
    },
    {
      value: '24/7',
      label: t('landing.trust.access', 'وصول مستمر للمكتبة'),
      detail: t('landing.trust.access.detail', 'القراءة والبحث متاحان بعد الفهرسة'),
    },
  ];

  const testimonials = [
    {
      quote: t(
        'landing.testimonials.item1.quote',
        'طلبت منها أن تجد لي كتبًا في فقه المعاملات أقصر من ٢٠٠ صفحة — وأعطتني قائمة مرتبة.'
      ),
      author: t('landing.testimonials.item1.author', 'باحثة في التراث - الرياض'),
    },
    {
      quote: t(
        'landing.testimonials.item2.quote',
        'تنظيم الملاحظات مع البحث داخل النص وفّر علي ساعات طويلة أثناء التحضير العلمي.'
      ),
      author: t('landing.testimonials.item2.author', 'طالب دراسات عليا - القاهرة'),
    },
    {
      quote: t(
        'landing.testimonials.item3.quote',
        'الواجهة العربية والاتجاه من اليمين لليسار تجعل القراءة طبيعية دون أي تشويش بصري.'
      ),
      author: t('landing.testimonials.item3.author', 'قارئ مستقل - الدوحة'),
    },
  ];

  /* ─── Class helpers ─── */
  const primaryCta =
    'inline-flex items-center justify-center rounded-xl bg-terracotta px-6 py-3 text-sm font-medium text-ivory shadow-[0_0_0_1px_#c96442] transition-all hover:bg-terracotta-soft hover:shadow-[0_6px_24px_-6px_rgba(201,100,66,0.6)] focus:outline-none focus:ring-2 focus:ring-focus-blue focus:ring-offset-2 focus:ring-offset-parchment';
  const secondaryCta =
    'inline-flex items-center justify-center rounded-xl border border-border-warm bg-ivory px-6 py-3 text-sm font-medium text-charcoal-warm shadow-ring-cream transition-shadow hover:shadow-ring-warm focus:outline-none focus:ring-2 focus:ring-focus-blue focus:ring-offset-2 focus:ring-offset-parchment dark:border-dark-surface dark:bg-dark-surface dark:text-warm-silver';
  const invertedCta =
    'inline-flex items-center justify-center rounded-xl bg-ivory px-6 py-3 text-sm font-medium text-near-black shadow-ring-warm transition-shadow hover:shadow-ring-deep focus:outline-none focus:ring-2 focus:ring-focus-blue focus:ring-offset-2 focus:ring-offset-near-black';
  const darkSecondaryCta =
    'inline-flex items-center justify-center rounded-xl border border-dark-surface bg-transparent px-6 py-3 text-sm font-medium text-warm-silver transition-colors hover:border-terracotta/50 hover:text-ivory focus:outline-none focus:ring-2 focus:ring-focus-blue focus:ring-offset-2 focus:ring-offset-near-black';
  const overline = 'text-[11px] font-medium uppercase tracking-[0.18em] text-stone-gray';

  return (
    <main className="bg-parchment text-near-black dark:bg-near-black dark:text-ivory">
      {/* ─── HERO ─── */}
      <section className="relative px-6 pt-14 pb-20 md:px-10 md:pt-20 md:pb-28">
        {/* subtle paper-grain decorative texture */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.35] dark:opacity-[0.15]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 10%, rgba(201,100,66,0.06), transparent 40%), radial-gradient(circle at 80% 70%, rgba(20,20,19,0.04), transparent 45%)',
          }}
        />
        <div className="relative mx-auto flex max-w-4xl flex-col items-center text-center">
          <span
            className={`inline-flex items-center ${overline} rounded-full border border-border-warm bg-ivory px-3 py-1 dark:border-dark-surface dark:bg-dark-surface`}
          >
            <span className="me-2 inline-block h-1.5 w-1.5 rounded-full bg-terracotta" />
            {t('landing.heroEyebrow', 'قراءة عميقة. بحث أذكى.')}
          </span>
          <h1 className="mt-7 max-w-3xl font-serif text-4xl font-medium leading-[1.08] tracking-tight text-near-black dark:text-ivory md:text-[64px]">
            {t('landing.heroTitle', 'اقرأ بعمق، وابحث بذكاء داخل التراث.')}
          </h1>
          <p className="mt-6 max-w-2xl font-serif text-lg leading-[1.6] text-olive-gray dark:text-warm-silver md:text-xl">
            {t(
              'landing.heroSubtitle',
              'مكتبة علم تمنحك مخطوطات نادرة، وبحثًا دلاليًا يفهم سؤالك كما يفهمه أمين مكتبة متمرّس.'
            )}
          </p>

          {/* Interactive AI search bar */}
          <form onSubmit={onSubmitDemoSearch} className="mt-10 w-full max-w-2xl">
            <div className="group relative rounded-2xl border border-border-warm bg-ivory p-1.5 shadow-whisper transition-all focus-within:border-terracotta/40 focus-within:shadow-[0_10px_40px_-12px_rgba(201,100,66,0.35)] dark:border-dark-surface dark:bg-dark-surface">
              <div className="flex items-center gap-2">
                <span className="ps-3 text-terracotta" aria-hidden>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M11 3a8 8 0 105.293 14.293l4.207 4.207 1.414-1.414-4.207-4.207A8 8 0 0011 3zm0 2a6 6 0 110 12 6 6 0 010-12z"
                      fill="currentColor"
                    />
                  </svg>
                </span>
                <input
                  type="text"
                  value={demoUserInput}
                  onChange={(e) => setDemoUserInput(e.target.value)}
                  placeholder={demoQueries[demoIndex]?.q ?? ''}
                  className="min-w-0 flex-1 bg-transparent px-2 py-3 font-sans text-base text-near-black placeholder:text-stone-gray focus:outline-none dark:text-ivory md:text-[15px]"
                  aria-label={t('landing.hero.searchAria', 'اسأل عن كتاب أو فكرة')}
                />
                <button
                  type="submit"
                  className="me-1 inline-flex items-center gap-1.5 rounded-xl bg-near-black px-4 py-2.5 text-sm font-medium text-ivory transition-colors hover:bg-charcoal-warm dark:bg-ivory dark:text-near-black dark:hover:bg-warm-silver"
                >
                  {t('landing.hero.ask', 'اسأل')}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M5 12h14m-6-6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
              {/* Simulated streaming response */}
              <div className="mt-1.5 rounded-xl bg-parchment/60 px-4 py-3 text-start font-serif text-[15px] leading-[1.65] text-charcoal-warm dark:bg-near-black/40 dark:text-warm-silver">
                <div className="mb-1 flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.2em] text-stone-gray">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block h-1.5 w-1.5 rounded-full bg-terracotta ${isDemoPaused ? '' : 'animate-pulse'}`} />
                    {t('landing.hero.thinking', 'يستنبط من المكتبة')}
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsDemoPaused((paused) => !paused)}
                    aria-pressed={isDemoPaused}
                    className="rounded-full border border-border-warm px-2 py-1 font-sans text-[10px] font-medium text-charcoal-warm transition-colors hover:border-terracotta/50 hover:text-terracotta focus:outline-none focus:ring-2 focus:ring-focus-blue dark:border-dark-surface dark:text-warm-silver"
                  >
                    {isDemoPaused ? t('landing.hero.resume', 'تشغيل') : t('landing.hero.pause', 'إيقاف')}
                  </button>
                </div>
                <span aria-live={isDemoPaused ? 'off' : 'polite'}>{demoTyping}</span>
                <span className={`ms-0.5 inline-block h-[1em] w-[2px] bg-terracotta align-middle ${isDemoPaused ? 'opacity-40' : 'animate-pulse'}`} aria-hidden />
              </div>
            </div>
            <p className="mt-3 text-xs text-stone-gray">
              {t('landing.hero.hint', 'جرّب: "فقه المعاملات في أقل من ٢٠٠ صفحة"، أو "اشرح مفهوم العمران عند ابن خلدون".')}
            </p>
          </form>

          <div className="mt-8 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center">
            <Link href={localizedPath('/documents')} className={`${primaryCta} w-full sm:w-auto`}>
              {t('landing.ctaPrimary', 'ادخل إلى المكتبة')}
            </Link>
            {!isLoading && !isAuthenticated && (
              <Link href={localizedPath('/auth/register')} className={`${secondaryCta} w-full sm:w-auto`}>
                {t('landing.ctaTertiary', 'أنشئ حسابًا مجانيًا')}
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* ─── LIVE AI DEMO STRIP ─── */}
      <section className="border-t border-border-cream px-6 py-12 md:px-10 md:py-16 dark:border-dark-surface">
        <div className="mx-auto max-w-6xl">
          <p className={overline}>{t('landing.section.demos', 'ماذا يمكن أن تسأل؟')}</p>
          <h2 className="mt-3 max-w-3xl font-serif text-2xl font-medium leading-[1.25] text-near-black dark:text-ivory md:text-[32px]">
            {t(
              'landing.demoHeadline',
              'بحث دلالي، تلخيص لفصل، أو مقارنة بين مؤلّفَين — الأمر لك.'
            )}
          </h2>
          <div className="mt-8 flex flex-wrap gap-2.5">
            {demoQueries.map((item, idx) => (
              <button
                key={item.q}
                type="button"
                onClick={() => {
                  setDemoIndex(idx);
                  setDemoUserInput('');
                }}
                aria-pressed={idx === demoIndex}
                className={`group inline-flex items-center gap-2 rounded-full border px-4 py-2 font-sans text-sm transition-all ${
                  idx === demoIndex
                    ? 'border-terracotta bg-terracotta/10 text-terracotta shadow-[0_0_0_3px_rgba(201,100,66,0.08)]'
                    : 'border-border-warm bg-ivory text-charcoal-warm hover:border-terracotta/40 hover:text-near-black dark:border-dark-surface dark:bg-dark-surface dark:text-warm-silver'
                }`}
              >
                <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-stone-gray">
                  {idx + 1 < 10 ? `0${idx + 1}` : idx + 1}
                </span>
                <span className="max-w-[28ch] truncate">{item.q}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CONTINUE READING (auth-only) ─── */}
      <section className="border-t border-border-cream px-6 py-12 md:px-10 md:py-16 dark:border-dark-surface">
        <ContinueReadingShelf />
      </section>

      {/* ─── VALUES ─── */}
      <section className="border-t border-border-cream px-6 py-20 md:px-10 md:py-24 dark:border-dark-surface">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <p className={overline}>{t('landing.section.values', 'لماذا مكتبة علم؟')}</p>
            <h2 className="mt-3 font-serif text-3xl font-medium leading-[1.2] text-near-black dark:text-ivory md:text-[44px]">
              {t('landing.valuesHeadline', 'مكتبة تُصمَّم حول القارئ، لا حول الخوارزمية.')}
            </h2>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {valueCards.map((card) => (
              <article
                key={card.title}
                className="group rounded-2xl border border-border-cream bg-ivory p-7 shadow-whisper transition-all hover:-translate-y-0.5 hover:shadow-[0_14px_40px_-16px_rgba(20,20,19,0.15)] dark:border-dark-surface dark:bg-dark-surface"
              >
                <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-warm-sand text-terracotta transition-colors group-hover:bg-terracotta group-hover:text-ivory dark:bg-dark-warm dark:text-terracotta-soft">
                  {card.icon}
                </div>
                <h3 className="font-serif text-[24px] font-medium leading-[1.2] text-near-black dark:text-ivory">
                  {card.title}
                </h3>
                <p className="mt-3 font-sans text-sm leading-[1.65] text-olive-gray dark:text-warm-silver">
                  {card.description}
                </p>
                <p className="mt-5 inline-flex rounded-full border border-border-warm bg-parchment px-3 py-1 font-sans text-xs font-medium text-charcoal-warm dark:border-dark-warm dark:bg-near-black dark:text-warm-silver">
                  {card.proof}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ─── EDITORIAL SHELVES ─── */}
      <section className="border-t border-border-cream px-6 py-20 md:px-10 md:py-24 dark:border-dark-surface">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-2xl">
              <p className={overline}>{t('landing.section.shelves', 'رفوف المحررين')}</p>
              <h2 className="mt-3 font-serif text-3xl font-medium leading-[1.2] text-near-black dark:text-ivory md:text-[44px]">
                {t('landing.shelvesHeadline', 'ادخل من الرف الذي يناسب حالتك الذهنية.')}
              </h2>
            </div>
            <Link href={localizedPath('/documents')} className="font-sans text-sm font-medium text-terracotta hover:text-terracotta-soft">
              {t('landing.shelves.browseAll', 'تصفح كل الرفوف →')}
            </Link>
          </div>

          <div className="mt-12 space-y-14">
            {shelves.map((shelf) => (
              <div key={shelf.label}>
                <div className="flex items-baseline justify-between">
                  <h3 className="font-serif text-xl font-medium text-near-black dark:text-ivory md:text-[26px]">
                    {shelf.label}
                  </h3>
                  <span className={overline}>
                    {shelf.books.length} {t('landing.shelves.items', 'عناوين')}
                  </span>
                </div>
                <div className="relative mt-5">
                  <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-4">
                    {shelf.books.map((book) => (
                      <article
                        key={book.title}
                        className="group relative flex flex-col"
                      >
                        <div
                          className={`relative aspect-[3/4] overflow-hidden rounded-xl bg-gradient-to-br ${shelfAccentClass[book.accent]} shadow-whisper ring-1 ring-black/5 transition-transform duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_16px_40px_-12px_rgba(20,20,19,0.25)]`}
                        >
                          <div className="absolute inset-x-3 top-3 flex items-center justify-between text-ivory/60">
                            <span className="text-[9px] uppercase tracking-[0.25em]">مكتبة علم</span>
                            <span className="h-1.5 w-1.5 rounded-full bg-ivory/70" />
                          </div>
                          <div className="absolute inset-x-4 bottom-5">
                            <p className="font-serif text-[15px] leading-[1.25] text-ivory line-clamp-3">
                              {book.title}
                            </p>
                            <p className="mt-2 font-sans text-[11px] text-ivory/70 line-clamp-1">
                              {book.author}
                            </p>
                          </div>
                          {/* AI-moment hover pitch */}
                          <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/80 via-black/20 to-transparent p-4 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                            <p className="font-serif text-[13px] leading-[1.5] text-ivory">
                              <span className="me-1 inline-block h-1.5 w-1.5 rounded-full bg-terracotta align-middle" />
                              {book.pitch}
                            </p>
                          </div>
                        </div>
                        <p className="mt-3 rounded-xl border border-border-cream bg-ivory px-3 py-2 font-serif text-[13px] leading-[1.5] text-charcoal-warm shadow-ring-cream dark:border-dark-surface dark:bg-dark-surface dark:text-warm-silver md:hidden">
                          {book.pitch}
                        </p>
                      </article>
                    ))}
                  </div>
                  {/* shelf line — the literary touch */}
                  <div className="mt-4 h-px w-full bg-gradient-to-r from-transparent via-border-warm to-transparent dark:via-dark-surface" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── HOW THE ANALYSIS WORKS ─── */}
      <section className="bg-near-black px-6 py-24 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] md:px-10 md:py-32 dark:bg-[#0b0b0a]">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-warm-silver">
              {t('landing.section.how', 'كيف يعمل التحليل')}
            </p>
            <h2 className="mt-3 font-serif text-3xl font-medium leading-[1.2] text-ivory md:text-[52px]">
              {t('landing.howHeadline', 'المنتج كاملًا في صفحة واحدة.')}
            </h2>
            <p className="mt-5 max-w-xl font-serif text-lg leading-[1.6] text-warm-silver">
              {t(
                'landing.howSubhead',
                'صفحة الكتاب إلى اليمين، ومساعد القراءة إلى اليسار — تسأل فيجيبك مستشهدًا بالنص.'
              )}
            </p>
          </div>

          <div className="mt-14 grid gap-8 md:grid-cols-[1.3fr_1fr]">
            {/* Book page miniature */}
            <div className="overflow-hidden rounded-2xl border border-dark-surface bg-[#1a1715] p-8 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)]">
              <div className="mb-4 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-warm-silver/60">
                <span>{t('landing.how.pageLabel', 'صفحة ٤٧')}</span>
                <span>{t('landing.how.chapterLabel', 'الفصل الثالث')}</span>
              </div>
              <article className="space-y-3 font-serif text-[15px] leading-[1.85] text-warm-silver">
                <p>
                  {t(
                    'landing.how.sample1',
                    'وإذا تأمّلتَ أحوال العمران الحضريّ رأيتَه يتدرّج على سنن ثابتة تجمع بين بداوة الأصل وتعقيد الدولة.'
                  )}
                </p>
                <p className="rounded bg-terracotta/15 px-2 py-1 ring-1 ring-terracotta/30">
                  <span className="bg-terracotta/30 text-ivory">
                    {t(
                      'landing.how.sampleHighlight',
                      'فالعصبية قاعدة الملك، ومتى انفكّت فَقَد الملكُ عموده الأول.'
                    )}
                  </span>
                </p>
                <p>
                  {t(
                    'landing.how.sample2',
                    'ثم إن لأطوار الدولة أعمارًا محدودة كأعمار الأشخاص، ولكل طور منها شواهد تُعرف بها.'
                  )}
                </p>
              </article>
            </div>

            {/* AI sidebar miniature */}
            <div className="flex flex-col gap-3 rounded-2xl border border-dark-surface bg-[#1a1715] p-6 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)]">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-terracotta/20 text-terracotta">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M12 2l2.2 6.8H21l-5.4 4 2.1 6.8L12 15.8 6.3 19.6l2.1-6.8L3 8.8h6.8z" fill="currentColor" />
                  </svg>
                </span>
                <span className="font-sans text-xs font-medium uppercase tracking-[0.18em] text-warm-silver">
                  {t('landing.how.assistant', 'مساعد القراءة')}
                </span>
              </div>

              {howItWorks.map((item, i) => (
                <div
                  key={item.title}
                  className={`rounded-xl border p-3.5 ${
                    i === 0
                      ? 'border-terracotta/40 bg-terracotta/10'
                      : 'border-dark-surface bg-[#141413]/60 hover:border-terracotta/30'
                  } transition-colors`}
                >
                  <p className="font-serif text-[15px] text-ivory">{item.title}</p>
                  <p className="mt-1.5 font-sans text-[12px] leading-[1.55] text-warm-silver">
                    {item.text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── LIBRARY SCALE STATS ─── */}
      <section className="px-6 py-20 md:px-10 md:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-xl">
              <p className={overline}>{t('landing.section.trust', 'مقياس المكتبة')}</p>
              <h2 className="mt-3 font-serif text-3xl font-medium leading-[1.2] text-near-black dark:text-ivory md:text-[44px]">
                {t('landing.trustHeadline', 'أرقام تُذكر بهدوء، لا بضوضاء.')}
              </h2>
            </div>
            <p className="max-w-sm font-sans text-sm leading-[1.65] text-olive-gray dark:text-warm-silver">
              {t(
                'landing.trustSubhead',
                'كل كتاب مُفهرس يدويًا قبل أن يدخل محرك البحث، لذلك تأتي النتائج مسندة.'
              )}
            </p>
          </div>

          <dl className="mt-12 grid gap-px overflow-hidden rounded-2xl bg-border-cream dark:bg-dark-surface md:grid-cols-4">
            {trustStats.map((stat) => (
              <div key={stat.label} className="bg-ivory p-8 dark:bg-near-black">
                <dd className="font-serif text-4xl font-medium leading-none text-near-black dark:text-ivory md:text-5xl">
                  {stat.value}
                </dd>
                <dt className="mt-3 font-sans text-sm text-olive-gray dark:text-warm-silver">{stat.label}</dt>
                <dd className="mt-3 border-t border-border-cream pt-3 font-sans text-xs leading-[1.55] text-stone-gray dark:border-dark-surface dark:text-warm-silver/75">
                  {stat.detail}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ─── TESTIMONIALS ─── */}
      <section className="border-t border-border-cream px-6 py-24 md:px-10 md:py-28 dark:border-dark-surface">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <p className={overline}>{t('landing.section.testimonials', 'أصوات القرّاء')}</p>
            <h2 className="mt-3 font-serif text-3xl font-medium leading-[1.2] text-near-black dark:text-ivory md:text-[44px]">
              {t('landing.testimonialsHeadline', 'قرّاء وباحثون — لحظات يحكون فيها ما وجدوه.')}
            </h2>
            <p className="mt-4 max-w-xl font-sans text-sm leading-[1.65] text-olive-gray dark:text-warm-silver">
              {t('landing.testimonialsNote', 'قصص استخدام تمثيلية توضّح ما يفعله القرّاء داخل المنصة.')}
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {testimonials.map((item) => (
              <figure
                key={item.author}
                className="flex flex-col rounded-2xl border border-border-cream bg-ivory p-7 shadow-whisper dark:border-dark-surface dark:bg-dark-surface"
              >
                <span aria-hidden className="font-serif text-5xl leading-none text-terracotta">&ldquo;</span>
                <blockquote className="mt-2 flex-1 font-serif text-[17px] leading-[1.65] text-near-black dark:text-ivory">
                  {item.quote}
                </blockquote>
                <figcaption className="mt-6 font-sans text-[13px] text-olive-gray dark:text-warm-silver">
                  {item.author}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* ─── PRICING ─── */}
      <section className="border-t border-border-cream px-6 py-20 md:px-10 md:py-24 dark:border-dark-surface">
        <div className="mx-auto max-w-5xl">
          <div className="max-w-2xl">
            <p className={overline}>{t('landing.section.pricing', 'التسعير')}</p>
            <h2 className="mt-3 font-serif text-3xl font-medium leading-[1.2] text-near-black dark:text-ivory md:text-[44px]">
              {t('landing.pricingHeadline', 'صادقون بشأن ما هو مجاني.')}
            </h2>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            <article className="rounded-2xl border border-border-cream bg-ivory p-8 shadow-whisper dark:border-dark-surface dark:bg-dark-surface">
              <p className={overline}>{t('landing.pricing.free.tag', 'مجاني — دائمًا')}</p>
              <h3 className="mt-3 font-serif text-[32px] font-medium text-near-black dark:text-ivory">
                {t('landing.pricing.free.title', 'الكتب في النطاق العام')}
              </h3>
              <p className="mt-3 font-sans text-sm leading-[1.65] text-olive-gray dark:text-warm-silver">
                {t(
                  'landing.pricing.free.desc',
                  'القراءة، البحث الدلالي، والملاحظات — مجانية تمامًا لكل ما سقطت عنه الحقوق.'
                )}
              </p>
              <Link href={localizedPath('/documents')} className={`mt-6 ${secondaryCta}`}>
                {t('landing.pricing.free.cta', 'تصفح المجاني الآن')}
              </Link>
            </article>
            <article className="relative overflow-hidden rounded-2xl border border-terracotta/30 bg-gradient-to-br from-terracotta/10 to-transparent p-8 dark:from-terracotta/20">
              <p className={`${overline} text-terracotta`}>
                {t('landing.pricing.pro.tag', 'للباحث — قريبًا')}
              </p>
              <h3 className="mt-3 font-serif text-[32px] font-medium text-near-black dark:text-ivory">
                {t('landing.pricing.pro.title', 'مكتبة علم — للمحقّقين')}
              </h3>
              <p className="mt-3 font-sans text-sm leading-[1.65] text-olive-gray dark:text-warm-silver">
                {t(
                  'landing.pricing.pro.desc',
                  'نسخ محققة مرخّصة، تصدير اقتباسات، وتعاون بحثي. سعر شفاف، بدون عقود خفية.'
                )}
              </p>
              <button
                type="button"
                disabled
                className="mt-6 inline-flex cursor-not-allowed items-center justify-center rounded-xl border border-terracotta/40 bg-terracotta/10 px-6 py-3 text-sm font-medium text-terracotta"
              >
                {t('landing.pricing.pro.cta', 'قائمة الانتظار قريبًا')}
              </button>
            </article>
          </div>
        </div>
      </section>

      {/* ─── FINAL CTA (dark) ─── */}
      <section className="bg-near-black px-6 py-24 md:px-10 md:py-32 dark:bg-[#0f0f0e]">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="font-serif text-3xl font-medium leading-[1.15] text-ivory md:text-[52px]">
            {t('landing.section.finalCta', 'ابدأ رحلتك مع النصوص النادرة.')}
          </h2>
          <p className="mx-auto mt-6 max-w-xl font-serif text-lg leading-[1.6] text-warm-silver">
            {t(
              'landing.finalText',
              'ابنِ مكتبتك الخاصة من الكتب التي لم تأخذ حقها من النشر بعد.'
            )}
          </p>
          <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href={localizedPath('/documents')} className={`${invertedCta} w-full sm:w-auto`}>
              {t('landing.ctaPrimary', 'ادخل إلى المكتبة')}
            </Link>
            {!isLoading && !isAuthenticated && (
              <Link href={localizedPath('/auth/register')} className={`${darkSecondaryCta} w-full sm:w-auto`}>
                {t('landing.ctaTertiary', 'أنشئ حسابًا مجانيًا')}
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="border-t border-border-cream px-6 py-16 md:px-10 dark:border-dark-surface">
        <div className="mx-auto max-w-6xl">
          <blockquote className="max-w-2xl font-serif text-xl leading-[1.5] text-near-black dark:text-ivory md:text-2xl">
            {t(
              'landing.footer.quote',
              '«إنّ الكتبَ جنّاتٌ في القلوب، ورياضٌ في الصدور» — الجاحظ'
            )}
          </blockquote>

          <div className="mt-12 grid gap-10 md:grid-cols-[1.2fr_1fr_1fr_1fr]">
            <div>
              <p className="font-serif text-xl font-medium text-near-black dark:text-ivory">
                {t('brand.word1', 'مكتبة')} <span className="text-terracotta">{t('brand.word2', 'علم')}</span>
              </p>
              <p className="mt-3 max-w-xs font-sans text-sm leading-[1.65] text-olive-gray dark:text-warm-silver">
                {t('landing.footer.about', 'منصة للقراءة والبحث الدلالي في الكتب والمخطوطات النادرة.')}
              </p>
            </div>

            <div>
              <p className={overline}>{t('landing.footer.browse', 'تصفّح')}</p>
              <ul className="mt-4 space-y-2 font-sans text-sm">
                <li><Link href={localizedPath('/documents')} className="text-charcoal-warm transition-colors hover:text-terracotta dark:text-warm-silver">{t('nav.documents', 'المكتبة')}</Link></li>
                <li><Link href={localizedPath('/upload')} className="text-charcoal-warm transition-colors hover:text-terracotta dark:text-warm-silver">{t('nav.upload', 'رفع كتاب')}</Link></li>
              </ul>
            </div>

            <div>
              <p className={overline}>{t('landing.footer.account', 'الحساب')}</p>
              <ul className="mt-4 space-y-2 font-sans text-sm">
                {!isLoading && !isAuthenticated ? (
                  <>
                    <li><Link href={localizedPath('/auth/login')} className="text-charcoal-warm transition-colors hover:text-terracotta dark:text-warm-silver">{t('nav.signIn', 'تسجيل الدخول')}</Link></li>
                    <li><Link href={localizedPath('/auth/register')} className="text-charcoal-warm transition-colors hover:text-terracotta dark:text-warm-silver">{t('nav.getStarted', 'ابدأ الآن')}</Link></li>
                  </>
                ) : (
                  <li><Link href={localizedPath('/profile')} className="text-charcoal-warm transition-colors hover:text-terracotta dark:text-warm-silver">{t('nav.profile', 'الملف الشخصي')}</Link></li>
                )}
              </ul>
            </div>

            <div>
              <p className={overline}>{t('landing.footer.language', 'اللغات')}</p>
              <ul className="mt-4 space-y-2 font-sans text-sm text-olive-gray dark:text-warm-silver">
                <li>{t('nav.locale.ar', 'العربية')}</li>
                <li>{t('nav.locale.en', 'الإنجليزية')}</li>
                <li>{t('nav.locale.fa', 'الفارسية')}</li>
                <li>{t('nav.locale.ur', 'الأوردية')}</li>
              </ul>
            </div>
          </div>

          <div className="mt-12 flex flex-col items-start justify-between gap-2 border-t border-border-cream pt-6 font-sans text-xs text-stone-gray md:flex-row dark:border-dark-surface">
            <span>
              {t('landing.footer.tagline', '{year} © مكتبة علم — منصة الكتب والمخطوطات النادرة', { year })}
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-terracotta" aria-hidden />
              {t('landing.footer.madeWith', 'صُنعت بعناية للقرّاء.')}
            </span>
          </div>
        </div>
      </footer>
    </main>
  );
}
