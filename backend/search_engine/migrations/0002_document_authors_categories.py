# Generated migration for adding authors and categories to Document model

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('search_engine', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='document',
            name='authors',
            field=models.JSONField(blank=True, default=list, help_text='List of authors'),
        ),
        migrations.AddField(
            model_name='document',
            name='categories',
            field=models.JSONField(blank=True, default=list, help_text='List of categories/tags'),
        ),
    ]
