from allauth.socialaccount.providers.google.views import GoogleOAuth2Adapter
from allauth.socialaccount.providers.oauth2.client import OAuth2Client
from allauth.socialaccount.models import SocialAccount, SocialApp
from django.contrib.auth import get_user_model
from django.contrib.sites.shortcuts import get_current_site
from dj_rest_auth.registration.views import SocialLoginView
from rest_framework import generics
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
import os
import logging
import requests
from .serializers import UserProfileSerializer

logger = logging.getLogger(__name__)
User = get_user_model()


class UserProfileView(generics.RetrieveUpdateAPIView):
    """Dedicated profile endpoint for authenticated user updates."""

    serializer_class = UserProfileSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'patch', 'head', 'options']

    def get_object(self):
        return self.request.user


class GoogleLogin(SocialLoginView):
    """Google OAuth login view with improved error handling."""
    adapter_class = GoogleOAuth2Adapter
    callback_url = os.environ.get(
        'GOOGLE_CALLBACK_URL', 'https://localhost/auth/google/callback')
    client_class = OAuth2Client

    def _get_user_info_from_google(self, access_token):
        """Get user info from Google OAuth access token."""
        try:
            # Use Google's userinfo endpoint to get user data
            response = requests.get(
                'https://www.googleapis.com/oauth2/v2/userinfo',
                params={'access_token': access_token},
                timeout=10
            )
            if response.status_code == 200:
                return response.json()
            else:
                logger.warning(
                    f"Failed to fetch user info from Google: {response.status_code}")
                return None
        except Exception as e:
            logger.error(f"Error fetching user info from Google: {e}", exc_info=True)
            return None

    def _link_social_account_to_user(self, user, access_token, uid, user_info):
        """Link Google social account to existing user."""
        try:
            # Get the SocialApp for Google
            site = get_current_site(self.request)
            social_app = SocialApp.objects.get(
                provider='google',
                sites__id=site.id
            )

            # Prepare extra_data from user_info
            extra_data = {
                'id': user_info.get('id') or user_info.get('sub'),
                'email': user_info.get('email'),
                'verified_email': user_info.get('verified_email', False),
                'name': user_info.get('name'),
                'given_name': user_info.get('given_name'),
                'family_name': user_info.get('family_name'),
                'picture': user_info.get('picture'),
            }

            # Get or create the SocialAccount
            social_account, created = SocialAccount.objects.get_or_create(
                provider='google',
                uid=uid,
                defaults={
                    'user': user,
                    'extra_data': extra_data
                }
            )

            # If account already exists but linked to different user, update it
            if not created and social_account.user != user:
                logger.info(
                    f"Linking existing social account {social_account.id} to user {user.id}")
                social_account.user = user
                social_account.extra_data = extra_data
                social_account.save()
            elif not created:
                # Update extra_data if account already linked to this user
                social_account.extra_data = extra_data
                social_account.save()

            return social_account
        except SocialApp.DoesNotExist:
            logger.error("Google SocialApp not found")
            return None
        except Exception as e:
            logger.error(f"Error linking social account: {e}", exc_info=True)
            return None

    def post(self, request, *args, **kwargs):
        """Override to provide account merging functionality."""
        # Check if Google OAuth is configured
        google_client_id = os.environ.get('GOOGLE_CLIENT_ID')
        logger.info(
            f"Google login attempt. Client ID configured: {bool(google_client_id)}")

        if not google_client_id:
            return Response(
                {'detail': 'Google login is not configured on this server. Please contact the administrator.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE
            )

        access_token = request.data.get('access_token')
        if not access_token:
            return Response(
                {'detail': 'Access token is required.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            logger.info(
                f"Processing Google login with access_token: {access_token[:20]}...")

            # Get user info from Google token
            user_info = self._get_user_info_from_google(access_token)
            if not user_info:
                return Response(
                    {'detail': 'Invalid or expired Google token. Please try signing in again.'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            email = user_info.get('email')
            if not email:
                return Response(
                    {'detail': 'Unable to retrieve email from Google account.'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            logger.info(f"Extracted email from Google token: {email}")

            # Check if user with this email already exists
            try:
                existing_user = User.objects.get(email=email)
                logger.info(
                    f"Found existing user with email {email}, attempting to link Google account")

                # Extract Google UID
                google_uid = user_info.get('id') or user_info.get('sub')

                if not google_uid:
                    return Response(
                        {'detail': 'Unable to retrieve user ID from Google.'},
                        status=status.HTTP_400_BAD_REQUEST
                    )

                # Link the Google social account to existing user
                social_account = self._link_social_account_to_user(
                    existing_user, access_token, google_uid, user_info)

                if not social_account:
                    return Response(
                        {'detail': 'Failed to link Google account. Please try again.'},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR
                    )

                logger.info(
                    f"Successfully linked Google account to user {existing_user.id}")

                # Generate JWT tokens for the existing user
                from rest_framework_simplejwt.tokens import RefreshToken
                refresh = RefreshToken.for_user(existing_user)
                access_token_jwt = str(refresh.access_token)

                # Set JWT cookies
                from django.conf import settings
                response_data = {
                    'access': access_token_jwt,
                    'refresh': str(refresh),
                    'user': {
                        'pk': existing_user.pk,
                        'email': existing_user.email,
                        'first_name': existing_user.first_name,
                        'last_name': existing_user.last_name,
                        'username': existing_user.username,
                    }
                }

                http_response = Response(response_data, status=status.HTTP_200_OK)

                # Set JWT cookies
                http_response.set_cookie(
                    key=settings.JWT_AUTH_COOKIE,
                    value=access_token_jwt,
                    httponly=True,
                    secure=settings.JWT_AUTH_SECURE,
                    samesite='Lax',
                    max_age=settings.SIMPLE_JWT['ACCESS_TOKEN_LIFETIME'].total_seconds()
                )
                http_response.set_cookie(
                    key=settings.JWT_AUTH_REFRESH_COOKIE,
                    value=str(refresh),
                    httponly=True,
                    secure=settings.JWT_AUTH_SECURE,
                    samesite='Lax',
                    max_age=settings.SIMPLE_JWT['REFRESH_TOKEN_LIFETIME'].total_seconds()
                )

                return http_response

            except User.DoesNotExist:
                # User doesn't exist, proceed with normal flow
                logger.info(f"No existing user found with email {email}, creating new account")
                return super().post(request, *args, **kwargs)

        except Exception as e:
            error_message = str(e)
            logger.error(
                f"Google login failed with error: {error_message}", exc_info=True)
            # Provide user-friendly messages for common errors
            if 'token' in error_message.lower() or 'invalid' in error_message.lower():
                return Response(
                    {'detail': 'Invalid or expired Google token. Please try signing in again.'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            else:
                return Response(
                    {'detail': 'Google login failed. Please try again or use email login.'},
                    status=status.HTTP_400_BAD_REQUEST
                )
