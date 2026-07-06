"use client";

import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";

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

export default function HowItWorksSection() {
  const { t } = useI18n();

  return (
    <section
      id="how"
      dir="rtl"
      lang="ar"
      className="py-32 px-6 bg-[var(--cream-base)]"
    >
      <div className="max-w-6xl mx-auto">
        {/* Section header */}
        <FadeIn className="max-w-3xl">
          <span className="section-eyebrow">
            {t("home.how.eyebrow", "كيف تعمل")}
          </span>
          <h2 className="font-reem-kufi font-semibold text-[clamp(36px,5vw,64px)] leading-[1.1] tracking-tight mt-5 text-[var(--ink)]">
            {t("home.how.titleLead", "المنتج كاملًا في ")}
            <span className="text-[var(--accent)]">
              {t("home.how.titleAccent", "صفحةٍ واحدة")}
            </span>
            {t("home.how.titleTail", ".")}
          </h2>
          <p className="mt-7 max-w-[58ch] text-[18px] leading-[1.7] text-[var(--ink-muted)] font-body-ar">
            {t(
              "home.how.subheading",
              "نصٌّ على اليمين، مساعدٌ مستشهد على اليسار. تسأل، فيُجيب من السطر."
            )}
          </p>
        </FadeIn>

        {/* Browser-frame product preview */}
        <FadeIn delay={0.1} className="mt-[120px]">
          <div
            className="bg-[var(--cream-card)] rounded-2xl border border-[var(--border-warm-soft)] overflow-hidden mx-auto"
            style={{
              boxShadow:
                "0 1px 3px rgba(0,0,0,0.04), 0 24px 48px rgba(58,42,30,0.08)",
            }}
          >
            {/* Toolbar strip */}
            <div
              dir="ltr"
              className="h-10 px-4 flex items-center bg-[var(--cream-card-soft)] border-b border-[var(--border-warm-soft)] relative"
            >
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#d98b7a]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#e3c078]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#88b98a]" />
              </div>
              <div className="absolute left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-white border border-[var(--border-warm-soft)] text-[12px] text-[var(--ink-muted)] font-mono">
                {t("home.how.urlBar", "ilm.shamela/read/muqaddima/ch3/p47")}
              </div>
            </div>

            {/* Two-column body */}
            <div className="grid grid-cols-1 lg:grid-cols-[60%_40%]">
              {/* Text panel (right in RTL) */}
              <div className="p-8 md:p-10 lg:min-h-[440px] order-1">
                <div className="flex items-center justify-between text-[12px] tracking-wider text-[var(--ink-muted)] font-body-ar mb-6">
                  <span>{t("home.how.bookChapter", "الفصل الثالث")}</span>
                  <span>·</span>
                  <span>{t("home.how.bookPage", "صفحة ٤٧")}</span>
                </div>
                <div
                  className="font-body-ar text-[16px] leading-[1.9] text-[var(--warm-deep)]"
                  lang="ar"
                >
                  <p>
                    {t(
                      "home.how.bookExcerpt1",
                      "وإذا تأمَّلتَ أحوالَ العُمران الحضريّ رأيتَه يتدرَّج على سُنن ثابتة تجمع بين بداوة الأصل وتعقيد الدولة."
                    )}
                  </p>
                  <p className="mt-5">
                    <span className="relative inline-block bg-[var(--accent-soft-bg)] border-r-[3px] border-[var(--accent)] px-3 py-1 rounded-sm">
                      {t(
                        "home.how.bookExcerptHighlight",
                        "فالعصبيّة قاعدة المُلك، ومتى انفكَّت فقد المُلكُ عمودَه الأوّل."
                      )}
                      <span
                        aria-hidden
                        className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-[var(--accent)] text-white text-[12px] flex items-center justify-center shadow-md"
                      >
                        {t("home.how.askBadge", "؟")}
                      </span>
                    </span>
                  </p>
                  <p className="mt-5">
                    {t(
                      "home.how.bookExcerpt2",
                      "ثم إنّ لأطوار الدولة أعمارًا محدودةً كأعمار الأشخاص، ولكلِّ طورٍ منها شواهدُ تُعرَف بها."
                    )}
                  </p>
                </div>
              </div>

              {/* Assistant panel (left in RTL) */}
              <div
                className="p-6 md:p-8 lg:min-h-[440px] order-2 bg-gradient-to-b from-[var(--cream-card)] to-[var(--cream-card-soft)] border-t lg:border-t-0 lg:border-l border-[var(--border-warm-soft)]"
              >
                {/* Header row */}
                <div className="flex items-center justify-between mb-6">
                  <div className="font-reem-kufi text-[14px] text-[var(--warm-deep)] inline-flex items-center gap-2">
                    <span className="text-[var(--accent)]">✦</span>
                    <span>
                      {t("home.how.assistantTitle", "مساعد القراءة")}
                    </span>
                  </div>
                  <div className="inline-flex items-center gap-1.5 text-[11px] text-[var(--ink-muted)] font-body-ar">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-deep" />
                    <span>{t("home.how.assistantConnected", "متّصل")}</span>
                  </div>
                </div>

                {/* User query bubble */}
                <div className="flex">
                  <div className="ms-auto max-w-[85%] bg-[var(--accent-soft-bg)] rounded-xl px-3.5 py-2 text-[14px] text-[var(--ink)] font-body-ar leading-[1.6]">
                    {t("home.how.userQuery", "ما المقصود بالعصبيّة هنا؟")}
                  </div>
                </div>

                {/* Assistant response card */}
                <div className="mt-4 bg-[var(--cream-card)] border border-[var(--border-warm-soft)] rounded-xl p-4">
                  <div className="text-[11px] tracking-widest text-[var(--ink-muted)] font-body-ar">
                    {t("home.how.replyHeader", "ردّ المساعد · مباشر")}
                  </div>
                  <p className="mt-2 font-body-ar text-[14.5px] leading-[1.8] text-[var(--warm-deep)]">
                    {t(
                      "home.how.replyBodyV2",
                      "العصبيّة عند ابن خلدون هي الرابطة التي تجمع الجماعة وتدفعها إلى التغالب. وهي عنده أساس قيام الدولة وسقوطها."
                    )}
                  </p>
                  <div className="mt-3 inline-flex items-center bg-[var(--accent-soft-bg)] text-[var(--accent)] text-[12px] px-2.5 py-1 rounded-lg cursor-pointer font-body-ar">
                    {t("home.how.citationChip", "↗ المقدّمة · الفصل ٣ · §٤٧")}
                  </div>
                </div>

                {/* Continue reading link */}
                <a
                  href="#"
                  className="mt-5 inline-flex items-center gap-1.5 text-[13px] text-[var(--accent)] font-body-ar hover:underline"
                >
                  <span>{t("home.how.continueReading", "أكمل القراءة من هنا")}</span>
                  <ArrowLeft className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
