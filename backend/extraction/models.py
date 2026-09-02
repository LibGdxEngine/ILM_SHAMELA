"""Standoff entity-annotation layer over ``search_engine`` documents.

Design contract (mirrors the repo's existing offset convention used by
``Highlight``, ``TextCorrection`` and ``DocumentChunk.layout.blocks``):

- Every mention anchors to ``(document, page_number, char_start, char_end)``
  where the offsets index into that page's content string — NEVER to a
  ``DocumentChunk`` pk (chunks are destroyed and rebuilt on every reprocess).
- Every mention stores the ``content_hash`` of the page at extraction time so
  reprocess drift is detectable: superseded machine output is re-extracted;
  human-verified rows are never deleted, only flagged ``orphaned``.
- Competing annotation versions coexist: each (extractor_name,
  extractor_version) run keeps its own rows; a newer successful run marks the
  older version's rows ``superseded_at``. Serving queries always filter
  ``superseded_at__isnull=True``.

KB-layer rows (``Kb*``) follow all of the above and add a second, authoritative
coordinate system: ``(doc_char_start, doc_char_end)`` are ABSOLUTE offsets into
the *normalized* document text built by ``extraction.kb.normalize`` — the only
space the KB pipeline produces, and the one its spans and segments agree in.
``(page_number, page_char_start, page_char_end)`` is a derived best-effort
projection onto RAW page content for the reader overlay: the normalizer
collapses whitespace and strips markdown, so page offsets are re-located by
matching the surface form rather than by subtracting a page start. They are
nullable, and a client must verify them against ``content_hash`` before
rendering.
"""
from django.conf import settings
from django.db import models
from django.db.models import F, Q

from .kb import choices as kb_choices


class ExtractionRun(models.Model):
    """One execution of one extractor version over one document."""

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        RUNNING = 'running', 'Running'
        SUCCEEDED = 'succeeded', 'Succeeded'
        FAILED = 'failed', 'Failed'

    document = models.ForeignKey(
        'search_engine.Document', on_delete=models.CASCADE, related_name='extraction_runs')
    extractor_name = models.CharField(max_length=50)
    extractor_version = models.CharField(max_length=20)
    status = models.CharField(
        max_length=12, choices=Status.choices, default=Status.PENDING)
    corpus_hash = models.CharField(
        max_length=64, blank=True, default='',
        help_text='sha256 over the ordered page hashes at extraction time — '
                  'unchanged hash ⇒ re-run is a no-op')
    mention_count = models.PositiveIntegerField(default=0)
    error = models.TextField(blank=True, default='')
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    # KB layer only — blank for the deterministic extractors, layer0 and ner.
    persisted_at = models.DateTimeField(
        null=True, blank=True,
        help_text='When this run was last projected into the extraction_kb_* tables')
    persisted_hash = models.CharField(
        max_length=64, blank=True, default='',
        help_text='sha256(normalized-text hash | persist version | disk format) of '
                  'the data currently in the extraction_kb_* tables. Empty or '
                  'mismatched ⇒ the projection is stale and will be redone. '
                  'Deliberately independent of corpus_hash so the writer can be '
                  'fixed and replayed without invalidating paid LLM caches.')

    class Meta:
        db_table = 'extraction_runs'
        unique_together = [['document', 'extractor_name', 'extractor_version']]
        indexes = [models.Index(fields=['extractor_name', 'status'])]

    def __str__(self):
        return f'{self.extractor_name}@{self.extractor_version} on doc {self.document_id} [{self.status}]'


class Person(models.Model):
    """Canonical person record (أعلام) with structured Arabic name parts.

    Created conservatively by the deterministic extractor (death-year-anchored
    mentions or Author-seeded records); full disambiguation/linking is a later
    layer — ``wikidata_id``/``viaf_id`` are its landing slots.
    """

    class Source(models.TextChoices):
        EXTRACTED = 'extracted', 'Extracted'
        AUTHOR_IMPORT = 'author_import', 'Author import'
        MANUAL = 'manual', 'Manual'

    display_name = models.CharField(max_length=255)
    ism = models.CharField(max_length=100, blank=True, default='')
    kunya = models.CharField(max_length=100, blank=True, default='')
    nasab = models.CharField(max_length=255, blank=True, default='')
    nisba = models.CharField(max_length=100, blank=True, default='')
    laqab = models.CharField(max_length=100, blank=True, default='')
    shuhra = models.CharField(max_length=150, blank=True, default='')
    honorific_class = models.CharField(
        max_length=30, blank=True, default='',
        help_text="Status signal from honorifics: 'prophet', 'sahabi', '' …")
    aliases = models.JSONField(default=list, blank=True)
    blocking_key = models.CharField(
        max_length=150, db_index=True,
        help_text='Normalized shuhra/kunya/ism — groups candidate duplicates')
    death_date_raw = models.CharField(max_length=100, blank=True, default='')
    death_year_hijri = models.IntegerField(null=True, blank=True)
    death_century = models.IntegerField(null=True, blank=True, db_index=True)
    author = models.ForeignKey(
        'search_engine.Author', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='persons')
    wikidata_id = models.CharField(max_length=32, blank=True, default='')
    viaf_id = models.CharField(max_length=32, blank=True, default='')
    source = models.CharField(max_length=20, choices=Source.choices)
    review_status = models.CharField(max_length=10, default='pending', db_index=True)
    mention_doc_count = models.PositiveIntegerField(
        default=0, help_text='Denormalized distinct-document mention count (typeahead ordering)')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'extraction_persons'
        indexes = [models.Index(fields=['-mention_doc_count'])]

    def __str__(self):
        return self.display_name


class Place(models.Model):
    """Canonical toponym; the surface-form gazetteer lives in ``PlaceName``."""

    class Source(models.TextChoices):
        THURAYYA = 'thurayya', 'al-Thurayya'
        GEONAMES = 'geonames', 'GeoNames'
        MANUAL = 'manual', 'Manual'

    name = models.CharField(max_length=255)
    name_translit = models.CharField(max_length=255, blank=True, default='')
    modern_name = models.CharField(max_length=255, blank=True, default='')
    feature_type = models.CharField(max_length=30, blank=True, default='')
    lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    lon = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    source = models.CharField(max_length=20, choices=Source.choices)
    source_id = models.CharField(max_length=64)
    wikidata_id = models.CharField(max_length=32, blank=True, default='')
    mention_doc_count = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = 'extraction_places'
        unique_together = [['source', 'source_id']]

    def __str__(self):
        return self.name


class PlaceName(models.Model):
    """Pre-normalized surface forms for gazetteer matching."""

    class Kind(models.TextChoices):
        PRIMARY = 'primary', 'Primary'
        VARIANT = 'variant', 'Variant'
        HISTORICAL = 'historical', 'Historical'
        NISBA = 'nisba', 'Nisba'

    place = models.ForeignKey(Place, on_delete=models.CASCADE, related_name='names')
    name = models.CharField(max_length=255)
    normalized = models.CharField(max_length=255, db_index=True)
    kind = models.CharField(max_length=12, choices=Kind.choices)

    class Meta:
        db_table = 'extraction_place_names'
        unique_together = [['place', 'normalized', 'kind']]

    def __str__(self):
        return f'{self.name} ({self.kind})'


class Work(models.Model):
    """Canonical work/book record — the backbone of the commentary tree
    (شرح/حاشية/مختصر edges land on these via ``EntityRelation``).

    Same creation policy as ``Person``: rows are made only by ``seed_works``
    or a human in the admin — the extractor resolves against existing rows
    and otherwise leaves free-text tails. ``wikidata_id``/``openiti_id``/
    ``shamela_id`` are landing slots for the external-linking layer.
    """

    class Source(models.TextChoices):
        EXTRACTED = 'extracted', 'Extracted'
        LIBRARY_IMPORT = 'library_import', 'Library import'
        MANUAL = 'manual', 'Manual'

    display_title = models.CharField(max_length=255)
    normalized_title = models.CharField(max_length=255, db_index=True)
    author = models.ForeignKey(
        Person, null=True, blank=True, on_delete=models.SET_NULL, related_name='works')
    document = models.ForeignKey(
        'search_engine.Document', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='canonical_works',
        help_text="The library's own copy of this work, when we hold one")
    wikidata_id = models.CharField(max_length=32, blank=True, default='')
    openiti_id = models.CharField(max_length=64, blank=True, default='')
    shamela_id = models.CharField(max_length=32, blank=True, default='')
    source = models.CharField(max_length=20, choices=Source.choices)
    review_status = models.CharField(max_length=10, default='pending', db_index=True)
    mention_doc_count = models.PositiveIntegerField(
        default=0, help_text='Denormalized distinct-document mention count (typeahead ordering)')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'extraction_works'
        indexes = [models.Index(fields=['-mention_doc_count'])]

    def __str__(self):
        return self.display_title


class WorkName(models.Model):
    """Pre-normalized title surface forms for work resolution."""

    class Kind(models.TextChoices):
        PRIMARY = 'primary', 'Primary'
        VARIANT = 'variant', 'Variant'
        SHORT = 'short', 'Short title'

    work = models.ForeignKey(Work, on_delete=models.CASCADE, related_name='names')
    name = models.CharField(max_length=255)
    normalized = models.CharField(max_length=255, db_index=True)
    kind = models.CharField(max_length=12, choices=Kind.choices)

    class Meta:
        db_table = 'extraction_work_names'
        unique_together = [['work', 'normalized', 'kind']]

    def __str__(self):
        return f'{self.name} ({self.kind})'


class EntityMention(models.Model):
    """One standoff entity annotation (see module docstring for the contract)."""

    class EntityType(models.TextChoices):
        PERSON = 'person', 'Person'
        PLACE = 'place', 'Place'
        DATE = 'date', 'Date'
        QURAN = 'quran', 'Quran citation'
        HADITH_SOURCE = 'hadith_source', 'Hadith takhrij'
        # Layer-1 universal types (LLM NER pass). LLM PERSON/LOCATION/DATE
        # map onto the existing person/place/date values above so the reader
        # overlay and rollups treat both extractors uniformly.
        ORGANIZATION = 'organization', 'Organization'
        WORK_TITLE = 'work_title', 'Work title'
        EVENT = 'event', 'Event'
        MONEY = 'money', 'Money'
        MEASURE = 'measure', 'Measure'
        PERCENT = 'percent', 'Percent'
        LAW_REGULATION = 'law_regulation', 'Law / regulation'
        PRODUCT_BRAND = 'product_brand', 'Product / brand'
        ID_NUMBER = 'id_number', 'Identifier'
        # Layer-2 structural spans — ordinary standoff rows so the
        # supersede/orphan lifecycle applies; structured detail (bahr/qafiya,
        # transmitter_count, speaker…) rides in ``normalized``.
        ISNAD = 'isnad', 'Isnad chain span'
        MATN = 'matn', 'Matn span'
        POETRY = 'poetry', 'Poetry span'
        QUOTE = 'quote', 'Quotation span'

    class ReviewStatus(models.TextChoices):
        AUTO = 'auto', 'Auto (high confidence)'
        PENDING = 'pending', 'Pending review'
        APPROVED = 'approved', 'Approved'
        REJECTED = 'rejected', 'Rejected'
        ORPHANED = 'orphaned', 'Orphaned (page changed)'

    document = models.ForeignKey(
        'search_engine.Document', on_delete=models.CASCADE, related_name='entity_mentions')
    page_number = models.PositiveIntegerField()
    char_start = models.PositiveIntegerField()
    char_end = models.PositiveIntegerField()
    surface_text = models.TextField()
    normalized_text = models.CharField(
        max_length=255, db_index=True,
        help_text="Grouping key: 'quran:2:255', 'bukhari:52', 'hijri:728', a "
                  'person blocking key, a place normalized name…')
    normalized = models.JSONField(default=dict, blank=True)
    entity_type = models.CharField(max_length=20, choices=EntityType.choices)
    person = models.ForeignKey(
        Person, null=True, blank=True, on_delete=models.SET_NULL, related_name='mentions')
    place = models.ForeignKey(
        Place, null=True, blank=True, on_delete=models.SET_NULL, related_name='mentions')
    work = models.ForeignKey(
        Work, null=True, blank=True, on_delete=models.SET_NULL, related_name='mentions')
    confidence = models.FloatField(default=1.0)
    extractor_name = models.CharField(max_length=50)
    extractor_version = models.CharField(max_length=20)
    content_hash = models.CharField(
        max_length=64, help_text='sha256 of the page content at extraction time')
    review_status = models.CharField(
        max_length=10, choices=ReviewStatus.choices, default=ReviewStatus.AUTO,
        db_index=True)
    human_verified = models.BooleanField(default=False)
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='+')
    superseded_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'extraction_entity_mentions'
        constraints = [
            models.CheckConstraint(
                check=Q(char_end__gt=F('char_start')), name='mention_span_valid'),
            models.UniqueConstraint(
                fields=['document', 'extractor_name', 'extractor_version',
                        'entity_type', 'page_number', 'char_start', 'char_end'],
                name='mention_unique_per_version'),
        ]
        indexes = [
            models.Index(
                fields=['document', 'page_number'],
                condition=Q(superseded_at__isnull=True),
                name='mention_active_page_idx'),
            models.Index(
                fields=['entity_type', 'normalized_text'],
                condition=Q(superseded_at__isnull=True),
                name='mention_active_key_idx'),
            models.Index(fields=['review_status', 'confidence']),
        ]

    def __str__(self):
        return f'{self.entity_type}:{self.normalized_text} @doc{self.document_id} p{self.page_number}'


class DocumentMeta(models.Model):
    """Layer-0 document classification (genre / madhhab / era / register /
    physical class), LLM-derived with per-field confidence and its own review
    lifecycle — kept OneToOne here (not fields on Document) so extraction data
    stays versioned/reviewable and out of search_engine's migration chain."""

    GENRES = [
        ('fiqh', 'فقه'), ('usul_fiqh', 'أصول الفقه'), ('hadith', 'حديث'),
        ('tafsir', 'تفسير'), ('ulum_quran', 'علوم القرآن'), ('aqida', 'عقيدة'),
        ('sira', 'سيرة'), ('tarikh', 'تاريخ'), ('tarajim', 'تراجم وطبقات'),
        ('adab', 'أدب'), ('lugha', 'لغة ونحو وصرف'), ('tasawwuf', 'تصوف وسلوك'),
        ('tibb', 'طب'), ('falsafa_mantiq', 'فلسفة ومنطق'), ('fatawa', 'فتاوى'),
        ('ansab', 'أنساب'), ('jughrafiya', 'جغرافيا ورحلات'), ('other', 'أخرى'),
    ]
    MADHHABS = [
        ('hanafi', 'حنفي'), ('maliki', 'مالكي'), ('shafii', 'شافعي'),
        ('hanbali', 'حنبلي'), ('zahiri', 'ظاهري'), ('jafari', 'جعفري'),
        ('zaydi', 'زيدي'), ('ibadi', 'إباضي'), ('multi', 'مقارن/متعدد'),
        ('na', 'لا ينطبق'), ('unknown', 'غير محدد'),
    ]
    REGISTERS = [
        ('classical', 'فصحى تراثية'), ('modern', 'فصحى حديثة'),
        ('mixed', 'مختلط'), ('non_arabic', 'غير عربي'),
    ]
    PHYSICAL = [
        ('printed_book', 'كتاب مطبوع'), ('newspaper', 'صحيفة/مجلة'),
        ('manuscript_scan', 'مخطوط'), ('thesis', 'رسالة جامعية'), ('other', 'أخرى'),
    ]

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        SUCCEEDED = 'succeeded', 'Succeeded'
        FAILED = 'failed', 'Failed'

    document = models.OneToOneField(
        'search_engine.Document', on_delete=models.CASCADE, related_name='extracted_meta')
    genre = models.CharField(
        max_length=30, choices=GENRES, blank=True, default='', db_index=True)
    genres_secondary = models.JSONField(default=list, blank=True)
    genre_confidence = models.FloatField(null=True, blank=True)
    madhhab = models.CharField(
        max_length=20, choices=MADHHABS, blank=True, default='', db_index=True)
    madhhab_confidence = models.FloatField(null=True, blank=True)
    era_century = models.IntegerField(
        null=True, blank=True, db_index=True,
        help_text='Hijri century of COMPOSITION (distinct from author death century)')
    era_confidence = models.FloatField(null=True, blank=True)
    register = models.CharField(max_length=20, choices=REGISTERS, blank=True, default='')
    register_confidence = models.FloatField(null=True, blank=True)
    physical_class = models.CharField(
        max_length=20, choices=PHYSICAL, blank=True, default='', db_index=True)
    physical_confidence = models.FloatField(null=True, blank=True)
    evidence = models.JSONField(
        default=dict, blank=True, help_text='field → short verbatim quote justifying it')
    extractor_version = models.CharField(max_length=20, default='')
    model_id = models.CharField(max_length=100, blank=True, default='')
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.PENDING, db_index=True)
    degraded_reason = models.TextField(
        blank=True, default='',
        help_text='Loud failure surface — a dead OPENROUTER_API_KEY must never fail silently')
    attempts = models.PositiveIntegerField(default=0)
    human_verified = models.BooleanField(
        default=False, db_index=True,
        help_text='Verified classifications are never overwritten by LLM re-runs')
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'extraction_document_meta'
        verbose_name = 'Document metadata'
        verbose_name_plural = 'Document metadata'

    def __str__(self):
        return f'meta for doc {self.document_id} [{self.status}]'


class EntityRelation(models.Model):
    """Knowledge-graph edge with a span-anchored evidence quote, following the
    same supersede/orphan contract as ``EntityMention``.

    Endpoints are mention FKs with ``SET_NULL`` (a human-verified relation must
    survive the deletion of same-version machine mentions on re-runs) plus
    denormalized canonical FKs and free-text fallbacks for endpoints that have
    no mention/canonical row (offices, madhhabs, works we don't hold).
    Isnad chains serialize as ordered ``transmitted_to`` edges whose
    ``qualifiers`` carry ``{verb, position, tahwil_group, chain_key}``.
    """

    class Predicate(models.TextChoices):
        # person → person
        TAUGHT = 'taught', 'Teacher of'
        TRANSMITTED_TO = 'transmitted_to', 'Isnad edge'
        PARENT_OF = 'parent_of', 'Parent of'
        SPOUSE_OF = 'spouse_of', 'Spouse of'
        SIBLING_OF = 'sibling_of', 'Sibling of'
        KIN_OF = 'kin_of', 'Kin of'
        # person → work / work → work
        AUTHORED = 'authored', 'Authored'
        COMMENTARY_ON = 'commentary_on', 'شرح على'
        GLOSS_ON = 'gloss_on', 'حاشية على'
        ABRIDGMENT_OF = 'abridgment_of', 'مختصر لـ'
        REFUTATION_OF = 'refutation_of', 'رد على'
        VERSIFICATION_OF = 'versification_of', 'نظم لـ'
        TAKHRIJ_OF = 'takhrij_of', 'تخريج لـ'
        CITES = 'cites', 'Cites'
        # person → place, typed by role
        BORN_IN = 'born_in', 'Born in'
        DIED_IN = 'died_in', 'Died in'
        RESIDED_IN = 'resided_in', 'Resided in'
        TRAVELED_TO = 'traveled_to', 'Traveled to'
        HELD_OFFICE = 'held_office', 'Held office'
        # person → attribute
        ADHERES_TO = 'adheres_to', 'Madhhab of'
        BORN_ON = 'born_on', 'Born on'
        DIED_ON = 'died_on', 'Died on'
        DATED_EVENT = 'dated_event', 'Dated event'  # qualifiers.kind: journey|office
        # quote → speaker
        ATTRIBUTED_TO = 'attributed_to', 'Spoken by'

    document = models.ForeignKey(
        'search_engine.Document', on_delete=models.CASCADE, related_name='entity_relations')
    predicate = models.CharField(max_length=20, choices=Predicate.choices, db_index=True)
    subject_mention = models.ForeignKey(
        EntityMention, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='relations_as_subject')
    object_mention = models.ForeignKey(
        EntityMention, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='relations_as_object')
    subject_person = models.ForeignKey(
        Person, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    object_person = models.ForeignKey(
        Person, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    object_place = models.ForeignKey(
        Place, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    object_work = models.ForeignKey(
        Work, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    subject_text = models.CharField(max_length=255, blank=True, default='')
    object_text = models.CharField(max_length=255, blank=True, default='')
    qualifiers = models.JSONField(default=dict, blank=True)
    # Evidence span — same page-offset contract as EntityMention.
    page_number = models.PositiveIntegerField()
    char_start = models.PositiveIntegerField()
    char_end = models.PositiveIntegerField()
    evidence_text = models.TextField()
    content_hash = models.CharField(
        max_length=64, help_text='sha256 of the page content at extraction time')
    confidence = models.FloatField(default=1.0)
    extractor_name = models.CharField(max_length=50)
    extractor_version = models.CharField(max_length=20)
    dedupe_key = models.CharField(
        max_length=64,
        help_text='sha256(predicate|subject key|object key|page|start|end) — '
                  'free-text tails keep multi-column uniqueness impractical')
    review_status = models.CharField(
        max_length=10, choices=EntityMention.ReviewStatus.choices,
        default=EntityMention.ReviewStatus.AUTO, db_index=True)
    human_verified = models.BooleanField(default=False)
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='+')
    superseded_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'extraction_entity_relations'
        constraints = [
            models.CheckConstraint(
                check=Q(char_end__gt=F('char_start')), name='relation_span_valid'),
            models.UniqueConstraint(
                fields=['document', 'extractor_name', 'extractor_version', 'dedupe_key'],
                name='relation_unique_per_version'),
        ]
        indexes = [
            models.Index(
                fields=['document', 'predicate'],
                condition=Q(superseded_at__isnull=True),
                name='relation_active_pred_idx'),
        ]

    def __str__(self):
        return f'{self.predicate} @doc{self.document_id} p{self.page_number}'


class DocumentStructuredExtraction(models.Model):
    """Document-level structured output of the LLM NER pass — material with no
    single anchoring span (paper front matter, press masthead, colophon, fatwa
    units…). ``page_refs`` keeps best-effort span anchors into the pages the
    payload was assembled from."""

    class Kind(models.TextChoices):
        PAPER_META = 'paper_meta', 'Academic front matter'
        REFERENCES = 'references', 'Structured references'
        CAPTIONS = 'captions', 'Figure/table captions'
        MASTHEAD = 'masthead', 'Press masthead'
        ARTICLES = 'articles', 'Press article units'
        ADS = 'ads', 'Advertisement segments'
        OBITUARIES = 'obituaries', 'Obituary units'
        COLOPHON = 'colophon', 'Manuscript colophon'
        CODICOLOGY = 'codicology', 'Ownership/waqf/samaat/shelfmark/marginalia'
        ARCHIVAL_DEED = 'archival_deed', 'Deed: parties/witnesses/qadi/boundaries'
        FATWA_UNITS = 'fatwa_units', 'Fatwa question/answer units'

    document = models.ForeignKey(
        'search_engine.Document', on_delete=models.CASCADE,
        related_name='structured_extractions')
    kind = models.CharField(max_length=20, choices=Kind.choices, db_index=True)
    payload = models.JSONField(default=dict, blank=True)
    page_refs = models.JSONField(
        default=list, blank=True,
        help_text="[{'page_number', 'char_start', 'char_end'}] best-effort anchors")
    confidence = models.FloatField(default=1.0)
    extractor_name = models.CharField(max_length=50)
    extractor_version = models.CharField(max_length=20)
    model_id = models.CharField(max_length=100, blank=True, default='')
    review_status = models.CharField(
        max_length=10, choices=EntityMention.ReviewStatus.choices,
        default=EntityMention.ReviewStatus.AUTO, db_index=True)
    human_verified = models.BooleanField(default=False)
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='+')
    superseded_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'extraction_document_structures'
        constraints = [
            models.UniqueConstraint(
                fields=['document', 'kind', 'extractor_name', 'extractor_version'],
                name='structure_unique_per_version'),
        ]

    def __str__(self):
        return f'{self.kind} @doc{self.document_id}'


# =============================================================================
# KB layer — the mention-level projection of extraction/kb/ pipeline output.
#
# Files under KB_DATA_DIR stay the source of truth; these tables are a
# rebuildable projection written by ``extraction.kb.persist`` (see
# ``manage.py backfill_kb_to_db``). The vocabularies are NOT re-declared here:
# they are derived from the pydantic enums in ``kb/schema.py`` via
# ``kb/choices.py``, so the ORM can never drift from the extraction schema.
#
# The structural layer (segments) has no table of its own — ``segments.json``
# remains its only home. The part worth querying, ``segment_type``, is
# denormalized onto every row below, so "every appraisal inside a biography"
# stays one indexed lookup.
# =============================================================================


class _KbRowMixin(models.Model):
    """Shared anchoring, provenance and review-lifecycle block for KB rows.

    An abstract model rather than the copy-paste used by the older tables: four
    models repeating ~20 identical fields is where that convention stops paying
    for itself. It adds no table and no query of its own.
    """

    document = models.ForeignKey(
        'search_engine.Document', on_delete=models.CASCADE, related_name='+')
    source_id = models.CharField(
        max_length=20, blank=True, default='',
        help_text="The pipeline's own id ('men_a1b2c3d4e5f6'). Regenerated on "
                  'every run (uuid4) — diagnostic only, never identity.')

    # Absolute offsets into the normalized document text — authoritative.
    doc_char_start = models.PositiveIntegerField()
    doc_char_end = models.PositiveIntegerField()
    # Derived projection onto raw page content — best effort, may be NULL.
    page_number = models.PositiveIntegerField()
    page_char_start = models.PositiveIntegerField(null=True, blank=True)
    page_char_end = models.PositiveIntegerField(null=True, blank=True)
    content_hash = models.CharField(
        max_length=64, blank=True, default='',
        help_text='sha256 of the raw page content at extraction time')

    segment_source_id = models.CharField(
        max_length=20, blank=True, default='',
        help_text='segments.json id of the enclosing structural unit; valid only '
                  'within the run that produced it')
    segment_type = models.CharField(
        max_length=kb_choices.SEGMENT_TYPE_MAX, blank=True, default='',
        choices=kb_choices.SEGMENT_TYPE_CHOICES,
        help_text='Denormalized from segments.json: biography / isnad / matn / '
                  'annal… — what keeps the structural layer queryable')

    stream = models.CharField(
        max_length=kb_choices.TEXT_STREAM_MAX, choices=kb_choices.TEXT_STREAM_CHOICES,
        default='main')
    extraction_method = models.CharField(
        max_length=kb_choices.EXTRACTION_METHOD_MAX,
        choices=kb_choices.EXTRACTION_METHOD_CHOICES, default='llm')
    ocr_source = models.BooleanField(default=False)
    extracted_at = models.DateTimeField(
        null=True, blank=True,
        help_text='When the pipeline produced this — distinct from created_at, '
                  'which is when the projection wrote the row')
    confidence = models.FloatField(
        default=1.0,
        help_text='Always 1.0 from the LLM pipeline (see kb/mapping.py) — kept for '
                  'parity with EntityMention and for future human/model passes')

    extractor_name = models.CharField(max_length=50)
    extractor_version = models.CharField(max_length=20)
    review_status = models.CharField(
        max_length=10, choices=EntityMention.ReviewStatus.choices,
        default=EntityMention.ReviewStatus.AUTO, db_index=True)
    human_verified = models.BooleanField(default=False)
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='+')
    superseded_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        abstract = True


class KbMention(_KbRowMixin):
    """One KB-pipeline mention (12 labels, including time and quotation)."""

    document = models.ForeignKey(
        'search_engine.Document', on_delete=models.CASCADE, related_name='kb_mentions')

    label = models.CharField(
        max_length=kb_choices.MENTION_LABEL_MAX,
        choices=kb_choices.MENTION_LABEL_CHOICES)
    surface_form = models.TextField()
    normalized_form = models.CharField(
        max_length=255, blank=True, default='', db_index=True,
        help_text="Canonical form when it differs from the text ('أسلم' → "
                  "'الإسلام'). The KB analogue of EntityMention.normalized_text.")
    blocking_key = models.CharField(
        max_length=150, blank=True, default='',
        help_text='Entity-resolution grouping key, same vocabulary as '
                  'Person.blocking_key. Empty until the linking phase exists.')
    ref_key = models.CharField(
        max_length=64, blank=True, default='',
        help_text="'quran:2:255' / 'bukhari:52' — cross-extractor grouping key "
                  'derived from canonical_ref')

    # Subtype scalars; which one applies is keyed off `label`.
    subtype = models.CharField(
        max_length=kb_choices.MENTION_SUBTYPE_MAX, blank=True, default='',
        choices=kb_choices.MENTION_SUBTYPE_CHOICES,
        help_text='label=work → WorkSubtype, label=organization → '
                  "OrganizationSubtype, label=sect → SectKind, '' otherwise")
    quote_type = models.CharField(
        max_length=kb_choices.QUOTATION_TYPE_MAX, blank=True, default='',
        choices=kb_choices.QUOTATION_TYPE_CHOICES)
    match_method = models.CharField(
        max_length=kb_choices.MATCH_METHOD_MAX, blank=True, default='',
        choices=kb_choices.MATCH_METHOD_CHOICES)
    match_score = models.FloatField(null=True, blank=True)

    # Denormalized from `parsed_time`: a discriminated union inside JSON is not
    # indexable on SQLite, and "who died in 204" is the most-asked question here.
    time_kind = models.CharField(
        max_length=kb_choices.TIME_KIND_MAX, blank=True, default='',
        choices=kb_choices.TIME_KIND_CHOICES)
    hijri_year = models.IntegerField(null=True, blank=True)
    hijri_year_to = models.IntegerField(null=True, blank=True)
    hijri_approximate = models.BooleanField(default=False)

    parsed_time = models.JSONField(
        default=dict, blank=True,
        help_text="ParsedTime dump: {'kind':'absolute','date':{…}} | "
                  "{'kind':'range','range':{'earliest':{…},'latest':{…}}} | "
                  "{'kind':'relative','anchor_text':str,'anchor_entity_id':str|None}")
    canonical_ref = models.JSONField(
        default=dict, blank=True,
        help_text="{'ref_kind':'quran','sura':int,'aya_start':int,'aya_end':int|None} "
                  "| {'ref_kind':'hadith','collection':str,'hadith_number':str}")
    name_components = models.JSONField(
        default=dict, blank=True,
        help_text="NameComponents dump: {'kunya','ism','nasab':[],'nisba':[],"
                  "'laqab':[],'shuhra'} — the list fields rule out real columns")

    # Quotation attribution; both may point forward, so the writer fills them in
    # a second pass after every mention row exists.
    speaker_mention = models.ForeignKey(
        'self', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    about_mention = models.ForeignKey(
        'self', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')

    # Entity-resolution landing slots — all unset until that phase is built.
    entity_key = models.CharField(
        max_length=64, blank=True, default='',
        help_text='MentionBase.entity_id — the KB entity this resolves to')
    linking_status = models.CharField(
        max_length=kb_choices.LINKING_STATUS_MAX,
        choices=kb_choices.LINKING_STATUS_CHOICES, default='unlinked')
    person = models.ForeignKey(
        Person, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    place = models.ForeignKey(
        Place, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    work = models.ForeignKey(
        Work, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')

    class Meta:
        db_table = 'extraction_kb_mentions'
        constraints = [
            models.CheckConstraint(
                check=Q(doc_char_end__gt=F('doc_char_start')),
                name='kb_mention_span_valid'),
            models.CheckConstraint(
                check=Q(page_char_start__isnull=True)
                | Q(page_char_end__gt=F('page_char_start')),
                name='kb_mention_page_span_valid'),
            models.CheckConstraint(
                check=Q(subtype='')
                | Q(label__in=['work', 'organization', 'sect']),
                name='kb_mention_subtype_matches_label'),
            models.CheckConstraint(
                check=Q(quote_type='') | Q(label='quotation'),
                name='kb_mention_quote_type_matches_label'),
            models.UniqueConstraint(
                fields=['document', 'extractor_name', 'extractor_version',
                        'label', 'doc_char_start', 'doc_char_end'],
                name='kb_mention_unique_per_version'),
        ]
        indexes = [
            models.Index(
                fields=['document', 'page_number', 'doc_char_start'],
                condition=Q(superseded_at__isnull=True),
                name='kb_mention_active_page_idx'),
            models.Index(
                fields=['label', 'normalized_form'],
                condition=Q(superseded_at__isnull=True),
                name='kb_mention_active_key_idx'),
            models.Index(
                fields=['document', 'segment_type'],
                condition=Q(superseded_at__isnull=True),
                name='kb_mention_active_seg_idx'),
            models.Index(
                fields=['blocking_key'],
                condition=Q(superseded_at__isnull=True) & ~Q(blocking_key=''),
                name='kb_mention_blocking_idx'),
            models.Index(
                fields=['hijri_year'],
                condition=Q(superseded_at__isnull=True)
                & Q(hijri_year__isnull=False),
                name='kb_mention_year_idx'),
            models.Index(
                fields=['ref_key'],
                condition=Q(superseded_at__isnull=True) & ~Q(ref_key=''),
                name='kb_mention_ref_idx'),
            models.Index(fields=['review_status', 'confidence']),
        ]

    def __str__(self):
        return (f'{self.label}:{self.surface_form[:40]} '
                f'@doc{self.document_id} p{self.page_number}')


class KbMentionRelation(_KbRowMixin):
    """A relation between two mentions (34 types, with place/time qualifiers)."""

    document = models.ForeignKey(
        'search_engine.Document', on_delete=models.CASCADE,
        related_name='kb_mention_relations')

    relation_type = models.CharField(
        max_length=kb_choices.RELATION_TYPE_MAX,
        choices=kb_choices.RELATION_TYPE_CHOICES, db_index=True)
    subject_mention = models.ForeignKey(
        KbMention, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='kb_relations_as_subject')
    object_mention = models.ForeignKey(
        KbMention, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='kb_relations_as_object')
    place_mention = models.ForeignKey(
        KbMention, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    time_mention = models.ForeignKey(
        KbMention, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    trigger = models.CharField(
        max_length=120, blank=True, default='',
        help_text='The verb that signalled the relation — حدثنا، سمعت، تفقّه على. '
                  'The interpretive content of an isnad edge.')
    evidence_text = models.TextField(
        blank=True, default='',
        help_text='Normalized text under the enclosing span, capped at 2000 chars')
    dedupe_key = models.CharField(
        max_length=64,
        help_text='sha256(relation_type | subject span key | object span key | '
                  'place | time | span). Mention ids are random per run, so '
                  'identity is built from spans instead.')

    class Meta:
        db_table = 'extraction_kb_mention_relations'
        constraints = [
            models.CheckConstraint(
                check=Q(doc_char_end__gt=F('doc_char_start')),
                name='kb_relation_span_valid'),
            models.UniqueConstraint(
                fields=['document', 'extractor_name', 'extractor_version',
                        'dedupe_key'],
                name='kb_relation_unique_per_version'),
        ]
        indexes = [
            models.Index(
                fields=['document', 'relation_type'],
                condition=Q(superseded_at__isnull=True),
                name='kb_relation_active_type_idx'),
            models.Index(
                fields=['document', 'page_number'],
                condition=Q(superseded_at__isnull=True),
                name='kb_relation_active_page_idx'),
        ]

    def __str__(self):
        return f'{self.relation_type} @doc{self.document_id} p{self.page_number}'


class KbMentionClaim(_KbRowMixin):
    """A dated claim about one mention (birth / death / floruit)."""

    document = models.ForeignKey(
        'search_engine.Document', on_delete=models.CASCADE,
        related_name='kb_mention_claims')

    predicate = models.CharField(
        max_length=kb_choices.CLAIM_PREDICATE_MAX,
        choices=kb_choices.CLAIM_PREDICATE_CHOICES, db_index=True)
    subject_mention = models.ForeignKey(
        KbMention, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='kb_claims_as_subject')
    time_mention = models.ForeignKey(
        KbMention, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    # Copied off the time mention so "every death date in the corpus" is one
    # indexed query rather than a join plus a JSON dig.
    hijri_year = models.IntegerField(null=True, blank=True)
    hijri_year_to = models.IntegerField(null=True, blank=True)
    hijri_approximate = models.BooleanField(default=False)
    dedupe_key = models.CharField(max_length=64)

    class Meta:
        db_table = 'extraction_kb_mention_claims'
        constraints = [
            models.CheckConstraint(
                check=Q(doc_char_end__gt=F('doc_char_start')),
                name='kb_claim_span_valid'),
            models.UniqueConstraint(
                fields=['document', 'extractor_name', 'extractor_version',
                        'dedupe_key'],
                name='kb_claim_unique_per_version'),
        ]
        indexes = [
            models.Index(
                fields=['document', 'predicate'],
                condition=Q(superseded_at__isnull=True),
                name='kb_claim_active_pred_idx'),
            models.Index(
                fields=['predicate', 'hijri_year'],
                condition=Q(superseded_at__isnull=True)
                & Q(hijri_year__isnull=False),
                name='kb_claim_pred_year_idx'),
        ]

    def __str__(self):
        return f'{self.predicate}={self.hijri_year} @doc{self.document_id}'


class KbMentionAppraisal(_KbRowMixin):
    """One جرح/تعديل verdict: a critic's judgement of a transmitter.

    ``verbatim`` is authoritative and required; ``rank`` is a contested
    normalization onto Ibn Hajar's 12 levels and stays optional and
    re-derivable, exactly as the pydantic schema argues.
    """

    document = models.ForeignKey(
        'search_engine.Document', on_delete=models.CASCADE,
        related_name='kb_mention_appraisals')

    verbatim = models.TextField(help_text='The verdict as written: ثقة ثبت، ليس بشيء')
    polarity = models.CharField(
        max_length=kb_choices.APPRAISAL_POLARITY_MAX,
        choices=kb_choices.APPRAISAL_POLARITY_CHOICES, db_index=True)
    rank = models.CharField(
        max_length=kb_choices.APPRAISAL_RANK_MAX, blank=True, default='',
        choices=kb_choices.APPRAISAL_RANK_CHOICES)
    rank_level = models.PositiveSmallIntegerField(
        null=True, blank=True,
        help_text='APPRAISAL_RANK_LEVEL[rank]: 1 = highest tadil, 12 = harshest '
                  'jarh (1-6 tadil, 7-12 jarh). Denormalized because ordering on '
                  'the string enum is meaningless and ordering is the point.')
    scope_kind = models.CharField(
        max_length=kb_choices.APPRAISAL_SCOPE_KIND_MAX,
        choices=kb_choices.APPRAISAL_SCOPE_KIND_CHOICES, default='general')
    scope_target_mention = models.ForeignKey(
        KbMention, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    scope_note = models.CharField(max_length=255, blank=True, default='')
    critic_mention = models.ForeignKey(
        KbMention, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='kb_appraisals_as_critic')
    subject_mention = models.ForeignKey(
        KbMention, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='kb_appraisals_as_subject')
    quotation_mention = models.ForeignKey(
        KbMention, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    dedupe_key = models.CharField(max_length=64)

    class Meta:
        db_table = 'extraction_kb_mention_appraisals'
        constraints = [
            models.CheckConstraint(
                check=Q(doc_char_end__gt=F('doc_char_start')),
                name='kb_appraisal_span_valid'),
            models.CheckConstraint(
                check=~Q(verbatim=''), name='kb_appraisal_verbatim_present'),
            # Port of AppraisalBase._rank_matches_polarity (kb/schema.py), so a
            # future non-pipeline writer cannot file متروك as تعديل.
            models.CheckConstraint(
                check=Q(rank_level__isnull=True)
                | Q(polarity__in=['mixed', 'neutral'])
                | (Q(polarity='tadil') & Q(rank_level__lte=6))
                | (Q(polarity='jarh') & Q(rank_level__gt=6)),
                name='kb_appraisal_rank_matches_polarity'),
            models.CheckConstraint(
                check=~Q(scope_kind='general')
                | Q(scope_target_mention__isnull=True),
                name='kb_appraisal_general_scope_has_no_target'),
            models.UniqueConstraint(
                fields=['document', 'extractor_name', 'extractor_version',
                        'dedupe_key'],
                name='kb_appraisal_unique_per_version'),
        ]
        indexes = [
            models.Index(
                fields=['document', 'polarity'],
                condition=Q(superseded_at__isnull=True),
                name='kb_appraisal_active_pol_idx'),
            models.Index(
                fields=['subject_mention', 'rank_level'],
                condition=Q(superseded_at__isnull=True),
                name='kb_appraisal_subj_rank_idx'),
        ]

    def __str__(self):
        return (f'{self.polarity}({self.rank or "-"}): {self.verbatim[:40]} '
                f'@doc{self.document_id}')
