import os

from rest_framework import serializers
from .models import Document, Author, DocumentAlternateName, Category, Edition


MAX_DOCUMENT_FILE_SIZE_MB = int(os.environ.get('MAX_DOCUMENT_FILE_SIZE_MB', '25'))
MAX_DOCUMENT_FILE_SIZE_BYTES = MAX_DOCUMENT_FILE_SIZE_MB * 1024 * 1024
MAX_COVER_FILE_SIZE_MB = int(os.environ.get('MAX_COVER_FILE_SIZE_MB', '10'))
MAX_COVER_FILE_SIZE_BYTES = MAX_COVER_FILE_SIZE_MB * 1024 * 1024
MAX_OCR_LAYOUT_FILE_SIZE_MB = int(os.environ.get('MAX_OCR_LAYOUT_FILE_SIZE_MB', '50'))
MAX_OCR_LAYOUT_FILE_SIZE_BYTES = MAX_OCR_LAYOUT_FILE_SIZE_MB * 1024 * 1024
ALLOWED_DOCUMENT_EXTENSIONS = {'.pdf', '.doc', '.docx', '.txt'}


class AuthorListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for Author model in list views."""
    
    class Meta:
        model = Author
        fields = ['id', 'name', 'photo', 'date_of_birth', 'date_of_death']
        read_only_fields = ['id']


class AuthorSerializer(serializers.ModelSerializer):
    """Basic serializer for Author model."""
    
    class Meta:
        model = Author
        fields = ['id', 'name', 'alternate_names', 'date_of_birth', 'date_of_death', 'photo', 'description', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']


class AuthorDetailSerializer(serializers.ModelSerializer):
    """Serializer for Author model in detail views (includes published books)."""
    documents = serializers.SerializerMethodField()
    documents_count = serializers.SerializerMethodField()
    
    class Meta:
        model = Author
        fields = ['id', 'name', 'alternate_names', 'date_of_birth', 'date_of_death', 'photo', 'description', 'created_at', 'updated_at', 'documents', 'documents_count']
        read_only_fields = ['id', 'created_at', 'updated_at', 'documents', 'documents_count']
    
    def get_documents(self, obj):
        """Return list of documents authored by this author."""
        documents = obj.documents.all()[:50]  # Limit to 50 for performance
        return DocumentListSerializer(documents, many=True, context=self.context).data
    
    def get_documents_count(self, obj):
        """Return total count of documents authored by this author."""
        return obj.documents.count()


class DocumentAlternateNameSerializer(serializers.ModelSerializer):
    """Serializer for DocumentAlternateName model."""
    
    class Meta:
        model = DocumentAlternateName
        fields = ['id', 'name', 'created_at']
        read_only_fields = ['id', 'created_at']


class CategoryListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for Category model in list views."""
    
    class Meta:
        model = Category
        fields = ['id', 'name']
        read_only_fields = ['id']


class CategorySerializer(serializers.ModelSerializer):
    """Basic serializer for Category model."""
    
    class Meta:
        model = Category
        fields = ['id', 'name', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']


class EditionSerializer(serializers.ModelSerializer):
    """Serializer for the printed edition a document was digitized from."""

    class Meta:
        model = Edition
        fields = [
            'id',
            'editor',
            'publisher',
            'publication_place',
            'edition_statement',
            'publication_year_hijri',
            'publication_year_gregorian',
            'volume_count',
            'page_map',
            'notes',
        ]
        read_only_fields = ['id']


class DocumentListSerializer(serializers.ModelSerializer):
    """Serializer for Document model in list views (without full content)."""
    authors = AuthorListSerializer(many=True, read_only=True)
    authors_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Author.objects.all(),
        source='authors',
        write_only=True,
        required=False
    )
    categories = CategoryListSerializer(many=True, read_only=True)
    category_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Category.objects.all(),
        source='categories',
        write_only=True,
        required=False
    )
    thumbnail_url = serializers.SerializerMethodField()
    cover_photo_url = serializers.SerializerMethodField()
    
    class Meta:
        model = Document
        fields = [
            'id',
            'title',
            'file',
            'uploaded_at',
            'processed',
            'processing_status',
            'processing_error',
            'processing_attempts',
            'language',
            'authors',
            'authors_ids',
            'categories',
            'category_ids',
            'cover_photo',
            'cover_photo_url',
            'thumbnail',
            'thumbnail_url',
            'description',
            'written_date',
            'rights_status',
            'uploaded_by',
        ]
        read_only_fields = [
            'id',
            'uploaded_at',
            'processed',
            'processing_status',
            'processing_error',
            'processing_attempts',
            'authors',
            'categories',
            'thumbnail_url',
            'cover_photo_url',
            'rights_status',
            'uploaded_by',
        ]
    
    def get_thumbnail_url(self, obj):
        """Return thumbnail URL if available."""
        if obj.thumbnail:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.thumbnail.url)
            return obj.thumbnail.url
        return None
    
    def get_cover_photo_url(self, obj):
        """Return cover photo URL if available."""
        if obj.cover_photo:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.cover_photo.url)
            return obj.cover_photo.url
        return None


class DocumentDetailSerializer(serializers.ModelSerializer):
    """Serializer for Document model in detail views (metadata only).

    Deliberately excludes `content`: full book text is only available
    page-by-page via the quota-enforced pages endpoint.
    """
    authors = AuthorListSerializer(many=True, read_only=True)
    authors_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Author.objects.all(),
        source='authors',
        write_only=True,
        required=False
    )
    categories = CategoryListSerializer(many=True, read_only=True)
    category_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Category.objects.all(),
        source='categories',
        write_only=True,
        required=False
    )
    alternate_names = DocumentAlternateNameSerializer(many=True, read_only=True)
    editions = EditionSerializer(many=True, read_only=True)
    thumbnail_url = serializers.SerializerMethodField()
    cover_photo_url = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = [
            'id',
            'title',
            'file',
            'uploaded_at',
            'processed',
            'processing_status',
            'processing_error',
            'processing_attempts',
            'processing_started_at',
            'processing_completed_at',
            'language',
            'authors',
            'authors_ids',
            'categories',
            'category_ids',
            'cover_photo',
            'cover_photo_url',
            'thumbnail',
            'thumbnail_url',
            'description',
            'written_date',
            'alternate_names',
            'has_layout',
            'rights_status',
            'provenance_source',
            'rights_notes',
            'editions',
            'uploaded_by',
        ]
        read_only_fields = [
            'id',
            'uploaded_at',
            'processed',
            'processing_status',
            'processing_error',
            'processing_attempts',
            'processing_started_at',
            'processing_completed_at',
            'authors',
            'categories',
            'alternate_names',
            'thumbnail_url',
            'cover_photo_url',
            'has_layout',
            'editions',
            'uploaded_by',
        ]

    def get_thumbnail_url(self, obj):
        """Return thumbnail URL if available."""
        if obj.thumbnail:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.thumbnail.url)
            return obj.thumbnail.url
        return None
    
    def get_cover_photo_url(self, obj):
        """Return cover photo URL if available."""
        if obj.cover_photo:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.cover_photo.url)
            return obj.cover_photo.url
        return None


class DocumentSerializer(serializers.ModelSerializer):
    """Serializer for Document model (used for create/update)."""
    authors_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Author.objects.all(),
        source='authors',
        write_only=True,
        required=False
    )
    category_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Category.objects.all(),
        source='categories',
        write_only=True,
        required=False
    )
    category_names = serializers.ListField(
        child=serializers.CharField(max_length=255),
        write_only=True,
        required=False,
        help_text="List of category names (will be created if they don't exist)"
    )
    author_names = serializers.ListField(
        child=serializers.CharField(max_length=255),
        write_only=True,
        required=False,
        help_text="List of author names (will be created if they don't exist)"
    )
    alternate_names = serializers.ListField(
        child=serializers.CharField(max_length=500),
        write_only=True,
        required=False,
        help_text="List of alternate names for the document"
    )
    ocr_engine = serializers.ChoiceField(
        choices=Document.OCREngine.choices,
        required=False,
        default=Document.OCREngine.AUTO,
        help_text="OCR engine to use for this document (auto/none/tesseract/chandra)"
    )
    edition_editor = serializers.CharField(
        max_length=255, write_only=True, required=False, allow_blank=True,
        help_text="Editor / muhaqqiq of the printed edition this file was digitized from")
    edition_publisher = serializers.CharField(
        max_length=255, write_only=True, required=False, allow_blank=True,
        help_text="Publisher of the printed edition")
    edition_year_hijri = serializers.CharField(
        max_length=50, write_only=True, required=False, allow_blank=True,
        help_text="Hijri publication year (flexible format)")
    edition_year_gregorian = serializers.CharField(
        max_length=50, write_only=True, required=False, allow_blank=True,
        help_text="Gregorian publication year (flexible format)")
    edition_volume_count = serializers.IntegerField(
        write_only=True, required=False, min_value=1,
        help_text="Number of volumes in the printed edition")

    class Meta:
        model = Document
        fields = [
            'id',
            'title',
            'file',
            'uploaded_at',
            'processed',
            'processing_status',
            'processing_error',
            'processing_attempts',
            'processing_started_at',
            'processing_completed_at',
            'language',
            'content',
            'authors',
            'authors_ids',
            'author_names',
            'categories',
            'category_ids',
            'category_names',
            'cover_photo',
            'thumbnail',
            'description',
            'written_date',
            'alternate_names',
            'ocr_engine',
            'ocr_engine_used',
            'ocr_layout',
            'has_layout',
            'rights_status',
            'provenance_source',
            'rights_notes',
            'edition_editor',
            'edition_publisher',
            'edition_year_hijri',
            'edition_year_gregorian',
            'edition_volume_count',
        ]
        read_only_fields = [
            'id',
            'uploaded_at',
            'processed',
            'processing_status',
            'processing_error',
            'processing_attempts',
            'processing_started_at',
            'processing_completed_at',
            'authors',
            'categories',
            'ocr_engine_used',
            'has_layout',
        ]

    def validate(self, attrs):
        """Validate that required fields are present."""
        if self.instance is None:  # Only validate on create
            if 'title' not in attrs or not attrs.get('title'):
                raise serializers.ValidationError({'title': 'This field is required.'})
            if 'file' not in attrs or not attrs.get('file'):
                raise serializers.ValidationError({'file': 'This field is required.'})
        # An OCR layout JSON only makes sense paired with a PDF page image source.
        ocr_layout = attrs.get('ocr_layout')
        file_obj = attrs.get('file') or getattr(self.instance, 'file', None)
        if ocr_layout and file_obj:
            if os.path.splitext(file_obj.name)[1].lower() != '.pdf':
                raise serializers.ValidationError(
                    {'ocr_layout': 'An OCR layout JSON can only be attached to a PDF document.'}
                )
        return attrs

    def validate_file(self, file_obj):
        extension = os.path.splitext(file_obj.name)[1].lower()
        if extension not in ALLOWED_DOCUMENT_EXTENSIONS:
            raise serializers.ValidationError(
                f'Unsupported file extension "{extension}". Allowed: {", ".join(sorted(ALLOWED_DOCUMENT_EXTENSIONS))}.'
            )
        if file_obj.size > MAX_DOCUMENT_FILE_SIZE_BYTES:
            raise serializers.ValidationError(
                f'File is too large. Maximum allowed size is {MAX_DOCUMENT_FILE_SIZE_MB} MB.'
            )
        return file_obj

    def validate_cover_photo(self, file_obj):
        if file_obj.size > MAX_COVER_FILE_SIZE_BYTES:
            raise serializers.ValidationError(
                f'Cover photo is too large. Maximum allowed size is {MAX_COVER_FILE_SIZE_MB} MB.'
            )
        return file_obj

    def validate_ocr_layout(self, file_obj):
        extension = os.path.splitext(file_obj.name)[1].lower()
        if extension != '.json':
            raise serializers.ValidationError(
                f'Unsupported OCR layout extension "{extension}". A datalab/marker .json file is required.'
            )
        if file_obj.size > MAX_OCR_LAYOUT_FILE_SIZE_BYTES:
            raise serializers.ValidationError(
                f'OCR layout file is too large. Maximum allowed size is {MAX_OCR_LAYOUT_FILE_SIZE_MB} MB.'
            )
        return file_obj


class DocumentPageSerializer(serializers.Serializer):
    """Serializer for paginated document content pages."""
    page_number = serializers.IntegerField()
    content = serializers.CharField()
