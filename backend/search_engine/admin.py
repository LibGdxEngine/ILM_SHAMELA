from django.contrib import admin
from .models import (
    Author,
    Category,
    Chapter,
    ChatMessage,
    ChatSession,
    Document,
    DocumentAlternateName,
    Edition,
)


class DocumentAlternateNameInline(admin.TabularInline):
    """Inline admin for DocumentAlternateName."""
    model = DocumentAlternateName
    extra = 1
    fields = ['name']


class EditionInline(admin.StackedInline):
    """Inline admin for the printed edition(s) a document was digitized from."""
    model = Edition
    extra = 0
    fields = [
        'editor', 'publisher', 'publication_place', 'edition_statement',
        'publication_year_hijri', 'publication_year_gregorian', 'volume_count',
        'page_map', 'notes',
    ]


class ChapterInline(admin.TabularInline):
    """Inline admin for Chapter rows on the Document page."""
    model = Chapter
    extra = 0
    fields = ['order', 'title', 'parent', 'page_start', 'page_end']
    ordering = ['order']
    autocomplete_fields = ['parent']


@admin.register(Author)
class AuthorAdmin(admin.ModelAdmin):
    """Admin interface for Author model."""
    list_display = ['id', 'name', 'date_of_birth', 'date_of_death', 'created_at']
    list_filter = ['created_at', 'updated_at']
    search_fields = ['name', 'alternate_names', 'description']
    readonly_fields = ['created_at', 'updated_at']
    fieldsets = (
        ('Basic Information', {
            'fields': ('name', 'alternate_names', 'photo', 'description')
        }),
        ('Dates', {
            'fields': ('date_of_birth', 'date_of_death')
        }),
        ('Timestamps', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    """Admin interface for Category model."""
    list_display = ['id', 'name', 'created_at', 'updated_at']
    list_filter = ['created_at', 'updated_at']
    search_fields = ['name']
    readonly_fields = ['created_at', 'updated_at']
    ordering = ['name']


@admin.register(DocumentAlternateName)
class DocumentAlternateNameAdmin(admin.ModelAdmin):
    """Admin interface for DocumentAlternateName model."""
    list_display = ['id', 'document', 'name', 'created_at']
    list_filter = ['created_at']
    search_fields = ['name', 'document__title']
    readonly_fields = ['created_at']


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    """Admin interface for Document model."""
    list_display = ['id', 'title', 'uploaded_at', 'processed', 'language', 'rights_status',
                    'get_authors_display']
    list_filter = ['processed', 'rights_status', 'language', 'uploaded_at', 'authors',
                   'categories']
    search_fields = ['title', 'description', 'provenance_source']
    readonly_fields = ['uploaded_at']
    filter_horizontal = ['authors', 'categories']
    inlines = [DocumentAlternateNameInline, ChapterInline, EditionInline]
    actions = ['mark_rights_clear', 'mark_rights_gray', 'mark_rights_restricted',
               'mark_rights_unreviewed']
    fieldsets = (
        ('Basic Information', {
            'fields': ('title', 'file', 'language', 'description', 'written_date')
        }),
        ('Content', {
            'fields': ('content', 'processed')
        }),
        ('Rights & Provenance', {
            'fields': ('rights_status', 'provenance_source', 'rights_notes')
        }),
        ('Media', {
            'fields': ('cover_photo', 'thumbnail')
        }),
        ('Relationships', {
            'fields': ('authors', 'categories')
        }),
        ('Timestamps', {
            'fields': ('uploaded_at',),
            'classes': ('collapse',)
        }),
    )

    def get_authors_display(self, obj):
        """Display authors as comma-separated list."""
        return ', '.join([author.name for author in obj.authors.all()[:3]])
    get_authors_display.short_description = 'Authors'

    def _mark_rights(self, request, queryset, status):
        updated = queryset.update(rights_status=status)
        self.message_user(request, f'{updated} document(s) marked as {status}.')

    @admin.action(description='Mark rights: clear (نضيف)')
    def mark_rights_clear(self, request, queryset):
        self._mark_rights(request, queryset, Document.RightsStatus.CLEAR)

    @admin.action(description='Mark rights: gray area (رمادي)')
    def mark_rights_gray(self, request, queryset):
        self._mark_rights(request, queryset, Document.RightsStatus.GRAY)

    @admin.action(description='Mark rights: restricted (ممنوع)')
    def mark_rights_restricted(self, request, queryset):
        self._mark_rights(request, queryset, Document.RightsStatus.RESTRICTED)

    @admin.action(description='Mark rights: unreviewed')
    def mark_rights_unreviewed(self, request, queryset):
        self._mark_rights(request, queryset, Document.RightsStatus.UNREVIEWED)


@admin.register(Edition)
class EditionAdmin(admin.ModelAdmin):
    """Standalone admin for Edition (also editable inline on Document)."""
    list_display = ['id', 'document', 'editor', 'publisher', 'publication_year_hijri',
                    'volume_count']
    search_fields = ['document__title', 'editor', 'publisher']
    autocomplete_fields = ['document']


@admin.register(Chapter)
class ChapterAdmin(admin.ModelAdmin):
    """Standalone admin for Chapter (also editable inline on Document)."""
    list_display = ['id', 'document', 'order', 'title', 'page_start', 'page_end', 'parent']
    list_filter = ['document']
    search_fields = ['title', 'document__title']
    ordering = ['document', 'order']
    autocomplete_fields = ['document', 'parent']


class ChatMessageInline(admin.TabularInline):
    """Read-only inline of messages within a session."""
    model = ChatMessage
    extra = 0
    fields = ['created_at', 'role', 'content', 'context_page', 'citations']
    readonly_fields = fields
    can_delete = False


@admin.register(ChatSession)
class ChatSessionAdmin(admin.ModelAdmin):
    list_display = ['id', 'user', 'document', 'created_at', 'updated_at']
    list_filter = ['document', 'user']
    search_fields = ['user__username', 'document__title']
    readonly_fields = ['created_at', 'updated_at']
    inlines = [ChatMessageInline]


@admin.register(ChatMessage)
class ChatMessageAdmin(admin.ModelAdmin):
    list_display = ['id', 'session', 'role', 'context_page', 'created_at']
    list_filter = ['role', 'session__document']
    search_fields = ['content', 'session__user__username']
    readonly_fields = ['created_at']