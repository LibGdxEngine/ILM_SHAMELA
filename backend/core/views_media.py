"""Auth-gated serving of user-visible media files.

Book content under ``media/documents/`` (original uploads, OCR artifacts,
rendered page images) must not be fetchable anonymously — a single URL would
otherwise leak an entire book and bypass the reader's quotas. Covers,
thumbnails and author photos stay public so listing/landing pages keep
working for logged-out visitors.
"""
import posixpath

from django.conf import settings
from django.http import HttpResponse
from django.views.static import serve
from dj_rest_auth.jwt_auth import JWTCookieAuthentication
from rest_framework.request import Request

PUBLIC_PREFIXES = (
    'documents/covers/',
    'documents/thumbnails/',
    'authors/photos/',
)
PROTECTED_PREFIX = 'documents/'


def _jwt_cookie_user(request):
    # DRF authentication classes don't run on plain Django views, so the
    # 'jwt-auth' cookie has to be checked explicitly. GET is a safe method,
    # so dj-rest-auth's CSRF enforcement is not a factor here.
    try:
        result = JWTCookieAuthentication().authenticate(Request(request))
    except Exception:
        return None
    return result[0] if result else None


def protected_media(request, path):
    # Normalize exactly like django.views.static.serve does, so the prefix
    # check can't be dodged with segments like 'documents/covers/../pages/'.
    normalized = posixpath.normpath(path).lstrip('/')
    needs_auth = normalized.startswith(PROTECTED_PREFIX) and not normalized.startswith(
        PUBLIC_PREFIXES
    )
    if needs_auth:
        user = request.user if request.user.is_authenticated else _jwt_cookie_user(request)
        if user is None:
            return HttpResponse(status=401)
    return serve(request, normalized, document_root=settings.MEDIA_ROOT)
