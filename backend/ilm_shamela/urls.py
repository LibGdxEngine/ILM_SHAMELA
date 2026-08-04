"""
URL configuration for ilm_shamela project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path, include, re_path
from core.views import GoogleLogin, UserProfileView
from core.views_health import LivenessView, ReadinessView, MetricsView
from core.views_media import protected_media

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/search_engine/', include('search_engine.urls')),
    path('api/analytics/', include('analytics.urls')),
    path('api/extraction/', include('extraction.urls')),
    # Include registration URLs before main dj-rest-auth URLs to avoid conflicts
    path('api/auth/registration/', include('dj_rest_auth.registration.urls')),
    path('api/auth/google/', GoogleLogin.as_view(), name='google_login'),
    path('api/auth/user/', UserProfileView.as_view(), name='user_profile'),
    path('api/auth/', include('dj_rest_auth.urls')),
    path('api/health/live/', LivenessView.as_view(), name='health-live'),
    path('api/health/ready/', ReadinessView.as_view(), name='health-ready'),
    path('api/metrics/', MetricsView.as_view(), name='metrics'),
]

# Media lives on the local filesystem and is served by Django (behind Caddy
# in prod). Book content under media/documents/ requires authentication;
# covers/thumbnails/author photos stay public. Same route in DEBUG and prod
# so dev behaves like production.
urlpatterns += [
    re_path(r'^media/(?P<path>.*)$', protected_media),
]
