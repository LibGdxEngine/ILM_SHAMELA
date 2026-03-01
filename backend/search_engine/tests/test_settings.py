from django.conf import settings
from django.test import SimpleTestCase


class RestFrameworkSettingsTests(SimpleTestCase):
    def test_dj_rest_auth_throttle_scope_has_rate(self):
        throttle_rates = settings.REST_FRAMEWORK.get('DEFAULT_THROTTLE_RATES', {})
        self.assertIn('dj_rest_auth', throttle_rates)
