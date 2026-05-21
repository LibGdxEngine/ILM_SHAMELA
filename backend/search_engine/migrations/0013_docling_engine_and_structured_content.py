from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('search_engine', '0012_reader_data'),
    ]

    operations = [
        migrations.AlterField(
            model_name='document',
            name='ocr_engine',
            field=models.CharField(
                choices=[
                    ('auto', 'Auto (Tika first, OCR fallback)'),
                    ('none', 'No OCR'),
                    ('tesseract', 'Tesseract'),
                    ('chandra', 'Chandra'),
                    ('docling', 'Docling'),
                ],
                default='auto',
                help_text='OCR engine requested at upload (auto = Tika first with fallback)',
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name='documentchunk',
            name='structured_content',
            field=models.JSONField(
                blank=True,
                help_text='Layout-aware payload from the extractor (e.g. {markdown, tables}); null when '
                          'the extractor returned only plain text',
                null=True,
            ),
        ),
    ]
