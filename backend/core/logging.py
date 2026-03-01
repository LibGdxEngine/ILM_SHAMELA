import json
import logging
from datetime import datetime, timezone

from .request_id import get_request_id


class RequestIDFilter(logging.Filter):
    """Attach request/task correlation id to log records."""

    def filter(self, record):
        if not hasattr(record, 'request_id'):
            record.request_id = get_request_id()
        return True


class JSONFormatter(logging.Formatter):
    """Compact JSON formatter for structured logs."""

    def format(self, record):
        payload = {
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'level': record.levelname,
            'logger': record.name,
            'request_id': getattr(record, 'request_id', get_request_id()),
            'message': record.getMessage(),
        }

        for key in (
            'task_id',
            'document_id',
            'user_id',
            'path',
            'method',
            'status_code',
        ):
            if hasattr(record, key):
                payload[key] = getattr(record, key)

        if record.exc_info:
            payload['exception'] = self.formatException(record.exc_info)

        return json.dumps(payload, ensure_ascii=True)
