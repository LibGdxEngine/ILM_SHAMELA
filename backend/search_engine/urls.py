from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    DocumentListCreateView, DocumentDetailView, DocumentSearchView,
    DocumentSearchAssistView,
    DocumentStatusView, DocumentContentPagesView, DocumentInDocumentSearchView,
    DocumentSuggestionsView, AuthorListView, AuthorDetailView, CategoryListView,
    OCREngineListView, DocumentByCountryView, CountryDocumentStatsView,
    DocumentFacetOptionsView,
)
from .views_reader import (
    BookmarkViewSet,
    ContinueReadingView,
    DocumentChapterListView,
    DocumentFilterPreferenceView,
    HighlightViewSet,
    NoteExportView,
    NoteViewSet,
    ReaderPreferenceView,
    ReadingProgressUpsertView,
    SavedFilterPresetViewSet,
    TextCorrectionViewSet,
)
from .views_chat import (
    ChatMessageListCreateView,
    ChatMessageStoreView,
    ChatSessionDetailView,
    ChatSessionListCreateView,
    LibraryChatMessageListCreateView,
    LibraryChatSessionDetailView,
    LibraryChatSessionListCreateView,
)


reader_router = DefaultRouter()
reader_router.register(r'reader/bookmarks', BookmarkViewSet, basename='reader-bookmark')
reader_router.register(r'reader/notes', NoteViewSet, basename='reader-note')
reader_router.register(r'reader/highlights', HighlightViewSet, basename='reader-highlight')
reader_router.register(r'reader/corrections', TextCorrectionViewSet, basename='reader-correction')
reader_router.register(r'reader/document-filter-presets', SavedFilterPresetViewSet, basename='reader-document-filter-preset')


urlpatterns = [
    path('documents/', DocumentListCreateView.as_view(), name='document-list-create'),
    path('documents/<int:pk>/', DocumentDetailView.as_view(), name='document-detail'),
    path('documents/<int:pk>/pages/', DocumentContentPagesView.as_view(), name='document-pages'),
    path('documents/<int:pk>/chapters/', DocumentChapterListView.as_view(), name='document-chapters'),
    path(
        'documents/<int:pk>/chat/sessions/',
        ChatSessionListCreateView.as_view(),
        name='document-chat-sessions',
    ),
    path(
        'documents/<int:pk>/chat/sessions/<int:session_id>/',
        ChatSessionDetailView.as_view(),
        name='document-chat-session-detail',
    ),
    path(
        'documents/<int:pk>/chat/sessions/<int:session_id>/messages/',
        ChatMessageListCreateView.as_view(),
        name='document-chat-messages',
    ),
    path(
        'documents/<int:pk>/chat/sessions/<int:session_id>/messages/store/',
        ChatMessageStoreView.as_view(),
        name='document-chat-messages-store',
    ),
    path(
        'library/chat/sessions/',
        LibraryChatSessionListCreateView.as_view(),
        name='library-chat-sessions',
    ),
    path(
        'library/chat/sessions/<int:session_id>/',
        LibraryChatSessionDetailView.as_view(),
        name='library-chat-session-detail',
    ),
    path(
        'library/chat/sessions/<int:session_id>/messages/',
        LibraryChatMessageListCreateView.as_view(),
        name='library-chat-messages',
    ),
    path('documents/<int:pk>/search/', DocumentInDocumentSearchView.as_view(), name='document-in-search'),
    path('documents/search/', DocumentSearchView.as_view(), name='document-search'),
    path('documents/search/assist/', DocumentSearchAssistView.as_view(), name='document-search-assist'),
    path('documents/country/<str:country>/', DocumentByCountryView.as_view(), name='documents-by-country'),
    path('documents/country-stats/', CountryDocumentStatsView.as_view(), name='country-document-stats'),
    path('documents/facet-options/', DocumentFacetOptionsView.as_view(), name='document-facet-options'),
    path('documents/suggest/', DocumentSuggestionsView.as_view(), name='document-suggest'),
    path('documents/<int:doc_id>/status/', DocumentStatusView.as_view(), name='document-status'),
    path('ocr-engines/', OCREngineListView.as_view(), name='ocr-engine-list'),
    path('authors/', AuthorListView.as_view(), name='author-list'),
    path('authors/<int:pk>/', AuthorDetailView.as_view(), name='author-detail'),
    path('categories/', CategoryListView.as_view(), name='category-list'),
    path('reader/preferences/', ReaderPreferenceView.as_view(), name='reader-preferences'),
    path('reader/document-filters/', DocumentFilterPreferenceView.as_view(), name='reader-document-filters'),
    path(
        'reader/progress/<int:document_id>/',
        ReadingProgressUpsertView.as_view(),
        name='reader-progress-upsert',
    ),
    path('reader/continue/', ContinueReadingView.as_view(), name='reader-continue'),
    path('reader/notes/export/', NoteExportView.as_view(), name='reader-notes-export'),
    path('', include(reader_router.urls)),
]
