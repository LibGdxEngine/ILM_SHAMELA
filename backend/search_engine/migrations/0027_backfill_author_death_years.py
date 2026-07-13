# Data migration: derive Author.death_year_hijri / death_century from the
# free-text date_of_death for all existing rows (new rows derive in save()).
#
# Importing from search_engine.hijri_dates inside a migration is safe because
# the module is pure (no models/apps access), and it guarantees the backfill
# and Author.save() can never drift apart. Repo precedent for RunPython
# backfills: 0005 / 0009.

from django.db import migrations


def backfill(apps, schema_editor):
    from search_engine.hijri_dates import derive_death_fields

    Author = apps.get_model('search_engine', 'Author')
    batch = []
    for author in Author.objects.all().iterator(chunk_size=500):
        year, century = derive_death_fields(author.date_of_death)
        if author.death_year_hijri != year or author.death_century != century:
            author.death_year_hijri = year
            author.death_century = century
            batch.append(author)
        if len(batch) >= 500:
            Author.objects.bulk_update(batch, ['death_year_hijri', 'death_century'])
            batch = []
    if batch:
        Author.objects.bulk_update(batch, ['death_year_hijri', 'death_century'])


def clear(apps, schema_editor):
    Author = apps.get_model('search_engine', 'Author')
    Author.objects.update(death_year_hijri=None, death_century=None)


class Migration(migrations.Migration):

    dependencies = [
        ('search_engine', '0026_author_death_year_fields'),
    ]

    operations = [
        migrations.RunPython(backfill, clear),
    ]
