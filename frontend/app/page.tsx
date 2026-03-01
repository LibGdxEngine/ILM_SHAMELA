'use client';

import Image from 'next/image';
import Link from 'next/link';

import { useAuth } from '@/lib/AuthContext';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import { useI18n } from '@/components/i18n/I18nProvider';

export default function Home() {
  const localizedPath = useLocalizedPath();
  const { t } = useI18n();
  const { isAuthenticated, isLoading } = useAuth();
  const year = new Date().getFullYear();

  const valueCards = [
    {
      title: t('landing.values.rare.title', 'اكتشاف نادر'),
      description: t('landing.values.rare.description', 'نصوص مخطوطة وكتب مجهولة التداول، مرتبة لتصل إلى ما تبحث عنه بسرعة.'),
      icon: (
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <path d="M16 2L20 12L30 16L20 20L16 30L12 20L2 16L12 12Z" fill="#C8A86B" opacity="0.7"/>
          <path d="M16 2L20 12L30 16L20 20L16 30L12 20L2 16L12 12Z" fill="#C8A86B" opacity="0.4" transform="rotate(22.5,16,16)"/>
        </svg>
      ),
    },
    {
      title: t('landing.values.focused.title', 'قراءة مركزة'),
      description: t('landing.values.focused.description', 'واجهة قراءة هادئة تدعم البحث داخل الكتاب والتنقل الدقيق بين الصفحات.'),
      icon: (
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <path d="M4 6C4 6 10 4 16 4C22 4 28 6 28 6V28C28 28 22 26 16 26C10 26 4 28 4 28V6Z" stroke="#C8A86B" strokeWidth="2" fill="none"/>
          <path d="M16 4V26" stroke="#C8A86B" strokeWidth="1.5"/>
          <path d="M8 10H14" stroke="#C8A86B" strokeWidth="1" opacity="0.5"/>
          <path d="M8 14H13" stroke="#C8A86B" strokeWidth="1" opacity="0.5"/>
          <path d="M18 10H24" stroke="#C8A86B" strokeWidth="1" opacity="0.5"/>
          <path d="M18 14H23" stroke="#C8A86B" strokeWidth="1" opacity="0.5"/>
        </svg>
      ),
    },
    {
      title: t('landing.values.organized.title', 'تنظيم معرفي'),
      description: t('landing.values.organized.description', 'تصنيفات ومؤلفون وعناوين بديلة تساعدك على بناء مكتبة بحثية متماسكة.'),
      icon: (
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <rect x="4" y="8" width="8" height="20" rx="2" stroke="#C8A86B" strokeWidth="1.5" fill="none"/>
          <rect x="14" y="5" width="8" height="23" rx="2" stroke="#C8A86B" strokeWidth="1.5" fill="none"/>
          <rect x="24" y="10" width="4" height="18" rx="1" stroke="#C8A86B" strokeWidth="1.5" fill="none"/>
          <path d="M6 12H10" stroke="#C8A86B" strokeWidth="1" opacity="0.5"/>
          <path d="M16 9H20" stroke="#C8A86B" strokeWidth="1" opacity="0.5"/>
        </svg>
      ),
    },
  ];

  const journeySteps = [
    {
      number: '01',
      title: t('landing.journey.step1.title', 'ابنِ مكتبتك'),
      text: t('landing.journey.step1.text', 'ارفع الكتاب مع بياناته الأساسية ليدخل مباشرة في مسار الفهرسة.'),
    },
    {
      number: '02',
      title: t('landing.journey.step2.title', 'افتح النص'),
      text: t('landing.journey.step2.text', 'انتقل بين الصفحات، أضف ملاحظاتك، واحفظ المواضع المهمة للعودة إليها.'),
    },
    {
      number: '03',
      title: t('landing.journey.step3.title', 'استخرج الفائدة'),
      text: t('landing.journey.step3.text', 'ابحث داخل المحتوى ووثّق نتائجك مع رؤية أوضح لعلاقتك بالنص.'),
    },
  ];

  const featuredCategories = [
    t('landing.categories.item1', 'مخطوطات تاريخية'),
    t('landing.categories.item2', 'فقه وأصول'),
    t('landing.categories.item3', 'لغة وبلاغة'),
    t('landing.categories.item4', 'فلسفة وفكر'),
    t('landing.categories.item5', 'تراجم وسير'),
    t('landing.categories.item6', 'علوم الحضارة'),
  ];

  const testimonials = [
    {
      quote: t('landing.testimonials.item1.quote', 'لأول مرة أقرأ مخطوطات غير متاحة في النشر التجاري ضمن تجربة رقمية مريحة فعلًا.'),
      author: t('landing.testimonials.item1.author', 'باحثة في التراث - الرياض'),
    },
    {
      quote: t('landing.testimonials.item2.quote', 'تنظيم الملاحظات مع البحث داخل النص وفّر علي ساعات طويلة أثناء التحضير العلمي.'),
      author: t('landing.testimonials.item2.author', 'طالب دراسات عليا - القاهرة'),
    },
    {
      quote: t('landing.testimonials.item3.quote', 'الواجهة العربية والاتجاه من اليمين لليسار تجعل القراءة طبيعية دون أي تشويش بصري.'),
      author: t('landing.testimonials.item3.author', 'قارئ مستقل - الدوحة'),
    },
  ];

  return (
    <main className="relative overflow-hidden pb-0">
      {/* Background ambient gradients */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_85%_5%,rgba(172,121,43,0.23),transparent_30%),radial-gradient(circle_at_10%_0%,rgba(16,90,78,0.22),transparent_35%)]" />

      {/* Floating geometric star ornaments in background */}
      <div className="pointer-events-none absolute inset-0 -z-[5] overflow-hidden" aria-hidden="true">
        <div className="star-ornament float-slow" style={{ top: '8%', right: '12%', width: 32, height: 32, opacity: 0.1 }} />
        <div className="star-ornament float-medium" style={{ top: '25%', left: '5%', width: 20, height: 20, opacity: 0.08 }} />
        <div className="star-ornament float-slow" style={{ top: '55%', right: '8%', width: 28, height: 28, opacity: 0.07, animationDelay: '2s' }} />
        <div className="star-ornament float-medium" style={{ top: '70%', left: '10%', width: 24, height: 24, opacity: 0.06, animationDelay: '3s' }} />
        <div className="star-ornament float-slow" style={{ top: '85%', right: '20%', width: 18, height: 18, opacity: 0.08, animationDelay: '1s' }} />
      </div>

      {/* ═══ HERO SECTION ═══ */}
      <section className="px-6 pb-12 pt-14 md:px-10 md:pt-20">
        <div className="mx-auto grid max-w-7xl gap-8 rounded-[2.2rem] border border-amber-200/80 bg-[#fffaf0] p-6 shadow-[0_30px_80px_rgba(101,69,19,0.12)] md:grid-cols-2 md:p-10 geo-corner relative">
          <div className="flex flex-col justify-center">
            {/* بسم الله decorative ribbon */}
            <p className="inline-flex w-fit items-center gap-2 rounded-full border border-amber-300 bg-amber-100/70 px-4 py-1 text-xs font-bold text-amber-900">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="opacity-60">
                <path d="M7 0L9 5L14 7L9 9L7 14L5 9L0 7L5 5Z" fill="#92400e"/>
              </svg>
              {t('landing.badge', 'مكتبة علم')}
            </p>
            <h1 className="mt-5 text-4xl font-black leading-tight text-stone-900 md:text-6xl">
              {t('landing.heroTitle', 'كتب لم تُنشر من قبل، الآن بين يديك')}
            </h1>
            <p className="mt-6 max-w-xl text-base leading-8 text-stone-700 md:text-lg">
              {t(
                'landing.heroSubtitle',
                'اكتشف مخطوطات نادرة وقراءات أصيلة، بتجربة عربية مصممة للباحث والقارئ الشغوف.'
              )}
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href={localizedPath('/documents')}
                className="rounded-xl bg-amber-700 px-6 py-3 text-sm font-semibold text-white transition hover:bg-amber-800"
              >
                {t('landing.ctaPrimary', 'ادخل إلى المكتبة')}
              </Link>
              <Link
                href={localizedPath('/upload')}
                className="rounded-xl border border-amber-300 bg-white px-6 py-3 text-sm font-semibold text-amber-900 transition hover:border-amber-500"
              >
                {t('landing.ctaSecondary', 'ارفع مخطوطتك')}
              </Link>
              {!isLoading && !isAuthenticated && (
                <Link
                  href={localizedPath('/auth/register')}
                  className="rounded-xl border border-transparent px-4 py-3 text-sm font-semibold text-stone-600 transition hover:text-stone-900"
                >
                  {t('landing.ctaTertiary', 'أنشئ حسابًا')}
                </Link>
              )}
            </div>
          </div>

          <div className="relative min-h-[320px] overflow-hidden rounded-3xl border border-amber-200 bg-[#f8ecd2] glow-amber">
            <Image
              src="/images/landing/hero-manuscript.svg"
              alt={t('landing.alt.heroManuscript', 'مخطوطة نادرة')}
              fill
              className="object-cover"
              priority
            />
          </div>
        </div>
      </section>

      {/* ═══ Ornamental divider ═══ */}
      <div className="ornamental-divider mx-auto max-w-7xl px-6 md:px-10">
        <span className="ornamental-divider-symbol" />
      </div>

      {/* ═══ VALUE CARDS ═══ */}
      <section className="section-reveal mx-auto grid max-w-7xl gap-4 px-6 md:grid-cols-3 md:px-10">
        {valueCards.map((card, i) => (
          <article
            key={card.title}
            className="arabesque-border rounded-2xl bg-white/90 p-6 shadow-[0_10px_30px_rgba(0,0,0,0.06)] transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
            style={{ animationDelay: `${i * 0.12}s` }}
          >
            <div className="mb-3 opacity-60">{card.icon}</div>
            <h2 className="text-xl font-bold text-stone-900">{card.title}</h2>
            <p className="mt-3 text-sm leading-7 text-stone-700">{card.description}</p>
          </article>
        ))}
      </section>

      {/* ═══ SPOTLIGHT SECTION ═══ */}
      <section className="section-reveal mx-auto mt-14 grid max-w-7xl gap-8 px-6 md:grid-cols-[1.1fr_1fr] md:px-10">
        <div className="relative rounded-3xl border border-teal-900/20 bg-[#113a34] p-7 text-white islamic-pattern-bg-dark">
          {/* Decorative Islamic header ornament */}
          <div className="mb-4 flex items-center gap-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="opacity-40">
              <path d="M12 0L15 9L24 12L15 15L12 24L9 15L0 12L9 9Z" fill="#14b8a6"/>
            </svg>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-teal-200">
              {t('landing.section.spotlight', 'مخطوطة اليوم')}
            </p>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="opacity-40">
              <path d="M12 0L15 9L24 12L15 15L12 24L9 15L0 12L9 9Z" fill="#14b8a6"/>
            </svg>
          </div>
          <h3 className="mt-3 text-3xl font-black leading-tight">{t('landing.spotlight.title', 'الرحلة المغربية في وصف خزائن العلم')}</h3>
          <p className="mt-4 text-sm leading-8 text-teal-100">
            {t('landing.spotlight.description', 'نص رحلي يتتبع مسارات الكتب بين المدن القديمة، ويكشف عن عناوين لم تصل إلى النشر الحديث.')}
          </p>
          <ul className="mt-6 space-y-2 text-sm text-teal-50">
            <li className="flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-teal-400" />
              {t('landing.spotlight.statPages', '312 صفحة محققة رقميًا.')}
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-teal-400" />
              {t('landing.spotlight.statBookmarks', '27 إشارة مرجعية لحواشٍ نادرة.')}
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-teal-400" />
              {t('landing.spotlight.statTopics', '8 موضوعات رئيسية قابلة للتصفية.')}
            </li>
          </ul>
        </div>
        <div className="relative min-h-[360px] overflow-hidden rounded-3xl border border-teal-200/70 bg-[#cde3dc] geo-corner glow-teal">
          <Image src="/images/landing/spotlight-scroll.svg" alt={t('landing.alt.spotlight', 'مخطوطة اليوم')} fill className="object-cover" />
        </div>
      </section>

      {/* ═══ Ornamental divider ═══ */}
      <div className="ornamental-divider mx-auto mt-14 max-w-7xl px-6 md:px-10">
        <span className="ornamental-divider-symbol" />
      </div>

      {/* ═══ JOURNEY SECTION ═══ */}
      <section className="section-reveal mx-auto max-w-7xl px-6 md:px-10">
        <div className="grid gap-6 rounded-3xl border border-stone-200 bg-white p-7 md:grid-cols-[1fr_1.1fr]">
          <div className="relative min-h-[320px] overflow-hidden rounded-2xl border border-amber-200 bg-[#f5e8cb] glow-amber">
            <Image src="/images/landing/journey-reading.svg" alt={t('landing.alt.journey', 'رحلة القراءة')} fill className="object-cover" />
          </div>
          <div>
            <h3 className="text-2xl font-black text-stone-900">{t('landing.section.journey', 'رحلة القارئ')}</h3>
            <div className="mt-5 space-y-4">
              {journeySteps.map((step, i) => (
                <div key={step.number} className="relative flex gap-4 items-start">
                  {/* Connecting line between steps */}
                  {i < journeySteps.length - 1 && (
                    <div className="journey-connector" />
                  )}
                  {/* Medallion number */}
                  <div className="medallion">{step.number}</div>
                  <div className="flex-1 rounded-xl border border-stone-200 bg-stone-50 p-4">
                    <p className="text-lg font-bold text-stone-900">{step.title}</p>
                    <p className="mt-2 text-sm leading-7 text-stone-700">{step.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══ CATEGORIES SECTION ═══ */}
      <section className="section-reveal mx-auto mt-14 max-w-7xl px-6 md:px-10">
        <div className="relative grid gap-6 rounded-3xl border border-amber-200 bg-[#fff6e3] p-7 md:grid-cols-[1fr_1fr] islamic-pattern-bg overflow-hidden">
          <div>
            <h3 className="text-2xl font-black text-stone-900">
              {t('landing.section.categories', 'تصنيفات مختارة')}
            </h3>
            <p className="mt-3 max-w-lg text-sm leading-8 text-stone-700">
              {t('landing.categories.description', 'ابدأ من المجال الذي يهمك، ثم توسع إلى عناوين مرتبطة تقودك إلى نصوص لا تظهر في المكتبات التقليدية.')}
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              {featuredCategories.map((category) => (
                <div key={category} className="category-chip cursor-default rounded-xl border border-amber-300 bg-white px-4 py-3 text-sm font-semibold text-stone-800">
                  {category}
                </div>
              ))}
            </div>
          </div>

          <div className="relative min-h-[320px] overflow-hidden rounded-2xl border border-amber-300 bg-[#153c36]">
            <Image src="/images/landing/categories-arch.svg" alt={t('landing.alt.categories', 'تصنيفات مكتبة علم')} fill className="object-cover" />
          </div>
        </div>
      </section>

      {/* ═══ TRUST / STATS SECTION ═══ */}
      <section className="section-reveal mx-auto mt-14 max-w-7xl px-6 md:px-10">
        <div className="relative rounded-3xl border border-teal-200 bg-white p-7 islamic-pattern-bg overflow-hidden">
          <h3 className="text-2xl font-black text-stone-900">{t('landing.section.trust', 'موثوقية المنصة')}</h3>
          <div className="mt-6 grid gap-4 md:grid-cols-4">
            <div className="stat-frame rounded-xl bg-teal-50 p-4 text-teal-900">
              <p className="text-3xl font-black">+12k</p>
              <p className="mt-2 text-xs font-semibold text-teal-700">{t('landing.trust.indexedPages', 'صفحة نصية مفهرسة')}</p>
            </div>
            <div className="stat-frame rounded-xl bg-amber-50 p-4 text-amber-900">
              <p className="text-3xl font-black">98%</p>
              <p className="mt-2 text-xs font-semibold text-amber-700">{t('landing.trust.processingSuccess', 'نجاح معالجة المستندات')}</p>
            </div>
            <div className="stat-frame rounded-xl bg-stone-100 p-4 text-stone-900">
              <p className="text-3xl font-black">24/7</p>
              <p className="mt-2 text-xs font-semibold text-stone-700">{t('landing.trust.access', 'وصول مستمر للمكتبة')}</p>
            </div>
            <div className="stat-frame rounded-xl bg-teal-50 p-4 text-teal-900">
              <p className="text-3xl font-black">5.0</p>
              <p className="mt-2 text-xs font-semibold text-teal-700">{t('landing.trust.rating', 'تقييم تجربة القراءة')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ TESTIMONIALS ═══ */}
      <section className="section-reveal mx-auto mt-14 max-w-7xl px-6 md:px-10">
        <h3 className="text-2xl font-black text-stone-900">{t('landing.section.testimonials', 'آراء القرّاء')}</h3>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {testimonials.map((item, i) => (
            <figure
              key={item.author}
              className="rounded-2xl border border-stone-200 bg-white p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
              style={{ animationDelay: `${i * 0.1}s` }}
            >
              <div className="arabic-quote">
                <blockquote className="text-sm leading-8 text-stone-700">
                  {item.quote}
                </blockquote>
              </div>
              <figcaption className="mt-4 text-xs font-bold text-amber-700">{item.author}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* ═══ FINAL CTA ═══ */}
      <section className="section-reveal mx-auto mt-14 max-w-7xl px-6 md:px-10">
        <div className="relative rounded-3xl border border-amber-300 bg-gradient-to-l from-[#f8e8c2] to-[#fdf5df] p-8 text-center geo-corner overflow-hidden">
          {/* Floating decorative elements */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
            <div className="star-ornament float-slow" style={{ top: '15%', right: '10%', width: 24, height: 24, opacity: 0.12 }} />
            <div className="star-ornament float-medium" style={{ bottom: '20%', left: '8%', width: 20, height: 20, opacity: 0.1, animationDelay: '1.5s' }} />
          </div>
          <h3 className="text-3xl font-black text-stone-900">
            {t('landing.section.finalCta', 'ابدأ رحلتك مع النصوص النادرة')}
          </h3>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-8 text-stone-700">
            {t(
              'landing.finalText',
              'ابنِ مكتبتك الخاصة من الكتب التي لم تأخذ حقها من النشر بعد.'
            )}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {!isLoading && !isAuthenticated && (
              <Link
                href={localizedPath('/auth/register')}
                className="rounded-xl bg-teal-700 px-6 py-3 text-sm font-semibold text-white transition hover:bg-teal-800"
              >
                {t('landing.ctaTertiary', 'أنشئ حسابًا')}
              </Link>
            )}
            <Link
              href={localizedPath('/documents')}
              className="rounded-xl border border-stone-300 bg-white px-6 py-3 text-sm font-semibold text-stone-800 transition hover:border-teal-600 hover:text-teal-700"
            >
              {t('landing.ctaPrimary', 'ادخل إلى المكتبة')}
            </Link>
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="mx-auto mt-14 max-w-7xl px-6 pb-10 md:px-10">
        <div className="footer-divider" />
        <div className="flex flex-col items-center gap-3 text-center">
          {/* Brand with geometric ornament */}
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="opacity-30">
              <path d="M8 0L10 6L16 8L10 10L8 16L6 10L0 8L6 6Z" fill="#C8A86B"/>
            </svg>
            <p className="text-lg font-bold text-stone-800">{t('landing.badge', 'مكتبة علم')}</p>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="opacity-30">
              <path d="M8 0L10 6L16 8L10 10L8 16L6 10L0 8L6 6Z" fill="#C8A86B"/>
            </svg>
          </div>
          <p className="text-xs text-stone-500">
            {t('landing.footer.tagline', '{year} © مكتبة علم — منصة الكتب والمخطوطات النادرة', { year })}
          </p>
        </div>
      </footer>
    </main>
  );
}
