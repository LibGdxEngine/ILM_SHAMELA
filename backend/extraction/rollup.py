"""Document-level entity rollups for the ES index.

``build_document_entity_summary`` aggregates a document's ACTIVE, non-rejected
mentions + its Layer-0 metadata into flattened keyword/integer fields for the
``documents`` index (facet pushdown happens inside the ES filter, closing the
top-200 post-filter gap). Called lazily from ``DocumentIndex.prepare`` with an
empty-dict fallback, so indexing never breaks if extraction data is absent.

Key formats:
- ``person_keys``: ``p:<person_pk>`` when canonically linked, else
  ``k:<blocking_key>``
- ``place_keys``: ``pl:<place_pk>``, plus the normalized surface for
  unlinked mentions (rare)
- ``quran_suras``: sura ints; ``quran_ayas``: ``"2:255"`` keywords
- ``hadith_collections``: collection slugs (``bukhari``, ``muttafaq`` …)
"""
from typing import Dict, List


def build_document_entity_summary(document) -> Dict[str, object]:
    from .models import DocumentMeta, EntityMention

    summary: Dict[str, object] = {}

    meta = DocumentMeta.objects.filter(
        document=document, status=DocumentMeta.Status.SUCCEEDED).first()
    if meta:
        summary['genre'] = meta.genre or ''
        summary['madhhab'] = meta.madhhab or ''
        summary['era_century'] = meta.era_century
        summary['register'] = meta.register or ''
        summary['physical_class'] = meta.physical_class or ''

    mentions = EntityMention.objects.filter(
        document=document, superseded_at__isnull=True,
    ).exclude(review_status=EntityMention.ReviewStatus.REJECTED).values_list(
        'entity_type', 'normalized_text', 'normalized', 'person_id', 'place_id',
        'work_id')

    person_keys: set = set()
    place_keys: set = set()
    quran_suras: set = set()
    quran_ayas: set = set()
    hadith_collections: set = set()
    organization_keys: set = set()
    work_keys: set = set()

    for entity_type, normalized_text, normalized, person_id, place_id, work_id \
            in mentions:
        payload = normalized or {}
        if entity_type == 'person':
            person_keys.add(f'p:{person_id}' if person_id else f'k:{normalized_text}')
        elif entity_type == 'place':
            place_keys.add(f'pl:{place_id}' if place_id else normalized_text)
        elif entity_type == 'quran':
            sura = payload.get('sura')
            if isinstance(sura, int):
                quran_suras.add(sura)
                aya_start = payload.get('aya_start')
                aya_end = payload.get('aya_end') or aya_start
                if isinstance(aya_start, int) and isinstance(aya_end, int):
                    for aya in range(aya_start, min(aya_end, aya_start + 20) + 1):
                        quran_ayas.add(f'{sura}:{aya}')
        elif entity_type == 'hadith_source':
            slug = payload.get('collection') or normalized_text.split(':', 1)[0]
            if slug:
                hadith_collections.add(slug)
        elif entity_type == 'organization':
            if normalized_text:
                organization_keys.add(normalized_text)
        elif entity_type == 'work_title':
            work_keys.add(f'w:{work_id}' if work_id else normalized_text)

    from .models import EntityRelation
    relation_predicates = sorted(
        EntityRelation.objects.filter(
            document=document, superseded_at__isnull=True,
        ).exclude(review_status=EntityMention.ReviewStatus.REJECTED)
        .values_list('predicate', flat=True).distinct())

    summary['person_keys'] = sorted(person_keys)
    summary['place_keys'] = sorted(place_keys)
    summary['quran_suras'] = sorted(quran_suras)
    summary['quran_ayas'] = sorted(quran_ayas)
    summary['hadith_collections'] = sorted(hadith_collections)
    summary['organization_keys'] = sorted(organization_keys)[:200]
    # Cap keeps noisy title extractions from bloating the mapping.
    summary['work_keys'] = sorted(work_keys)[:200]
    summary['relation_predicates'] = relation_predicates
    return summary


def refresh_document_index(document) -> None:
    """Re-save one document into ES so its rollup fields update (called from
    the extraction tasks after a successful run; best-effort)."""
    from search_engine.documents import DocumentIndex

    if not document.processed:
        return
    index_doc = DocumentIndex(meta={'id': document.id})
    index_doc.prepare(document)
    index_doc.save()


def update_mention_doc_counts() -> None:
    """Refresh the denormalized Person/Place ``mention_doc_count`` (typeahead
    ordering). Cheap at current scale; run after backfills."""
    from django.db.models import Count

    from .models import EntityMention, Person, Place

    person_counts = dict(
        EntityMention.objects.filter(
            superseded_at__isnull=True, person__isnull=False,
        ).values_list('person_id').annotate(n=Count('document_id', distinct=True)))
    for person in Person.objects.all():
        count = person_counts.get(person.id, 0)
        if person.mention_doc_count != count:
            Person.objects.filter(id=person.id).update(mention_doc_count=count)

    place_counts = dict(
        EntityMention.objects.filter(
            superseded_at__isnull=True, place__isnull=False,
        ).values_list('place_id').annotate(n=Count('document_id', distinct=True)))
    for place in Place.objects.all():
        count = place_counts.get(place.id, 0)
        if place.mention_doc_count != count:
            Place.objects.filter(id=place.id).update(mention_doc_count=count)
