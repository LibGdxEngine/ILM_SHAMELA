from django.urls import path
from .views import (
    DocumentListCreateView, DocumentDetailView, DocumentSearchView, 
    DocumentStatusView, DocumentContentPagesView, DocumentInDocumentSearchView,
    AuthorListView, AuthorDetailView
)

urlpatterns = [
    path('documents/', DocumentListCreateView.as_view(), name='document-list-create'),
    path('documents/<int:pk>/', DocumentDetailView.as_view(), name='document-detail'),
    path('documents/<int:pk>/pages/', DocumentContentPagesView.as_view(), name='document-pages'),
    path('documents/<int:pk>/search/', DocumentInDocumentSearchView.as_view(), name='document-in-search'),
    path('documents/search/', DocumentSearchView.as_view(), name='document-search'),
    path('documents/<int:doc_id>/status/', DocumentStatusView.as_view(), name='document-status'),
    path('authors/', AuthorListView.as_view(), name='author-list'),
    path('authors/<int:pk>/', AuthorDetailView.as_view(), name='author-detail'),
]