from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('search_engine', '0009_migrate_and_drop_legacy_author_category_json'),
    ]

    operations = [
        migrations.CreateModel(
            name='DocumentChunk',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('chunk_index', models.PositiveIntegerField()),
                ('page_number', models.PositiveIntegerField()),
                ('content', models.TextField()),
                ('embedding', models.JSONField(blank=True, default=list)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('document', models.ForeignKey(
                    db_index=True,
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='chunks',
                    to='search_engine.document',
                )),
            ],
            options={
                'db_table': 'search_engine_document_chunks',
                'ordering': ['document', 'chunk_index'],
                'indexes': [
                    models.Index(fields=['document', 'chunk_index'], name='chunk_doc_idx'),
                ],
            },
        ),
        migrations.AlterUniqueTogether(
            name='documentchunk',
            unique_together={('document', 'chunk_index')},
        ),
    ]
