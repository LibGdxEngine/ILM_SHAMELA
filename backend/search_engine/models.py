from django.db import models


class Document(models.Model):
    """Document model for storing file metadata."""
    title = models.CharField(max_length=500)
    file = models.FileField(upload_to='documents/')
    uploaded_at = models.DateTimeField(auto_now_add=True)
    processed = models.BooleanField(default=False)
    language = models.CharField(max_length=10, blank=True, null=True)
    content = models.TextField(null=True, blank=True)

    class Meta:
        db_table = 'search_engine_documents'
        verbose_name = 'Document'
        verbose_name_plural = 'Documents'
        ordering = ['-uploaded_at']

    def __str__(self):
        return self.title