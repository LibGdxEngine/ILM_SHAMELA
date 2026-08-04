"""Admin-first review queue for extraction output (mirrors the rights-audit
bulk-action pattern on DocumentAdmin). A dedicated editor-facing UI can later
drive the same ``review_status`` fields."""
from django.contrib import admin

from .models import (DocumentMeta, DocumentStructuredExtraction, EntityMention,
                     EntityRelation, ExtractionRun, Person, Place, PlaceName,
                     Work, WorkName)


class ConfidenceBandFilter(admin.SimpleListFilter):
    title = 'confidence band'
    parameter_name = 'confidence_band'

    def lookups(self, request, model_admin):
        return [('low', '< 0.6'), ('mid', '0.6 – 0.85'), ('high', '> 0.85')]

    def queryset(self, request, queryset):
        if self.value() == 'low':
            return queryset.filter(confidence__lt=0.6)
        if self.value() == 'mid':
            return queryset.filter(confidence__gte=0.6, confidence__lte=0.85)
        if self.value() == 'high':
            return queryset.filter(confidence__gt=0.85)
        return queryset


@admin.register(EntityMention)
class EntityMentionAdmin(admin.ModelAdmin):
    list_display = [
        'id', 'document', 'page_number', 'entity_type', 'surface_short',
        'normalized_text', 'confidence', 'review_status', 'extractor_name',
        'extractor_version', 'human_verified',
    ]
    list_filter = [
        'entity_type', 'review_status', 'extractor_name', 'human_verified',
        ConfidenceBandFilter,
    ]
    search_fields = ['surface_text', 'normalized_text', 'document__title']
    autocomplete_fields = ['person', 'place', 'document']
    readonly_fields = ['created_at', 'superseded_at', 'content_hash']
    actions = ['approve_selected', 'reject_selected', 'send_back_to_pending']
    list_per_page = 50

    @admin.display(description='surface')
    def surface_short(self, obj):
        return (obj.surface_text or '')[:60]

    @admin.action(description='Approve selected mentions')
    def approve_selected(self, request, queryset):
        queryset.update(
            review_status=EntityMention.ReviewStatus.APPROVED,
            human_verified=True,
            verified_by=request.user,
        )

    @admin.action(description='Reject selected mentions')
    def reject_selected(self, request, queryset):
        queryset.update(
            review_status=EntityMention.ReviewStatus.REJECTED,
            human_verified=True,
            verified_by=request.user,
        )

    @admin.action(description='Send back to pending')
    def send_back_to_pending(self, request, queryset):
        queryset.update(
            review_status=EntityMention.ReviewStatus.PENDING,
            human_verified=False,
            verified_by=None,
        )


@admin.register(DocumentMeta)
class DocumentMetaAdmin(admin.ModelAdmin):
    list_display = [
        'document', 'genre', 'madhhab', 'era_century', 'register',
        'physical_class', 'status', 'degraded_short', 'human_verified',
        'updated_at',
    ]
    list_filter = ['genre', 'madhhab', 'physical_class', 'status', 'human_verified']
    search_fields = ['document__title', 'degraded_reason']
    autocomplete_fields = ['document']
    readonly_fields = ['created_at', 'updated_at', 'attempts', 'model_id']
    actions = ['mark_verified']

    @admin.display(description='degraded')
    def degraded_short(self, obj):
        return (obj.degraded_reason or '')[:60]

    @admin.action(description='Mark classification human-verified')
    def mark_verified(self, request, queryset):
        queryset.update(human_verified=True, verified_by=request.user)


@admin.register(Person)
class PersonAdmin(admin.ModelAdmin):
    list_display = [
        'display_name', 'shuhra', 'kunya', 'nisba', 'death_year_hijri',
        'death_century', 'source', 'review_status', 'mention_doc_count',
    ]
    list_filter = ['source', 'review_status', 'honorific_class']
    search_fields = ['display_name', 'shuhra', 'kunya', 'blocking_key', 'aliases']
    autocomplete_fields = ['author']
    actions = ['merge_into_first']

    @admin.action(description='Merge selected into the FIRST selected person')
    def merge_into_first(self, request, queryset):
        rows = list(queryset.order_by('id'))
        if len(rows) < 2:
            self.message_user(request, 'Select at least two persons to merge.')
            return
        target, losers = rows[0], rows[1:]
        aliases = set(target.aliases or [])
        for loser in losers:
            loser.mentions.update(person=target)
            aliases.add(loser.display_name)
            aliases.update(loser.aliases or [])
            if loser.author_id and not target.author_id:
                target.author_id = loser.author_id
            loser.delete()
        target.aliases = sorted(a for a in aliases if a and a != target.display_name)
        target.save()
        self.message_user(
            request, f'Merged {len(losers)} record(s) into "{target.display_name}".')


class PlaceNameInline(admin.TabularInline):
    model = PlaceName
    extra = 0


@admin.register(Place)
class PlaceAdmin(admin.ModelAdmin):
    list_display = [
        'name', 'modern_name', 'feature_type', 'source', 'source_id',
        'mention_doc_count',
    ]
    list_filter = ['source', 'feature_type']
    search_fields = ['name', 'modern_name', 'names__normalized']
    inlines = [PlaceNameInline]
    actions = ['merge_into_first']

    @admin.action(description='Merge selected into the FIRST selected place')
    def merge_into_first(self, request, queryset):
        rows = list(queryset.order_by('id'))
        if len(rows) < 2:
            self.message_user(request, 'Select at least two places to merge.')
            return
        target, losers = rows[0], rows[1:]
        for loser in losers:
            loser.mentions.update(place=target)
            for name in loser.names.all():
                PlaceName.objects.get_or_create(
                    place=target, normalized=name.normalized, kind=name.kind,
                    defaults={'name': name.name},
                )
            loser.delete()
        self.message_user(request, f'Merged {len(losers)} record(s) into "{target.name}".')


class _ReviewActionsMixin:
    """Shared approve/reject/pending actions for the standoff review models."""

    actions = ['approve_selected', 'reject_selected', 'send_back_to_pending']

    @admin.action(description='Approve selected')
    def approve_selected(self, request, queryset):
        queryset.update(
            review_status=EntityMention.ReviewStatus.APPROVED,
            human_verified=True,
            verified_by=request.user,
        )

    @admin.action(description='Reject selected')
    def reject_selected(self, request, queryset):
        queryset.update(
            review_status=EntityMention.ReviewStatus.REJECTED,
            human_verified=True,
            verified_by=request.user,
        )

    @admin.action(description='Send back to pending')
    def send_back_to_pending(self, request, queryset):
        queryset.update(
            review_status=EntityMention.ReviewStatus.PENDING,
            human_verified=False,
            verified_by=None,
        )


@admin.register(EntityRelation)
class EntityRelationAdmin(_ReviewActionsMixin, admin.ModelAdmin):
    list_display = [
        'id', 'document', 'predicate', 'subject_short', 'object_short',
        'page_number', 'confidence', 'review_status', 'human_verified',
    ]
    list_filter = ['predicate', 'review_status', 'extractor_name',
                   'human_verified', ConfidenceBandFilter]
    search_fields = ['subject_text', 'object_text', 'evidence_text',
                     'document__title']
    autocomplete_fields = ['document', 'subject_mention', 'object_mention',
                           'subject_person', 'object_person', 'object_place',
                           'object_work']
    readonly_fields = ['created_at', 'superseded_at', 'content_hash', 'dedupe_key']
    list_per_page = 50

    @admin.display(description='subject')
    def subject_short(self, obj):
        if obj.subject_mention_id and obj.subject_mention:
            return (obj.subject_mention.surface_text or '')[:40]
        return (obj.subject_text or '')[:40]

    @admin.display(description='object')
    def object_short(self, obj):
        if obj.object_mention_id and obj.object_mention:
            return (obj.object_mention.surface_text or '')[:40]
        return (obj.object_text or '')[:40]


@admin.register(DocumentStructuredExtraction)
class DocumentStructuredExtractionAdmin(_ReviewActionsMixin, admin.ModelAdmin):
    list_display = [
        'id', 'document', 'kind', 'confidence', 'review_status',
        'extractor_version', 'model_id', 'human_verified', 'created_at',
    ]
    list_filter = ['kind', 'review_status', 'human_verified']
    search_fields = ['document__title']
    autocomplete_fields = ['document']
    readonly_fields = ['created_at', 'superseded_at', 'model_id']


class WorkNameInline(admin.TabularInline):
    model = WorkName
    extra = 0


@admin.register(Work)
class WorkAdmin(admin.ModelAdmin):
    list_display = [
        'display_title', 'author', 'document', 'source', 'review_status',
        'wikidata_id', 'openiti_id', 'shamela_id', 'mention_doc_count',
    ]
    list_filter = ['source', 'review_status']
    search_fields = ['display_title', 'normalized_title', 'names__normalized']
    autocomplete_fields = ['author', 'document']
    inlines = [WorkNameInline]
    actions = ['merge_into_first']

    @admin.action(description='Merge selected into the FIRST selected work')
    def merge_into_first(self, request, queryset):
        rows = list(queryset.order_by('id'))
        if len(rows) < 2:
            self.message_user(request, 'Select at least two works to merge.')
            return
        target, losers = rows[0], rows[1:]
        for loser in losers:
            loser.mentions.update(work=target)
            for name in loser.names.all():
                WorkName.objects.get_or_create(
                    work=target, normalized=name.normalized, kind=name.kind,
                    defaults={'name': name.name},
                )
            WorkName.objects.get_or_create(
                work=target, normalized=loser.normalized_title,
                kind=WorkName.Kind.VARIANT,
                defaults={'name': loser.display_title},
            )
            if loser.author_id and not target.author_id:
                target.author_id = loser.author_id
            if loser.document_id and not target.document_id:
                target.document_id = loser.document_id
            loser.delete()
        target.save()
        self.message_user(
            request, f'Merged {len(losers)} record(s) into "{target.display_title}".')


@admin.register(ExtractionRun)
class ExtractionRunAdmin(admin.ModelAdmin):
    list_display = [
        'document', 'extractor_name', 'extractor_version', 'status',
        'mention_count', 'started_at', 'finished_at',
    ]
    list_filter = ['extractor_name', 'status']
    search_fields = ['document__title', 'error']
    readonly_fields = [f.name for f in ExtractionRun._meta.fields]

    def has_add_permission(self, request):
        return False
