from django.db import connection
from django.http import HttpResponse
from elasticsearch_dsl import connections
from rest_framework import permissions, status, views
from rest_framework.response import Response

from .metrics import export_prometheus_metrics


class LivenessView(views.APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        return Response({'status': 'ok'}, status=status.HTTP_200_OK)


class ReadinessView(views.APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        checks = {
            'database': False,
            'elasticsearch': False,
        }

        try:
            with connection.cursor() as cursor:
                cursor.execute('SELECT 1')
                cursor.fetchone()
            checks['database'] = True
        except Exception:
            checks['database'] = False

        try:
            es = connections.get_connection()
            checks['elasticsearch'] = bool(es.ping())
        except Exception:
            checks['elasticsearch'] = False

        ready = all(checks.values())
        return Response(
            {'status': 'ready' if ready else 'not_ready', 'checks': checks},
            status=status.HTTP_200_OK if ready else status.HTTP_503_SERVICE_UNAVAILABLE,
        )


class MetricsView(views.APIView):
    permission_classes = [permissions.IsAdminUser]

    def get(self, request):
        return HttpResponse(
            export_prometheus_metrics(),
            content_type='text/plain; version=0.0.4; charset=utf-8',
            status=200,
        )
