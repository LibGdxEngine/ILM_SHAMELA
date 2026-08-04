'use client';

import type { CSSProperties } from 'react';

import { useI18n } from '@/components/i18n/I18nProvider';
import { termColor } from '@/lib/search/termColors';
import type { TermFuzziness, TermMatch, TermOp } from '@/lib/search/terms';
import type { TermsSectionSpec } from './types';

const OP_ORDER: TermOp[] = ['must', 'should', 'must_not'];

const OP_FALLBACK: Record<TermOp, string> = {
  must: 'يجب',
  should: 'أو',
  must_not: 'بدون',
};

const MATCH_FALLBACK: Record<TermMatch, string> = {
  phrase: 'عبارة تامة',
  word: 'كلمة تامة',
  fuzzy: 'تقريبي',
  stem: 'تقارب لفظي',
};

const FUZZINESS_OPTIONS: { value: TermFuzziness; key: string; fallback: string }[] = [
  { value: 'AUTO', key: 'auto', fallback: 'تلقائي' },
  { value: 1, key: 'one', fallback: 'حرف واحد' },
  { value: 2, key: 'two', fallback: 'حرفان' },
];

const SELECT_CLASS =
  'rounded-[8px] border bg-transparent px-1.5 py-1 text-[11.5px] outline-none';

function opStyle(op: TermOp): CSSProperties {
  switch (op) {
    case 'should':
      return {
        background: 'transparent',
        borderColor: 'var(--accent, #b07d2b)',
        color: 'var(--accent, #b07d2b)',
      };
    case 'must_not':
      return {
        background: 'color-mix(in srgb, #a4423b 12%, transparent)',
        borderColor: '#a4423b',
        color: '#a4423b',
      };
    default:
      return {
        background: 'var(--accent, #b07d2b)',
        borderColor: 'var(--accent, #b07d2b)',
        color: 'var(--shell-on-accent, #fcf8ee)',
      };
  }
}

/**
 * The multi-term query builder: one row per term with its boolean role chip
 * (يجب/أو/بدون — click to cycle), free text, match-kind select, fuzziness
 * select (fuzzy only) and a diacritics toggle. Semantics:
 * (all musts) AND (≥1 of the أو rows) AND NOT (any بدون row).
 */
export default function TermBuilderPane({ section }: { section: TermsSectionSpec }) {
  const { t } = useI18n();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      {section.terms.length === 0 && (
        <p className="text-[12px] leading-[1.7]" style={{ color: 'var(--shell-muted, #9a8b70)' }}>
          {t(
            'nav.search.terms.empty',
            'أضف كلمات أو عبارات، ولكلٍّ منها شرطها الخاص: مطابقة تامة، تقريب إملائي، أو تقارب لفظي.',
          )}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {section.terms.map((term, index) => (
          <div
            key={term.id}
            className="flex flex-wrap items-center gap-1.5 rounded-[10px] border p-2"
            style={{ borderColor: 'var(--shell-line, #e2d5ba)' }}
          >
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: termColor(index) }}
            />
            <button
              type="button"
              onClick={() => {
                const next = OP_ORDER[(OP_ORDER.indexOf(term.op) + 1) % OP_ORDER.length];
                section.onUpdate(term.id, { op: next });
              }}
              title={t('nav.search.terms.opCycle', 'تبديل نوع الشرط')}
              className="rounded-full border px-2.5 py-[3px] text-[11.5px] font-semibold transition-colors"
              style={opStyle(term.op)}
            >
              {t(`nav.search.terms.op.${term.op}`, OP_FALLBACK[term.op])}
            </button>

            <input
              type="text"
              dir="auto"
              value={term.text}
              onChange={(e) => section.onUpdate(term.id, { text: e.target.value })}
              onKeyDown={(e) => {
                // Esc-layering: a non-empty row consumes Esc to clear itself;
                // an empty one lets the dialog's deferred check close it.
                if (e.key === 'Escape' && term.text) {
                  e.preventDefault();
                  section.onUpdate(term.id, { text: '' });
                }
              }}
              placeholder={t('nav.search.terms.placeholder', 'كلمة أو عبارة…')}
              className="min-w-[9rem] flex-1 rounded-[8px] border bg-transparent px-2 py-1 text-[13px] outline-none"
              style={{
                borderColor: 'var(--shell-line, #e2d5ba)',
                color: 'var(--shell-ink, #2c2620)',
              }}
            />

            <select
              value={term.match}
              onChange={(e) => {
                const match = e.target.value as TermMatch;
                section.onUpdate(term.id, {
                  match,
                  fuzziness: match === 'fuzzy' ? (term.fuzziness ?? 'AUTO') : undefined,
                  diacritics: match === 'stem' ? 'ignore' : term.diacritics,
                });
              }}
              aria-label={t('nav.search.terms.matchLabel', 'نوع المطابقة')}
              className={SELECT_CLASS}
              style={{
                borderColor: 'var(--shell-line, #e2d5ba)',
                color: 'var(--shell-ink, #2c2620)',
              }}
            >
              {(Object.keys(MATCH_FALLBACK) as TermMatch[]).map((m) => (
                <option key={m} value={m}>
                  {t(`nav.search.terms.match.${m}`, MATCH_FALLBACK[m])}
                </option>
              ))}
            </select>

            {term.match === 'fuzzy' && (
              <select
                value={String(term.fuzziness ?? 'AUTO')}
                onChange={(e) => {
                  const raw = e.target.value;
                  section.onUpdate(term.id, {
                    fuzziness: raw === 'AUTO' ? 'AUTO' : (Number(raw) as TermFuzziness),
                  });
                }}
                aria-label={t('nav.search.terms.fuzzinessLabel', 'مدى التقريب')}
                className={SELECT_CLASS}
                style={{
                  borderColor: 'var(--shell-line, #e2d5ba)',
                  color: 'var(--shell-ink, #2c2620)',
                }}
              >
                {FUZZINESS_OPTIONS.map((opt) => (
                  <option key={opt.key} value={String(opt.value)}>
                    {t(`nav.search.terms.fuzziness.${opt.key}`, opt.fallback)}
                  </option>
                ))}
              </select>
            )}

            {term.match !== 'stem' && (
              <button
                type="button"
                role="switch"
                aria-checked={term.diacritics === 'sensitive'}
                onClick={() =>
                  section.onUpdate(term.id, {
                    diacritics: term.diacritics === 'sensitive' ? 'ignore' : 'sensitive',
                  })
                }
                title={t('nav.search.terms.diacritics', 'حساس للتشكيل')}
                className="rounded-[8px] border px-2 py-1 text-[11.5px] transition-colors"
                style={
                  term.diacritics === 'sensitive'
                    ? {
                        background: 'color-mix(in srgb, var(--accent, #b07d2b) 15%, transparent)',
                        borderColor: 'var(--accent, #b07d2b)',
                        color: 'var(--shell-ink, #2c2620)',
                      }
                    : {
                        borderColor: 'var(--shell-line, #e2d5ba)',
                        color: 'var(--shell-muted, #9a8b70)',
                      }
                }
              >
                {t('nav.search.terms.diacriticsShort', 'ـَـ')}
              </button>
            )}

            <button
              type="button"
              onClick={() => section.onRemove(term.id)}
              title={t('docs.categorySearch.remove', 'إزالة')}
              className="ms-auto rounded-full p-1 transition-colors"
              style={{ color: 'var(--shell-muted, #9a8b70)' }}
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => section.onAdd()}
        className="self-start rounded-[10px] border border-dashed px-3 py-1.5 text-[12.5px] font-medium transition-colors"
        style={{
          borderColor: 'color-mix(in srgb, var(--accent, #b07d2b) 45%, transparent)',
          color: 'var(--accent, #b07d2b)',
        }}
      >
        {t('nav.search.terms.add', '+ إضافة كلمة/عبارة')}
      </button>

      {section.terms.length > 1 && (
        <p className="text-[11.5px] leading-[1.7]" style={{ color: 'var(--shell-muted, #9a8b70)' }}>
          {t(
            'nav.search.terms.semanticsHint',
            'تتحقق كل شروط «يجب» معًا، ويكفي تحقق واحد من شروط «أو»، وتُستبعد النتائج التي فيها أي شرط «بدون».',
          )}
        </p>
      )}
    </div>
  );
}
