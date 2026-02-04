from django_elasticsearch_dsl import Document, fields
from django_elasticsearch_dsl.registries import registry
from .models import Document as DocumentModel


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
    
    class Index:
        name = 'documents'
        settings = {
            'number_of_shards': 1,
            'number_of_replicas': 0
        }
    
    class Django:
        model = DocumentModel
        fields = [
            'id',
        ]
        # Disable automatic indexing on save
        # Documents are indexed manually in the Celery task after processing
        ignore_signals = True
        
    def get_queryset(self):
        """Return only processed documents for indexing."""
        return super().get_queryset().filter(processed=True)
    
    def prepare(self, instance):
        """Prepare the document instance for indexing."""
        # Call parent prepare to get base data
        data = super().prepare(instance)
        # Manually set all fields
        self.title = instance.title
        self.content = instance.content or ''
        self.language = instance.language or ''
        self.uploaded_at = instance.uploaded_at
        # Handle authors and categories as lists
        self.authors = instance.authors if isinstance(instance.authors, list) else (instance.authors.split(',') if instance.authors else [])
        self.categories = instance.categories if isinstance(instance.categories, list) else (instance.categories.split(',') if instance.categories else [])
        return data
