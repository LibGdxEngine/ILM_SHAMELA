"""Tests for the library-assistant chat endpoints (``/library/chat/...``).

These are document-less, user-scoped sessions that persist the CopilotKit
library-agent transcript. No LLM is involved: create (by ``user, thread_id``)
and message append (by ``session, client_id``) are both idempotent, and the
session title is derived from the first user message.
"""
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from search_engine.models import LibraryChatMessage, LibraryChatSession


User = get_user_model()

SESSIONS_URL = '/api/search_engine/library/chat/sessions/'


def messages_url(session_id):
    return f'{SESSIONS_URL}{session_id}/messages/'


def detail_url(session_id):
    return f'{SESSIONS_URL}{session_id}/'


class LibraryChatTests(APITestCase):
    def setUp(self):
        self.user_a = User.objects.create_user(
            username='alice', email='alice@example.com', password='LibPass123!'
        )
        self.user_b = User.objects.create_user(
            username='bob', email='bob@example.com', password='LibPass123!'
        )
        self.client.force_authenticate(user=self.user_a)

    # --- auth -------------------------------------------------------------

    def test_unauthenticated_list_returns_401(self):
        self.client.force_authenticate(user=None)
        response = self.client.get(SESSIONS_URL)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    # --- idempotent create ------------------------------------------------

    def test_create_is_idempotent_by_thread_id(self):
        payload = {'thread_id': 'thread-xyz'}
        first = self.client.post(SESSIONS_URL, payload, format='json')
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)

        second = self.client.post(SESSIONS_URL, payload, format='json')
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(first.data['id'], second.data['id'])

        self.assertEqual(
            LibraryChatSession.objects.filter(
                user=self.user_a, thread_id='thread-xyz'
            ).count(),
            1,
        )

    def test_same_thread_id_distinct_per_user(self):
        self.client.post(SESSIONS_URL, {'thread_id': 'dup'}, format='json')
        self.client.force_authenticate(user=self.user_b)
        response = self.client.post(SESSIONS_URL, {'thread_id': 'dup'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(LibraryChatSession.objects.filter(thread_id='dup').count(), 2)

    # --- append messages --------------------------------------------------

    def _create_session(self, thread_id='t1'):
        response = self.client.post(SESSIONS_URL, {'thread_id': thread_id}, format='json')
        return response.data['id']

    def test_append_persists_and_autotitles(self):
        session_id = self._create_session()
        body = {
            'messages': [
                {'client_id': 'm1', 'role': 'user', 'content': 'Tell me about Al-Ghazali'},
                {'client_id': 'm2', 'role': 'assistant', 'content': 'Here are some works…'},
            ]
        }
        response = self.client.post(messages_url(session_id), body, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(response.data['messages']), 2)
        # Title derived from the first user message.
        self.assertEqual(response.data['title'], 'Tell me about Al-Ghazali')
        self.assertEqual(LibraryChatMessage.objects.filter(session_id=session_id).count(), 2)

    def test_append_is_idempotent_by_client_id(self):
        session_id = self._create_session()
        body = {'messages': [{'client_id': 'dupe', 'role': 'user', 'content': 'hi'}]}
        self.client.post(messages_url(session_id), body, format='json')
        # Re-posting the same client_id (retry / StrictMode) must not duplicate.
        self.client.post(messages_url(session_id), body, format='json')
        self.assertEqual(
            LibraryChatMessage.objects.filter(session_id=session_id, client_id='dupe').count(),
            1,
        )

    def test_messages_listed_chronologically(self):
        session_id = self._create_session()
        self.client.post(
            messages_url(session_id),
            {'messages': [
                {'client_id': 'a', 'role': 'user', 'content': 'first'},
                {'client_id': 'b', 'role': 'assistant', 'content': 'second'},
            ]},
            format='json',
        )
        response = self.client.get(messages_url(session_id))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([m['client_id'] for m in response.data], ['a', 'b'])

    def test_append_rejects_blank_content(self):
        session_id = self._create_session()
        body = {'messages': [{'client_id': 'x', 'role': 'user', 'content': '   '}]}
        response = self.client.post(messages_url(session_id), body, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    # --- rename / delete --------------------------------------------------

    def test_rename_session(self):
        session_id = self._create_session()
        response = self.client.patch(
            detail_url(session_id), {'title': 'My research'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['title'], 'My research')

    def test_delete_cascades_messages(self):
        session_id = self._create_session()
        self.client.post(
            messages_url(session_id),
            {'messages': [{'client_id': 'm', 'role': 'user', 'content': 'hi'}]},
            format='json',
        )
        response = self.client.delete(detail_url(session_id))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(LibraryChatSession.objects.filter(id=session_id).exists())
        self.assertEqual(LibraryChatMessage.objects.filter(session_id=session_id).count(), 0)

    # --- isolation --------------------------------------------------------

    def test_user_cannot_access_other_users_session(self):
        session_id = self._create_session()
        self.client.force_authenticate(user=self.user_b)
        self.assertEqual(
            self.client.get(detail_url(session_id)).status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertEqual(
            self.client.get(messages_url(session_id)).status_code,
            status.HTTP_404_NOT_FOUND,
        )
