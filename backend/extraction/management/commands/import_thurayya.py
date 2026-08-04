"""Import the al-Thurayya gazetteer (https://althurayya.github.io — CC-BY,
built off ياقوت's معجم البلدان; see ``extraction/data/ATTRIBUTION.md``) into
``Place``/``PlaceName``.

Usage:
    python manage.py import_thurayya path/to/places.geojson [--dry-run] [--limit N]

Expects the project's published GeoJSON export (FeatureCollection). Property
names have shifted across releases, so lookups are defensive: the Arabic
toponym, transliteration, type and URI are searched under both the flat
properties and the ``cornuData`` sub-object. Idempotent via
``Place.unique_together(source, source_id)`` — re-runs refresh in place.

Deliberately imports NO nisba variants: mechanical nisba derivation from
toponyms produces false gazetteer hits; curate those by hand in
``places_seed.tsv`` or the admin.
"""
import json

from django.core.management.base import BaseCommand, CommandError

from extraction.extractors.textnorm import normalize
from extraction.models import Place, PlaceName


def _prop(props: dict, *keys):
    """First non-empty value for any key, checking flat props then cornuData."""
    cornu = props.get('cornuData') or {}
    for key in keys:
        for source in (props, cornu):
            value = source.get(key)
            if value not in (None, ''):
                return value
    return None


class Command(BaseCommand):
    help = 'Import the al-Thurayya gazetteer GeoJSON into Place/PlaceName'

    def add_arguments(self, parser):
        parser.add_argument('path', help='Path to the al-Thurayya GeoJSON export')
        parser.add_argument('--dry-run', action='store_true')
        parser.add_argument('--limit', type=int, default=None)

    def handle(self, *args, **options):
        try:
            with open(options['path'], encoding='utf-8') as handle:
                data = json.load(handle)
        except (OSError, ValueError) as exc:
            raise CommandError(f'Cannot read GeoJSON: {exc}')

        features = data.get('features')
        if not isinstance(features, list):
            raise CommandError('Not a GeoJSON FeatureCollection (no features list)')
        if options['limit']:
            features = features[:options['limit']]

        created = updated = surfaces = skipped = 0
        for feature in features:
            props = feature.get('properties') or {}
            arabic = _prop(props, 'toponym_arabic', 'ar', 'name_ar', 'arabic')
            translit = _prop(props, 'toponym_translit', 'translit',
                             'toponym_search', 'name') or ''
            source_id = _prop(props, 'cornu_URI', 'URI', 'uri', 'id') \
                or feature.get('id')
            if not arabic or not source_id:
                skipped += 1
                continue
            arabic = str(arabic).split(',')[0].strip()
            feature_type = str(_prop(props, 'top_type_hom', 'top_type',
                                     'type') or '')[:30]
            lat = lon = None
            geometry = feature.get('geometry') or {}
            coords = geometry.get('coordinates')
            if isinstance(coords, (list, tuple)) and len(coords) >= 2:
                try:
                    lon, lat = float(coords[0]), float(coords[1])
                except (TypeError, ValueError):
                    lat = lon = None

            if options['dry_run']:
                created += 1
                continue

            place, was_created = Place.objects.update_or_create(
                source=Place.Source.THURAYYA,
                source_id=str(source_id)[:64],
                defaults={
                    'name': arabic[:255],
                    'name_translit': str(translit)[:255],
                    'feature_type': feature_type,
                    'lat': lat,
                    'lon': lon,
                },
            )
            created += was_created
            updated += not was_created
            names = {(arabic, PlaceName.Kind.HISTORICAL)}
            for name, kind in names:
                norm = normalize(name)[:255]
                if not norm:
                    continue
                _, name_created = PlaceName.objects.update_or_create(
                    place=place, normalized=norm, kind=kind,
                    defaults={'name': name[:255]})
                surfaces += name_created

        if not options['dry_run']:
            try:
                from extraction.extractors.places import reload_gazetteer
                reload_gazetteer()
            except ImportError:
                pass
        self.stdout.write(self.style.SUCCESS(
            f'al-Thurayya: {created} created, {updated} refreshed, '
            f'{surfaces} new surface(s), {skipped} skipped'
            f'{" (dry run)" if options["dry_run"] else ""}'))
