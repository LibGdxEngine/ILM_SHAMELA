"""Fill the external-ID landing slots (Layer-4 linking) — MANUAL, never
run on upload.

Targets, all only-fill-when-empty and corroboration-gated:
- persons → Wikidata QID (name search + death-year corroboration via P570)
  and VIAF via P214 on the matched entity.
- places  → Wikidata QID (name search + coordinate corroboration via P625
  when we hold coordinates).
- works   → Wikidata QID (exact normalized title/alias match, unique hit).
- references → Crossref DOI for ``DocumentStructuredExtraction`` reference
  items that carry a title but no DOI (normalized-title containment check).

Usage:
    python manage.py link_external --target persons [--limit 50] [--dry-run]
    python manage.py link_external --target all

Rate-limited (``--sleep``, default 1.1s between API calls) and resumable —
every write is idempotent and rows with filled slots are skipped.
"""
import time

from django.core.management.base import BaseCommand

from extraction.extractors.textnorm import normalize
from extraction.models import DocumentStructuredExtraction, Person, Place, Work
from search_engine.hijri_dates import gregorian_to_hijri

WIKIDATA_API = 'https://www.wikidata.org/w/api.php'
CROSSREF_API = 'https://api.crossref.org/works'
USER_AGENT = 'ILM-Shamela/1.0 (library entity linking; contact: admin@ilmshamela.com)'
DEATH_YEAR_TOLERANCE = 10
COORD_TOLERANCE_DEG = 1.5


class Command(BaseCommand):
    help = 'Reconcile Person/Place/Work rows against Wikidata/VIAF and references against Crossref'

    def add_arguments(self, parser):
        parser.add_argument('--target', default='all',
                            choices=['persons', 'places', 'works', 'references', 'all'])
        parser.add_argument('--limit', type=int, default=50,
                            help='Max rows per target (default 50)')
        parser.add_argument('--sleep', type=float, default=1.1,
                            help='Seconds between API calls (default 1.1)')
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **options):
        import requests
        self._requests = requests
        self._session = requests.Session()
        self._session.headers['User-Agent'] = USER_AGENT
        self._sleep = options['sleep']
        self._dry = options['dry_run']

        target = options['target']
        limit = options['limit']
        if target in ('persons', 'all'):
            self._link_persons(limit)
        if target in ('places', 'all'):
            self._link_places(limit)
        if target in ('works', 'all'):
            self._link_works(limit)
        if target in ('references', 'all'):
            self._link_references(limit)

    # -- shared ---------------------------------------------------------------

    def _api(self, url, params):
        time.sleep(self._sleep)
        response = self._session.get(url, params=params, timeout=30)
        response.raise_for_status()
        return response.json()

    def _wd_search(self, text, language='ar'):
        data = self._api(WIKIDATA_API, {
            'action': 'wbsearchentities', 'search': text, 'language': language,
            'uselang': language, 'type': 'item', 'limit': 5, 'format': 'json',
        })
        return data.get('search') or []

    def _wd_claims(self, qid):
        data = self._api(WIKIDATA_API, {
            'action': 'wbgetentities', 'ids': qid, 'props': 'claims',
            'format': 'json',
        })
        entity = (data.get('entities') or {}).get(qid) or {}
        return entity.get('claims') or {}

    @staticmethod
    def _claim_values(claims, prop):
        values = []
        for claim in claims.get(prop, []):
            snak = (claim.get('mainsnak') or {}).get('datavalue') or {}
            values.append(snak.get('value'))
        return values

    # -- persons --------------------------------------------------------------

    def _link_persons(self, limit):
        rows = Person.objects.filter(wikidata_id='').exclude(
            review_status='rejected').order_by('-mention_doc_count')[:limit]
        linked = skipped = 0
        for person in rows:
            try:
                match = self._match_person(person)
            except Exception as exc:  # noqa: BLE001 — keep the batch going
                self.stderr.write(f'  person {person.id} error: {exc}')
                continue
            if match is None:
                skipped += 1
                continue
            qid, viaf = match
            self.stdout.write(f'  {person.display_name} → {qid}'
                              f'{f" / VIAF {viaf}" if viaf else ""}')
            if not self._dry:
                person.wikidata_id = qid
                if viaf and not person.viaf_id:
                    person.viaf_id = str(viaf)[:32]
                person.save(update_fields=['wikidata_id', 'viaf_id', 'updated_at'])
            linked += 1
        self.stdout.write(self.style.SUCCESS(
            f'persons: {linked} linked, {skipped} uncorroborated'
            f'{" (dry run)" if self._dry else ""}'))

    def _match_person(self, person):
        """QID only when the death year corroborates — name similarity alone
        is worthless for Arabic namesakes."""
        if person.death_year_hijri is None:
            return None  # nothing to corroborate against
        for hit in self._wd_search(person.display_name):
            claims = self._wd_claims(hit['id'])
            for value in self._claim_values(claims, 'P570'):  # date of death
                iso = (value or {}).get('time', '') if isinstance(value, dict) else ''
                try:
                    gregorian_year = int(iso.lstrip('+-')[:4])
                except (ValueError, AttributeError):
                    continue
                hijri = gregorian_to_hijri(gregorian_year)
                if abs(hijri - person.death_year_hijri) <= DEATH_YEAR_TOLERANCE:
                    viaf_values = self._claim_values(claims, 'P214')
                    viaf = viaf_values[0] if viaf_values else ''
                    return hit['id'], viaf
        return None

    # -- places ---------------------------------------------------------------

    def _link_places(self, limit):
        rows = Place.objects.filter(wikidata_id='').order_by(
            '-mention_doc_count')[:limit]
        linked = skipped = 0
        for place in rows:
            try:
                qid = self._match_place(place)
            except Exception as exc:  # noqa: BLE001
                self.stderr.write(f'  place {place.id} error: {exc}')
                continue
            if qid is None:
                skipped += 1
                continue
            self.stdout.write(f'  {place.name} → {qid}')
            if not self._dry:
                Place.objects.filter(id=place.id).update(wikidata_id=qid)
            linked += 1
        self.stdout.write(self.style.SUCCESS(
            f'places: {linked} linked, {skipped} uncorroborated'
            f'{" (dry run)" if self._dry else ""}'))

    def _match_place(self, place):
        """Coordinate corroboration when we hold coords; otherwise require a
        unique exact-label hit."""
        hits = self._wd_search(place.name)
        if not hits:
            return None
        if place.lat is None or place.lon is None:
            exact = [h for h in hits
                     if normalize(h.get('label', '')) == normalize(place.name)]
            return exact[0]['id'] if len(exact) == 1 else None
        for hit in hits:
            claims = self._wd_claims(hit['id'])
            for value in self._claim_values(claims, 'P625'):  # coordinates
                if not isinstance(value, dict):
                    continue
                try:
                    dlat = abs(float(value['latitude']) - float(place.lat))
                    dlon = abs(float(value['longitude']) - float(place.lon))
                except (KeyError, TypeError, ValueError):
                    continue
                if dlat <= COORD_TOLERANCE_DEG and dlon <= COORD_TOLERANCE_DEG:
                    return hit['id']
        return None

    # -- works ----------------------------------------------------------------

    def _link_works(self, limit):
        rows = Work.objects.filter(wikidata_id='').exclude(
            review_status='rejected').order_by('-mention_doc_count')[:limit]
        linked = skipped = 0
        for work in rows:
            try:
                hits = self._wd_search(work.display_title)
            except Exception as exc:  # noqa: BLE001
                self.stderr.write(f'  work {work.id} error: {exc}')
                continue
            exact = [h for h in hits
                     if normalize(h.get('label', '')) == work.normalized_title]
            if len(exact) != 1:
                skipped += 1
                continue
            qid = exact[0]['id']
            self.stdout.write(f'  {work.display_title} → {qid}')
            if not self._dry:
                Work.objects.filter(id=work.id).update(wikidata_id=qid)
            linked += 1
        self.stdout.write(self.style.SUCCESS(
            f'works: {linked} linked, {skipped} uncorroborated'
            f'{" (dry run)" if self._dry else ""}'))

    # -- references (Crossref DOI) ---------------------------------------------

    def _link_references(self, limit):
        rows = DocumentStructuredExtraction.objects.filter(
            kind=DocumentStructuredExtraction.Kind.REFERENCES,
            superseded_at__isnull=True)[:limit]
        filled = skipped = 0
        for row in rows:
            items = (row.payload or {}).get('items') or []
            changed = False
            for item in items:
                fields = item.get('fields') or {}
                title = fields.get('title')
                if not title or fields.get('doi'):
                    continue
                try:
                    doi = self._crossref_doi(str(title))
                except Exception as exc:  # noqa: BLE001
                    self.stderr.write(f'  structure {row.id} error: {exc}')
                    continue
                if doi is None:
                    skipped += 1
                    continue
                fields['doi'] = doi
                item['fields'] = fields
                changed = True
                filled += 1
            if changed and not self._dry:
                row.payload = {**row.payload, 'items': items}
                row.save(update_fields=['payload'])
        self.stdout.write(self.style.SUCCESS(
            f'references: {filled} DOI(s) filled, {skipped} unmatched'
            f'{" (dry run)" if self._dry else ""}'))

    def _crossref_doi(self, title):
        data = self._api(CROSSREF_API, {
            'query.bibliographic': title[:300], 'rows': 1})
        items = ((data.get('message') or {}).get('items')) or []
        if not items:
            return None
        hit = items[0]
        hit_title = ' '.join(hit.get('title') or [])
        ours, theirs = normalize(title), normalize(hit_title)
        if not ours or not theirs:
            return None
        if ours in theirs or theirs in ours:
            return hit.get('DOI')
        return None
