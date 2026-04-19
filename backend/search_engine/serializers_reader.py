from rest_framework import serializers

from .models import Bookmark, Highlight, Note, ReaderPreference, ReadingProgress
from .utils import split_document_content_into_pages


MAX_TAG_LENGTH = 32
MAX_TAGS_PER_ITEM = 16


def _validate_tags(value):
    """Shared validator: tags must be a list of <=16 short strings (<=32 chars)."""
    if value is None:
        return []
    if not isinstance(value, list):
        raise serializers.ValidationError('tags must be a list of strings.')
    if len(value) > MAX_TAGS_PER_ITEM:
        raise serializers.ValidationError(
            f'A maximum of {MAX_TAGS_PER_ITEM} tags is allowed.'
        )
    cleaned = []
    for entry in value:
        if not isinstance(entry, str):
            raise serializers.ValidationError('Each tag must be a string.')
        if len(entry) > MAX_TAG_LENGTH:
            raise serializers.ValidationError(
                f'Each tag must be at most {MAX_TAG_LENGTH} characters.'
            )
        cleaned.append(entry)
    return cleaned


class ReaderPreferenceSerializer(serializers.ModelSerializer):
    """Serializer for the per-user reader preference singleton."""

    class Meta:
        model = ReaderPreference
        fields = [
            'font_size',
            'theme',
            'font_weight',
            'letter_spacing',
            'line_height',
            'tashkeel_enabled',
            'extra',
            'updated_at',
        ]
        read_only_fields = ['updated_at']


class BookmarkSerializer(serializers.ModelSerializer):
    """Serializer for Bookmark; user is set server-side in the view."""

    class Meta:
        model = Bookmark
        fields = [
            'id',
            'document',
            'page_number',
            'paragraph_id',
            'label',
            'tags',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']

    def validate_tags(self, value):
        return _validate_tags(value)


class NoteSerializer(serializers.ModelSerializer):
    """Serializer for Note; user is set server-side in the view."""

    class Meta:
        model = Note
        fields = [
            'id',
            'document',
            'page_number',
            'paragraph_id',
            'body',
            'tags',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate_tags(self, value):
        return _validate_tags(value)


class HighlightSerializer(serializers.ModelSerializer):
    """Serializer for Highlight; user is set server-side in the view."""

    class Meta:
        model = Highlight
        fields = [
            'id',
            'document',
            'page_number',
            'paragraph_id',
            'char_start',
            'char_end',
            'color',
            'note',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']

    def validate(self, attrs):
        char_start = attrs.get('char_start')
        char_end = attrs.get('char_end')
        if char_start is None and self.instance is not None:
            char_start = self.instance.char_start
        if char_end is None and self.instance is not None:
            char_end = self.instance.char_end
        if char_start is not None and char_end is not None and char_end <= char_start:
            raise serializers.ValidationError(
                {'char_end': 'char_end must be greater than char_start.'}
            )
        return attrs


class ReadingProgressSerializer(serializers.ModelSerializer):
    """Serializer for ReadingProgress; user is set server-side in the view."""

    class Meta:
        model = ReadingProgress
        fields = [
            'id',
            'document',
            'last_page',
            'last_paragraph_id',
            'scroll_ratio',
            'percent_complete',
            'updated_at',
        ]
        read_only_fields = ['id', 'updated_at']


class ContinueReadingSerializer(serializers.ModelSerializer):
    """Composite read-only serializer for the Continue Reading shelf."""
    document = serializers.IntegerField(source='document.id', read_only=True)
    document_title = serializers.CharField(source='document.title', read_only=True)
    cover_photo_url = serializers.SerializerMethodField()
    thumbnail_url = serializers.SerializerMethodField()
    total_pages = serializers.SerializerMethodField()

    class Meta:
        model = ReadingProgress
        fields = [
            'document',
            'document_title',
            'cover_photo_url',
            'thumbnail_url',
            'total_pages',
            'last_page',
            'percent_complete',
            'updated_at',
        ]
        read_only_fields = fields

    def _absolute(self, file_field):
        if not file_field:
            return None
        request = self.context.get('request')
        if request is not None:
            return request.build_absolute_uri(file_field.url)
        return file_field.url

    def get_cover_photo_url(self, obj):
        return self._absolute(obj.document.cover_photo)

    def get_thumbnail_url(self, obj):
        return self._absolute(obj.document.thumbnail)

    def get_total_pages(self, obj):
        cache = self.context.setdefault('_total_pages_cache', {})
        doc_id = obj.document_id
        if doc_id in cache:
            return cache[doc_id]
        pages = split_document_content_into_pages(obj.document.content or '')
        total = len(pages)
        cache[doc_id] = total
        return total
