from rest_framework import serializers
from .models import Document


class DocumentListSerializer(serializers.ModelSerializer):
    """Serializer for Document model in list views (without full content)."""
    
    class Meta:
        model = Document
        fields = ['id', 'title', 'file', 'uploaded_at', 'processed', 'language', 'authors', 'categories']
        read_only_fields = ['id', 'uploaded_at', 'processed']


class DocumentDetailSerializer(serializers.ModelSerializer):
    """Serializer for Document model in detail views (with full content)."""
    
    class Meta:
        model = Document
        fields = ['id', 'title', 'file', 'uploaded_at', 'processed', 'language', 'content', 'authors', 'categories']
        read_only_fields = ['id', 'uploaded_at', 'processed']


class DocumentSerializer(serializers.ModelSerializer):
    """Serializer for Document model (used for create/update)."""
    
    class Meta:
        model = Document
        fields = ['id', 'title', 'file', 'uploaded_at', 'processed', 'language', 'content', 'authors', 'categories']
        read_only_fields = ['id', 'uploaded_at', 'processed']
    
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