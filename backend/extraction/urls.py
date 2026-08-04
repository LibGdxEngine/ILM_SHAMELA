from django.urls import path

from .views import (DocumentRelationsView, DocumentStructureView,
                    PageMentionsView, PersonTypeaheadView, PlaceTypeaheadView,
                    WorkTypeaheadView)

urlpatterns = [
    path('persons/', PersonTypeaheadView.as_view(), name='extraction-persons'),
    path('places/', PlaceTypeaheadView.as_view(), name='extraction-places'),
    path('works/', WorkTypeaheadView.as_view(), name='extraction-works'),
    path(
        'documents/<int:doc_id>/pages/<int:page>/mentions/',
        PageMentionsView.as_view(),
        name='extraction-page-mentions',
    ),
    path(
        'documents/<int:doc_id>/structure/',
        DocumentStructureView.as_view(),
        name='extraction-document-structure',
    ),
    path(
        'documents/<int:doc_id>/relations/',
        DocumentRelationsView.as_view(),
        name='extraction-document-relations',
    ),
]
