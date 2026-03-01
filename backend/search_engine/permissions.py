from rest_framework.permissions import BasePermission, SAFE_METHODS


EDITOR_GROUPS = {'editor', 'admin'}


def has_editor_privileges(user) -> bool:
    """Return True for users allowed to write document resources."""
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser or user.is_staff:
        return True
    return user.groups.filter(name__in=EDITOR_GROUPS).exists()


class IsAuthenticatedReadOnlyOrEditor(BasePermission):
    """
    All requests require authentication.
    SAFE methods are allowed for any authenticated user.
    Write methods are restricted to editor/admin roles.
    """

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return True
        return has_editor_privileges(user)
