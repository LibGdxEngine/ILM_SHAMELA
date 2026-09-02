"""Tests for file-backed secret resolution (Docker secrets)."""

import os
import tempfile

from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase

from ilm_shamela.env_secrets import SECRET_ENV_VARS, load_secrets


class LoadSecretsTests(SimpleTestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)

    def write(self, name, content):
        path = os.path.join(self._tmp.name, name)
        with open(path, 'w', encoding='utf-8') as handle:
            handle.write(content)
        return path

    def test_file_value_is_loaded_into_env(self):
        env = {'SECRET_KEY_FILE': self.write('sk', 'from-secret-file')}
        loaded = load_secrets(environ=env)

        self.assertEqual(env['SECRET_KEY'], 'from-secret-file')
        self.assertEqual(loaded, ['SECRET_KEY'])

    def test_trailing_newline_is_stripped(self):
        # `echo secret > file` appends a newline; a stray \n corrupts an API key
        # in an HTTP header and silently changes SECRET_KEY between restarts.
        env = {'OPENROUTER_API_KEY_FILE': self.write('or', 'sk-or-v1-abc\n')}
        load_secrets(environ=env)

        self.assertEqual(env['OPENROUTER_API_KEY'], 'sk-or-v1-abc')

    def test_file_wins_over_plain_variable(self):
        env = {
            'POSTGRES_PASSWORD': 'from-dot-env',
            'POSTGRES_PASSWORD_FILE': self.write('pg', 'from-secret'),
        }
        load_secrets(environ=env)

        self.assertEqual(env['POSTGRES_PASSWORD'], 'from-secret')

    def test_empty_file_does_not_clobber_existing_value(self):
        # Placeholder files exist for every optional key, so an empty one must
        # not disable a value still supplied through the environment.
        env = {
            'ANTHROPIC_API_KEY': 'from-dot-env',
            'ANTHROPIC_API_KEY_FILE': self.write('anthropic', ''),
        }
        loaded = load_secrets(environ=env)

        self.assertEqual(env['ANTHROPIC_API_KEY'], 'from-dot-env')
        self.assertEqual(loaded, [])

    def test_empty_file_yields_empty_value_when_nothing_else_is_set(self):
        env = {'GEMINI_API_KEY_FILE': self.write('gemini', '')}
        load_secrets(environ=env)

        self.assertEqual(env['GEMINI_API_KEY'], '')

    def test_plain_variable_used_when_no_file_is_configured(self):
        env = {'SECRET_KEY': 'plain-value'}
        loaded = load_secrets(environ=env)

        self.assertEqual(env['SECRET_KEY'], 'plain-value')
        self.assertEqual(loaded, [])

    def test_unreadable_file_raises(self):
        env = {'SECRET_KEY_FILE': os.path.join(self._tmp.name, 'missing')}

        with self.assertRaises(ImproperlyConfigured) as ctx:
            load_secrets(environ=env)

        self.assertIn('SECRET_KEY_FILE', str(ctx.exception))

    def test_only_allowlisted_names_are_expanded(self):
        # "expand anything ending in _FILE" would turn an ordinary path setting
        # into a secret read; the allowlist is what prevents that.
        env = {'DJANGO_SETTINGS_FILE': self.write('unrelated', 'not-a-secret')}
        load_secrets(environ=env)

        self.assertNotIn('DJANGO_SETTINGS', env)

    def test_allowlist_matches_the_shell_loader(self):
        # backend/load_secrets.sh duplicates this list for the pre-Python steps
        # in entrypoint.sh; the two drifting apart is a silent failure.
        script = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
            'load_secrets.sh',
        )
        with open(script, encoding='utf-8') as handle:
            line = next(ln for ln in handle if ln.startswith('SECRET_VARS='))

        shell_vars = tuple(line.split('"')[1].split())
        self.assertEqual(shell_vars, SECRET_ENV_VARS)
