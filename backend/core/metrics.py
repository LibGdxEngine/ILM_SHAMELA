from threading import Lock
from typing import Dict, Tuple


_metrics_lock = Lock()
_metrics: Dict[Tuple[str, Tuple[Tuple[str, str], ...]], float] = {}


def _key(name: str, labels: Dict[str, str]):
    return (name, tuple(sorted((k, str(v)) for k, v in labels.items())))


def increment_metric(name: str, value: float = 1.0, **labels):
    key = _key(name, labels)
    with _metrics_lock:
        _metrics[key] = _metrics.get(key, 0.0) + value


def export_prometheus_metrics() -> str:
    lines = []
    with _metrics_lock:
        items = list(_metrics.items())

    for (name, labels), value in items:
        if labels:
            label_str = ','.join(f'{k}="{v}"' for k, v in labels)
            lines.append(f'{name}{{{label_str}}} {value}')
        else:
            lines.append(f'{name} {value}')
    return '\n'.join(lines) + '\n'
