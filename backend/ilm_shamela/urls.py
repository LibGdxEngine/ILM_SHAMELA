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
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import path, include
from core.views import GoogleLogin, UserProfileView
from core.views_health import LivenessView, ReadinessView, MetricsView

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/search_engine/', include('search_engine.urls')),
    # Include registration URLs before main dj-rest-auth URLs to avoid conflicts
    path('api/auth/registration/', include('dj_rest_auth.registration.urls')),
    path('api/auth/google/', GoogleLogin.as_view(), name='google_login'),
    path('api/auth/user/', UserProfileView.as_view(), name='user_profile'),
    path('api/auth/', include('dj_rest_auth.urls')),
    path('api/health/live/', LivenessView.as_view(), name='health-live'),
    path('api/health/ready/', ReadinessView.as_view(), name='health-ready'),
    path('api/metrics/', MetricsView.as_view(), name='metrics'),
]

# Serve media files - needed because files are stored on local filesystem
# In production with S3/MinIO, this would not be needed as files would be served from S3
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
else:
    # Also serve media in non-debug mode since we're behind Caddy
    # and files are on the local filesystem (not S3)
    from django.views.static import serve
    from django.urls import re_path
    urlpatterns += [
        re_path(r'^media/(?P<path>.*)$', serve, {'document_root': settings.MEDIA_ROOT}),
    ]
