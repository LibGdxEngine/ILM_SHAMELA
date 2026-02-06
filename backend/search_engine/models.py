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
    title = models.CharField(max_length=500)
    file = models.FileField(upload_to='documents/')
    uploaded_at = models.DateTimeField(auto_now_add=True)
    processed = models.BooleanField(default=False)
    language = models.CharField(max_length=10, blank=True, null=True)
    content = models.TextField(null=True, blank=True)
    # Keep old authors JSONField temporarily for migration, will be removed later
    authors_old = models.JSONField(
        default=list, blank=True, help_text="Legacy authors field (deprecated)")
    # New ManyToMany relationship with Author model
    authors = models.ManyToManyField(
        Author, related_name='documents', blank=True, help_text="Authors of the document")
    # Keep old categories JSONField temporarily for migration, will be removed later
    # Note: This field will be created by migration 0006
    # IMPORTANT: Run migrations before using this model: python manage.py migrate
    categories_old = models.JSONField(
        default=list, blank=True, help_text="Legacy categories field (deprecated)")
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

    class Meta:
        db_table = 'search_engine_documents'
        verbose_name = 'Document'
        verbose_name_plural = 'Documents'
        ordering = ['-uploaded_at']

    def __str__(self):
        return self.title


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
