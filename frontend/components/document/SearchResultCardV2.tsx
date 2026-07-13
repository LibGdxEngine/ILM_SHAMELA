'use client';

// Reader & Search v2 result cards.
// `SearchResultCardV2` renders one in-book match (kind badge + colored edge,
// snippet with backend <mark>s, score bar, jump / copy-citation / save-note
// actions). `LibraryResultCard` renders one corpus (كلّ المكتبة) document hit.

import { useI18n } from '@/components/i18n/I18nProvider';
import type { Document, DocumentSearchMatch, InDocMatchKind } from '@/lib/api';
import { resolveMatchKind } from '@/lib/reader/searchPanelUtils';

const KIND_META: Record<InDocMatchKind, { labelKey: string; labelFallback: string; bg: string; fg: string }> = {
  exact: { labelKey: 'reader.search.kind.exact', labelFallback: 'تام', bg: '#e6f0ec', fg: '#1e5f56' },
  lexical: { labelKey: 'reader.search.kind.lexical', labelFallback: 'لفظي', bg: '#fbefd6', fg: '#9a6b12' },
  semantic: { labelKey: 'reader.search.kind.semantic', labelFallback: 'دلالي', bg: '#ece7f4', fg: '#574a7e' },
};

function ActionButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="inline-flex cursor-pointer items-center gap-[5px] text-[11.5px] font-semibold"
      style={{ color: active ? 'var(--rr-brand)' : '#8a7d68' }}
    >
      {icon}
      {label}
    </button>
  );
}

interface SearchResultCardV2Props {
  match: DocumentSearchMatch;
  /** Chapter/page label, e.g. "كتاب العلم · ص ٤٢". */
  location: string;
  /** Localized percentage formatter. */
  pct: (x: number | null | undefined) => string;
  /** Localized page label for the jump action. */
  localizedPage: string;
  saved: boolean;
  onGoTo: () => void;
  onCopyCitation: () => void;
  onToggleSave: () => void;
}

export default function SearchResultCardV2({
  match,
  location,
  pct,
  localizedPage,
  saved,
  onGoTo,
  onCopyCitation,
  onToggleSave,
}: SearchResultCardV2Props) {
  const { t } = useI18n();
  const kind = resolveMatchKind(match);
  const meta = KIND_META[kind];

  const lex = match.score_lexical ?? 0;
  const sem = match.score_semantic ?? 0;
  const badgeText =
    kind === 'exact'
      ? t(meta.labelKey, meta.labelFallback)
      : `${t(meta.labelKey, meta.labelFallback)} ${pct(kind === 'lexical' ? lex : sem)}`;
  const metric = kind === 'exact' ? Math.max(0.65, lex) : kind === 'lexical' ? lex : sem;

  return (
    <div
      className="ilm-result mb-[11px]"
      style={{
        background: 'var(--rr-surface)',
        border: '1px solid var(--rr-line-2)',
        borderInlineEnd: `3px solid ${meta.fg}`,
        borderRadius: '12px',
        padding: '12px 14px',
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          className="flex-shrink-0 whitespace-nowrap rounded-[7px] px-[9px] py-[3px] text-[11px] font-bold"
          style={{ background: meta.bg, color: meta.fg }}
        >
          {badgeText}
        </span>
        <span className="truncate text-[11px]" style={{ color: 'var(--rr-ink-3)' }}>
          {location}
        </span>
      </div>
      <div
        className="text-[13.5px] leading-[1.95]"
        style={{ color: '#3a342b' }}
        dir="auto"
        dangerouslySetInnerHTML={{ __html: match.snippet }}
      />
      <div className="mt-2.5 h-1 overflow-hidden rounded-[3px]" style={{ background: 'var(--rr-line-2)' }}>
        <div
          className="h-full rounded-[3px]"
          style={{ width: `${Math.round(metric * 100)}%`, background: meta.fg, transition: 'width .2s' }}
        />
      </div>
      <div className="mt-2.5 flex items-center gap-4 pt-[9px]" style={{ borderTop: '1px solid #f0e6cf' }}>
        <ActionButton
          onClick={onGoTo}
          label={t('reader.search.goToPage', 'الانتقال إلى ص {page}', { page: localizedPage })}
          icon={
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M11 17l-5-5 5-5M6 12h12" />
            </svg>
          }
        />
        <ActionButton
          onClick={onCopyCitation}
          label={t('reader.search.copyCitation', 'نسخ مع الإحالة')}
          icon={
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M8 8h12v12H8zM4 16V4h12" />
            </svg>
          }
        />
        <ActionButton
          onClick={onToggleSave}
          active={saved}
          label={saved ? t('reader.search.saved', 'محفوظ') : t('reader.search.save', 'حفظ')}
          icon={
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill={saved ? 'var(--rr-brand)' : 'none'}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z" />
            </svg>
          }
        />
      </div>
    </div>
  );
}

interface LibraryResultCardProps {
  document: Document;
  onOpen: () => void;
}

/** Corpus (كلّ المكتبة) hit: work identity + snippet + relevance bar. The
 *  corpus endpoint has no per-match kind classification, so no kind badge. */
export function LibraryResultCard({ document, onOpen }: LibraryResultCardProps) {
  const { t } = useI18n();
  const authors = document.authors?.map((a) => a.name).join('، ');
  const score = document.score_final ?? 0;
  return (
    <div
      className="ilm-result mb-[11px]"
      style={{
        background: 'var(--rr-surface)',
        border: '1px solid var(--rr-line-2)',
        borderInlineEnd: '3px solid var(--rr-brand)',
        borderRadius: '12px',
        padding: '12px 14px',
      }}
    >
      <div className="mb-1 flex items-baseline gap-2">
        <span className="rr-title truncate text-[14px]" style={{ color: 'var(--rr-ink)' }}>
          {document.title}
        </span>
        {authors && (
          <span className="truncate text-[11px]" style={{ color: 'var(--rr-ink-3)' }}>
            {authors}
          </span>
        )}
      </div>
      {document.snippet && (
        <div
          className="text-[13px] leading-[1.9]"
          style={{ color: '#3a342b' }}
          dir="auto"
          dangerouslySetInnerHTML={{ __html: document.snippet }}
        />
      )}
      {score > 0 && (
        <div className="mt-2.5 h-1 overflow-hidden rounded-[3px]" style={{ background: 'var(--rr-line-2)' }}>
          <div className="h-full rounded-[3px]" style={{ width: `${Math.round(score * 100)}%`, background: 'var(--rr-brand)' }} />
        </div>
      )}
      <div className="mt-2.5 flex items-center pt-[9px]" style={{ borderTop: '1px solid #f0e6cf' }}>
        <ActionButton
          onClick={onOpen}
          label={t('reader.search.openBook', 'فتح الكتاب')}
          icon={
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2zM22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z" />
            </svg>
          }
        />
      </div>
    </div>
  );
}
