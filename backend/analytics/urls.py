from django.urls import path

from .views import EventIngestView, RecommendationsView

app_name = 'analytics'

urlpatterns = [
    path('events/', EventIngestView.as_view(), name='event-ingest'),
    path('recommendations/', RecommendationsView.as_view(), name='recommendations'),
]
