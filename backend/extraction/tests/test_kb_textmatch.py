"""textmatch tests: shadow invariants (built on textnorm's folding), the
locate_in_focus tier ladder, and the أبو-folding regression in
name_without_kunya (textnorm folds أ→ا, so the fold pattern must be written
in shadow orthography).
"""
from django.test import SimpleTestCase

from extraction.kb.textmatch import (
    locate_in_focus,
    name_without_kunya,
    shadow,
    shadow_with_map,
)


class ShadowTests(SimpleTestCase):
    def test_diacritics_stripped_whitespace_collapsed(self):
        sh, imap = shadow_with_map('مُحَمَّد بْن  إسماعيل')
        self.assertEqual(sh, 'محمد بن اسماعيل')   # hamza fold: إ -> ا
        self.assertEqual(imap[0], 0)
        # Index map is strictly increasing (bisect cursor logic depends on it).
        self.assertEqual(imap, sorted(set(imap)))
        self.assertEqual(len(sh), len(imap))

    def test_textnorm_folds_apply(self):
        # أ/إ/آ -> ا, ى -> ي, ة -> ه, Arabic-Indic digits -> ASCII
        self.assertEqual(shadow('أحمد'), 'احمد')
        self.assertEqual(shadow('مكتبة'), 'مكتبه')
        self.assertEqual(shadow('موسى'), 'موسي')
        self.assertEqual(shadow('سنة ٢٠٤'), 'سنه 204')

    def test_map_translates_spans_back_to_original(self):
        original = 'قال أَبُو بكر'
        sh, imap = shadow_with_map(original)
        i = sh.find('ابو بكر')
        self.assertNotEqual(i, -1)
        start, end = imap[i], imap[i + len('ابو بكر') - 1] + 1
        self.assertEqual(original[start:end], 'أَبُو بكر')


class LocateInFocusTests(SimpleTestCase):
    def _locate(self, focus, needle, occurrence=1):
        fshadow, fmap = shadow_with_map(focus)
        return locate_in_focus(focus, fshadow, fmap, needle, occurrence)

    def test_exact_tier(self):
        focus = 'حدثنا محمد بن إسماعيل قال'
        loc = self._locate(focus, 'محمد بن إسماعيل')
        self.assertEqual(focus[loc[0]:loc[1]], 'محمد بن إسماعيل')

    def test_nth_occurrence(self):
        focus = 'قال أحمد ثم قال أحمد أيضا'
        first = self._locate(focus, 'أحمد', 1)
        second = self._locate(focus, 'أحمد', 2)
        self.assertLess(first[0], second[0])
        self.assertEqual(focus[second[0]:second[1]], 'أحمد')

    def test_miscounted_occurrence_falls_back_to_first(self):
        focus = 'قال أحمد مرة واحدة'
        loc = self._locate(focus, 'أحمد', 3)
        self.assertEqual(focus[loc[0]:loc[1]], 'أحمد')

    def test_shadow_tier_bridges_diacritics_and_folds(self):
        # Model echoes bare orthography; the OCR text carries tashkeel + hamza.
        focus = 'ذكر أَبُو عَبْدِ اللهِ البُخارِيُّ في التاريخ'
        loc = self._locate(focus, 'ابو عبد الله البخاري')
        self.assertIsNotNone(loc)
        self.assertIn('البُخارِيُّ'[:5], focus[loc[0]:loc[1]])

    def test_not_found_returns_none(self):
        self.assertIsNone(self._locate('نص قصير', 'غير موجود'))


class NameWithoutKunyaTests(SimpleTestCase):
    def test_nominative_reported_genitive_in_text(self):
        # The regression the shadow-orthography _fold_abu fix covers: the model
        # reports «أبو عبد الله» where the text carries the genitive «أبي».
        self.assertEqual(
            name_without_kunya('أبي عبد الله الشافعي', 'أبو عبد الله'),
            'الشافعي')

    def test_kunya_absent_leaves_surface_whole(self):
        self.assertEqual(
            name_without_kunya('محمد بن إدريس الشافعي', 'أبو عبد الله'),
            'محمد بن إدريس الشافعي')

    def test_no_kunya(self):
        self.assertEqual(name_without_kunya(' الشافعي ', None), 'الشافعي')
