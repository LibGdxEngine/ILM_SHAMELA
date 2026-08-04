from django.apps import AppConfig


class ExtractionConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'extraction'
    verbose_name = 'Entity Extraction'

    def ready(self):
        # Register this app's ES rollup fields as POST-body facets
        # (filters.facets.<key>) with the search executor's registry — the
        # composition point that keeps search_engine free of extraction
        # imports.
        try:
            from search_engine.query_builder import FacetDef, register_facet
        except ImportError:  # pragma: no cover
            return
        register_facet('genre', FacetDef(es_field='genre'))
        register_facet('madhhab', FacetDef(es_field='madhhab'))
        register_facet('era_century', FacetDef(es_field='era_century'))
        register_facet('physical_class', FacetDef(es_field='physical_class'))
        register_facet('person_keys', FacetDef(es_field='person_keys'))
        register_facet('place_keys', FacetDef(es_field='place_keys'))
        register_facet('quran_ayas', FacetDef(es_field='quran_ayas'))
        register_facet('hadith_collections', FacetDef(es_field='hadith_collections'))
        register_facet('organization_keys', FacetDef(es_field='organization_keys'))
        register_facet('work_keys', FacetDef(es_field='work_keys'))
        register_facet('relation_predicates', FacetDef(es_field='relation_predicates'))
