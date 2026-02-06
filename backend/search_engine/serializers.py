from rest_framework import serializers
from .models import Document, Author, DocumentAlternateName, Category


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
        fields = ['id', 'title', 'file', 'uploaded_at', 'processed', 'language', 'authors', 'authors_ids', 'categories', 'category_ids', 'cover_photo', 'cover_photo_url', 'thumbnail', 'thumbnail_url', 'description', 'written_date']
        read_only_fields = ['id', 'uploaded_at', 'processed', 'authors', 'categories', 'thumbnail_url', 'cover_photo_url']
    
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
    """Serializer for Document model in detail views (with full content)."""
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
    thumbnail_url = serializers.SerializerMethodField()
    cover_photo_url = serializers.SerializerMethodField()
    
    class Meta:
        model = Document
        fields = ['id', 'title', 'file', 'uploaded_at', 'processed', 'language', 'content', 'authors', 'authors_ids', 'categories', 'category_ids', 'cover_photo', 'cover_photo_url', 'thumbnail', 'thumbnail_url', 'description', 'written_date', 'alternate_names']
        read_only_fields = ['id', 'uploaded_at', 'processed', 'authors', 'categories', 'alternate_names', 'thumbnail_url', 'cover_photo_url']
    
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
    alternate_names = serializers.ListField(
        child=serializers.CharField(max_length=500),
        write_only=True,
        required=False,
        help_text="List of alternate names for the document"
    )
    
    class Meta:
        model = Document
        fields = ['id', 'title', 'file', 'uploaded_at', 'processed', 'language', 'content', 'authors', 'authors_ids', 'categories', 'category_ids', 'category_names', 'cover_photo', 'thumbnail', 'description', 'written_date', 'alternate_names']
        read_only_fields = ['id', 'uploaded_at', 'processed', 'authors', 'categories']
    
    def validate(self, attrs):
        """Validate that required fields are present."""
        if self.instance is None:  # Only validate on create
            if 'title' not in attrs or not attrs.get('title'):
                raise serializers.ValidationError({'title': 'This field is required.'})
            if 'file' not in attrs or not attrs.get('file'):
                raise serializers.ValidationError({'file': 'This field is required.'})
        return attrs


class DocumentPageSerializer(serializers.Serializer):
    """Serializer for paginated document content pages."""
    page_number = serializers.IntegerField()
    content = serializers.CharField()