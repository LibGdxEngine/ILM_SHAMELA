"""Stage 2 mapping tests, no network: locating mentions, pre-check drops,
assembly, and the prune -> write -> rehydrate roundtrip (incl. segment_id
re-derivation and the per-document ocr_source restore).
"""
import tempfile

from django.test import SimpleTestCase, override_settings

from extraction.kb import mapping
from extraction.kb.extract import (
    LLMAppraisal,
    LLMClaim,
    LLMMention,
    LLMNameComponents,
    LLMRelation,
    LLMWindowExtraction,
)
from extraction.kb.normalize import normalize_pages
from extraction.kb.schema import (
    ExtractionWindow,
    Segment,
    SegmentDetector,
    SegmentType,
    SegmentedDocument,
    TextSpan,
)

TEXT = 'توفي أَبُو عَبْدِ الله الشافعي بمصر سنة أربع ومائتين رحمه الله تعالى.'


def _fixture():
    nd = normalize_pages([{'page_number': 1, 'content': TEXT}], 'doc_1')
    nd.ocr_source = True
    seg = Segment(book_id='doc_1', segment_type=SegmentType.BIOGRAPHY,
                  span=TextSpan(start=0, end=len(nd.text)), order=0,
                  detector=SegmentDetector.MODEL)
    sdoc = SegmentedDocument(book_id='doc_1', text_length=len(nd.text),
                             segments=[seg])
    w = ExtractionWindow(
        context_span=TextSpan(start=0, end=len(nd.text)),
        focus_span=TextSpan(start=0, end=len(nd.text)),
        segment_ids=[seg.id])
    return nd, sdoc, seg, w


def _llm_out():
    return LLMWindowExtraction(
        mentions=[
            LLMMention(local_id='m1', label='person',
                       text='ابو عبد الله الشافعي',   # shadow tier must find it
                       name_components=LLMNameComponents(
                           kunya='أبو عبد الله', ism='محمد', nasab=['إدريس'],
                           nisba=['الشافعي'], shuhra='الشافعي')),
            LLMMention(local_id='m2', label='place', text='مصر',
                       normalized='مِصر'),
            LLMMention(local_id='m3', label='time', text='سنة أربع ومائتين',
                       hijri_year=204),
            LLMMention(local_id='m4', label='person', text='نص غير موجود بتاتا'),
        ],
        relations=[
            LLMRelation(relation_type='died_in', subject_local_id='m1',
                        object_local_id='m2', time_local_id='m3',
                        trigger='توفي'),
            # domain violation: place cannot author a person
            LLMRelation(relation_type='authored', subject_local_id='m2',
                        object_local_id='m1'),
        ],
        claims=[LLMClaim(predicate='death_date', subject_local_id='m1',
                         time_local_id='m3')],
        appraisals=[
            # critic == subject -> dropped
            LLMAppraisal(critic_local_id='m1', subject_local_id='m1',
                         verbatim='ثقة', polarity='tadil'),
        ])


class MapWindowTests(SimpleTestCase):
    def test_map_and_drops(self):
        nd, sdoc, seg, w = _fixture()
        seg_by_id = {seg.id: seg}
        mentions, relations, claims, appraisals, drops = mapping.map_window(
            'doc_1', nd, seg_by_id, w, _llm_out())

        self.assertEqual(len(mentions), 3)          # m4 not found
        self.assertEqual(len(relations), 1)         # authored dropped
        self.assertEqual(len(claims), 1)
        self.assertEqual(appraisals, [])            # identical parties dropped
        reasons = {d['reason'] for d in drops}
        self.assertIn('mention_not_found', reasons)
        self.assertIn('domain_range: place->person', reasons)
        self.assertIn('bad_parties_or_empty_verbatim', reasons)

        person = mentions[0]
        # Span points at the ORIGINAL text (diacritics intact) via the shadow.
        self.assertEqual(
            nd.text[person.provenance.span.start:person.provenance.span.end],
            person.surface_form)
        self.assertIn('الشافعي', person.surface_form)
        self.assertEqual(person.provenance.segment_id, seg.id)
        self.assertEqual(person.provenance.page, '1')
        self.assertTrue(person.provenance.ocr_source)
        time_m = mentions[2]
        self.assertEqual(time_m.parsed.date.year, 204)

    def test_prune_rehydrate_roundtrip(self):
        nd, sdoc, seg, w = _fixture()
        mentions, relations, claims, appraisals, drops = mapping.map_window(
            'doc_1', nd, {seg.id: seg}, w, _llm_out())
        ext = mapping.assemble_extraction('doc_1', mentions, relations, claims,
                                          appraisals, drops)
        pruned = mapping.prune_extraction(ext)
        # Constants are gone from disk form...
        for rec in pruned['mentions']:
            self.assertNotIn('book_id', rec['provenance'])
            self.assertNotIn('ocr_source', rec['provenance'])
            self.assertNotIn('linking_status', rec)
        # ...and come back on rehydrate, including per-document ocr_source
        # and the re-derived segment_id.
        back = mapping.rehydrate_extraction(pruned, sdoc, ocr_source=True)
        self.assertEqual(len(back.mentions), len(ext.mentions))
        for m in back.mentions:
            self.assertEqual(m.provenance.book_id, 'doc_1')
            self.assertTrue(m.provenance.ocr_source)
            self.assertEqual(m.provenance.segment_id, seg.id)
        # The full name analysis survives (disk_format 2), not just kunya/shuhra
        person = back.mentions[0]
        self.assertEqual(person.name_components.kunya, 'أبو عبد الله')
        self.assertEqual(person.name_components.shuhra, 'الشافعي')
        self.assertEqual(person.name_components.ism, 'محمد')
        self.assertEqual(person.name_components.nasab, ['إدريس'])
        self.assertEqual(person.name_components.nisba, ['الشافعي'])

    def test_prune_keeps_model_output(self):
        """normalized_form and trigger are real model output, so unlike the
        provenance constants they must survive the trip through disk."""
        nd, sdoc, seg, w = _fixture()
        mentions, relations, claims, appraisals, drops = mapping.map_window(
            'doc_1', nd, {seg.id: seg}, w, _llm_out())
        ext = mapping.assemble_extraction('doc_1', mentions, relations, claims,
                                          appraisals, drops)
        pruned = mapping.prune_extraction(ext)
        self.assertEqual(pruned['relations'][0]['trigger'], 'توفي')
        place = next(m for m in pruned['mentions'] if m['label'] == 'place')
        self.assertEqual(place['normalized_form'], 'مِصر')

        back = mapping.rehydrate_extraction(pruned, sdoc, ocr_source=True)
        self.assertEqual(back.relations[0].trigger, 'توفي')
        place_back = next(m for m in back.mentions if m.label == 'place')
        self.assertEqual(place_back.normalized_form, 'مِصر')

    def test_rehydrate_accepts_legacy_collapsed_name_components(self):
        """Every extraction.json written before the un-pruning fix carries a
        `name` key that NameComponents has no field for; it must be dropped
        rather than rejected, or old books become unreadable."""
        nd, sdoc, seg, w = _fixture()
        mentions, relations, claims, appraisals, drops = mapping.map_window(
            'doc_1', nd, {seg.id: seg}, w, _llm_out())
        ext = mapping.assemble_extraction('doc_1', mentions, relations, claims,
                                          appraisals, drops)
        legacy = mapping.prune_extraction(ext)
        for rec in legacy['mentions']:
            if rec.get('name_components'):
                rec['name_components'] = {'name': 'الشافعي',
                                          'kunya': 'أبو عبد الله',
                                          'shuhra': 'الشافعي'}
            rec.pop('normalized_form', None)
        for rec in legacy['relations']:
            rec.pop('trigger', None)

        back = mapping.rehydrate_extraction(legacy, sdoc, ocr_source=True)
        person = back.mentions[0]
        self.assertEqual(person.name_components.kunya, 'أبو عبد الله')
        self.assertEqual(person.name_components.shuhra, 'الشافعي')
        self.assertIsNone(person.name_components.ism)
        self.assertIsNone(back.relations[0].trigger)

    def test_assemble_drops_dangling_reference(self):
        nd, sdoc, seg, w = _fixture()
        mentions, relations, claims, appraisals, drops = mapping.map_window(
            'doc_1', nd, {seg.id: seg}, w, _llm_out())
        # Sabotage: point the claim at a mention that will not be present.
        claims[0].subject_mention_id = 'men_000000000000'
        ext = mapping.assemble_extraction('doc_1', mentions, relations, claims,
                                          appraisals, drops)
        self.assertEqual(len(ext.claims), 0)
        self.assertTrue(any(d['kind'] == 'assembly' for d in drops))


class LoadExtractionTests(SimpleTestCase):
    def test_load_extraction_reads_files_back(self):
        import json

        from extraction.kb import config, io_utils, split

        with tempfile.TemporaryDirectory() as tmp:
            with override_settings(KB_DATA_DIR=tmp):
                nd, sdoc, seg, w = _fixture()
                split.save_segments('doc_1', nd, sdoc, {'total': 0},
                                    document_id=1)
                mentions, relations, claims, appraisals, drops = \
                    mapping.map_window('doc_1', nd, {seg.id: seg}, w, _llm_out())
                ext = mapping.assemble_extraction(
                    'doc_1', mentions, relations, claims, appraisals, drops)
                io_utils.atomic_write_text(
                    config.output_dir('doc_1') / 'extraction.json',
                    json.dumps(mapping.prune_extraction(ext), ensure_ascii=False))
                io_utils.atomic_write_text(
                    config.output_dir('doc_1') / 'extraction_meta.json',
                    json.dumps({'ocr_source': True}))
                back = mapping.load_extraction('doc_1')
                self.assertIsNotNone(back)
                self.assertEqual(len(back.mentions), 3)
                self.assertTrue(back.mentions[0].provenance.ocr_source)
                self.assertEqual(back.mentions[0].provenance.segment_id, seg.id)
