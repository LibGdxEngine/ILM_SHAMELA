from dj_rest_auth.registration.serializers import RegisterSerializer
from dj_rest_auth.serializers import LoginSerializer
from rest_framework import serializers
from django.contrib.auth import get_user_model
from django.utils.translation import gettext_lazy as _

User = get_user_model()


class CustomLoginSerializer(LoginSerializer):
    """Custom login serializer with user-friendly error messages."""

    def validate(self, attrs):
        email = attrs.get('email') or attrs.get('username')
        password = attrs.get('password')

        if email and password:
            # Check if user exists
            try:
                user = User.objects.get(email=email)
            except User.DoesNotExist:
                raise serializers.ValidationError({
                    'email': [_('No account found with this email address.')]
                })

            # Check if user has a usable password (not social-auth-only)
            if not user.has_usable_password():
                raise serializers.ValidationError({
                    'non_field_errors': [_(
                        'This account was created using Google login. '
                        'Please use "Continue with Google" to sign in.'
                    )]
                })

            # Check password
            if not user.check_password(password):
                raise serializers.ValidationError({
                    'password': [_('Incorrect password. Please try again.')]
                })

            # Check if account is active
            if not user.is_active:
                raise serializers.ValidationError({
                    'non_field_errors': [_('This account has been deactivated.')]
                })

            # All checks passed, let parent handle the rest
            attrs['email'] = email

        return super().validate(attrs)


class CustomRegisterSerializer(RegisterSerializer):
    """Custom registration serializer with first/last name fields."""
    first_name = serializers.CharField(required=True)
    last_name = serializers.CharField(required=True)

    def validate_email(self, email):
        """Check if email already exists with a friendly message."""
        if User.objects.filter(email=email).exists():
            raise serializers.ValidationError(
                _('An account with this email already exists. Please sign in instead.')
            )
        return super().validate_email(email)

    def custom_signup(self, request, user):
        user.first_name = self.validated_data.get('first_name', '')
        user.last_name = self.validated_data.get('last_name', '')
        user.save()
