from django.conf import settings
from django.core.exceptions import ValidationError
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
    nationality = models.CharField(
        max_length=100, blank=True, null=True, help_text="Nationality of the author")
    death_year_hijri = models.IntegerField(
        null=True, blank=True,
        help_text="Derived hijri death year parsed from date_of_death; null when unparseable")
    death_century = models.IntegerField(
        null=True, blank=True, db_index=True,
        help_text="Derived hijri century of death (year 728 -> 8); null when unknown")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'search_engine_authors'
        verbose_name = 'Author'
        verbose_name_plural = 'Authors'
        ordering = ['name']

    def save(self, *args, **kwargs):
        # Same-row derived data (cross-model sync lives in signals.py), so the
        # derivation sits here next to the fields. Bulk paths (queryset
        # .update()/bulk_create) bypass save(); the backfill_death_years
        # command re-derives after any such write.
        from .hijri_dates import derive_death_fields
        self.death_year_hijri, self.death_century = derive_death_fields(self.date_of_death)
        super().save(*args, **kwargs)

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
        DOCLING = 'docling', 'Docling'

    class RightsStatus(models.TextChoices):
        UNREVIEWED = 'unreviewed', 'Unreviewed'
        CLEAR = 'clear', 'Clear'
        GRAY = 'gray', 'Gray area'
        RESTRICTED = 'restricted', 'Restricted'

    title = models.CharField(max_length=500)
    file = models.FileField(upload_to='documents/')
    uploaded_at = models.DateTimeField(auto_now_add=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='uploaded_documents',
        db_index=True,
        help_text="User who uploaded the document; NULL for legacy uploads that predate "
                  "ownership tracking (the 'my uploads' search scope only covers "
                  "attributed documents)",
    )
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
    ocr_layout = models.FileField(
        upload_to='documents/ocr/',
        blank=True,
        null=True,
        help_text="Optional datalab/marker OCR JSON with per-block bounding boxes; when present the "
                  "reader renders the original PDF page image with a transparent text overlay",
    )
    has_layout = models.BooleanField(
        default=False,
        help_text="True when this document was ingested with an OCR layout JSON (PDF-overlay reader mode)",
    )
    word_count = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Cached count of whitespace-delimited words in `content`; "
                  "computed lazily by the assistant's metadata tool",
    )
    page_count = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Cached count of distinct DocumentChunk.page_number; "
                  "computed lazily by the assistant's metadata tool",
    )
    rights_status = models.CharField(
        max_length=20,
        choices=RightsStatus.choices,
        default=RightsStatus.UNREVIEWED,
        db_index=True,
        help_text="Rights-audit classification: the base heritage text is public domain, but "
                  "modern critical apparatus (tahqiq, footnotes, introductions) may carry "
                  "editor/publisher rights",
    )
    provenance_source = models.CharField(
        max_length=500,
        blank=True,
        default='',
        help_text="Where the digital text came from (e.g. 'scan of Dar X 1407H edition', "
                  "'Shamela import')",
    )
    rights_notes = models.TextField(
        blank=True,
        default='',
        help_text="Free-form notes supporting the rights classification",
    )

    class Meta:
        db_table = 'search_engine_documents'
        verbose_name = 'Document'
        verbose_name_plural = 'Documents'
        ordering = ['-uploaded_at']

    def __str__(self):
        return self.title

    @property
    def primary_edition(self):
        """The printed edition this document was digitized from (first by id)."""
        return self.editions.order_by('id').first()


class DocumentChunk(models.Model):
    """Per-page/chunk embedding storage for in-document semantic search."""
    document = models.ForeignKey(
        Document, on_delete=models.CASCADE, related_name='chunks', db_index=True)
    chunk_index = models.PositiveIntegerField()
    page_number = models.PositiveIntegerField()
    content = models.TextField()
    structured_content = models.JSONField(
        null=True,
        blank=True,
        help_text="Layout-aware payload from the extractor (e.g. {markdown, tables}); null when "
                  "the extractor returned only plain text",
    )
    layout = models.JSONField(
        null=True,
        blank=True,
        help_text="Per-page OCR geometry {width, height, blocks:[{id, type, bbox, text, "
                  "char_start, char_end}]} used to position the transparent text overlay",
    )
    page_image = models.ImageField(
        upload_to='documents/pages/',
        blank=True,
        null=True,
        help_text="Rendered image of this PDF page shown beneath the transparent text overlay",
    )
    embedding = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'search_engine_document_chunks'
        ordering = ['document', 'chunk_index']
        unique_together = [['document', 'chunk_index']]
        indexes = [models.Index(fields=['document', 'chunk_index'], name='chunk_doc_idx')]

    def __str__(self):
        return f"{self.document.title} — chunk {self.chunk_index} (page {self.page_number})"


class Edition(models.Model):
    """The printed edition a document was digitized from (موافقة المطبوع).

    ``page_map`` maps digital page numbers to printed (volume, page) references so the
    reader and AI citations can cite the physical edition. It is a list of volume ranges,
    reprocess-safe (unlike DocumentChunk rows, which are rebuilt on every reprocess).
    """

    document = models.ForeignKey(
        Document, on_delete=models.CASCADE, related_name='editions')
    editor = models.CharField(
        max_length=255, blank=True, default='',
        help_text="Editor / muhaqqiq (المحقق) of this printed edition")
    publisher = models.CharField(
        max_length=255, blank=True, default='', help_text="Publishing house (دار النشر)")
    publication_place = models.CharField(
        max_length=255, blank=True, default='', help_text="Place of publication")
    edition_statement = models.CharField(
        max_length=100, blank=True, default='',
        help_text="Edition statement, e.g. 'الطبعة الثانية'")
    publication_year_hijri = models.CharField(
        max_length=50, blank=True, default='',
        help_text="Hijri publication year (flexible format, e.g. '1407' or '1407–1410هـ')")
    publication_year_gregorian = models.CharField(
        max_length=50, blank=True, default='',
        help_text="Gregorian publication year (flexible format)")
    volume_count = models.PositiveIntegerField(null=True, blank=True)
    page_map = models.JSONField(
        default=list,
        blank=True,
        help_text='Digital→printed page ranges, e.g. '
                  '[{"volume": 2, "from_page": 120, "to_page": 250, "printed_start": 1}]. '
                  'Page numbers are the DIGITAL page numbers of this document; reprocessing a '
                  'non-layout document with a different OCR engine can renumber pages and '
                  'silently invalidate this map (PDF-overlay documents are safe).',
    )
    notes = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'search_engine_editions'
        verbose_name = 'Edition'
        verbose_name_plural = 'Editions'
        ordering = ['document', 'id']

    def __str__(self):
        parts = [self.document.title]
        if self.publisher:
            parts.append(self.publisher)
        if self.publication_year_hijri:
            parts.append(f"{self.publication_year_hijri}هـ")
        return ' — '.join(parts)

    def clean(self):
        if not isinstance(self.page_map, list):
            raise ValidationError({'page_map': 'page_map must be a list of range objects.'})
        ranges = []
        for i, entry in enumerate(self.page_map):
            if not isinstance(entry, dict):
                raise ValidationError({'page_map': f'Entry {i} must be an object.'})
            values = {}
            for key in ('volume', 'from_page', 'to_page', 'printed_start'):
                value = entry.get(key)
                # bool is an int subclass; reject it explicitly
                if not isinstance(value, int) or isinstance(value, bool) or value < 1:
                    raise ValidationError(
                        {'page_map': f'Entry {i}: "{key}" must be an integer >= 1.'})
                values[key] = value
            if values['to_page'] < values['from_page']:
                raise ValidationError(
                    {'page_map': f'Entry {i}: "to_page" must be >= "from_page".'})
            ranges.append(values)
        ranges.sort(key=lambda r: r['from_page'])
        for prev, curr in zip(ranges, ranges[1:]):
            if curr['from_page'] <= prev['to_page']:
                raise ValidationError(
                    {'page_map': 'Page ranges must not overlap '
                                 f"({prev['from_page']}–{prev['to_page']} and "
                                 f"{curr['from_page']}–{curr['to_page']})."})

    def printed_ref(self, page_number):
        """Return {'volume': v, 'printed_page': p} for a digital page, or None if unmapped."""
        if not page_number or not isinstance(self.page_map, list):
            return None
        for entry in self.page_map:
            if not isinstance(entry, dict):
                continue
            from_page = entry.get('from_page')
            to_page = entry.get('to_page')
            printed_start = entry.get('printed_start')
            volume = entry.get('volume')
            if not all(isinstance(v, int) and not isinstance(v, bool)
                       for v in (from_page, to_page, printed_start, volume)):
                continue
            if from_page <= page_number <= to_page:
                return {
                    'volume': volume,
                    'printed_page': printed_start + (page_number - from_page),
                }
        return None


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


class DocumentFilterPreference(models.Model):
    """Per-user auto-saved 'last used' /documents filter state, restored on next visit."""
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='document_filter_preference',
    )
    filters = models.JSONField(default=dict, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'search_engine_document_filter_preference'
        verbose_name = 'Document Filter Preference'
        verbose_name_plural = 'Document Filter Preferences'

    def __str__(self):
        return f"DocumentFilterPreference(user={self.user_id})"


class SavedFilterPreset(models.Model):
    """Named, user-saved /documents filter preset for fast recall."""
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='saved_filter_presets',
    )
    name = models.CharField(max_length=100)
    filters = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'search_engine_saved_filter_preset'
        verbose_name = 'Saved Filter Preset'
        verbose_name_plural = 'Saved Filter Presets'
        ordering = ['-created_at']
        unique_together = [['user', 'name']]

    def __str__(self):
        return f"SavedFilterPreset(user={self.user_id}, name={self.name!r})"


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


class TextCorrection(models.Model):
    """Per-user error report anchored to a character range within a paragraph."""
    STATUSES = [
        ('open', 'Open'),
        ('reviewed', 'Reviewed'),
        ('resolved', 'Resolved'),
    ]
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='text_corrections',
    )
    document = models.ForeignKey(
        Document, on_delete=models.CASCADE, related_name='text_corrections'
    )
    page_number = models.PositiveIntegerField()
    paragraph_id = models.CharField(max_length=64, blank=True, default='')
    char_start = models.PositiveIntegerField()
    char_end = models.PositiveIntegerField()
    selected_text = models.TextField()
    description = models.TextField()
    suggested_correction = models.TextField(blank=True, default='')
    status = models.CharField(max_length=10, choices=STATUSES, default='open')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'search_engine_text_corrections'
        verbose_name = 'Text Correction'
        verbose_name_plural = 'Text Corrections'
        indexes = [
            models.Index(fields=['user', 'document']),
            models.Index(fields=['document', 'page_number']),
        ]
        ordering = ['-created_at']

    def __str__(self):
        return (
            f"TextCorrection(user={self.user_id}, doc={self.document_id}, "
            f"page={self.page_number}, status={self.status})"
        )


class Chapter(models.Model):
    """A chapter/section entry in a document's table of contents.

    Self-referencing via `parent` to support nested subsections.
    Populated post-ingest by the `extract_chapters` management command
    (parses h1/h2/h3 in DocumentPage.content) or via admin.
    """
    document = models.ForeignKey(
        Document, on_delete=models.CASCADE, related_name='chapters'
    )
    parent = models.ForeignKey(
        'self',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='children',
    )
    title = models.CharField(max_length=512)
    order = models.PositiveIntegerField(default=0)
    page_start = models.PositiveIntegerField()
    page_end = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        db_table = 'search_engine_chapters'
        verbose_name = 'Chapter'
        verbose_name_plural = 'Chapters'
        ordering = ['document', 'order']
        indexes = [models.Index(fields=['document', 'order'])]

    def __str__(self):
        return f"Chapter(doc={self.document_id}, '{self.title}', p{self.page_start})"


class ChatSession(models.Model):
    """A single conversation between a user and the AI assistant about a document."""
    CONTEXT_SCOPE_CHOICES = [('auto', 'auto'), ('page', 'page'), ('book', 'book')]

    document = models.ForeignKey(
        Document, on_delete=models.CASCADE, related_name='chat_sessions'
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='chat_sessions',
    )
    title = models.CharField(max_length=200, blank=True, default='')
    context_scope = models.CharField(
        max_length=8, choices=CONTEXT_SCOPE_CHOICES, default='auto'
    )
    pinned_context = models.JSONField(
        default=list, blank=True
    )  # [{page:int, text:str, label:str}]
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'search_engine_chat_sessions'
        verbose_name = 'Chat Session'
        verbose_name_plural = 'Chat Sessions'
        ordering = ['-updated_at']
        indexes = [models.Index(fields=['user', 'document', '-updated_at'])]

    def __str__(self):
        return f"ChatSession(user={self.user_id}, doc={self.document_id})"


class ChatMessage(models.Model):
    """One user-or-assistant message within a ChatSession."""
    ROLE_CHOICES = [('user', 'user'), ('assistant', 'assistant')]

    session = models.ForeignKey(
        ChatSession, on_delete=models.CASCADE, related_name='messages'
    )
    role = models.CharField(max_length=12, choices=ROLE_CHOICES)
    content = models.TextField()
    citations = models.JSONField(
        default=list,
        blank=True,
        help_text="Assistant citations: [{page: int, quote: str, volume?: int, "
                  "printed_page?: int}, ...]; volume/printed_page are derived from the "
                  "document's Edition page_map when mapped",
    )
    context_page = models.PositiveIntegerField(
        null=True, blank=True,
        help_text="Page the user was reading when this message was sent",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'search_engine_chat_messages'
        verbose_name = 'Chat Message'
        verbose_name_plural = 'Chat Messages'
        ordering = ['session', 'created_at']
        indexes = [models.Index(fields=['session', 'created_at'])]

    def __str__(self):
        return f"ChatMessage({self.role}, session={self.session_id})"


class LibraryChatSession(models.Model):
    """A conversation between a user and the library-wide AI assistant.

    Unlike ChatSession this is *document-less* (the library agent researches the
    whole catalogue). The `thread_id` is the CopilotKit/AG-UI thread id minted on
    the frontend; it joins the durable transcript here to the ephemeral thread the
    deep-agent sidecar keeps in its in-RAM checkpointer.
    """
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='library_chat_sessions',
    )
    thread_id = models.CharField(max_length=64, db_index=True)
    title = models.CharField(max_length=200, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'search_engine_library_chat_sessions'
        verbose_name = 'Library Chat Session'
        verbose_name_plural = 'Library Chat Sessions'
        ordering = ['-updated_at']
        # One durable row per (user, thread_id) so create is idempotent.
        unique_together = ('user', 'thread_id')
        indexes = [models.Index(fields=['user', '-updated_at'])]

    def __str__(self):
        return f"LibraryChatSession(user={self.user_id}, thread={self.thread_id})"


class LibraryChatMessage(models.Model):
    """One user-or-assistant message within a LibraryChatSession.

    `client_id` is the AG-UI message id supplied by the frontend. It makes the
    store endpoint idempotent (unique per session) and lets replayed history
    dedupe against the sidecar's checkpointer by id.
    """
    ROLE_CHOICES = [('user', 'user'), ('assistant', 'assistant')]

    session = models.ForeignKey(
        LibraryChatSession, on_delete=models.CASCADE, related_name='messages'
    )
    client_id = models.CharField(max_length=64)
    role = models.CharField(max_length=12, choices=ROLE_CHOICES)
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'search_engine_library_chat_messages'
        verbose_name = 'Library Chat Message'
        verbose_name_plural = 'Library Chat Messages'
        ordering = ['session', 'created_at']
        # Idempotent append: a re-posted turn (StrictMode / retry) is a no-op.
        unique_together = ('session', 'client_id')
        indexes = [models.Index(fields=['session', 'created_at'])]

    def __str__(self):
        return f"LibraryChatMessage({self.role}, session={self.session_id})"


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


class CountryDocumentCount(models.Model):
    """Denormalized aggregation table: document counts per country.

    Derived from Author.nationality via the Document ↔ Author M2M.
    Kept in sync automatically by Django signals so that map / stats
    endpoints can read a single small table instead of running
    expensive JOINs + GROUP BY on every request.

    Use ``manage.py rebuild_country_counts`` for a full rebuild.
    """
    country = models.CharField(
        max_length=100, unique=True, db_index=True,
        help_text="Country name (normalised to match Author.nationality)",
    )
    document_count = models.PositiveIntegerField(
        default=0,
        help_text="Number of distinct documents whose authors belong to this country",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'search_engine_country_document_counts'
        verbose_name = 'Country Document Count'
        verbose_name_plural = 'Country Document Counts'
        ordering = ['-document_count', 'country']

    def __str__(self):
        return f"{self.country}: {self.document_count}"

    @classmethod
    def refresh_country(cls, country_name):
        """Recompute the count for a single country and upsert the row."""
        if not country_name or not country_name.strip():
            return
        country_name = country_name.strip()
        count = (
            Document.objects
            .filter(authors__nationality__iexact=country_name)
            .distinct()
            .count()
        )
        if count > 0:
            cls.objects.update_or_create(
                country=country_name,
                defaults={'document_count': count},
            )
        else:
            cls.objects.filter(country=country_name).delete()

    @classmethod
    def refresh_all(cls):
        """Full rebuild of every country row from scratch."""
        from django.db.models import Count
        stats = (
            Author.objects
            .exclude(nationality__isnull=True)
            .exclude(nationality='')
            .values('nationality')
            .annotate(doc_count=Count('documents', distinct=True))
            .order_by()
        )
        # Wipe stale rows and bulk-upsert.
        cls.objects.all().delete()
        cls.objects.bulk_create(
            [
                cls(country=row['nationality'], document_count=row['doc_count'])
                for row in stats if row['doc_count'] > 0
            ],
            ignore_conflicts=True,
        )
