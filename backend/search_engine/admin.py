from django.contrib import admin
from .models import (
    Author,
    Category,
    Chapter,
    ChatMessage,
    ChatSession,
    Document,
    DocumentAlternateName,
)


class DocumentAlternateNameInline(admin.TabularInline):
    """Inline admin for DocumentAlternateName."""
    model = DocumentAlternateName
    extra = 1
    fields = ['name']


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
    list_display = ['id', 'title', 'uploaded_at', 'processed', 'language', 'get_authors_display']
    list_filter = ['processed', 'language', 'uploaded_at', 'authors', 'categories']
    search_fields = ['title', 'description']
    readonly_fields = ['uploaded_at']
    filter_horizontal = ['authors', 'categories']
    inlines = [DocumentAlternateNameInline, ChapterInline]
    fieldsets = (
        ('Basic Information', {
            'fields': ('title', 'file', 'language', 'description', 'written_date')
        }),
        ('Content', {
            'fields': ('content', 'processed')
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