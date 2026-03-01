from contextvars import ContextVar, Token


_request_id_var: ContextVar[str] = ContextVar('request_id', default='-')


def get_request_id() -> str:
    return _request_id_var.get()


def set_request_id(value: str) -> Token:
    return _request_id_var.set(value)


def reset_request_id(token: Token) -> None:
    _request_id_var.reset(token)
