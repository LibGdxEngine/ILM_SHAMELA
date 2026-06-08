from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('search_engine', '0015_chatsession_chatmessage_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='document',
            name='word_count',
            field=models.PositiveIntegerField(
                blank=True,
                null=True,
                help_text="Cached count of whitespace-delimited words in `content`; "
                          "computed lazily by the assistant's metadata tool",
            ),
        ),
        migrations.AddField(
            model_name='document',
            name='page_count',
            field=models.PositiveIntegerField(
                blank=True,
                null=True,
                help_text="Cached count of distinct DocumentChunk.page_number; "
                          "computed lazily by the assistant's metadata tool",
            ),
        ),
    ]
