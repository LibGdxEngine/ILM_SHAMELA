"""LLM NER pass tests: anchoring, validation gate, task persistence,
sequencing, supersession, retry envelope, API surface. The LLM boundary is
mocked at the module-function level (``ner.extract_document_entities`` for
task tests, synthetic tool args for gate tests) — never at the HTTP layer."""
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APITestCase

from extraction import ner
from extraction.extractors.textnorm import normalize
from extraction.models import (DocumentStructuredExtraction, EntityMention,
                               EntityRelation, ExtractionRun, Person, Work,
                               WorkName)
from extraction.tasks import ner_document_task
from search_engine.models import Document


def _page_index(page_number, content):
    return {page_number: ner._PageIndex(page_number, content)}


class AnchorTests(SimpleTestCase):
    """The LLM quotes verbatim surfaces; code must locate them offset-exactly
    on the ORIGINAL page string, tolerating diacritic/hamza variance."""

    PAGE = 'قَالَ الشَّيْخُ مُحَمَّدُ بْنُ سِيرِينَ في بَغْدَادَ سنة ٢٠٤'

    def test_anchors_diacritic_free_quote_onto_vocalized_page(self):
        pages = _page_index(1, self.PAGE)
        result = ner._anchor(pages, 'محمد بن سيرين', 1, None, max_len=200)
        self.assertIsNotNone(result)
        page, start, end, fallback = result
        self.assertEqual(page, 1)
        self.assertFalse(fallback)
        self.assertEqual(normalize(self.PAGE[start:end]), normalize('محمد بن سيرين'))

    def test_paraphrased_quote_is_dropped(self):
        pages = _page_index(1, self.PAGE)
        self.assertIsNone(
            ner._anchor(pages, 'الإمام البخاري', 1, None, max_len=200))

    def test_occurrence_index_selects_the_right_hit(self):
        page = 'ذكر محمد اولا ثم ذكر محمد ثانيا'
        pages = _page_index(1, page)
        first = ner._anchor(pages, 'محمد', 1, 1, max_len=200)
        second = ner._anchor(pages, 'محمد', 1, 2, max_len=200)
        self.assertLess(first[1], second[1])
        self.assertEqual(page[first[1]:first[2]], 'محمد')
        self.assertEqual(page[second[1]:second[2]], 'محمد')

    def test_claimed_walk_advances_over_duplicates(self):
        page = 'ذكر محمد اولا ثم ذكر محمد ثانيا'
        pages = _page_index(1, page)
        first = ner._anchor(pages, 'محمد', 1, None, max_len=200)
        second = ner._anchor(pages, 'محمد', 1, None, max_len=200)
        self.assertLess(first[1], second[1])

    def test_off_by_one_page_falls_back_within_window(self):
        pages = {1: ner._PageIndex(1, 'صفحة اولي فارغه من الاسم تقريبا'),
                 2: ner._PageIndex(2, 'وفي هذه الصفحه ذكر الطبري رحمه الله')}
        result = ner._anchor(pages, 'الطبري', 1, None, max_len=200)
        self.assertIsNotNone(result)
        self.assertEqual(result[0], 2)
        self.assertTrue(result[3])  # fallback flagged → pending review

    def test_floor_forces_forward_matches(self):
        page = 'عن نافع حدثنا مالك عن نافع مرة اخري'
        pages = _page_index(1, page)
        first = ner._anchor(pages, 'نافع', 1, None, max_len=200)
        floor = (1, ner._shadow_offset(pages[1], first[2]))
        second = ner._anchor(pages, 'نافع', 1, None, max_len=200, floor=floor)
        self.assertGreater(second[1], first[1])


class DateNormalizationTests(SimpleTestCase):
    """Calendar math is server-side — the LLM only labels."""

    def test_gregorian_year_gets_hijri_counterpart(self):
        key, payload = ner._normalize_date_fields(
            {'calendar': 'gregorian', 'year': 1925})
        self.assertEqual(key, 'greg:1925')
        self.assertEqual(payload['year_hijri'], 1344)
        self.assertEqual(payload['century'], 14)

    def test_hijri_year_gets_gregorian_counterpart(self):
        key, payload = ner._normalize_date_fields(
            {'calendar': 'hijri', 'year': 728})
        self.assertEqual(key, 'hijri:728')
        self.assertEqual(payload['century'], 8)
        self.assertEqual(payload['year_gregorian'], 1328)

    def test_coptic_rumi_stay_labeled_unconverted(self):
        key, payload = ner._normalize_date_fields(
            {'calendar': 'rumi', 'year': 1330})
        self.assertEqual(key, 'rumi:1330')
        self.assertNotIn('year_hijri', payload)

    def test_regnal_dating_resolves_to_hijri_range(self):
        key, payload = ner._normalize_date_fields(
            {'regnal': 'في خلافة المأمون'})
        self.assertEqual(key, 'hijri:198-218')
        self.assertEqual(payload['century'], 2)

    def test_unknown_regnal_stays_pending_key(self):
        key, _payload = ner._normalize_date_fields(
            {'regnal': 'في ولاية شخص مجهول تماما'})
        self.assertEqual(key, 'date:regnal')


class GateTests(SimpleTestCase):
    """apply_ner_window: whitelist, clamp, skip-invalid, anchor-or-drop."""

    PAGE = ('قال الشافعي رحمه الله روي عن مالك بن انس في كتاب الموطا '
            'وكان ذلك سنة ١٧٩ هـ في المدينه')

    def _run_gate(self, args, page=PAGE):
        pages = _page_index(1, page)
        mentions, relations, regions = [], [], []
        stats = {}
        ner.apply_ner_window(args, [1], pages, mentions, relations, regions,
                             {}, stats)
        return mentions, relations, regions, stats

    def test_entities_anchor_and_carry_typed_norms(self):
        args = {'entities': [
            {'id': 0, 'type': 'person', 'surface': 'الشافعي', 'page': 1,
             'norm': {'shuhra': 'الشافعي', 'death_year_hijri': 204},
             'confidence': 0.9},
            {'id': 1, 'type': 'work_title', 'surface': 'الموطا', 'page': 1,
             'confidence': 0.85},
            {'id': 2, 'type': 'date', 'surface': 'سنة ١٧٩ هـ', 'page': 1,
             'norm': {'calendar': 'hijri', 'year': 179}, 'confidence': 0.9},
        ]}
        mentions, _relations, _regions, stats = self._run_gate(args)
        self.assertEqual(len(mentions), 3)
        self.assertEqual(stats['anchored'], 3)
        person = mentions[0]
        self.assertEqual(person.entity_type, 'person')
        self.assertEqual(person.normalized['death_year_hijri'], 204)
        self.assertEqual(person.canonical_hint['person_death_year'], 204)
        date = mentions[2]
        self.assertEqual(date.normalized_text, 'hijri:179')
        self.assertEqual(date.normalized['century'], 2)
        for m in mentions:
            self.assertEqual(normalize(self.PAGE[m.char_start:m.char_end]),
                             normalize(m.surface_text))

    def test_invalid_types_pages_and_unanchorable_are_skipped(self):
        args = {'entities': [
            {'id': 0, 'type': 'alien', 'surface': 'الشافعي', 'page': 1},
            {'id': 1, 'type': 'person', 'surface': 'الشافعي', 'page': 7},
            {'id': 2, 'type': 'person', 'surface': 'نص غير موجود هنا', 'page': 1},
        ]}
        mentions, _relations, _regions, stats = self._run_gate(args)
        self.assertEqual(mentions, [])
        self.assertEqual(stats.get('unanchored'), 1)  # only the anchorable-page miss

    def test_narrated_from_swaps_into_taught_edge(self):
        args = {
            'entities': [
                {'id': 0, 'type': 'person', 'surface': 'الشافعي', 'page': 1,
                 'confidence': 0.9},
                {'id': 1, 'type': 'person', 'surface': 'مالك بن انس', 'page': 1,
                 'confidence': 0.9},
            ],
            'relations': [
                {'type': 'narrated_from', 'subject': 0, 'object': 1,
                 'verb_surface': 'روي عن', 'confidence': 0.85},
            ],
        }
        mentions, relations, _regions, _stats = self._run_gate(args)
        self.assertEqual(len(relations), 1)
        edge = relations[0]
        self.assertEqual(edge.predicate, 'taught')
        # teacher (مالك) became the subject
        self.assertEqual(mentions[edge.subject_index].surface_text,
                         self.PAGE[mentions[1].char_start:mentions[1].char_end])
        self.assertEqual(edge.qualifiers['verb'], 'روي عن')

    def test_relation_with_unknown_endpoint_is_dropped(self):
        args = {
            'entities': [{'id': 0, 'type': 'person', 'surface': 'الشافعي',
                          'page': 1, 'confidence': 0.9}],
            'relations': [{'type': 'taught', 'subject': 0, 'object': 99}],
        }
        _mentions, relations, _regions, _stats = self._run_gate(args)
        self.assertEqual(relations, [])

    def test_entity_cap_truncates_and_flags(self):
        args = {'entities': [
            {'id': i, 'type': 'person', 'surface': 'الشافعي', 'page': 1}
            for i in range(ner.MAX_ENTITIES_PER_WINDOW + 10)
        ]}
        _mentions, _relations, _regions, stats = self._run_gate(args)
        self.assertTrue(stats.get('truncated'))

    def test_isnad_chain_builds_container_persons_and_edges(self):
        page = 'حدثنا احمد بن حنبل قال حدثنا سفيان عن الزهري عن انس'
        args = {'entities': [], 'isnads': [{
            'page': 1,
            'chain': [
                {'surface': 'احمد بن حنبل'},
                {'surface': 'سفيان', 'verb': 'حدثنا'},
                {'surface': 'الزهري', 'verb': 'عن'},
            ],
            'confidence': 0.9,
        }]}
        mentions, relations, _regions, _stats = self._run_gate(args, page=page)
        types = [m.entity_type for m in mentions]
        self.assertEqual(types.count('isnad'), 1)
        self.assertEqual(types.count('person'), 3)
        edges = [r for r in relations if r.predicate == 'transmitted_to']
        self.assertEqual(len(edges), 2)
        # Teacher→student: text order runs student→teacher, so the edge
        # subject is the LATER node.
        first_edge = edges[0]
        subject = mentions[first_edge.subject_index]
        obj = mentions[first_edge.object_index]
        self.assertEqual(normalize(subject.surface_text), normalize('سفيان'))
        self.assertEqual(normalize(obj.surface_text), normalize('احمد بن حنبل'))
        self.assertEqual(first_edge.qualifiers['verb'], 'حدثنا')

    def test_quote_structure_becomes_span_with_attribution(self):
        page = 'وقال الطبري ان العلم لا يؤخذ الا من اهله والله اعلم'
        args = {
            'entities': [{'id': 0, 'type': 'person', 'surface': 'الطبري',
                          'page': 1, 'confidence': 0.9}],
            'structures': [{
                'kind': 'quote', 'page': 1,
                'start_quote': 'ان العلم لا يؤخذ الا من اهله',
                'payload': {'speaker_surface': 'الطبري', 'speaker_role': 'مؤرخ'},
                'confidence': 0.8,
            }],
        }
        mentions, relations, _regions, _stats = self._run_gate(args, page=page)
        quote = next(m for m in mentions if m.entity_type == 'quote')
        attribution = next(r for r in relations if r.predicate == 'attributed_to')
        self.assertEqual(mentions[attribution.subject_index], quote)
        self.assertEqual(
            normalize(mentions[attribution.object_index].surface_text),
            normalize('الطبري'))
        self.assertEqual(attribution.qualifiers['role'], 'مؤرخ')

    def test_intertextual_ref_becomes_cites_relation(self):
        page = 'قال في الفتح ما نصه وهذا مذهب الجمهور'
        args = {'entities': [], 'structures': [{
            'kind': 'intertextual_ref', 'page': 1,
            'start_quote': 'قال في الفتح',
            'payload': {'work_surface': 'فتح الباري'},
            'confidence': 0.8,
        }]}
        _mentions, relations, _regions, _stats = self._run_gate(args, page=page)
        cites = next(r for r in relations if r.predicate == 'cites')
        self.assertEqual(cites.object_text, 'فتح الباري')


class GroupRegionsTests(SimpleTestCase):
    def test_fatwa_question_answer_pair_into_units(self):
        regions = [
            {'kind': 'fatwa_question', 'page_number': 1, 'char_start': 0,
             'char_end': 10, 'text': 'السؤال...', 'payload': {}, 'confidence': 0.8},
            {'kind': 'fatwa_answer', 'page_number': 1, 'char_start': 11,
             'char_end': 30, 'text': 'الجواب...', 'payload': {'mufti': 'الشيخ'},
             'confidence': 0.9},
        ]
        grouped = ner.group_regions(regions)
        units = grouped['fatwa_units']['payload']['items']
        self.assertEqual(len(units), 1)
        self.assertIn('question', units[0])
        self.assertIn('answer', units[0])
        self.assertEqual(grouped['fatwa_units']['confidence'], 0.9)

    def test_codicology_kinds_share_one_bucket(self):
        regions = [
            {'kind': 'waqf_note', 'page_number': 1, 'char_start': 0,
             'char_end': 5, 'text': 'وقف', 'payload': {}, 'confidence': 0.7},
            {'kind': 'sama_note', 'page_number': 2, 'char_start': 0,
             'char_end': 5, 'text': 'سماع', 'payload': {}, 'confidence': 0.6},
        ]
        grouped = ner.group_regions(regions)
        self.assertEqual(len(grouped['codicology']['payload']['items']), 2)
        self.assertEqual(len(grouped['codicology']['page_refs']), 2)


class SelectPlaybookTests(TestCase):
    def _meta(self, **kwargs):
        from extraction.models import DocumentMeta
        document = Document.objects.create(
            title=kwargs.pop('title', 'كتاب'), file='documents/x.txt',
            processed=True)
        meta = DocumentMeta.objects.create(document=document, **kwargs)
        return meta, document

    def test_meta_physical_class_wins(self):
        from extraction.models import DocumentMeta
        meta, document = self._meta(
            status=DocumentMeta.Status.SUCCEEDED,
            physical_class='manuscript_scan', genre='hadith')
        self.assertEqual(ner.select_playbook(meta, document), 'manuscript')

    def test_genre_maps_to_turath(self):
        from extraction.models import DocumentMeta
        meta, document = self._meta(
            status=DocumentMeta.Status.SUCCEEDED, genre='fiqh')
        self.assertEqual(ner.select_playbook(meta, document), 'turath')

    def test_title_fallback_when_meta_missing(self):
        press = Document.objects.create(
            title='جريدة الاهرام', file='documents/p.txt', processed=True)
        thesis = Document.objects.create(
            title='رسالة ماجستير في النحو', file='documents/t.txt', processed=True)
        plain = Document.objects.create(
            title='كتاب الطهارة', file='documents/k.txt', processed=True)
        self.assertEqual(ner.select_playbook(None, press), 'press')
        self.assertEqual(ner.select_playbook(None, thesis), 'academic')
        self.assertEqual(ner.select_playbook(None, plain), 'generic')


PAGE_1 = 'قال الشافعي رحمه الله روي عن مالك بن انس في الموطا.'
PAGE_2 = 'وتوفي الشافعي سنة ٢٠٤ من الهجره بمصر.'


def _result_for(document, pages):
    """A small deterministic NerResult anchored to real fixture offsets."""
    def span(page_number, needle):
        content = pages[page_number - 1]['content']
        start = content.find(needle)
        assert start >= 0, needle
        return page_number, start, start + len(needle)

    p1, s1, e1 = span(1, 'الشافعي')
    p2, s2, e2 = span(1, 'مالك بن انس')
    p3, s3, e3 = span(1, 'الموطا')
    mentions = [
        ner.NerMention('person', p1, s1, e1, 'الشافعي', 'الشافعي',
                       {'shuhra': 'الشافعي'}, 0.9, False,
                       {'person_blocking_key': normalize('الشافعي'),
                        'person_death_year': 204}),
        ner.NerMention('person', p2, s2, e2, 'مالك بن انس', 'مالك',
                       {}, 0.9, False,
                       {'person_blocking_key': normalize('مالك')}),
        ner.NerMention('work_title', p3, s3, e3, 'الموطا', normalize('الموطا'),
                       {}, 0.85, False,
                       {'work_normalized': normalize('الموطا')}),
    ]
    relations = [
        ner.NerRelation('taught', 1, 0, p1, s1, e1, 'روي عن',
                        qualifiers={'verb': 'روي عن'}, confidence=0.85),
        ner.NerRelation('authored', 1, 2, p2, s2, e2, 'مالك بن انس',
                        confidence=0.85),
    ]
    structures = {
        'colophon': {'payload': {'items': [{'kind': 'colophon',
                                            'text': 'تم النسخ'}]},
                     'page_refs': [{'page_number': 2, 'char_start': 0,
                                    'char_end': 8}],
                     'confidence': 0.8},
    }
    return ner.NerResult(mentions=mentions, relations=relations,
                         structures=structures,
                         stats={'emitted': 3, 'anchored': 3, 'playbook': 'turath',
                                'windows': 1, 'failed_windows': []},
                         model_id='test-model')


class NerTaskTests(TestCase):
    def setUp(self):
        self.document = Document.objects.create(
            title='كتاب الاختبار', file='documents/test.txt',
            content=f'{PAGE_1}\f{PAGE_2}', processed=True)
        from search_engine.utils import split_document_content_into_pages
        self.pages = split_document_content_into_pages(self.document.content)

    def _run(self, **kwargs):
        result = _result_for(self.document, self.pages)
        with mock.patch.object(ner, 'extract_document_entities',
                               return_value=result) as mocked:
            ner_document_task.run(self.document.id, **kwargs)
        return mocked

    def test_persists_mentions_relations_structures(self):
        self._run()
        mentions = EntityMention.objects.filter(
            document=self.document, extractor_name='ner_llm',
            superseded_at__isnull=True)
        self.assertEqual(mentions.count(), 3)
        for m in mentions:
            page = next(p['content'] for p in self.pages
                        if p['page_number'] == m.page_number)
            self.assertEqual(page[m.char_start:m.char_end], m.surface_text)
            self.assertTrue(m.content_hash)

        relations = EntityRelation.objects.filter(document=self.document)
        self.assertEqual(relations.count(), 2)
        taught = relations.get(predicate='taught')
        self.assertEqual(taught.subject_mention.surface_text, 'مالك بن انس')
        self.assertEqual(taught.object_mention.surface_text, 'الشافعي')

        structure = DocumentStructuredExtraction.objects.get(
            document=self.document, kind='colophon')
        self.assertEqual(structure.model_id, 'test-model')

        run = ExtractionRun.objects.get(
            document=self.document, extractor_name='ner_llm')
        self.assertEqual(run.status, ExtractionRun.Status.SUCCEEDED)
        self.assertIn('anchored=3/3', run.error)

    def test_canonical_resolution_death_year_disambiguates(self):
        key = normalize('الشافعي')
        Person.objects.create(display_name='الشافعي الكبير', blocking_key=key,
                              death_year_hijri=204, source='manual')
        Person.objects.create(display_name='شافعي اخر', blocking_key=key,
                              death_year_hijri=560, source='manual')
        work = Work.objects.create(display_title='الموطأ',
                                   normalized_title=normalize('الموطا'),
                                   source='manual')
        WorkName.objects.create(work=work, name='الموطأ',
                                normalized=normalize('الموطا'), kind='primary')
        self._run()
        shafii = EntityMention.objects.get(
            document=self.document, surface_text='الشافعي',
            extractor_name='ner_llm')
        self.assertEqual(shafii.person.display_name, 'الشافعي الكبير')
        muwatta = EntityMention.objects.get(
            document=self.document, entity_type='work_title')
        self.assertEqual(muwatta.work_id, work.id)
        # Ambiguous key WITHOUT death-year hint stays NIL.
        malik_key = normalize('مالك')
        Person.objects.create(display_name='مالك ١', blocking_key=malik_key,
                              source='manual')
        Person.objects.create(display_name='مالك ٢', blocking_key=malik_key,
                              source='manual')
        self._run(force=True)
        malik = EntityMention.objects.get(
            document=self.document, surface_text='مالك بن انس',
            superseded_at__isnull=True)
        self.assertIsNone(malik.person_id)

    def test_rerun_without_changes_is_noop(self):
        first = self._run()
        self.assertEqual(first.call_count, 1)
        second = self._run()
        self.assertEqual(second.call_count, 0)

    def test_edits_beyond_page_25_do_not_retrigger(self):
        long_content = '\f'.join(
            f'صفحه رقم {i} وفيها نص كاف للتجربه' for i in range(1, 31))
        document = Document.objects.create(
            title='مطول', file='documents/long.txt', content=long_content,
            processed=True)
        empty = ner.NerResult(stats={'emitted': 0, 'anchored': 0,
                                     'playbook': 'generic', 'windows': 0,
                                     'failed_windows': []})
        with mock.patch.object(ner, 'extract_document_entities',
                               return_value=empty) as mocked:
            ner_document_task.run(document.id)
            self.assertEqual(mocked.call_count, 1)
            # Mutate page 30 — outside the 25-page slice → no re-run.
            document.content = long_content + ' زياده في الاخر'
            document.save(update_fields=['content'])
            ner_document_task.run(document.id)
            self.assertEqual(mocked.call_count, 1)
            # Mutate page 3 — inside the slice → re-run.
            document.content = document.content.replace(
                'صفحه رقم 3 ', 'صفحه رقم 3 معدله ')
            document.save(update_fields=['content'])
            ner_document_task.run(document.id)
            self.assertEqual(mocked.call_count, 2)

    def test_supersede_and_verified_relation_survives(self):
        self._run()
        relation = EntityRelation.objects.get(predicate='taught')
        relation.human_verified = True
        relation.review_status = EntityMention.ReviewStatus.APPROVED
        relation.save(update_fields=['human_verified', 'review_status'])
        dedupe = relation.dedupe_key

        self._run(force=True)
        surviving = EntityRelation.objects.filter(dedupe_key=dedupe)
        self.assertEqual(surviving.count(), 1)
        survivor = surviving.get()
        self.assertTrue(survivor.human_verified)
        # Its machine subject mention was deleted on the re-run → SET_NULL.
        self.assertIsNone(survivor.subject_mention_id)
        # Machine rows were replaced, not duplicated.
        self.assertEqual(
            EntityRelation.objects.filter(document=self.document).count(), 2)

    def test_meta_pending_requeues_in_async_context(self):
        from extraction.models import DocumentMeta
        DocumentMeta.objects.create(document=self.document)  # status pending
        with mock.patch.object(ner, 'extract_document_entities') as extract, \
                mock.patch.object(ner_document_task, 'apply_async') as requeue:
            ner_document_task.apply(args=[self.document.id])
        extract.assert_not_called()
        requeue.assert_called_once()
        _args, kwargs = requeue.call_args
        self.assertEqual(kwargs['countdown'], 120)
        self.assertEqual(kwargs['kwargs']['meta_waits'], 1)

    def test_meta_pending_proceeds_in_sync_context(self):
        from extraction.models import DocumentMeta
        DocumentMeta.objects.create(document=self.document)  # status pending
        mocked = self._run()  # .run() has no request id → no waiting
        self.assertEqual(mocked.call_count, 1)

    def test_dead_key_is_loud_and_never_retries_in_sync(self):
        with mock.patch.object(
                ner, 'extract_document_entities',
                side_effect=RuntimeError('OPENROUTER_API_KEY is not configured')):
            ner_document_task.run(self.document.id)  # must not raise
        run = ExtractionRun.objects.get(
            document=self.document, extractor_name='ner_llm')
        self.assertEqual(run.status, ExtractionRun.Status.FAILED)
        self.assertIn('OPENROUTER_API_KEY', run.error)

    def test_transport_error_records_failure_in_sync(self):
        with mock.patch.object(ner, 'extract_document_entities',
                               side_effect=RuntimeError('connection reset')):
            ner_document_task.run(self.document.id)
        run = ExtractionRun.objects.get(
            document=self.document, extractor_name='ner_llm')
        self.assertEqual(run.status, ExtractionRun.Status.FAILED)


class RollupTests(TestCase):
    def setUp(self):
        self.document = Document.objects.create(
            title='كتاب', file='documents/r.txt', content='نص',
            processed=True)

    def test_new_rollup_keys(self):
        from extraction.rollup import build_document_entity_summary
        work = Work.objects.create(display_title='الرساله',
                                   normalized_title=normalize('الرساله'),
                                   source='manual')
        EntityMention.objects.create(
            document=self.document, page_number=1, char_start=0, char_end=4,
            surface_text='نصنص', normalized_text=normalize('الازهر'),
            entity_type='organization', extractor_name='ner_llm',
            extractor_version='1', content_hash='x')
        EntityMention.objects.create(
            document=self.document, page_number=1, char_start=5, char_end=9,
            surface_text='نصنص', normalized_text=normalize('الرساله'),
            entity_type='work_title', work=work, extractor_name='ner_llm',
            extractor_version='1', content_hash='x')
        rejected = EntityMention.objects.create(
            document=self.document, page_number=1, char_start=10, char_end=14,
            surface_text='نصنص', normalized_text='مرفوض',
            entity_type='organization', extractor_name='ner_llm',
            extractor_version='1', content_hash='x',
            review_status=EntityMention.ReviewStatus.REJECTED)
        EntityRelation.objects.create(
            document=self.document, predicate='commentary_on',
            page_number=1, char_start=0, char_end=4, evidence_text='نص',
            content_hash='x', extractor_name='ner_llm', extractor_version='1',
            dedupe_key='k1')

        summary = build_document_entity_summary(self.document)
        self.assertEqual(summary['organization_keys'], [normalize('الازهر')])
        self.assertEqual(summary['work_keys'], [f'w:{work.id}'])
        self.assertEqual(summary['relation_predicates'], ['commentary_on'])
        self.assertNotIn('مرفوض', summary['organization_keys'])
        self.assertTrue(rejected.id)


class NerApiTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='reader', email='reader@example.com', password='x')
        self.client.force_authenticate(user=self.user)
        self.document = Document.objects.create(
            title='كتاب', file='documents/a.txt', content='نص الصفحه',
            processed=True)

    def test_structure_endpoint_shape(self):
        DocumentStructuredExtraction.objects.create(
            document=self.document, kind='colophon',
            payload={'items': [{'text': 'تم النسخ'}]},
            page_refs=[{'page_number': 1, 'char_start': 0, 'char_end': 8}],
            confidence=0.8, extractor_name='ner_llm', extractor_version='1',
            model_id='m')
        DocumentStructuredExtraction.objects.create(
            document=self.document, kind='masthead', payload={},
            confidence=0.5, extractor_name='ner_llm', extractor_version='1',
            review_status=EntityMention.ReviewStatus.REJECTED)
        resp = self.client.get(
            f'/api/extraction/documents/{self.document.id}/structure/')
        self.assertEqual(resp.status_code, 200)
        structures = resp.json()['structures']
        self.assertIn('colophon', structures)
        self.assertNotIn('masthead', structures)  # rejected excluded
        self.assertEqual(structures['colophon']['payload']['items'][0]['text'],
                         'تم النسخ')

    def test_relations_endpoint_shape_and_filter(self):
        mention = EntityMention.objects.create(
            document=self.document, page_number=1, char_start=0, char_end=3,
            surface_text='نص', normalized_text='k', entity_type='person',
            extractor_name='ner_llm', extractor_version='1', content_hash='x')
        EntityRelation.objects.create(
            document=self.document, predicate='taught',
            subject_mention=mention, page_number=1, char_start=0, char_end=3,
            evidence_text='نص', content_hash='x', extractor_name='ner_llm',
            extractor_version='1', dedupe_key='k1')
        EntityRelation.objects.create(
            document=self.document, predicate='cites', object_text='الفتح',
            page_number=1, char_start=0, char_end=3, evidence_text='نص',
            content_hash='x', extractor_name='ner_llm', extractor_version='1',
            dedupe_key='k2')
        resp = self.client.get(
            f'/api/extraction/documents/{self.document.id}/relations/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['count'], 2)
        filtered = self.client.get(
            f'/api/extraction/documents/{self.document.id}/relations/'
            '?predicate=cites')
        body = filtered.json()
        self.assertEqual(body['count'], 1)
        self.assertEqual(body['relations'][0]['object']['text'], 'الفتح')

    def test_relations_404_on_missing_document(self):
        resp = self.client.get('/api/extraction/documents/999999/relations/')
        self.assertEqual(resp.status_code, 404)

    def test_works_typeahead_requires_auth_and_matches_normalized(self):
        work = Work.objects.create(
            display_title='فتح الباري', normalized_title=normalize('فتح الباري'),
            source='manual')
        WorkName.objects.create(work=work, name='الفتح',
                                normalized=normalize('الفتح'), kind='short')
        resp = self.client.get('/api/extraction/works/', {'q': 'فتح'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['count'], 1)
        self.client.force_authenticate(user=None)
        anon = self.client.get('/api/extraction/works/')
        self.assertIn(anon.status_code, (401, 403))
