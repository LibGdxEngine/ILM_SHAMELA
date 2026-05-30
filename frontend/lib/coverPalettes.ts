import type { Document, Category } from '@/lib/api';

export interface CoverPalette {
  from: string;
  to: string;
  text: string;
  accent: string;
}

const FALLBACK_PALETTES: CoverPalette[] = [
  { from: '#2a1a10', to: '#4a2818', text: '#e8d4b4', accent: '#d8a373' },
  { from: '#1a2a2e', to: '#2c4145', text: '#d4e0e2', accent: '#8fb8bf' },
  { from: '#2e1a26', to: '#4a2c3e', text: '#e6d2dc', accent: '#c89eb0' },
  { from: '#1a2818', to: '#2a4424', text: '#d4e2cc', accent: '#9bbf80' },
  { from: '#2e2418', to: '#4a3a24', text: '#ecdcb8', accent: '#d4b574' },
  { from: '#1f1a2c', to: '#2e2848', text: '#d8d4e6', accent: '#a89cd0' },
];

const DISCIPLINE_PALETTES: Record<string, CoverPalette> = {
  fiqh: { from: '#1a2818', to: '#2d4424', text: '#dce8d0', accent: '#9bbf80' },
  hadith: { from: '#2a1810', to: '#48281a', text: '#e8d4b8', accent: '#c89870' },
  tafsir: { from: '#2e2010', to: '#4a3318', text: '#ecdcb0', accent: '#d4ad50' },
  history: { from: '#2e1414', to: '#4d2020', text: '#ecd0c8', accent: '#c87060' },
  philosophy: { from: '#1a1a2e', to: '#28284a', text: '#d8d4e8', accent: '#8c84d0' },
  literature: { from: '#2c1a26', to: '#48283e', text: '#e8d2dc', accent: '#c890b0' },
  biography: { from: '#1f242c', to: '#323a48', text: '#d8dfe6', accent: '#94a5b8' },
  language: { from: '#142628', to: '#214144', text: '#d0e2e0', accent: '#7cb4ad' },
  creed: { from: '#2c2010', to: '#48341a', text: '#eddcb4', accent: '#cca065' },
  sufism: { from: '#241a2e', to: '#3c2c4a', text: '#e0d4e8', accent: '#a890c8' },
  usul: { from: '#152828', to: '#244444', text: '#d0e2e0', accent: '#7caca8' },
};

const CATEGORY_NAME_MAP: Record<string, keyof typeof DISCIPLINE_PALETTES> = {
  فقه: 'fiqh',
  الفقه: 'fiqh',
  fiqh: 'fiqh',
  jurisprudence: 'fiqh',
  حديث: 'hadith',
  الحديث: 'hadith',
  hadith: 'hadith',
  تفسير: 'tafsir',
  التفسير: 'tafsir',
  tafsir: 'tafsir',
  exegesis: 'tafsir',
  تاريخ: 'history',
  التاريخ: 'history',
  history: 'history',
  فلسفة: 'philosophy',
  الفلسفة: 'philosophy',
  philosophy: 'philosophy',
  أدب: 'literature',
  الأدب: 'literature',
  literature: 'literature',
  poetry: 'literature',
  شعر: 'literature',
  سيرة: 'biography',
  السيرة: 'biography',
  biography: 'biography',
  لغة: 'language',
  اللغة: 'language',
  نحو: 'language',
  النحو: 'language',
  language: 'language',
  grammar: 'language',
  عقيدة: 'creed',
  العقيدة: 'creed',
  creed: 'creed',
  theology: 'creed',
  تصوف: 'sufism',
  التصوف: 'sufism',
  sufism: 'sufism',
  أصول: 'usul',
  الأصول: 'usul',
  'أصول الفقه': 'usul',
  usul: 'usul',
};

function categoryNameOf(c: unknown): string | null {
  if (!c) return null;
  if (typeof c === 'string') return c;
  if (typeof c === 'object' && c !== null && 'name' in c) {
    const n = (c as { name?: unknown }).name;
    return typeof n === 'string' ? n : null;
  }
  return null;
}

function hashString(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

export function paletteFor(
  doc: Pick<Document, 'title' | 'categories'> & { categories?: Category[] | null }
): CoverPalette {
  const cats = doc.categories ?? [];
  for (const c of cats) {
    const name = categoryNameOf(c);
    if (!name) continue;
    const normalized = name.trim().toLowerCase();
    const key = CATEGORY_NAME_MAP[name.trim()] ?? CATEGORY_NAME_MAP[normalized];
    if (key && DISCIPLINE_PALETTES[key]) return DISCIPLINE_PALETTES[key];
  }
  const idx = hashString(doc.title || 'untitled') % FALLBACK_PALETTES.length;
  return FALLBACK_PALETTES[idx];
}
