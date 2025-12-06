from django.contrib import admin
from .models import Document


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    """Admin interface for Document model."""
    list_display = ['id', 'title', 'uploaded_at', 'processed', 'language']
    list_filter = ['processed', 'language', 'uploaded_at']
    search_fields = ['title']
    readonly_fields = ['uploaded_at']