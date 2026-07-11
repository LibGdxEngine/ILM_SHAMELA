from django.contrib import admin

from .models import UserDocumentAffinity, UserEvent


@admin.register(UserEvent)
class UserEventAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'event_type', 'document', 'source', 'created_at')
    list_filter = ('event_type', 'source', 'created_at')
    search_fields = ('user__email', 'document__title')
    readonly_fields = (
        'user', 'event_type', 'document', 'session_id', 'source',
        'metadata', 'created_at',
    )
    date_hierarchy = 'created_at'
    list_select_related = ('user', 'document')

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(UserDocumentAffinity)
class UserDocumentAffinityAdmin(admin.ModelAdmin):
    list_display = (
        'user', 'document', 'engagement_score', 'open_count', 'total_read_ms',
        'bookmark_count', 'note_count', 'highlight_count', 'assistant_query_count',
        'percent_complete', 'last_engaged_at',
    )
    list_filter = ('last_engaged_at',)
    search_fields = ('user__email', 'document__title')
    readonly_fields = ('user', 'document', 'first_engaged_at', 'last_engaged_at')
    list_select_related = ('user', 'document')
    ordering = ('-engagement_score',)
