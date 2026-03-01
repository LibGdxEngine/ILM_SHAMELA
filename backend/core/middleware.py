import time
import uuid

from .metrics import increment_metric
from .request_id import reset_request_id, set_request_id


class RequestIDMiddleware:
    """Attach request IDs and emit basic request metrics."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request_id = request.headers.get('X-Request-ID') or str(uuid.uuid4())
        token = set_request_id(request_id)
        request.request_id = request_id

        start = time.perf_counter()
        status_code = 500
        try:
            response = self.get_response(request)
            status_code = response.status_code
            response['X-Request-ID'] = request_id
            return response
        finally:
            elapsed_ms = (time.perf_counter() - start) * 1000
            increment_metric(
                'http_requests_total',
                1.0,
                method=request.method,
                path=request.path,
                status=str(status_code),
            )
            increment_metric(
                'http_request_duration_ms_sum',
                elapsed_ms,
                method=request.method,
                path=request.path,
            )
            increment_metric(
                'http_request_duration_ms_count',
                1.0,
                method=request.method,
                path=request.path,
            )
            reset_request_id(token)
