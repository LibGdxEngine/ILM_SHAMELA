# Data migration to convert existing JSONField authors to Author model instances

from django.db import migrations


def migrate_authors(apps, schema_editor):
    """
    Migrate authors from JSONField to Author model instances.
    Creates Author instances for unique author names and links them to documents.
    """
    Document = apps.get_model('search_engine', 'Document')
    Author = apps.get_model('search_engine', 'Author')
    
    # Dictionary to track author names and their Author instances
    author_map = {}
    
    # Process all documents
    for document in Document.objects.all():
        if document.authors_old and isinstance(document.authors_old, list):
            for author_name in document.authors_old:
                if author_name and isinstance(author_name, str):
                    author_name = author_name.strip()
                    if author_name:
                        # Check if we've already created this author
                        if author_name not in author_map:
                            # Create new Author instance
                            author, created = Author.objects.get_or_create(
                                name=author_name,
                                defaults={'alternate_names': []}
                            )
                            author_map[author_name] = author
                        else:
                            author = author_map[author_name]
                        
                        # Link document to author
                        document.authors.add(author)


def reverse_migrate_authors(apps, schema_editor):
    """
    Reverse migration: convert Author relationships back to JSONField.
    """
    Document = apps.get_model('search_engine', 'Document')
    
    for document in Document.objects.all():
        # Get author names from ManyToMany relationship
        author_names = list(document.authors.values_list('name', flat=True))
        # Store in old JSONField
        document.authors_old = author_names
        document.save()


class Migration(migrations.Migration):

    dependencies = [
        ('search_engine', '0004_add_author_m2m_and_rename_old_authors'),
    ]

    operations = [
        migrations.RunPython(migrate_authors, reverse_migrate_authors),
    ]
