"""Django signals that keep CountryDocumentCount in sync.

Triggers:
  1. Document.authors M2M changed  → refresh affected countries
  2. Author.nationality updated    → refresh old *and* new country
  3. Author deleted                → refresh its old country
  4. Document deleted               → refresh countries of its former authors
"""
import logging

from django.db.models.signals import m2m_changed, post_save, pre_delete, pre_save
from django.dispatch import receiver

logger = logging.getLogger(__name__)


def _refresh_countries_for_document(document):
    """Refresh every country touched by a document's current authors."""
    from .models import CountryDocumentCount
    nationalities = (
        document.authors
        .exclude(nationality__isnull=True)
        .exclude(nationality='')
        .values_list('nationality', flat=True)
        .distinct()
    )
    for country in nationalities:
        CountryDocumentCount.refresh_country(country)


# ── 1. Document ↔ Author M2M changed ─────────────────────────────
@receiver(m2m_changed, sender='search_engine.Document_authors')
def document_authors_changed(sender, instance, action, pk_set, **kwargs):
    """Fires when authors are added/removed from a document."""
    if action not in ('post_add', 'post_remove', 'post_clear'):
        return

    from .models import Author, CountryDocumentCount

    # Refresh countries of authors that were added/removed.
    if pk_set:
        countries = (
            Author.objects
            .filter(pk__in=pk_set)
            .exclude(nationality__isnull=True)
            .exclude(nationality='')
            .values_list('nationality', flat=True)
            .distinct()
        )
        for country in countries:
            CountryDocumentCount.refresh_country(country)

    # Also refresh all countries still attached to the document.
    _refresh_countries_for_document(instance)


# ── 2. Author.nationality changed ────────────────────────────────
@receiver(pre_save, sender='search_engine.Author')
def capture_old_nationality(sender, instance, **kwargs):
    """Stash the old nationality so post_save can refresh both old & new."""
    if instance.pk:
        try:
            instance._old_nationality = sender.objects.values_list(
                'nationality', flat=True
            ).get(pk=instance.pk)
        except sender.DoesNotExist:
            instance._old_nationality = None
    else:
        instance._old_nationality = None


@receiver(post_save, sender='search_engine.Author')
def author_nationality_changed(sender, instance, **kwargs):
    from .models import CountryDocumentCount

    old = getattr(instance, '_old_nationality', None)
    new = instance.nationality

    countries_to_refresh = set()
    if old:
        countries_to_refresh.add(old)
    if new:
        countries_to_refresh.add(new)

    for country in countries_to_refresh:
        CountryDocumentCount.refresh_country(country)


# ── 3. Author deleted ────────────────────────────────────────────
@receiver(pre_delete, sender='search_engine.Author')
def author_deleted(sender, instance, **kwargs):
    from .models import CountryDocumentCount

    if instance.nationality:
        # Schedule refresh after cascade; use post_delete would be too late
        # for the M2M rows, so we just queue it.
        CountryDocumentCount.refresh_country(instance.nationality)


# ── 4. Document deleted ──────────────────────────────────────────
@receiver(pre_delete, sender='search_engine.Document')
def document_deleted(sender, instance, **kwargs):
    """Refresh country counts for every author on the document being deleted."""
    _refresh_countries_for_document(instance)
