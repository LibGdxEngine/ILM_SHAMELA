# Migration to create Category model and migrate categories from JSONField to ManyToMany

from django.db import migrations, models


def migrate_categories(apps, schema_editor):
    """
    Migrate categories from JSONField to Category model instances.
    Creates Category instances for unique category names and links them to documents.
    """
    Document = apps.get_model('search_engine', 'Document')
    Category = apps.get_model('search_engine', 'Category')
    
    # Dictionary to track category names and their Category instances
    category_map = {}
    
    # Process all documents
    for document in Document.objects.all():
        if document.categories_old and isinstance(document.categories_old, list):
            for category_name in document.categories_old:
                if category_name and isinstance(category_name, str):
                    category_name = category_name.strip()
                    if category_name:
                        # Check if we've already created this category
                        if category_name not in category_map:
                            # Create new Category instance
                            category, created = Category.objects.get_or_create(
                                name=category_name
                            )
                            category_map[category_name] = category
                        else:
                            category = category_map[category_name]
                        
                        # Link document to category
                        document.categories.add(category)


def reverse_migrate_categories(apps, schema_editor):
    """
    Reverse migration: convert Category relationships back to JSONField.
    """
    Document = apps.get_model('search_engine', 'Document')
    
    for document in Document.objects.all():
        # Get category names from ManyToMany relationship
        category_names = list(document.categories.values_list('name', flat=True))
        # Store in old JSONField
        document.categories_old = category_names
        document.save()


class Migration(migrations.Migration):

    dependencies = [
        ('search_engine', '0005_migrate_authors_from_jsonfield'),
    ]

    operations = [
        # Create Category model
        migrations.CreateModel(
            name='Category',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(help_text='Category name', max_length=255, unique=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name': 'Category',
                'verbose_name_plural': 'Categories',
                'db_table': 'search_engine_categories',
                'ordering': ['name'],
            },
        ),
        # Rename old categories JSONField to categories_old
        migrations.RenameField(
            model_name='document',
            old_name='categories',
            new_name='categories_old',
        ),
        # Add new ManyToMany categories field
        migrations.AddField(
            model_name='document',
            name='categories',
            field=models.ManyToManyField(blank=True, help_text='Categories of the document', related_name='documents', to='search_engine.category'),
        ),
        # Migrate data from categories_old to Category instances
        migrations.RunPython(migrate_categories, reverse_migrate_categories),
    ]
