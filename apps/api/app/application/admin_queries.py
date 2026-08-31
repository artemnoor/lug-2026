"""Read-only organizer queries behind the admin HTTP boundary."""

from .repositories import AdminReadRepository


class AdminQueryRuleViolation(Exception):
    def __init__(self, message: str, code: str = "ADMIN_RESOURCE_NOT_FOUND") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


class AdminQueryService:
    ALLOWED_RESOURCES = frozenset({"users", "teams", "achievements"})

    def __init__(self, reads: AdminReadRepository) -> None:
        self.reads = reads

    async def collection(
        self,
        resource: str,
        limit: int = 50,
        offset: int = 0,
        query: str = "",
        status: str = "all",
    ) -> dict:
        if resource not in self.ALLOWED_RESOURCES:
            raise AdminQueryRuleViolation("Раздел админ-панели не найден.")
        return await self.reads.get_admin_collection(
            resource, limit, offset, query, status
        )

    async def overview(self) -> dict:
        return await self.reads.get_admin_overview()

    async def audit(self) -> list[dict]:
        return await self.reads.get_audit_log()
