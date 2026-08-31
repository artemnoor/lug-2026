"""Errors crossing an application/persistence port."""


class PersistenceError(RuntimeError):
    status_code = 409

    def __init__(
        self, message: str, status_code: int | None = None, code: str | None = None
    ) -> None:
        super().__init__(message)
        self.message = message
        if status_code is not None:
            self.status_code = status_code
        self.code = code or f"HTTP_{self.status_code}"
