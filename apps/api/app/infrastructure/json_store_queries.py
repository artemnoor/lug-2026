"""Read-side compatibility queries for the development JSON adapter."""

from time import time

from ..shared import domain


class JsonStoreQueryMixin:
    async def get_team_by_group(self, group: str) -> dict | None:
        state = await self.load()
        normalized = str(group or "").strip().upper()
        return next(
            (item for item in state["teams"] if item.get("group") == normalized), None
        )

    async def get_email_verification_by_email(self, email: str) -> dict | None:
        state = await self.load()
        normalized = email.lower()
        return next(
            (
                item
                for item in state["emailVerifications"]
                if str(item.get("email", "")).lower() == normalized
            ),
            None,
        )

    async def get_public_results_data(self) -> dict:
        state = await self.load()
        return {
            "settings": state["settings"],
            "users": state["users"],
            "teams": state["teams"],
            "achievements": state["achievements"],
        }

    async def get_public_results(self) -> dict:
        state = await self.get_public_results_data()
        settings = state["settings"]
        published = domain.timestamp(settings.get("resultsStart")) <= time() * 1000
        if not published:
            return {
                "published": False,
                "availableFrom": settings.get("resultsStart"),
                "teams": [],
            }
        users_by_team: dict[str, list[dict]] = {}
        achievements_by_user: dict[str, list[dict]] = {}
        for user in state["users"]:
            users_by_team.setdefault(user.get("teamId"), []).append(user)
        for achievement in state["achievements"]:
            achievements_by_user.setdefault(achievement.get("userId"), []).append(
                achievement
            )
        teams = []
        for team in state["teams"]:
            members = users_by_team.get(team.get("id"), [])
            if not domain.team_is_admitted(state, team, members):
                continue
            member_ids = {member.get("id") for member in members}
            score = sum(
                item.get("points") or 0
                for member_id in member_ids
                for item in achievements_by_user.get(member_id, [])
                if item.get("status") == "approved"
            )
            video = team.get("videoCard") or {}
            if video.get("status") == "approved":
                score += video.get("score") or 0
            teams.append(
                {
                    "id": team.get("id"),
                    "name": team.get("name"),
                    "group": team.get("group"),
                    "score": score,
                    "admitted": True,
                }
            )
        teams.sort(key=lambda item: (-item["score"], item["name"] or ""))
        return {
            "published": True,
            "availableFrom": settings.get("resultsStart"),
            "teams": teams,
        }

    async def get_admin_by_identity(self, email: str, phone: str = "") -> dict | None:
        state = await self.load()
        return next(
            (
                item
                for item in state["users"]
                if item.get("role") == "admin"
                and (
                    item.get("email", "").lower() == email
                    or (phone and item.get("phone") == phone)
                )
            ),
            None,
        )

    async def has_admin(self) -> bool:
        state = await self.load()
        return any(item.get("role") == "admin" for item in state["users"])

    async def get_user_by_id(self, user_id: str) -> dict | None:
        state = await self.load()
        return next(
            (item for item in state["users"] if item.get("id") == user_id), None
        )

    async def get_user_notifications(self, user_id: str) -> list[dict]:
        state = await self.load()
        user = next(
            (item for item in state["users"] if item.get("id") == user_id), None
        )
        return domain.list_notifications(state, user) if user else []

    async def get_user_uploads(self, user_id: str) -> list[dict]:
        state = await self.load()
        return [
            item for item in state.get("uploads", []) if item.get("userId") == user_id
        ]

    async def is_phone_in_use(self, phone: str, excluding_user_id: str) -> bool:
        state = await self.load()
        return any(
            item.get("id") != excluding_user_id and item.get("phone") == phone
            for item in state.get("users", [])
        )

    async def get_team_snapshot(self, team_id: str):
        state = await self.load()
        team = next(
            (item for item in state.get("teams", []) if item.get("id") == team_id), None
        )
        if not team:
            return None
        members = [
            item for item in state.get("users", []) if item.get("teamId") == team_id
        ]
        return team, members, state.get("settings", {})

    async def get_admin_overview(self):
        from ..shared.projections import admin_snapshot

        return admin_snapshot(await self.load())

    async def get_broadcast_targets(self) -> dict:
        state = await self.load()
        return {"users": state.get("users", []), "teams": state.get("teams", [])}

    async def get_admin_collection(
        self,
        resource: str,
        limit: int = 50,
        offset: int = 0,
        query: str = "",
        status: str = "all",
    ) -> dict:
        state = await self.load()
        source = {
            "users": [
                item for item in state.get("users", []) if item.get("role") != "admin"
            ],
            "teams": state.get("teams", []),
            "achievements": state.get("achievements", []),
        }.get(resource)
        if source is None:
            return {"items": [], "total": 0}
        needle = str(query or "").strip().lower()
        filtered = [
            item
            for item in source
            if (not needle or needle in str(item).lower())
            and (
                status in {"", "all"}
                or item.get("status") == status
                or item.get("identityStatus") == status
            )
        ]
        if resource == "users":
            filtered = [domain.public_user(item) for item in filtered]
        return {"items": filtered[offset : offset + limit], "total": len(filtered)}

    async def get_audit_log(self, limit: int = 200) -> list[dict]:
        return (await self.load()).get("auditLog", [])[:limit]

    async def get_referenced_upload_urls(self) -> set[str]:
        state = await self.load()
        urls = set()
        for user in state.get("users", []):
            urls.update({user.get("studentCardFile", ""), user.get("avatarUrl", "")})
        for team in state.get("teams", []):
            urls.update(
                {team.get("flagUrl", ""), (team.get("videoCard") or {}).get("url", "")}
            )
        for item in state.get("achievements", []):
            urls.add(item.get("fileUrl", ""))
        for item in state.get("uploads", []):
            urls.add(item.get("url", ""))
        return {url for url in urls if url}

    async def can_user_read_upload(self, user_id: str, url: str) -> bool:
        state = await self.load()
        user = next(
            (item for item in state["users"] if item.get("id") == user_id), None
        )
        if not user:
            return False
        if user.get("role") == "admin" or user.get("studentCardFile") == url:
            return True
        if any(
            item.get("userId") == user_id and item.get("fileUrl") == url
            for item in state["achievements"]
        ):
            return True
        if any(
            item.get("userId") == user_id and item.get("url") == url
            for item in state["uploads"]
        ):
            return True
        return any(
            item.get("id") == user.get("teamId") and item.get("flagUrl") == url
            for item in state["teams"]
        )
