from rest_framework import serializers
from .models import Document


class DocumentSerializer(serializers.ModelSerializer):
    """Serializer for Document model."""
    
    class Meta:
        model = Document
        fields = ['id', 'title', 'file', 'uploaded_at', 'processed', 'language', 'content']
        read_only_fields = ['id', 'uploaded_at', 'processed']
    
    def validate(self, attrs):
        """Validate that required fields are present."""
        if self.instance is None:  # Only validate on create
            if 'title' not in attrs or not attrs.get('title'):
                raise serializers.ValidationError({'title': 'This field is required.'})
            if 'file' not in attrs or not attrs.get('file'):
                raise serializers.ValidationError({'file': 'This field is required.'})
        return attrs