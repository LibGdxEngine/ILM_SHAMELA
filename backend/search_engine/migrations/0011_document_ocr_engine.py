from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('search_engine', '0010_documentchunk'),
    ]

    operations = [
        migrations.AddField(
            model_name='document',
            name='ocr_engine',
            field=models.CharField(
                choices=[
                    ('auto', 'Auto (Tika first, OCR fallback)'),
                    ('none', 'No OCR'),
                    ('tesseract', 'Tesseract'),
                    ('chandra', 'Chandra'),
                ],
                default='auto',
                help_text='OCR engine requested at upload (auto = Tika first with fallback)',
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name='document',
            name='ocr_engine_used',
            field=models.CharField(
                blank=True,
                default='',
                help_text='OCR engine actually executed during processing (audit trail)',
                max_length=32,
            ),
        ),
    ]
