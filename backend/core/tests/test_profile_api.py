from django.contrib.auth import get_user_model
from allauth.socialaccount.models import SocialAccount
from rest_framework import status
from rest_framework.test import APITestCase


User = get_user_model()


class ProfileApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='reader',
            email='reader@example.com',
            password='ReaderPass123!',
            first_name='Reader',
            last_name='User',
        )

    def test_user_details_requires_authentication(self):
        response = self.client.get('/api/auth/user/')
        self.assertIn(
            response.status_code,
            {status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN},
        )

    def test_authenticated_user_can_patch_profile(self):
        self.client.force_authenticate(user=self.user)

        response = self.client.patch(
            '/api/auth/user/',
            {
                'first_name': 'Updated',
                'last_name': 'Name',
                'email': 'updated@example.com',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertEqual(self.user.first_name, 'Updated')
        self.assertEqual(self.user.last_name, 'Name')
        self.assertEqual(self.user.email, 'updated@example.com')

    def test_authenticated_user_can_patch_profile_with_name_alias(self):
        self.client.force_authenticate(user=self.user)

        response = self.client.patch(
            '/api/auth/user/',
            {'name': 'Updated Name'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertEqual(self.user.first_name, 'Updated')
        self.assertEqual(self.user.last_name, 'Name')

    def test_profile_get_returns_name_and_avatar(self):
        SocialAccount.objects.create(
            user=self.user,
            provider='google',
            uid='google-123',
            extra_data={'picture': 'https://example.com/avatar.png'},
        )
        self.client.force_authenticate(user=self.user)

        response = self.client.get('/api/auth/user/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['name'], 'Reader User')
        self.assertEqual(response.data['avatar'], 'https://example.com/avatar.png')

    def test_profile_update_rejects_duplicate_email(self):
        User.objects.create_user(
            username='other',
            email='other@example.com',
            password='OtherPass123!',
        )
        self.client.force_authenticate(user=self.user)

        response = self.client.patch(
            '/api/auth/user/',
            {'email': 'other@example.com'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('email', response.data)

    def test_profile_update_rejects_blank_trimmed_names(self):
        self.client.force_authenticate(user=self.user)

        response = self.client.patch(
            '/api/auth/user/',
            {'first_name': '   '},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('first_name', response.data)

    def test_profile_update_changes_password_with_current_password(self):
        self.client.force_authenticate(user=self.user)

        response = self.client.patch(
            '/api/auth/user/',
            {
                'current_password': 'ReaderPass123!',
                'new_password': 'ReaderPass456!',
                'new_password_confirm': 'ReaderPass456!',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('ReaderPass456!'))

    def test_profile_update_rejects_wrong_current_password(self):
        self.client.force_authenticate(user=self.user)

        response = self.client.patch(
            '/api/auth/user/',
            {
                'current_password': 'WrongPass123!',
                'new_password': 'ReaderPass456!',
                'new_password_confirm': 'ReaderPass456!',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('non_field_errors', response.data)

    def test_profile_update_updates_avatar_for_google_account(self):
        social_account = SocialAccount.objects.create(
            user=self.user,
            provider='google',
            uid='google-123',
            extra_data={'picture': 'https://example.com/old-avatar.png'},
        )
        self.client.force_authenticate(user=self.user)

        response = self.client.patch(
            '/api/auth/user/',
            {'avatar': 'https://example.com/new-avatar.png'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        social_account.refresh_from_db()
        self.assertEqual(
            social_account.extra_data.get('picture'),
            'https://example.com/new-avatar.png',
        )
