from django.db import models
from django.contrib.auth.models import AbstractUser


class User(AbstractUser):
    """Custom User model extending Django's AbstractUser."""
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'users'
        verbose_name = 'User'
        verbose_name_plural = 'Users'

    def __str__(self):
        return self.username


class Document(models.Model):
    """Document model for storing file metadata and content."""
    title = models.CharField(max_length=500)
    file = models.FileField(upload_to='documents/')
    file_size = models.BigIntegerField(help_text="File size in bytes")
    mime_type = models.CharField(max_length=255, blank=True)
    language = models.CharField(max_length=10, blank=True, help_text="Detected language code")
    content_text = models.TextField(blank=True, help_text="Extracted text content")
    uploaded_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='documents')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    # Metadata fields
    author = models.CharField(max_length=255, blank=True)
    description = models.TextField(blank=True)
    tags = models.JSONField(default=list, blank=True)

    class Meta:
        db_table = 'documents'
        verbose_name = 'Document'
        verbose_name_plural = 'Documents'
        ordering = ['-created_at']

    def __str__(self):
        return self.title
