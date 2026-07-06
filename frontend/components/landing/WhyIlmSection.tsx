"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, BookOpen, Check, Languages, Lock, Quote, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useI18n } from "@/components/i18n/I18nProvider";

type FadeUpProps = {
  children: React.ReactNode;
  delay?: number;
  className?: string;
};

const FadeUp = ({ children, delay = 0, className }: FadeUpProps) => (
  <motion.div
    initial={{ opacity: 0, y: 16 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: "-10%" }}
    transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1], delay }}
    className={className}
  >
    {children}
  </motion.div>
);

type FeatureCard = {
  key: string;
  Icon: LucideIcon;
  title: string;
  desc: string;
};

export default function WhyIlmSection() {
  const { t } = useI18n();

  // RTL reading order = rightmost-first in DOM. Mock order: privacy → multilingual → manuscript → citations.
  const cards: FeatureCard[] = [
    {
      key: "privacy",
      Icon: Lock,
      title: t("home.feature.privacy.title", "Privacy by design"),
      desc: t(
        "home.feature.privacy.desc",
        "Your queries, notes, and uploads stay end-to-end encrypted. No training on your reading, ever — the library you build is yours alone."
      ),
    },
    {
      key: "multilingual",
      Icon: Languages,
      title: t("home.feature.multilingual.title", "Multilingual mastery"),
      desc: t(
        "home.feature.multilingual.desc",
        "Native handling of Arabic, English, Persian and Urdu — diacritics, ligatures, and full right-to-left context."
      ),
    },
    {
      key: "manuscript",
      Icon: BookOpen,
      title: t("home.feature.manuscript.title", "Manuscript-grade rendering"),
      desc: t(
        "home.feature.manuscript.desc",
        "Beautiful typography with proper kashida justification, marginalia support, and footnote linking — pages that echo the original without losing search."
      ),
    },
    {
      key: "citations",
      Icon: Quote,
      title: t("home.feature.citations.title", "Citation-first answers"),
      desc: t(
        "home.feature.citations.desc",
        "Every reply links to the exact line in the exact edition, with a direct link back to the source. If a claim isn't in the corpus, ILM tells you so plainly."
      ),
    },
  ];

  return (
    <section id="why" dir="rtl" className="relative py-[120px] px-6">
      <div className="max-w-6xl mx-auto">
        {/* Eyebrow + headline */}
        <FadeUp className="text-center">
          <span className="section-eyebrow">{t("home.why.eyebrow", "Why ILM")}</span>
          <h2 className="font-reem-kufi font-semibold text-[clamp(30px,4.4vw,50px)] leading-[1.3] tracking-tight mt-6 mx-auto max-w-[18ch] text-center text-ink-deep">
            <span className="block">
              {t("home.why.title.linePre", "A library built for ")}
              <span className="text-maroon">
                {t("home.why.title.lineEm", "thinkers")}
              </span>
              {t("home.why.title.linePost", ",")}
            </span>
            <span className="block">{t("home.why.title.line2", "not feeds.")}</span>
          </h2>
        </FadeUp>

        {/* Description */}
        <FadeUp delay={0.1}>
          <p className="text-[17px] leading-[2] text-ink-warm mt-7 mx-auto max-w-[62ch] text-center">
            {t(
              "home.why.body",
              "Most search engines flatten knowledge into ten blue links. ILM treats each text as it deserves — with provenance, edition, and context preserved. Your reading is private, your sources are verifiable, and your assistant never invents what isn't there."
            )}
          </p>
        </FadeUp>

        {/* Proof block */}
        <FadeUp delay={0.2}>
          <div className="mt-16 mx-auto max-w-3xl bg-paper-card border border-paper-line rounded-[20px] shadow-[0_12px_38px_rgba(44,38,32,0.08)] overflow-hidden">
            <blockquote className="px-8 py-5 text-center font-amiri text-[19px] text-[#3a342b] bg-paper-soft border-b border-paper-line m-0">
              {t(
                "home.why.proof.question",
                "«Question: what is the ruling on earnest-money sales in the Hanbali school?»"
              )}
            </blockquote>

            <ProofRow
              tone="muted"
              label={t("home.why.proof.row1.label", "Generic search engine")}
              response={t(
                "home.why.proof.row1.response",
                "Ten blue links, conflicting opinions, no verification"
              )}
            />
            <ProofRow
              tone="muted"
              label={t("home.why.proof.row2.label", "Generic language model")}
              response={t(
                "home.why.proof.row2.response",
                "Brief answer, hallucination risk, no citation"
              )}
            />
            <ProofRow
              tone="accent"
              label={t("home.why.proof.row3.label", "ILM")}
              response={t(
                "home.why.proof.row3.response",
                "«Ibn Qudāma in al-Mughnī, vol. 4 p. 312 said: \"…\"»"
              )}
              responseClassName="font-amiri text-[17px] text-ink-deep"
            />
          </div>
        </FadeUp>

        {/* Feature cards */}
        <div className="mt-20 grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {cards.map((card, i) => (
            <motion.div
              key={card.key}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-10%" }}
              transition={{ duration: 0.4, delay: 0.3 + i * 0.08, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <Link
                href={`#why-${card.key}`}
                aria-label={`اقرأ المزيد عن ${card.title}`}
                className="group block bg-paper-card border border-paper-line rounded-[18px] p-7 h-full transition-all duration-200 hover:-translate-y-[2px] hover:shadow-[0_8px_30px_-12px_rgba(44,38,32,0.14)] focus:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 relative"
              >
                <div className="w-[50px] h-[50px] rounded-[14px] flex items-center justify-center mb-5 bg-gold-soft text-gold">
                  <card.Icon size={24} strokeWidth={1.9} />
                </div>
                <h3 className="font-reem-kufi font-semibold text-[19px] leading-tight mb-3 text-maroon">
                  {card.title}
                </h3>
                <p className="text-[13.5px] leading-[1.95] text-ink-warm">{card.desc}</p>
                <ArrowLeft
                  size={18}
                  className="absolute bottom-6 left-6 text-gold opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                  aria-hidden
                />
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

type ProofRowProps = {
  tone: "muted" | "accent";
  label: string;
  response: string;
  responseClassName?: string;
};

function ProofRow({ tone, label, response, responseClassName }: ProofRowProps) {
  const isAccent = tone === "accent";
  const Icon = isAccent ? Check : X;

  return (
    <div
      className={`flex items-center gap-4 px-7 py-5 border-b border-paper-line last:border-b-0 ${
        isAccent ? "bg-[#f6fbf5]" : ""
      }`}
    >
      <span
        className={`w-[26px] h-[26px] rounded-lg flex items-center justify-center shrink-0 ${
          isAccent ? "bg-[#dcebdd]" : "bg-[#f3e3e1]"
        }`}
      >
        <Icon
          size={14}
          strokeWidth={isAccent ? 3 : 2.6}
          className={isAccent ? "text-[#2e5347]" : "text-[#9e3b2e]"}
          aria-hidden
        />
      </span>
      <span className={`flex-1 min-w-0 ${responseClassName ?? "text-[15px] text-ink-warm"}`}>
        {response}
      </span>
      <span
        className={
          isAccent
            ? "text-[#2e5347] font-bold font-reem-kufi text-[14px] shrink-0 w-[110px] text-end"
            : "text-ink-mute font-medium text-[13px] shrink-0 w-[110px] text-end"
        }
      >
        {label}
      </span>
    </div>
  );
}
