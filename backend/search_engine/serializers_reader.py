from rest_framework import serializers

from .models import (
    Bookmark,
    Chapter,
    ChatMessage,
    ChatSession,
    DocumentFilterPreference,
    Highlight,
    LibraryChatMessage,
    LibraryChatSession,
    Note,
    ReaderPreference,
    ReadingProgress,
    SavedFilterPreset,
    TextCorrection,
)
from .utils import split_document_content_into_pages


MAX_TAG_LENGTH = 32
MAX_TAGS_PER_ITEM = 16
MAX_PINNED_ITEMS = 10
MAX_PINNED_TEXT = 2000
MAX_PINNED_LABEL = 120


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


def _validate_pinned_context(value):
    """Shared validator: pinned_context is a list of <=10 passage dicts.

    Each entry is normalized to {'page': int (>0), 'text': str, 'label': str};
    unknown keys are dropped and over-long text/label are truncated.
    """
    if value is None:
        return []
    if not isinstance(value, list):
        raise serializers.ValidationError('pinned_context must be a list.')
    if len(value) > MAX_PINNED_ITEMS:
        raise serializers.ValidationError(
            f'A maximum of {MAX_PINNED_ITEMS} pinned items is allowed.'
        )
    cleaned = []
    for entry in value:
        if not isinstance(entry, dict):
            raise serializers.ValidationError('Each pinned item must be an object.')
        try:
            page = int(entry.get('page'))
        except (TypeError, ValueError):
            raise serializers.ValidationError('Each pinned item requires an integer page.')
        if page <= 0:
            raise serializers.ValidationError('Pinned page must be greater than 0.')
        text = entry.get('text')
        if not isinstance(text, str):
            raise serializers.ValidationError('Each pinned item requires text.')
        text = text[:MAX_PINNED_TEXT]
        label = entry.get('label', '')
        if not isinstance(label, str):
            raise serializers.ValidationError('Pinned label must be a string.')
        label = label[:MAX_PINNED_LABEL]
        cleaned.append({'page': page, 'text': text, 'label': label})
    return cleaned


class ChapterSerializer(serializers.ModelSerializer):
    """Serializes a Chapter with nested children for TOC display."""
    children = serializers.SerializerMethodField()

    class Meta:
        model = Chapter
        fields = ['id', 'title', 'order', 'page_start', 'page_end', 'children']
        read_only_fields = fields

    def get_children(self, obj):
        return ChapterSerializer(
            obj.children.all().order_by('order'), many=True, context=self.context
        ).data


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


class DocumentFilterPreferenceSerializer(serializers.ModelSerializer):
    """Serializer for the per-user auto-saved documents-filter singleton."""

    class Meta:
        model = DocumentFilterPreference
        fields = ['filters', 'updated_at']
        read_only_fields = ['updated_at']


class SavedFilterPresetSerializer(serializers.ModelSerializer):
    """Serializer for a named, user-saved documents-filter preset."""

    class Meta:
        model = SavedFilterPreset
        fields = ['id', 'name', 'filters', 'created_at']
        read_only_fields = ['id', 'created_at']

    def validate_name(self, value):
        # `unique_together = [['user', 'name']]` can't be enforced by DRF's
        # automatic UniqueTogetherValidator because `user` isn't a serializer
        # field (it's stamped on in the view's perform_create) — without this,
        # a duplicate name hits the DB constraint directly and surfaces as an
        # unhandled IntegrityError (500) instead of a clean 400.
        request = self.context.get('request')
        if request is not None:
            qs = SavedFilterPreset.objects.filter(user=request.user, name=value)
            if self.instance is not None:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError('You already have a saved preset with this name.')
        return value


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


class TextCorrectionSerializer(serializers.ModelSerializer):
    """Serializer for TextCorrection; user is set server-side in the view."""

    class Meta:
        model = TextCorrection
        fields = [
            'id',
            'document',
            'page_number',
            'paragraph_id',
            'char_start',
            'char_end',
            'selected_text',
            'description',
            'suggested_correction',
            'status',
            'created_at',
        ]
        read_only_fields = ['id', 'status', 'created_at']

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


class ChatMessageSerializer(serializers.ModelSerializer):
    """Serializes a single chat message (user or assistant)."""

    class Meta:
        model = ChatMessage
        fields = ['id', 'role', 'content', 'citations', 'context_page', 'created_at']
        read_only_fields = fields


class ChatMessageWriteSerializer(serializers.ModelSerializer):
    """Writable serializer for storing an already-produced chat message.

    Used by the store-only endpoint: the reader assistant streams its reply
    through the CopilotKit sidecar, so the client posts each completed message
    here to keep the durable per-user transcript in sync (no LLM call).
    """

    class Meta:
        model = ChatMessage
        fields = ['role', 'content', 'citations', 'context_page']

    def validate_content(self, value):
        if not (value or '').strip():
            raise serializers.ValidationError('content is required.')
        return value

    def validate_citations(self, value):
        if value in (None, ''):
            return []
        if not isinstance(value, list):
            raise serializers.ValidationError('citations must be a list.')
        return value


class ChatSessionSerializer(serializers.ModelSerializer):
    """Serializes a chat session; messages are fetched separately."""
    message_count = serializers.SerializerMethodField()

    class Meta:
        model = ChatSession
        fields = [
            'id',
            'document',
            'title',
            'context_scope',
            'pinned_context',
            'created_at',
            'updated_at',
            'message_count',
        ]
        read_only_fields = ['id', 'document', 'created_at', 'updated_at', 'message_count']

    def get_message_count(self, obj):
        return obj.messages.count()

    def validate_pinned_context(self, value):
        return _validate_pinned_context(value)


class LibraryChatMessageSerializer(serializers.ModelSerializer):
    """Serializes a single library-assistant message."""

    class Meta:
        model = LibraryChatMessage
        fields = ['id', 'client_id', 'role', 'content', 'created_at']
        read_only_fields = fields


class LibraryChatMessageWriteSerializer(serializers.ModelSerializer):
    """Writable serializer for an already-produced library-assistant message.

    The library agent streams through the CopilotKit sidecar, so Django never
    sees the turn; the client posts each completed message here (idempotent by
    `client_id`) to keep the durable transcript in sync. No LLM call.
    """

    class Meta:
        model = LibraryChatMessage
        fields = ['client_id', 'role', 'content']

    def validate_client_id(self, value):
        if not (value or '').strip():
            raise serializers.ValidationError('client_id is required.')
        return value

    def validate_content(self, value):
        if not (value or '').strip():
            raise serializers.ValidationError('content is required.')
        return value


class LibraryChatSessionSerializer(serializers.ModelSerializer):
    """Serializes a library chat session; messages are fetched separately."""
    message_count = serializers.SerializerMethodField()

    class Meta:
        model = LibraryChatSession
        fields = [
            'id',
            'thread_id',
            'title',
            'created_at',
            'updated_at',
            'message_count',
        ]
        # `thread_id` is client-supplied on create (it joins the AG-UI thread);
        # `title` is patchable. The rest are server-owned.
        read_only_fields = ['id', 'created_at', 'updated_at', 'message_count']

    def get_message_count(self, obj):
        return obj.messages.count()


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
