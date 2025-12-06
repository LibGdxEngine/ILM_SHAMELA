from django.urls import path
from .views import DocumentListCreateView, DocumentDetailView, DocumentSearchView, DocumentStatusView

urlpatterns = [
    path('documents/', DocumentListCreateView.as_view(), name='document-list-create'),
    path('documents/<int:pk>/', DocumentDetailView.as_view(), name='document-detail'),
    path('documents/search/', DocumentSearchView.as_view(), name='document-search'),
    path('documents/<int:doc_id>/status/', DocumentStatusView.as_view(), name='document-status'),
]