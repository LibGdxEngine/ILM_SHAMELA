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
        return super().get_queryset().filter(processed=True).prefetch_related('authors', 'alternate_names')
    
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
            # Get author names from ManyToMany relationship
            author_names = list(instance.authors.values_list('name', flat=True))
            # Also include alternate names from authors
            for author in instance.authors.all():
                if author.alternate_names:
                    author_names.extend(author.alternate_names)
            self.authors = author_names
        else:
            # Fallback to old JSONField if exists (for migration period)
            if hasattr(instance, 'authors_old') and instance.authors_old:
                self.authors = instance.authors_old if isinstance(instance.authors_old, list) else []
            else:
                self.authors = []
        
        # Handle categories as lists
        self.categories = instance.categories if isinstance(instance.categories, list) else (instance.categories.split(',') if instance.categories else [])
        
        # Handle alternate names from DocumentAlternateName model
        if hasattr(instance, 'alternate_names') and instance.alternate_names.exists():
            self.alternate_names = list(instance.alternate_names.values_list('name', flat=True))
        else:
            self.alternate_names = []
        
        return data
