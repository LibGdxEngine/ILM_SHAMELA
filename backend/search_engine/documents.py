from django_elasticsearch_dsl import Document, fields
from django_elasticsearch_dsl.registries import registry
from elasticsearch_dsl import analyzer
from elasticsearch_dsl import field as es_field
from .models import Document as DocumentModel
from .semantic import VECTOR_DIMENSIONS

# Tashkeel-insensitive matching without stemming: `arabic_normalization` strips
# harakat + tatweel and folds آ/أ/إ→ا, ى→ي, ة→ه, so an unvocalized query phrase
# matches vocalized text while staying an otherwise literal match (unlike the
# built-in `arabic` analyzer, which also stems).
arabic_exact = analyzer(
    'arabic_exact',
    tokenizer='standard',
    filter=['lowercase', 'arabic_normalization'],
)


@registry.register_document
class DocumentIndex(Document):
    """Elasticsearch document index for Document model."""

    title = fields.TextField(
        analyzer='standard',
        fields={
            'raw': fields.KeywordField(),
            'arabic': fields.TextField(analyzer='arabic'),
            'exact': fields.TextField(analyzer=arabic_exact),
        }
    )
    content = fields.TextField(
        analyzer='standard',
        fields={
            'arabic': fields.TextField(analyzer='arabic'),
            'exact': fields.TextField(analyzer=arabic_exact),
        }
    )
    language = fields.KeywordField()
    uploaded_at = fields.DateField()
    # Owner of the upload (stringified user PK); backs the "my uploads" search
    # scope. Empty for legacy documents that predate ownership tracking.
    uploaded_by_id = fields.KeywordField()
    authors = fields.TextField(
        analyzer='standard',
        fields={
            'arabic': fields.TextField(analyzer='arabic'),
            'exact': fields.TextField(analyzer=arabic_exact),
        },
        multi=True
    )
    # Canonical Author.name values only (the analyzed `authors` field mixes in
    # alternate names). Keyword-typed so author scoping can be pushed into the
    # ES filter instead of Django-side post-filtering the top-N.
    author_names = fields.KeywordField(multi=True)
    author_countries = fields.KeywordField(multi=True)
    author_death_centuries = fields.IntegerField(multi=True)
    rights_status = fields.KeywordField()
    categories = fields.KeywordField(multi=True)
    description = fields.TextField(
        analyzer='standard',
        fields={
            'arabic': fields.TextField(analyzer='arabic'),
            'exact': fields.TextField(analyzer=arabic_exact),
        }
    )
    written_date = fields.KeywordField()
    alternate_names = fields.TextField(
        analyzer='standard',
        fields={
            'arabic': fields.TextField(analyzer='arabic'),
            'exact': fields.TextField(analyzer=arabic_exact),
        },
        multi=True
    )
    # ── Extraction rollups (populated via extraction.rollup, lazily — empty
    # when the extraction app is absent or the document isn't processed yet).
    # Flattened keyword/int fields: enough for AND/OR terms-filter pushdown;
    # per-mention correlation (nested) is a later layer.
    genre = fields.KeywordField()
    madhhab = fields.KeywordField()
    era_century = fields.IntegerField()
    register = fields.KeywordField()
    physical_class = fields.KeywordField()
    person_keys = fields.KeywordField(multi=True)
    place_keys = fields.KeywordField(multi=True)
    quran_suras = fields.IntegerField(multi=True)
    quran_ayas = fields.KeywordField(multi=True)
    hadith_collections = fields.KeywordField(multi=True)
    organization_keys = fields.KeywordField(multi=True)
    work_keys = fields.KeywordField(multi=True)
    relation_predicates = fields.KeywordField(multi=True)

    semantic_vector = es_field.DenseVector(dims=VECTOR_DIMENSIONS)

    class Index:
        name = 'documents'
        settings = {
            'number_of_shards': 1,
            'number_of_replicas': 0,
        }

    class Django:
        model = DocumentModel
        fields = [
            'id',
        ]
        # Disable automatic indexing on save
        # Documents are indexed manually in the Celery task after processing
        ignore_signals = True
        # Required: get_queryset() uses prefetch_related(), and Django refuses
        # .iterator() without a chunk_size on prefetched querysets.
        queryset_pagination = 100

    def get_queryset(self):
        """Return only processed documents for indexing."""
        return super().get_queryset().filter(processed=True).prefetch_related('authors', 'alternate_names', 'categories')

    def prepare(self, instance):
        """Prepare the document instance for indexing."""
        # Call parent prepare to get base data
        data = super().prepare(instance)
        # Manually set all fields
        self.title = instance.title
        self.content = instance.content or ''
        self.language = instance.language or ''
        self.uploaded_at = instance.uploaded_at
        self.uploaded_by_id = str(instance.uploaded_by_id) if instance.uploaded_by_id else ''
        self.rights_status = instance.rights_status or ''
        self.description = instance.description or ''
        self.written_date = instance.written_date or ''

        # Handle authors from ManyToMany relationship
        if hasattr(instance, 'authors') and instance.authors.exists():
            author_names = list(instance.authors.values_list('name', flat=True))
            self.author_names = list(author_names)
            self.author_countries = sorted({
                author.nationality for author in instance.authors.all()
                if author.nationality
            })
            self.author_death_centuries = sorted({
                author.death_century for author in instance.authors.all()
                if author.death_century is not None
            })
            for author in instance.authors.all():
                if author.alternate_names:
                    author_names.extend(author.alternate_names)
            self.authors = author_names
        else:
            self.authors = []
            self.author_names = []
            self.author_countries = []
            self.author_death_centuries = []

        # Handle categories from ManyToMany relationship
        if hasattr(instance, 'categories') and instance.categories.exists():
            self.categories = list(instance.categories.values_list('name', flat=True))
        else:
            self.categories = []

        # Handle alternate names from DocumentAlternateName model
        if hasattr(instance, 'alternate_names') and instance.alternate_names.exists():
            self.alternate_names = list(
                instance.alternate_names.values_list('name', flat=True))
        else:
            self.alternate_names = []

        vec = instance.semantic_vector or []
        if len(vec) == VECTOR_DIMENSIONS and any(vec):
            self.semantic_vector = vec
        else:
            self.semantic_vector = None

        # Entity/metadata rollups — lazy so indexing works without the
        # extraction app (or before any extraction ran).
        summary = {}
        try:
            from extraction.rollup import build_document_entity_summary
            summary = build_document_entity_summary(instance)
        except ImportError:
            pass
        except Exception:  # noqa: BLE001 — never fail indexing over rollups
            import logging
            logging.getLogger(__name__).warning(
                'entity rollup failed for doc %s', instance.id, exc_info=True)
        self.genre = summary.get('genre', '')
        self.madhhab = summary.get('madhhab', '')
        self.era_century = summary.get('era_century')
        self.register = summary.get('register', '')
        self.physical_class = summary.get('physical_class', '')
        self.person_keys = summary.get('person_keys', [])
        self.place_keys = summary.get('place_keys', [])
        self.quran_suras = summary.get('quran_suras', [])
        self.quran_ayas = summary.get('quran_ayas', [])
        self.hadith_collections = summary.get('hadith_collections', [])
        self.organization_keys = summary.get('organization_keys', [])
        self.work_keys = summary.get('work_keys', [])
        self.relation_predicates = summary.get('relation_predicates', [])

        return data
