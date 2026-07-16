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
    authors = fields.TextField(
        analyzer='standard',
        fields={
            'arabic': fields.TextField(analyzer='arabic'),
        },
        multi=True
    )
    categories = fields.KeywordField(multi=True)
    description = fields.TextField(
        analyzer='standard',
        fields={
            'arabic': fields.TextField(analyzer='arabic'),
        }
    )
    written_date = fields.KeywordField()
    alternate_names = fields.TextField(
        analyzer='standard',
        fields={
            'arabic': fields.TextField(analyzer='arabic'),
        },
        multi=True
    )
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
        self.description = instance.description or ''
        self.written_date = instance.written_date or ''

        # Handle authors from ManyToMany relationship
        if hasattr(instance, 'authors') and instance.authors.exists():
            author_names = list(instance.authors.values_list('name', flat=True))
            for author in instance.authors.all():
                if author.alternate_names:
                    author_names.extend(author.alternate_names)
            self.authors = author_names
        else:
            self.authors = []

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

        return data
