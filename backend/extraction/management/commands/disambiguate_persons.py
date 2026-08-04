"""Batch person disambiguation (Layer-4, resolver v2).

Targets active, unlinked person mentions whose blocking key matches MULTIPLE
canonical ``Person`` rows (the resolver leaves those NIL at extraction time).
Two evidence tiers, applied in order:

1. Death-year proximity — the mention's ``normalized.death_year_hijri``
   within ±5y of exactly one candidate.
2. Teacher/student overlap — the candidate who shares the most graph
   neighbors (``taught``/``transmitted_to`` edges, corpus-wide) with the
   persons co-occurring in this mention's own relations. Requires a strict
   winner with at least one shared neighbor.

Mentions that neither tier separates stay NIL (conservative-linking policy).
Embedding-assisted scoring is a later increment — this command is the
blocking+evidence stage it would sit on top of.

Usage:
    python manage.py disambiguate_persons [--dry-run] [--limit N]
"""
from collections import defaultdict

from django.core.management.base import BaseCommand
from django.db.models import Q

from extraction.models import EntityMention, EntityRelation, Person


class Command(BaseCommand):
    help = 'Resolve ambiguous person mentions via death year + isnad-graph overlap'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true')
        parser.add_argument('--limit', type=int, default=None)

    def handle(self, *args, **options):
        mentions = EntityMention.objects.filter(
            entity_type=EntityMention.EntityType.PERSON,
            person__isnull=True,
            superseded_at__isnull=True,
        ).exclude(review_status=EntityMention.ReviewStatus.REJECTED) \
         .exclude(normalized_text='')
        if options['limit']:
            mentions = mentions[:options['limit']]

        candidates_by_key = defaultdict(list)
        for person_id, key, death_year in Person.objects.exclude(
                review_status='rejected').values_list(
                'id', 'blocking_key', 'death_year_hijri'):
            candidates_by_key[key].append((person_id, death_year))

        resolved_death = resolved_graph = unresolved = 0
        for mention in mentions.iterator():
            candidates = candidates_by_key.get(mention.normalized_text, [])
            if len(candidates) < 2:
                continue  # 0/1-candidate cases are the task resolver's job

            winner = None
            death_year = (mention.normalized or {}).get('death_year_hijri')
            if isinstance(death_year, int):
                close = [pid for pid, dy in candidates
                         if dy is not None and abs(dy - death_year) <= 5]
                if len(close) == 1:
                    winner = close[0]
                    resolved_death += 1

            if winner is None:
                winner = self._graph_winner(mention, [c[0] for c in candidates])
                if winner is not None:
                    resolved_graph += 1

            if winner is None:
                unresolved += 1
                continue
            if not options['dry_run']:
                EntityMention.objects.filter(id=mention.id).update(person_id=winner)

        self.stdout.write(self.style.SUCCESS(
            f'Resolved {resolved_death} by death year, {resolved_graph} by '
            f'graph overlap; {unresolved} stay NIL'
            f'{" (dry run)" if options["dry_run"] else ""}'))

    def _graph_winner(self, mention, candidate_ids):
        """Candidate sharing the most corpus-wide teacher/student neighbors
        with this mention's own relation neighbors; strict winner only."""
        edge_types = (EntityRelation.Predicate.TAUGHT,
                      EntityRelation.Predicate.TRANSMITTED_TO)
        neighbors = set()
        for relation in EntityRelation.objects.filter(
                Q(subject_mention_id=mention.id) | Q(object_mention_id=mention.id),
                predicate__in=edge_types, superseded_at__isnull=True):
            for pid in (relation.subject_person_id, relation.object_person_id):
                if pid is not None:
                    neighbors.add(pid)
        if not neighbors:
            return None

        scores = {}
        for candidate in candidate_ids:
            scores[candidate] = EntityRelation.objects.filter(
                Q(subject_person_id=candidate, object_person_id__in=neighbors)
                | Q(object_person_id=candidate, subject_person_id__in=neighbors),
                predicate__in=edge_types, superseded_at__isnull=True,
            ).count()
        ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
        if ranked[0][1] >= 1 and (len(ranked) == 1 or ranked[0][1] > ranked[1][1]):
            return ranked[0][0]
        return None
