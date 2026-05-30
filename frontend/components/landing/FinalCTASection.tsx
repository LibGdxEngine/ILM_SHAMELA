"use client";

import Link from "next/link";
import { motion } from "framer-motion";

import { useI18n } from "@/components/i18n/I18nProvider";

const FadeIn = ({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: "-10%" }}
    transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1], delay }}
    className={className}
  >
    {children}
  </motion.div>
);

type Props = {
  startReadingHref: string;
  documentsHref: string;
};

export default function FinalCTASection({
  startReadingHref,
  documentsHref,
}: Props) {
  const { t } = useI18n();

  return (
    <section
      id="cta"
      dir="rtl"
      lang="ar"
      className="relative py-40 px-6 overflow-hidden bg-[var(--cream-base)]"
    >
      {/* warmth glow */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div
          className="w-[800px] h-[800px] rounded-full blur-3xl"
          style={{ backgroundColor: "rgba(185,115,64,0.04)" }}
        />
      </div>

      <FadeIn className="relative max-w-3xl mx-auto text-center">
        <div className="text-[var(--accent)] text-[22px] leading-none mb-6">✦</div>

        <h2 className="font-reem-kufi font-semibold text-[clamp(48px,6vw,88px)] leading-[1.05] tracking-tight text-[var(--ink)] max-w-[18ch] mx-auto">
          {t("home.cta.title", "ابدأ من حيث تأخذك أسئلتك.")}
        </h2>

        <p className="mt-7 text-[18px] leading-relaxed text-[var(--ink-muted)] font-body-ar">
          {t(
            "home.cta.body",
            "حساب يعمل في أقلّ من دقيقة. بدون بطاقة. أوّل ١٢٬٠٠٠ صفحة بانتظارك."
          )}
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href={startReadingHref}
            className="inline-flex items-center justify-center h-14 px-8 rounded-[28px] bg-[var(--accent)] text-white text-[16px] font-medium font-body-ar shadow-[0_8px_20px_-8px_rgba(185,115,64,0.55)] transition-all hover:-translate-y-[1px] hover:bg-[#a86432]"
          >
            {t("home.cta.start", "ابدأ القراءة — مجانًا")}
          </Link>
          <Link
            href={documentsHref}
            className="inline-flex items-center justify-center h-14 px-8 rounded-[28px] bg-transparent text-[var(--warm-deep)] text-[16px] font-medium font-body-ar border-[1.5px] border-[var(--border-warm-soft)] transition-all hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            {t("home.cta.browse", "تصفّح المكتبة")}
          </Link>
        </div>

        <p className="mt-10 text-[14px] text-[var(--ink-muted)] font-body-ar">
          {t(
            "home.cta.fineprintV2",
            "بدون بطاقة  ·  بدون إزعاج  ·  لا تدريب على قراءاتك"
          )}
        </p>
      </FadeIn>
    </section>
  );
}
