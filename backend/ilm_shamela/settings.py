"""
Django settings for ilm_shamela project.
"""

import os
import sys
from pathlib import Path
from datetime import timedelta
from django.core.exceptions import ImproperlyConfigured

from .env_secrets import load_secrets

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent


def env_bool(name, default=False):
    value = os.environ.get(name)
    if value is None:
        return default
    return str(value).strip().lower() in {'1', 'true', 'yes', 'on'}


def env_list(name, default=None):
    value = os.environ.get(name)
    if value is None:
        return default or []
    return [item.strip() for item in value.split(',') if item.strip()]


# Expand any <VAR>_FILE (Docker secrets, mounted at /run/secrets/<name>) into
# the process environment before a single secret is read below. Every module
# that reads these keys via os.environ.get sees the resolved values, and plain
# environment variables keep working when no _FILE is set.
load_secrets()

# Quick-start development settings - unsuitable for production
# See https://docs.djangoproject.com/en/5.0/howto/deployment/checklist/

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = os.environ.get('SECRET_KEY')
if not SECRET_KEY:
    raise ImproperlyConfigured(
        'SECRET_KEY is required. Set SECRET_KEY_FILE to a Docker secret '
        '(the compose stack mounts one at /run/secrets/django_secret_key) '
        'or set SECRET_KEY directly.'
    )

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = env_bool('DEBUG', False)

ALLOWED_HOSTS = env_list('ALLOWED_HOSTS', ['localhost', '127.0.0.1', 'backend'])

# Security settings for HTTPS reverse proxy
# Trust the X-Forwarded-Proto header from the reverse proxy (Caddy)
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

# CSRF settings - required for Django 4.0+
# Allow configuration via environment variable, with sensible defaults
csrf_origins = os.environ.get(
    'CSRF_TRUSTED_ORIGINS', 'https://127.0.0.1,https://localhost,http://127.0.0.1,http://localhost,http://localhost:3000,http://127.0.0.1:3000')
CSRF_TRUSTED_ORIGINS = [origin.strip()
                        for origin in csrf_origins.split(',') if origin.strip()]

SECURE_SSL_REDIRECT = env_bool('SECURE_SSL_REDIRECT', not DEBUG)

# Cookie security settings (when behind HTTPS proxy)
SESSION_COOKIE_SECURE = env_bool('SESSION_COOKIE_SECURE', not DEBUG)
CSRF_COOKIE_SECURE = env_bool('CSRF_COOKIE_SECURE', not DEBUG)
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_HTTPONLY = False  # CSRF cookie needs to be accessible to JavaScript
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = 'strict-origin-when-cross-origin'
X_FRAME_OPTIONS = 'DENY'
SECURE_HSTS_SECONDS = int(os.environ.get('SECURE_HSTS_SECONDS', '0' if DEBUG else '31536000'))
SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool('SECURE_HSTS_INCLUDE_SUBDOMAINS', not DEBUG)
SECURE_HSTS_PRELOAD = env_bool('SECURE_HSTS_PRELOAD', False)

# Application definition

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'django.contrib.sites',  # Required by django-allauth
    'rest_framework',
    'django_elasticsearch_dsl',
    'storages',
    'corsheaders',
    'core',
    'search_engine',
    'analytics',
    'extraction',
    'rest_framework.authtoken',
    'dj_rest_auth',
    'dj_rest_auth.registration',
    'allauth',
    'allauth.account',
    'allauth.socialaccount',
    'allauth.socialaccount.providers.google',
    'rest_framework_simplejwt.token_blacklist',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'core.middleware.APITrailingSlashMiddleware',
    'core.middleware.RequestIDMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'allauth.account.middleware.AccountMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'ilm_shamela.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'ilm_shamela.wsgi.application'


# Database
# https://docs.djangoproject.com/en/5.0/ref/settings/#databases

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': os.environ.get('POSTGRES_DB', 'postgres'),
        'USER': os.environ.get('POSTGRES_USER', 'postgres'),
        'PASSWORD': os.environ.get('POSTGRES_PASSWORD', 'postgres'),
        'HOST': os.environ.get('POSTGRES_HOST', 'db'),
        'PORT': os.environ.get('POSTGRES_PORT', '5432'),
    }
}

if env_bool('USE_SQLITE_FOR_TESTS', False):
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'test.sqlite3',
        }
    }


# Custom User Model
AUTH_USER_MODEL = 'core.User'


# Password validation
# https://docs.djangoproject.com/en/5.0/ref/settings/#auth-password-validators

AUTHENTICATION_BACKENDS = [
    # Needed to login by username in Django admin, regardless of `allauth`
    'django.contrib.auth.backends.ModelBackend',

    # `allauth` specific authentication methods, such as login by e-mail
    'allauth.account.auth_backends.AuthenticationBackend',
]

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]


# Internationalization
# https://docs.djangoproject.com/en/5.0/topics/i18n/

LANGUAGE_CODE = 'en-us'

TIME_ZONE = 'UTC'

USE_I18N = True

USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/5.0/howto/static-files/

STATIC_URL = '/static/'
STATIC_ROOT = os.path.join(BASE_DIR, 'staticfiles')

MEDIA_URL = '/media/'
MEDIA_ROOT = os.path.join(BASE_DIR, 'media')

# Default primary key field type
# https://docs.djangoproject.com/en/5.0/ref/settings/#default-auto-field

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'


# REST Framework Configuration
REST_FRAMEWORK = {
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 20,
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'dj_rest_auth.jwt_auth.JWTCookieAuthentication',
        'rest_framework.authentication.SessionAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
        'rest_framework.throttling.ScopedRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '20/min',
        'user': '200/min',
        'dj_rest_auth': '20/min',
        'upload': '30/hour',
        'search': '600/hour',
        'reader_progress': '30/min',
        'reader_pages': '60/min',
        'analytics_ingest': '120/min',
        'recommendations': '60/min',
    },
}


# Redis Configuration
REDIS_HOST = os.environ.get('REDIS_HOST', 'redis')
REDIS_PORT = os.environ.get('REDIS_PORT', '6379')
REDIS_URL = f"redis://{REDIS_HOST}:{REDIS_PORT}/0"

# Shared cache (DRF throttle counters + reader quotas). Redis DB /1 so the
# Celery broker on /0 and the cache never clobber each other's keys.
CACHE_REDIS_URL = os.environ.get(
    'CACHE_REDIS_URL', f"redis://{REDIS_HOST}:{REDIS_PORT}/1"
)
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.redis.RedisCache',
        'LOCATION': CACHE_REDIS_URL,
        'KEY_PREFIX': 'ilm',
    }
}

# Unit tests must not depend on a live Redis instance.
if 'test' in sys.argv:
    CACHES = {
        'default': {
            'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
        }
    }

# Reader anti-scraping quotas (per user, per UTC day); 0 disables a quota.
READER_MAX_DOCS_PER_DAY = int(os.environ.get('READER_MAX_DOCS_PER_DAY', '50'))
READER_MAX_PAGES_PER_DAY = int(
    os.environ.get('READER_MAX_PAGES_PER_DAY', '5000')
)

# Celery Configuration
CELERY_BROKER_URL = REDIS_URL
CELERY_RESULT_BACKEND = REDIS_URL
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = TIME_ZONE

# KB extraction pipeline (extraction/kb/) — file outputs + LLM-response cache.
# Inside Docker this is a named volume (kb_data) so cache/outputs survive
# container restarts; on a host run it defaults under BASE_DIR (gitignored).
KB_DATA_DIR = os.environ.get('KB_DATA_DIR', os.path.join(BASE_DIR, 'data', 'kb'))

# Analytics / behavior tracking
# Raw UserEvent rows older than this are purged by `manage.py purge_events`
# (or the analytics.tasks.purge_old_events Celery task). Aggregates are kept.
ANALYTICS_EVENT_RETENTION_DAYS = int(
    os.environ.get('ANALYTICS_EVENT_RETENTION_DAYS', '180')
)


# Elasticsearch Configuration
# Ensure the Elasticsearch host URL includes scheme, host, and port
elasticsearch_host = os.environ.get('ELASTICSEARCH_HOST', 'es:9200')
# If the host doesn't start with http:// or https://, add http://
if not elasticsearch_host.startswith(('http://', 'https://')):
    elasticsearch_host = f'http://{elasticsearch_host}'

ELASTICSEARCH_DSL = {
    'default': {
        'hosts': [elasticsearch_host],
        'timeout': 30,  # Connection timeout in seconds
        'max_retries': 3,  # Number of retries
        'retry_on_timeout': True,  # Retry on timeout
    },
}


# MinIO/S3 Configuration (via django-storages)
AWS_ACCESS_KEY_ID = os.environ.get('MINIO_ROOT_USER', 'minioadmin')
AWS_SECRET_ACCESS_KEY = os.environ.get('MINIO_ROOT_PASSWORD', 'minioadmin')
AWS_STORAGE_BUCKET_NAME = os.environ.get(
    'AWS_STORAGE_BUCKET_NAME', 'documents')
AWS_S3_ENDPOINT_URL = os.environ.get(
    'AWS_S3_ENDPOINT_URL', 'http://minio:9000')
AWS_S3_USE_SSL = False
AWS_S3_VERIFY = False

# Storage Configuration
# Note: Django 5.2+ uses the STORAGES setting; DEFAULT_FILE_STORAGE is deprecated.
# Currently using FileSystemStorage (Django default) since existing files are on local filesystem.
# The old S3 settings below are kept for reference but not active via STORAGES.
DEFAULT_FILE_STORAGE = 'storages.backends.s3boto3.S3Boto3Storage'
STATICFILES_STORAGE = 'storages.backends.s3boto3.S3StaticStorage'

# CORS Configuration
CORS_ALLOW_ALL_ORIGINS = env_bool('CORS_ALLOW_ALL_ORIGINS', False)
CORS_ALLOWED_ORIGINS = env_list(
    'CORS_ALLOWED_ORIGINS',
    [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'https://localhost:3000',
        'https://127.0.0.1:3000',
    ],
)
CORS_ALLOWED_ORIGIN_REGEXES = env_list('CORS_ALLOWED_ORIGIN_REGEXES', [])

CORS_ALLOW_CREDENTIALS = True

# Allow all methods for file uploads
CORS_ALLOW_METHODS = [
    'DELETE',
    'GET',
    'OPTIONS',
    'PATCH',
    'POST',
    'PUT',
]

# Allow all headers including those needed for file uploads
CORS_ALLOW_HEADERS = [
    'accept',
    'accept-encoding',
    'authorization',
    'content-type',
    'dnt',
    'origin',
    'user-agent',
    'x-csrftoken',
    'x-requested-with',
]

# Explicitly expose CORS headers
CORS_EXPOSE_HEADERS = [
    'content-type',
    'x-csrftoken',
]

# Preflight cache duration (24 hours)
CORS_PREFLIGHT_MAX_AGE = 86400

# Email Configuration
if DEBUG:
    EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'
else:
    EMAIL_BACKEND = os.environ.get(
        'EMAIL_BACKEND', 'django.core.mail.backends.smtp.EmailBackend')
    EMAIL_HOST = os.environ.get('EMAIL_HOST', 'localhost')
    EMAIL_PORT = int(os.environ.get('EMAIL_PORT', 25))
    EMAIL_USE_TLS = os.environ.get('EMAIL_USE_TLS', 'False').lower() == 'true'
    EMAIL_HOST_USER = os.environ.get('EMAIL_HOST_USER', '')
    EMAIL_HOST_PASSWORD = os.environ.get('EMAIL_HOST_PASSWORD', '')

# Authentication Configuration
SITE_ID = 1

REST_USE_JWT = True
JWT_AUTH_COOKIE = 'jwt-auth'
JWT_AUTH_REFRESH_COOKIE = 'jwt-refresh-token'
JWT_AUTH_SECURE = not DEBUG

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=60),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=1),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
    'SIGNING_KEY': SECRET_KEY,
}

ACCOUNT_LOGIN_METHODS = {'email'}
# Flip to 'mandatory' (via env) only once a real SMTP provider is configured
# (EMAIL_HOST/EMAIL_HOST_USER/EMAIL_HOST_PASSWORD/EMAIL_USE_TLS); with the
# default localhost:25 backend, verification mails never arrive and signup
# silently breaks. Google OAuth signups are provider-verified either way.
ACCOUNT_EMAIL_VERIFICATION = os.environ.get(
    'ACCOUNT_EMAIL_VERIFICATION', 'optional'
)
ACCOUNT_SIGNUP_PASSWORD_ENTER_TWICE = False
ACCOUNT_UNIQUE_EMAIL = True
# Still seems to be used by some parts, but warnings said otherwise.
ACCOUNT_USERNAME_REQUIRED = False
# Let's trust the warning or basic config.
# Actually, let's keep it simple for now and address warnings if they persist or cause issues.
# The warning says: use settings.ACCOUNT_LOGIN_METHODS = {'email'}
# And settings.ACCOUNT_SIGNUP_FIELDS = ...

REST_AUTH = {
    'USE_JWT': True,
    'JWT_AUTH_COOKIE': 'jwt-auth',
    'JWT_AUTH_REFRESH_COOKIE': 'jwt-refresh-token',
    'JWT_AUTH_SECURE': not DEBUG,
    'REGISTER_SERIALIZER': 'core.serializers.CustomRegisterSerializer',
    'LOGIN_SERIALIZER': 'core.serializers.CustomLoginSerializer',
    'USER_DETAILS_SERIALIZER': 'core.serializers.CustomUserDetailsSerializer',
}

# Gemini Embedding — required for semantic search reranking
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

SOCIALACCOUNT_PROVIDERS = {
    'google': {
        # NOTE: Do NOT use 'APP' here - it conflicts with database SocialApp entry
        # The SocialApp is managed via the setup_google_oauth management command
        'SCOPE': [
            'profile',
            'email',
        ],
        'AUTH_PARAMS': {
            'access_type': 'online',
        }
    }
}


LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'filters': {
        'request_id': {
            '()': 'core.logging.RequestIDFilter',
        },
    },
    'formatters': {
        'json': {
            '()': 'core.logging.JSONFormatter',
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'json',
            'filters': ['request_id'],
        },
    },
    'root': {
        'handlers': ['console'],
        'level': os.environ.get('LOG_LEVEL', 'INFO'),
    },
}
