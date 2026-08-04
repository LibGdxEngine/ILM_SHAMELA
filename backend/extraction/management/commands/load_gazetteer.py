"""Idempotent gazetteer loader: TSV → Place/PlaceName upserts keyed on
(source, source_id) — re-runnable in any environment (fixtures would be
PK-brittle; this mirrors the backfill_death_years command convention).

Usage:
    python manage.py load_gazetteer                      # bundled seed TSV
    python manage.py load_gazetteer path/to/thurayya.tsv
"""
from pathlib import Path

from django.core.management.base import BaseCommand

from extraction.extractors.textnorm import normalize
from extraction.models import Place, PlaceName

DEFAULT_SEED = Path(__file__).resolve().parents[2] / 'data' / 'places_seed.tsv'

VALID_KINDS = {k for k, _ in PlaceName.Kind.choices}


class Command(BaseCommand):
    help = 'Load/refresh the places gazetteer from a TSV file'

    def add_arguments(self, parser):
        parser.add_argument('tsv', nargs='?', default=str(DEFAULT_SEED))

    def handle(self, *args, **options):
        path = Path(options['tsv'])
        if not path.exists():
            self.stderr.write(self.style.ERROR(f'File not found: {path}'))
            return

        created = updated = names = skipped = 0
        for line_no, raw in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
            line = raw.strip('\n')
            if not line.strip() or line.lstrip().startswith('#'):
                continue
            cols = line.split('\t')
            if len(cols) < 3:
                self.stderr.write(f'  line {line_no}: too few columns, skipped')
                skipped += 1
                continue
            cols += [''] * (9 - len(cols))
            source, source_id, name, translit, modern, feature, lat, lon, variants = cols[:9]

            defaults = {
                'name': name,
                'name_translit': translit,
                'modern_name': modern,
                'feature_type': feature,
            }
            try:
                if lat.strip():
                    defaults['lat'] = float(lat)
                if lon.strip():
                    defaults['lon'] = float(lon)
            except ValueError:
                pass

            place, was_created = Place.objects.update_or_create(
                source=source, source_id=source_id, defaults=defaults)
            created += was_created
            updated += not was_created

            surface_kinds = [(name, PlaceName.Kind.PRIMARY)]
            for pair in variants.split('|'):
                pair = pair.strip()
                if not pair:
                    continue
                if ':' in pair:
                    surface, kind = pair.rsplit(':', 1)
                else:
                    surface, kind = pair, PlaceName.Kind.VARIANT
                if kind not in VALID_KINDS:
                    kind = PlaceName.Kind.VARIANT
                surface_kinds.append((surface.strip(), kind))

            for surface, kind in surface_kinds:
                if not surface:
                    continue
                _, name_created = PlaceName.objects.update_or_create(
                    place=place, normalized=normalize(surface), kind=kind,
                    defaults={'name': surface})
                names += name_created

        self.stdout.write(self.style.SUCCESS(
            f'Places: {created} created, {updated} updated; '
            f'{names} new surface forms; {skipped} line(s) skipped'))
