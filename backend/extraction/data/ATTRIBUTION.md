# Gazetteer data sources

## places_seed.tsv (committed)
Hand-curated bootstrap gazetteer of major classical-Islamic toponyms
(~150 places with common orthographic variants and nisba forms), compiled for
this project. Rows carry `source=manual`. Coordinates, where present, are
approximate city centroids for map display only.

## Intended full sources (import, do not commit raw dumps)
- **al-Thurayya Gazetteer** (https://althurayya.github.io/) — ~2,000 classical
  toponyms built off Yāqūt's معجم البلدان and Cornu's Atlas. License: CC-BY.
  Export to TSV with `source=thurayya` and the al-Thurayya URI tail as
  `source_id`, then load with `manage.py load_gazetteer <file>`.
- **GeoNames** (https://www.geonames.org/) — modern toponyms + Arabic
  altnames. License: CC-BY 4.0. Pre-filter offline to MENA/Islamic-world
  P/A feature classes with Arabic alternate names; keep the committed slice
  under ~2 MB; rows carry `source=geonames` and the geonames id as
  `source_id`.

When either source is imported, add the attribution line to the frontend
about page as required by CC-BY.

## TSV format (tab-separated, `#` comments ignored)
source, source_id, name, name_translit, modern_name, feature_type, lat, lon,
variants — where `variants` is `|`-separated `surface:kind` pairs,
kind ∈ {primary, variant, historical, nisba}. The primary `name` is always
loaded as a `primary` PlaceName.

## nisba_stoplist.txt
Nisbas that are NOT geographic (tribal, madhhab, occupational, famous-work
attributions) — the places extractor suppresses them entirely.
