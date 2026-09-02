"""Resolve file-backed secrets (Docker secrets) into the process environment.

Docker Compose mounts each declared secret at ``/run/secrets/<name>``. A service
then points ``<VAR>_FILE`` at that path instead of setting ``<VAR>`` directly —
the same convention the ``postgres`` and ``minio`` images already implement, so
the whole stack reads secrets one way.

Values are materialised into ``os.environ`` rather than exposed through a new
accessor on purpose: these keys are read with bare ``os.environ.get`` from about
a dozen modules (``search_engine.llm``, ``search_engine.semantic``,
``search_engine.views_chat``, ``extraction.ner``, ``extraction.layer0``,
``core.management.commands.setup_google_oauth``, ...). Expanding into the
environment keeps every one of those call sites working untouched.

Precedence:
  * ``<VAR>_FILE`` pointing at a readable, non-empty file wins over ``<VAR>``.
  * An *empty* secret file is treated as "no opinion" and will not clobber a
    ``<VAR>`` that is already set. This keeps placeholder files for optional
    keys (``ANTHROPIC_API_KEY`` and friends) from silently disabling a value
    still supplied via ``.env``.
  * With no ``<VAR>_FILE`` at all, plain ``<VAR>`` is used unchanged, so
    host-run tests and pre-secrets deployments behave exactly as before.

A ``<VAR>_FILE`` that points at a missing or unreadable path is a hard error:
that means the secret was declared but not delivered, and starting with a
silently blank ``SECRET_KEY`` or database password is worse than not starting.
"""

import os

from django.core.exceptions import ImproperlyConfigured

# Every environment variable in the stack whose value is sensitive. Kept as an
# explicit allowlist rather than "expand anything ending in _FILE" so an
# unrelated variable that happens to name a path is never read as a secret.
SECRET_ENV_VARS = (
    'SECRET_KEY',
    'POSTGRES_PASSWORD',
    'MINIO_ROOT_PASSWORD',
    'GOOGLE_CLIENT_SECRET',
    'GEMINI_API_KEY',
    'OPENROUTER_API_KEY',
    'ANTHROPIC_API_KEY',
)


def load_secrets(names=SECRET_ENV_VARS, environ=None):
    """Expand ``<VAR>_FILE`` entries into ``<VAR>``. Returns the names loaded.

    Idempotent — safe to call from several bootstrap paths (Django settings,
    the agent sidecar) without ordering constraints.
    """
    env = os.environ if environ is None else environ
    loaded = []

    for name in names:
        path = (env.get(f'{name}_FILE') or '').strip()
        if not path:
            continue

        try:
            with open(path, encoding='utf-8') as handle:
                # Trailing newlines are the common failure here: `echo secret >
                # file` appends one, and a stray \n corrupts an API key in an
                # HTTP header or silently changes SECRET_KEY between restarts.
                value = handle.read().strip()
        except OSError as exc:
            raise ImproperlyConfigured(
                f'{name}_FILE points at {path!r}, which could not be read: {exc}. '
                f'Check that the secret is declared for this service in '
                f'docker-compose.yml and that its source file exists.'
            ) from exc

        if not value and env.get(name):
            # Placeholder file for an optional key; keep whatever is already set.
            continue

        env[name] = value
        loaded.append(name)

    return loaded
