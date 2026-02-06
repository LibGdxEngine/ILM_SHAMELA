# Migration to rename authors JSONField to authors_old and add ManyToMany authors field

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('search_engine', '0003_add_author_model_and_document_fields'),
    ]

    operations = [
        # Rename old authors JSONField to authors_old
        migrations.RenameField(
            model_name='document',
            old_name='authors',
            new_name='authors_old',
        ),
        # Add new ManyToMany authors field
        migrations.AddField(
            model_name='document',
            name='authors',
            field=models.ManyToManyField(blank=True, help_text='Authors of the document', related_name='documents', to='search_engine.author'),
        ),
    ]
