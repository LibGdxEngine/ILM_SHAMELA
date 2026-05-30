from dj_rest_auth.registration.serializers import RegisterSerializer
from dj_rest_auth.serializers import LoginSerializer, UserDetailsSerializer
from rest_framework import serializers
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
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


class CustomUserDetailsSerializer(UserDetailsSerializer):
    """Custom user details serializer for profile updates."""

    first_name = serializers.CharField(required=True, allow_blank=False, trim_whitespace=True)
    last_name = serializers.CharField(required=True, allow_blank=False, trim_whitespace=True)
    email = serializers.EmailField(required=True)

    class Meta(UserDetailsSerializer.Meta):
        fields = ('pk', 'username', 'email', 'first_name', 'last_name')
        read_only_fields = ('pk', 'username')

    def validate_first_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError(_('First name cannot be empty.'))
        return value

    def validate_last_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError(_('Last name cannot be empty.'))
        return value

    def validate_email(self, value):
        normalized = value.strip().lower()
        if not normalized:
            raise serializers.ValidationError(_('Email cannot be empty.'))

        queryset = User.objects.filter(email__iexact=normalized)
        if self.instance is not None:
            queryset = queryset.exclude(pk=self.instance.pk)

        if queryset.exists():
            raise serializers.ValidationError(
                _('An account with this email already exists. Please use a different email.')
            )

        return normalized


class UserProfileSerializer(serializers.Serializer):
    """Dedicated serializer for authenticated user profile get/patch."""

    pk = serializers.IntegerField(read_only=True)
    username = serializers.CharField(read_only=True)
    email = serializers.EmailField(required=False)
    first_name = serializers.CharField(required=False, allow_blank=False, trim_whitespace=True)
    last_name = serializers.CharField(required=False, allow_blank=False, trim_whitespace=True)
    name = serializers.CharField(required=False, allow_blank=False, trim_whitespace=True)
    avatar = serializers.CharField(required=False, allow_blank=True, allow_null=True, trim_whitespace=True)

    current_password = serializers.CharField(
        required=False,
        write_only=True,
        trim_whitespace=False,
        style={'input_type': 'password'},
    )
    new_password = serializers.CharField(
        required=False,
        write_only=True,
        trim_whitespace=False,
        style={'input_type': 'password'},
    )
    new_password_confirm = serializers.CharField(
        required=False,
        write_only=True,
        trim_whitespace=False,
        style={'input_type': 'password'},
    )

    default_error_messages = {
        'password_fields_required': _(
            'To change your password, provide current_password, new_password, and new_password_confirm.'
        ),
        'current_password_incorrect': _('Current password is incorrect.'),
        'password_mismatch': _('New passwords do not match.'),
        'name_empty': _('Name cannot be empty.'),
        'avatar_unsupported': _('Avatar updates are not supported for this account.'),
    }

    def _get_google_social_account(self, user):
        social_accounts = getattr(user, 'socialaccount_set', None)
        if social_accounts is None:
            return None
        return social_accounts.filter(provider='google').first()

    def _supports_avatar_updates(self, user):
        if hasattr(user, 'avatar'):
            return True
        return self._get_google_social_account(user) is not None

    def _get_avatar(self, user):
        if hasattr(user, 'avatar'):
            avatar_value = getattr(user, 'avatar')
            if not avatar_value:
                return None
            avatar_url = getattr(avatar_value, 'url', None)
            return avatar_url or str(avatar_value)

        social_account = self._get_google_social_account(user)
        if social_account:
            extra_data = social_account.extra_data or {}
            return extra_data.get('picture')
        return None

    def to_representation(self, instance):
        return {
            'pk': instance.pk,
            'username': instance.username,
            'email': instance.email,
            'first_name': instance.first_name,
            'last_name': instance.last_name,
            'name': f'{instance.first_name} {instance.last_name}'.strip(),
            'avatar': self._get_avatar(instance),
            'is_staff': bool(instance.is_staff),
            'is_superuser': bool(instance.is_superuser),
        }

    def validate_first_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError(_('First name cannot be empty.'))
        return value

    def validate_last_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError(_('Last name cannot be empty.'))
        return value

    def validate_name(self, value):
        value = value.strip()
        if not value:
            self.fail('name_empty')
        return value

    def validate_email(self, value):
        normalized = value.strip().lower()
        if not normalized:
            raise serializers.ValidationError(_('Email cannot be empty.'))

        user = self.instance or self.context['request'].user
        queryset = User.objects.filter(email__iexact=normalized).exclude(pk=user.pk)
        if queryset.exists():
            raise serializers.ValidationError(
                _('An account with this email already exists. Please use a different email.')
            )

        return normalized

    def validate(self, attrs):
        user = self.instance or self.context['request'].user

        if 'name' in attrs:
            if 'first_name' in attrs or 'last_name' in attrs:
                raise serializers.ValidationError({
                    'name': [_('Provide either name or first_name/last_name, not both.')]
                })
            name_parts = attrs.pop('name').split()
            attrs['first_name'] = name_parts[0]
            attrs['last_name'] = ' '.join(name_parts[1:]) if len(name_parts) > 1 else ''

        password_values = {
            field: attrs.get(field)
            for field in ('current_password', 'new_password', 'new_password_confirm')
        }
        provided_password_fields = [field for field, value in password_values.items() if value]
        if provided_password_fields:
            if len(provided_password_fields) != 3:
                self.fail('password_fields_required')

            if not user.check_password(password_values['current_password']):
                self.fail('current_password_incorrect')

            if password_values['new_password'] != password_values['new_password_confirm']:
                self.fail('password_mismatch')

            validate_password(password_values['new_password'], user=user)

        if 'avatar' in attrs and not self._supports_avatar_updates(user):
            self.fail('avatar_unsupported')

        return attrs

    def update(self, instance, validated_data):
        for field in ('email', 'first_name', 'last_name'):
            if field in validated_data:
                setattr(instance, field, validated_data[field])

        if validated_data.get('new_password'):
            instance.set_password(validated_data['new_password'])

        # Update instance fields in one write when available.
        save_fields = [
            field for field in ('email', 'first_name', 'last_name', 'password')
            if field in validated_data or field == 'password' and validated_data.get('new_password')
        ]
        if save_fields:
            if hasattr(instance, 'updated_at'):
                save_fields.append('updated_at')
            instance.save(update_fields=list(dict.fromkeys(save_fields)))

        if 'avatar' in validated_data:
            avatar_value = validated_data['avatar']
            if hasattr(instance, 'avatar'):
                setattr(instance, 'avatar', avatar_value)
                avatar_save_fields = ['avatar']
                if hasattr(instance, 'updated_at'):
                    avatar_save_fields.append('updated_at')
                instance.save(update_fields=avatar_save_fields)
            else:
                social_account = self._get_google_social_account(instance)
                extra_data = social_account.extra_data or {}
                if avatar_value in (None, ''):
                    extra_data.pop('picture', None)
                else:
                    extra_data['picture'] = avatar_value
                social_account.extra_data = extra_data
                social_account.save(update_fields=['extra_data'])

        return instance
