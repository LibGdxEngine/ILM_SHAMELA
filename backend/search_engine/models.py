from django.conf import settings
from django.db import models


class Author(models.Model):
    """Author model for storing author information."""
    name = models.CharField(max_length=255, unique=True,
                            help_text="Primary name of the author")
    alternate_names = models.JSONField(
        default=list, blank=True, help_text="List of alternate names for the same person")
    date_of_birth = models.CharField(max_length=100, blank=True, null=True,
                                     help_text="Date of birth (flexible format, e.g., '1200 CE', '5th century')")
    date_of_death = models.CharField(
        max_length=100, blank=True, null=True, help_text="Date of death (flexible format)")
    photo = models.ImageField(
        upload_to='authors/photos/', blank=True, null=True, help_text="Author photo")
    description = models.TextField(
        blank=True, null=True, help_text="Author biography/description")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'search_engine_authors'
        verbose_name = 'Author'
        verbose_name_plural = 'Authors'
        ordering = ['name']

    def __str__(self):
        return self.name


class Category(models.Model):
    """Category model for storing document categories."""
    name = models.CharField(max_length=255, unique=True, help_text="Category name")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'search_engine_categories'
        verbose_name = 'Category'
        verbose_name_plural = 'Categories'
        ordering = ['name']

    def __str__(self):
        return self.name


class Document(models.Model):
    """Document model for storing file metadata."""
    class ProcessingStatus(models.TextChoices):
        PENDING = 'pending', 'Pending'
        PROCESSING = 'processing', 'Processing'
        SUCCEEDED = 'succeeded', 'Succeeded'
        FAILED = 'failed', 'Failed'

    class OCREngine(models.TextChoices):
        AUTO = 'auto', 'Auto (Tika first, OCR fallback)'
        NONE = 'none', 'No OCR'
        TESSERACT = 'tesseract', 'Tesseract'
        CHANDRA = 'chandra', 'Chandra'

    title = models.CharField(max_length=500)
    file = models.FileField(upload_to='documents/')
    uploaded_at = models.DateTimeField(auto_now_add=True)
    processed = models.BooleanField(default=False)
    processing_status = models.CharField(
        max_length=20,
        choices=ProcessingStatus.choices,
        default=ProcessingStatus.PENDING,
        help_text="State of asynchronous document processing"
    )
    processing_error = models.TextField(
        blank=True,
        null=True,
        help_text="Last processing error (if any)"
    )
    processing_attempts = models.PositiveIntegerField(
        default=0,
        help_text="Number of processing attempts"
    )
    processing_started_at = models.DateTimeField(
        blank=True,
        null=True,
        help_text="When processing was last started"
    )
    processing_completed_at = models.DateTimeField(
        blank=True,
        null=True,
        help_text="When processing last completed (success/failure)"
    )
    language = models.CharField(max_length=10, blank=True, null=True)
    content = models.TextField(null=True, blank=True)
    semantic_vector = models.JSONField(
        default=list,
        blank=True,
        help_text="Deterministic embedding vector used for hybrid search reranking"
    )
    # New ManyToMany relationship with Author model
    authors = models.ManyToManyField(
        Author, related_name='documents', blank=True, help_text="Authors of the document")
    # New ManyToMany relationship with Category model
    categories = models.ManyToManyField(
        Category, related_name='documents', blank=True, help_text="Categories of the document")
    # New fields for enhanced metadata
    cover_photo = models.ImageField(
        upload_to='documents/covers/', blank=True, null=True, help_text="Book cover image")
    thumbnail = models.ImageField(upload_to='documents/thumbnails/',
                                  blank=True, null=True, help_text="Thumbnail version of cover")
    description = models.TextField(
        blank=True, null=True, help_text="Book description/metadata")
    written_date = models.CharField(max_length=100, blank=True, null=True,
                                    help_text="When the book was written (flexible format, e.g., '1200 CE', '5th century')")
    ocr_engine = models.CharField(
        max_length=32,
        choices=OCREngine.choices,
        default=OCREngine.AUTO,
        help_text="OCR engine requested at upload (auto = Tika first with fallback)",
    )
    ocr_engine_used = models.CharField(
        max_length=32,
        blank=True,
        default='',
        help_text="OCR engine actually executed during processing (audit trail)",
    )

    class Meta:
        db_table = 'search_engine_documents'
        verbose_name = 'Document'
        verbose_name_plural = 'Documents'
        ordering = ['-uploaded_at']

    def __str__(self):
        return self.title


class DocumentChunk(models.Model):
    """Per-page/chunk embedding storage for in-document semantic search."""
    document = models.ForeignKey(
        Document, on_delete=models.CASCADE, related_name='chunks', db_index=True)
    chunk_index = models.PositiveIntegerField()
    page_number = models.PositiveIntegerField()
    content = models.TextField()
    embedding = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'search_engine_document_chunks'
        ordering = ['document', 'chunk_index']
        unique_together = [['document', 'chunk_index']]
        indexes = [models.Index(fields=['document', 'chunk_index'], name='chunk_doc_idx')]

    def __str__(self):
        return f"{self.document.title} — chunk {self.chunk_index} (page {self.page_number})"


class DocumentAlternateName(models.Model):
    """Model for storing alternate names of documents."""
    document = models.ForeignKey(
        Document, on_delete=models.CASCADE, related_name='alternate_names')
    name = models.CharField(
        max_length=500, help_text="Alternate name for the document")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'search_engine_document_alternate_names'
        verbose_name = 'Document Alternate Name'
        verbose_name_plural = 'Document Alternate Names'
        ordering = ['name']
        unique_together = [['document', 'name']]

    def __str__(self):
        return f"{self.document.title} - {self.name}"


class ReaderPreference(models.Model):
    """Per-user reader UI preferences (typography, theme, diacritics)."""
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='reader_preference',
    )
    font_size = models.CharField(max_length=10, default='medium')
    theme = models.CharField(max_length=10, default='light')
    font_weight = models.PositiveSmallIntegerField(default=400)
    letter_spacing = models.FloatField(default=0.0)
    line_height = models.FloatField(default=1.8)
    tashkeel_enabled = models.BooleanField(default=True)
    extra = models.JSONField(default=dict, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'search_engine_reader_preferences'
        verbose_name = 'Reader Preference'
        verbose_name_plural = 'Reader Preferences'

    def __str__(self):
        return f"ReaderPreference(user={self.user_id})"


class Bookmark(models.Model):
    """Per-user bookmark on a document page."""
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='bookmarks',
    )
    document = models.ForeignKey(
        Document, on_delete=models.CASCADE, related_name='bookmarks'
    )
    page_number = models.PositiveIntegerField()
    paragraph_id = models.CharField(max_length=64, blank=True, default='')
    label = models.CharField(max_length=200, blank=True, default='')
    tags = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'search_engine_bookmarks'
        verbose_name = 'Bookmark'
        verbose_name_plural = 'Bookmarks'
        unique_together = [['user', 'document', 'page_number']]
        indexes = [models.Index(fields=['user', 'document'])]
        ordering = ['document', 'page_number']

    def __str__(self):
        return f"Bookmark(user={self.user_id}, doc={self.document_id}, page={self.page_number})"


class Note(models.Model):
    """Per-user free-text note attached to a document page."""
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='notes',
    )
    document = models.ForeignKey(
        Document, on_delete=models.CASCADE, related_name='notes'
    )
    page_number = models.PositiveIntegerField()
    paragraph_id = models.CharField(max_length=64, blank=True, default='')
    body = models.TextField()
    tags = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'search_engine_notes'
        verbose_name = 'Note'
        verbose_name_plural = 'Notes'
        indexes = [models.Index(fields=['user', 'document'])]
        ordering = ['-updated_at']

    def __str__(self):
        return f"Note(user={self.user_id}, doc={self.document_id}, page={self.page_number})"


class Highlight(models.Model):
    """Per-user color highlight over a character range within a paragraph."""
    COLORS = [
        ('yellow', 'yellow'),
        ('green', 'green'),
        ('blue', 'blue'),
        ('pink', 'pink'),
        ('orange', 'orange'),
    ]
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='highlights',
    )
    document = models.ForeignKey(
        Document, on_delete=models.CASCADE, related_name='highlights'
    )
    page_number = models.PositiveIntegerField()
    paragraph_id = models.CharField(max_length=64)
    char_start = models.PositiveIntegerField()
    char_end = models.PositiveIntegerField()
    color = models.CharField(max_length=10, choices=COLORS, default='yellow')
    note = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'search_engine_highlights'
        verbose_name = 'Highlight'
        verbose_name_plural = 'Highlights'
        indexes = [
            models.Index(fields=['user', 'document']),
            models.Index(fields=['document', 'page_number']),
        ]
        ordering = ['document', 'page_number', 'char_start']

    def __str__(self):
        return (
            f"Highlight(user={self.user_id}, doc={self.document_id}, "
            f"page={self.page_number}, range={self.char_start}-{self.char_end})"
        )


class ReadingProgress(models.Model):
    """Per-user reading position within a document (one row per user+document)."""
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='reading_progress',
    )
    document = models.ForeignKey(
        Document, on_delete=models.CASCADE, related_name='reading_progress'
    )
    last_page = models.PositiveIntegerField(default=1)
    last_paragraph_id = models.CharField(max_length=64, blank=True, default='')
    scroll_ratio = models.FloatField(default=0.0)
    percent_complete = models.FloatField(default=0.0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'search_engine_reading_progress'
        verbose_name = 'Reading Progress'
        verbose_name_plural = 'Reading Progress'
        unique_together = [['user', 'document']]
        indexes = [models.Index(fields=['user', '-updated_at'])]

    def __str__(self):
        return (
            f"ReadingProgress(user={self.user_id}, doc={self.document_id}, "
            f"page={self.last_page})"
        )
