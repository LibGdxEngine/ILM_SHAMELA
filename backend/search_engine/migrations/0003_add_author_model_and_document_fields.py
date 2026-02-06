# Generated migration for adding Author model, DocumentAlternateName model, and new fields to Document

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('search_engine', '0002_document_authors_categories'),
    ]

    operations = [
        # Create Author model
        migrations.CreateModel(
            name='Author',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(help_text='Primary name of the author', max_length=255, unique=True)),
                ('alternate_names', models.JSONField(blank=True, default=list, help_text='List of alternate names for the same person')),
                ('date_of_birth', models.CharField(blank=True, help_text="Date of birth (flexible format, e.g., '1200 CE', '5th century')", max_length=100, null=True)),
                ('date_of_death', models.CharField(blank=True, help_text='Date of death (flexible format)', max_length=100, null=True)),
                ('photo', models.ImageField(blank=True, help_text='Author photo', null=True, upload_to='authors/photos/')),
                ('description', models.TextField(blank=True, help_text='Author biography/description', null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name': 'Author',
                'verbose_name_plural': 'Authors',
                'db_table': 'search_engine_authors',
                'ordering': ['name'],
            },
        ),
        # Create DocumentAlternateName model
        migrations.CreateModel(
            name='DocumentAlternateName',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(help_text='Alternate name for the document', max_length=500)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('document', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='alternate_names', to='search_engine.document')),
            ],
            options={
                'verbose_name': 'Document Alternate Name',
                'verbose_name_plural': 'Document Alternate Names',
                'db_table': 'search_engine_document_alternate_names',
                'ordering': ['name'],
            },
        ),
        # Add new fields to Document model
        migrations.AddField(
            model_name='document',
            name='cover_photo',
            field=models.ImageField(blank=True, help_text='Book cover image', null=True, upload_to='documents/covers/'),
        ),
        migrations.AddField(
            model_name='document',
            name='description',
            field=models.TextField(blank=True, help_text='Book description/metadata', null=True),
        ),
        migrations.AddField(
            model_name='document',
            name='thumbnail',
            field=models.ImageField(blank=True, help_text='Thumbnail version of cover', null=True, upload_to='documents/thumbnails/'),
        ),
        migrations.AddField(
            model_name='document',
            name='written_date',
            field=models.CharField(blank=True, help_text="When the book was written (flexible format, e.g., '1200 CE', '5th century')", max_length=100, null=True),
        ),
        # Add unique constraint for DocumentAlternateName
        migrations.AlterUniqueTogether(
            name='documentalternatename',
            unique_together={('document', 'name')},
        ),
    ]
