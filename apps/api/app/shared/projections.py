"""Organizer-facing projections kept outside core domain rules."""

from copy import deepcopy

from . import domain


def admin_team_notifications(
    state: dict, team: dict, members: list[dict]
) -> list[dict]:
    member_ids = {member.get("id") for member in members}
    selected = []
    for item in state.get("notifications", []):
        target_type, target_id = item.get("targetType"), item.get("targetId")
        if target_type == "all" or target_type == "teams":
            recipients = member_ids
            audience = "Всем участникам"
        elif (
            target_type == "captains"
            and team.get("captainId")
            and team.get("captainId") in member_ids
        ):
            recipients = {team["captainId"]}
            audience = "Всем капитанам"
        elif target_type == "team" and target_id == team.get("id"):
            recipients = member_ids
            audience = "Всей команде"
        elif (
            target_type == "captain"
            and target_id == team.get("id")
            and team.get("captainId")
        ):
            recipients = {team["captainId"]}
            audience = "Капитану команды"
        elif target_type == "user" and target_id in member_ids:
            recipients = {target_id}
            member = next(
                (entry for entry in members if entry.get("id") == target_id), None
            )
            audience = f"Участнику: {member.get('fio', 'участнику') if member else 'участнику'}"
        else:
            continue
        selected.append(
            {
                **item,
                "audience": audience,
                "unreadForTeam": any(
                    recipient and recipient not in item.get("readBy", [])
                    for recipient in recipients
                ),
            }
        )
    return selected


def admin_team_workflow(
    state: dict, team: dict, members: list[dict], achievements: list[dict]
) -> dict:
    quota = domain.team_quota(state, team)
    review = domain.team_review_state(team, members)
    captain = next(
        (member for member in members if member.get("id") == team.get("captainId")),
        None,
    )
    captain_status = captain.get("identityStatus", "pending") if captain else "pending"
    profile_fields = ("name", "group", "flag", "description")
    has_pending_profile = (
        any(review[field]["status"] == "pending" for field in profile_fields)
        or review["members"]["status"] == "pending"
    )
    has_rejected_profile = (
        any(review[field]["status"] == "rejected" for field in profile_fields)
        or review["members"]["status"] == "rejected"
    )
    has_pending_identity = any(
        member.get("identityStatus") == "pending" for member in members
    )
    has_pending_achievements = any(
        item.get("status") == "pending" for item in achievements
    )
    has_pending_video = (team.get("videoCard") or {}).get("status") == "pending"
    has_rejected = (
        any(member.get("identityStatus") == "rejected" for member in members)
        or any(item.get("status") == "rejected" for item in achievements)
        or (team.get("videoCard") or {}).get("status") == "rejected"
    )
    if captain_status == "pending":
        return {
            "key": "new",
            "label": "Не рассматривалась",
            "reason": "Сначала подтвердите статус капитана",
        }
    if captain_status == "rejected" or has_rejected or has_rejected_profile:
        return {
            "key": "needs-work",
            "label": "Нужна доработка",
            "reason": "Нужно уточнить данные капитана"
            if captain_status == "rejected"
            else "Есть замечания к данным команды",
        }
    if (
        has_pending_profile
        or has_pending_identity
        or has_pending_achievements
        or has_pending_video
    ):
        return {
            "key": "review",
            "label": "На проверке",
            "reason": "Проверьте данные команды и состав участников"
            if has_pending_profile
            else "Есть материалы, ожидающие решения",
        }
    if not quota["eligible"]:
        return {
            "key": "new",
            "label": "Новая заявка",
            "reason": f"Состав {quota['members']} из {quota['required']} для допуска",
        }
    if team.get("isQuotaConfirmed") is not True:
        return {
            "key": "review",
            "label": "На проверке",
            "reason": "Подтвердите соответствие квоте состава",
        }
    return {
        "key": "ready",
        "label": "Готово",
        "reason": "Состав подтверждён, новых решений нет",
    }


def admin_snapshot(state: dict) -> dict:
    counts = state.get("_counts", {})
    users_by_team: dict[str, list[dict]] = {}
    users_by_id = {user.get("id"): user for user in state.get("users", [])}
    achievements_by_user: dict[str, list[dict]] = {}
    for user in state.get("users", []):
        users_by_team.setdefault(user.get("teamId"), []).append(user)
    for achievement in state.get("achievements", []):
        achievements_by_user.setdefault(achievement.get("userId"), []).append(
            achievement
        )
    users = [
        domain.public_user(user)
        for user in state.get("users", [])
        if user.get("role") != "admin"
    ]
    teams = []
    for team in state.get("teams", []):
        members = [
            domain.public_user(member)
            for member in users_by_team.get(team.get("id"), [])
        ]
        member_ids = {member.get("id") for member in members}
        captain = next(
            (member for member in members if member.get("id") == team.get("captainId")),
            None,
        )
        achievements = [
            _achievement_with_user(state, item, users_by_id)
            for member_id in member_ids
            for item in achievements_by_user.get(member_id, [])
        ]
        notifications = admin_team_notifications(state, team, members)
        team_copy = deepcopy(team)
        team_copy.update(
            {
                "members": members,
                "captain": captain,
                "quota": domain.team_quota(state, team, members),
                "review": domain.team_review_state(team, members),
                "isAdmitted": domain.team_is_admitted(state, team, members),
                "achievements": achievements,
                "notifications": notifications,
                "notificationCount": len(notifications),
                "unreadNotifications": sum(
                    item["unreadForTeam"] for item in notifications
                ),
                "workflow": admin_team_workflow(state, team, members, achievements),
            }
        )
        teams.append(team_copy)
    achievements = [
        _achievement_with_user(state, item, users_by_id)
        for item in state.get("achievements", [])
    ]
    videos = [
        {
            "teamId": team.get("id"),
            "teamName": team.get("name"),
            "group": team.get("group"),
            "videoCard": team.get("videoCard")
            or {"url": "", "status": "none", "score": None, "criteriaScores": {}},
        }
        for team in state.get("teams", [])
    ]
    admin_notifications = [
        deepcopy(item)
        for item in state.get("notifications", [])
        if item.get("targetType") == "admins"
    ][:200]
    return {
        "settings": state["settings"],
        "summary": {
            "teams": counts.get("teams", len(state.get("teams", []))),
            "users": counts.get("users", len(users)),
            "achievements": counts.get("achievements", len(achievements)),
            "notifications": counts.get(
                "notifications", len(state.get("notifications", []))
            ),
            "adminNotifications": len(admin_notifications),
            "pendingAchievements": counts.get(
                "pendingAchievements",
                sum(item.get("status") == "pending" for item in achievements),
            ),
            "pendingIdentity": counts.get(
                "pendingIdentity",
                sum(item.get("identityStatus") == "pending" for item in users),
            ),
            "pendingVideos": counts.get(
                "pendingVideos",
                sum(item["videoCard"].get("status") == "pending" for item in videos),
            ),
            "unreadNotifications": sum(team["unreadNotifications"] for team in teams),
        },
        "teams": teams,
        "users": users,
        "achievements": achievements,
        "videos": videos,
        "notifications": deepcopy(state.get("notifications", []))[:200],
        "adminNotifications": admin_notifications,
        "auditLog": state.get("auditLog", [])[:100],
    }


def _achievement_with_user(
    state: dict, achievement: dict, users_by_id: dict | None = None
) -> dict:
    owner = (users_by_id or {}).get(achievement.get("userId")) or next(
        (
            user
            for user in state.get("users", [])
            if user.get("id") == achievement.get("userId")
        ),
        {"id": achievement.get("userId"), "fio": "Удалённый пользователь"},
    )
    return {**achievement, "user": domain.public_user(owner)}
