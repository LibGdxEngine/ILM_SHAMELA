'use client';

import Link from 'next/link';

import { useI18n } from '@/components/i18n/I18nProvider';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import { toLocaleDigits } from '@/lib/utils';

interface LibraryHeroProps {
  count: number;
  topicsCount: number;
}

const CROSS_BOOK_THRESHOLD = 10;

function UploadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

export default function LibraryHero({ count, topicsCount }: LibraryHeroProps) {
  const { t, locale } = useI18n();
  const localizedPath = useLocalizedPath();

  const isEmpty = count === 0;
  const isGrowing = count > 0 && count < CROSS_BOOK_THRESHOLD;

  let headline: string;
  let subtext: string;
  let cta: string;
  let progressHint: string | null = null;

  if (isEmpty) {
    headline = t('docs.hero.empty.headline', 'ابدأ مكتبتك.');
    subtext = t('docs.hero.empty.subtext', 'ارفع كتابك الأوّل لتبدأ القراءة مع علم.');
    cta = t('docs.hero.empty.cta', 'ارفع كتابك الأوّل');
  } else if (isGrowing) {
    headline = t('docs.hero.growing.headline', 'مكتبتك تنمو.');
    subtext = t('docs.hero.growing.subtext', '{n} كتب جاهزة. كلّما رفعت أكثر، أصبحت إجابات علم أعمق.', {
      n: toLocaleDigits(count, locale),
    });
    cta = t('docs.hero.growing.cta', 'أضف كتاباً');
    const remaining = CROSS_BOOK_THRESHOLD - count;
    progressHint = t('docs.hero.growing.progressHint', 'أنت على بُعد {n} كتب من تفعيل البحث المتقاطع ✦', {
      n: toLocaleDigits(remaining, locale),
    });
  } else {
    headline = t('docs.hero.full.headline', 'مكتبتك.');
    subtext = t('docs.hero.full.subtext', '{n} كتاباً · {k} مواضيع', {
      n: toLocaleDigits(count, locale),
      k: toLocaleDigits(topicsCount, locale),
    });
    cta = t('docs.hero.full.cta', 'أضف كتاباً');
  }

  return (
    <section className="pt-10 sm:pt-14 pb-7 border-b border-border">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-5">
        <div className="min-w-0">
          <h1
            className="font-reem-kufi font-semibold text-text leading-[1.05] tracking-tight"
            style={{ fontSize: 'clamp(36px, 4vw, 56px)' }}
          >
            {headline}
          </h1>
          <p className="mt-3 text-[14.5px] text-text-2 leading-[1.7] max-w-xl">
            {subtext}
          </p>
          {progressHint && (
            <p className="mt-1.5 inline-flex items-center gap-1.5 text-[12.5px] text-accent-2 font-fraunces">
              {progressHint}
            </p>
          )}
        </div>

        <div className="flex-shrink-0">
          <Link
            href={localizedPath('/upload')}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-b from-accent-2 to-accent text-white text-[13.5px] font-medium px-5 h-11 shadow-[0_4px_20px_-4px_rgba(185,115,64,0.45),inset_0_1px_0_rgba(255,255,255,0.22)] hover:-translate-y-[1px] hover:shadow-[0_10px_30px_-6px_rgba(185,115,64,0.6),inset_0_1px_0_rgba(255,255,255,0.28)] transition-all"
          >
            <UploadIcon />
            {cta}
          </Link>
        </div>
      </div>
    </section>
  );
}
