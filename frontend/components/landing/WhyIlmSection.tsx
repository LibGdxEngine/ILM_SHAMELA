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

  // RTL reading order = rightmost-first in DOM. Citations leads to support the headline thesis.
  const cards: FeatureCard[] = [
    {
      key: "citations",
      Icon: Quote,
      title: t("home.feature.citations.title", "Citation-first answers"),
      desc: t(
        "home.feature.citations.desc",
        "Every reply links to the exact line in the exact edition, with a direct link back to the source. If a claim isn't in the corpus, ILM tells you so plainly."
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
      key: "multilingual",
      Icon: Languages,
      title: t("home.feature.multilingual.title", "Multilingual mastery"),
      desc: t(
        "home.feature.multilingual.desc",
        "Native handling of Arabic, English, Persian and Urdu — diacritics, ligatures, and full right-to-left context."
      ),
    },
    {
      key: "privacy",
      Icon: Lock,
      title: t("home.feature.privacy.title", "Privacy by design"),
      desc: t(
        "home.feature.privacy.desc",
        "Your queries, notes, and uploads stay end-to-end encrypted. No training on your reading, ever — the library you build is yours alone."
      ),
    },
  ];

  return (
    <section id="why" dir="rtl" className="relative py-[120px] px-6">
      <div className="max-w-6xl mx-auto">
        {/* Eyebrow + headline */}
        <FadeUp className="text-center">
          <span className="section-eyebrow">{t("home.why.eyebrow", "Why ILM")}</span>
          <h2 className="font-display-ar font-light text-[clamp(32px,4.5vw,56px)] leading-[1.1] tracking-tight mt-5 mx-auto max-w-[14ch] text-center">
            <span className="block">
              {t("home.why.title.linePre", "A library built for ")}
              <span className="italic text-accent">
                {t("home.why.title.lineEm", "thinkers")}
              </span>
              {t("home.why.title.linePost", ",")}
            </span>
            <span className="block">{t("home.why.title.line2", "not feeds.")}</span>
          </h2>
        </FadeUp>

        {/* Description */}
        <FadeUp delay={0.1}>
          <p className="text-[17px] leading-[1.7] text-text-2 mt-6 mx-auto max-w-[60ch] text-center">
            {t(
              "home.why.body",
              "Most search engines flatten knowledge into ten blue links. ILM treats each text as it deserves — with provenance, edition, and context preserved. Your reading is private, your sources are verifiable, and your assistant never invents what isn't there."
            )}
          </p>
        </FadeUp>

        {/* Proof block */}
        <FadeUp delay={0.2}>
          <div className="mt-16 mx-auto max-w-3xl bg-card border border-border rounded-[14px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.08)] overflow-hidden">
            <blockquote className="px-8 py-6 text-center font-amiri italic text-[17px] text-text-2 border-b border-border m-0">
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
              responseClassName="font-amiri text-[15.5px] text-text"
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
                className="group block bg-card border border-[rgba(31,26,20,0.06)] rounded-[14px] p-8 h-full transition-all duration-200 hover:-translate-y-[2px] hover:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.12)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 relative"
              >
                <div className="w-14 h-14 rounded-xl flex items-center justify-center mb-6 bg-accent-soft text-accent">
                  <card.Icon size={36} strokeWidth={1.5} />
                </div>
                <h3 className="font-fraunces font-semibold text-[20px] leading-tight mb-3 text-accent">
                  {card.title}
                </h3>
                <p className="text-[15px] leading-[1.7] text-text-2">{card.desc}</p>
                <ArrowLeft
                  size={18}
                  className="absolute bottom-6 left-6 text-accent opacity-0 group-hover:opacity-100 transition-opacity duration-200"
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
    <div className="relative border-b border-border last:border-b-0">
      {isAccent && (
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: "-10%" }}
          transition={{ duration: 0.3, delay: 0.5 }}
          aria-hidden
          className="absolute inset-0 bg-[rgba(192,133,82,0.04)] pointer-events-none"
        />
      )}
      <div className="relative flex items-center gap-4 px-8 py-5">
        <span
          className={
            isAccent
              ? "text-accent font-semibold text-[14px] shrink-0 w-[120px]"
              : "text-text-3 font-medium text-[13px] shrink-0 w-[120px]"
          }
        >
          {label}
        </span>
        <span
          className={`flex-1 min-w-0 ${responseClassName ?? "text-[15px] text-text-2"}`}
        >
          {response}
        </span>
        <Icon
          size={18}
          strokeWidth={2}
          className={isAccent ? "text-accent shrink-0" : "text-text-3 shrink-0"}
          aria-hidden
        />
      </div>
    </div>
  );
}
