"""Process-local and Redis-backed fixed-window rate limiting."""

import time
from typing import Any

from fastapi import Request

from .auth import request_address


class MemoryRateLimiter:
    store_name = "memory"

    def __init__(self, trust_proxy: bool, trusted_proxy_ips: tuple[str, ...]) -> None:
        self.trust_proxy = trust_proxy
        self.trusted_proxy_ips = trusted_proxy_ips
        self.buckets: dict[str, tuple[float, int]] = {}

    async def check(
        self, request: Request, key: str, limit: int, window: int = 60
    ) -> dict[str, Any]:
        bucket_key = f"{key}:{request_address(request, self.trust_proxy, self.trusted_proxy_ips)}"
        started, count = self.buckets.get(bucket_key, (time.monotonic(), 0))
        if time.monotonic() - started >= window:
            started, count = time.monotonic(), 0
        count += 1
        self.buckets[bucket_key] = (started, count)
        if len(self.buckets) > 10_000:
            self.buckets = {
                key: value
                for key, value in self.buckets.items()
                if time.monotonic() - value[0] < window
            }
        return {
            "allowed": count <= limit,
            "retryAfter": max(1, int(window - (time.monotonic() - started))),
            "store": self.store_name,
        }

    async def close(self) -> None:
        return None

    async def ready(self) -> bool:
        return True


class RedisRateLimiter:
    store_name = "redis"

    def __init__(
        self, client: Any, trust_proxy: bool, trusted_proxy_ips: tuple[str, ...]
    ) -> None:
        self.client = client
        self.trust_proxy = trust_proxy
        self.trusted_proxy_ips = trusted_proxy_ips

    async def check(
        self, request: Request, key: str, limit: int, window: int = 60
    ) -> dict[str, Any]:
        address = (
            request_address(request, self.trust_proxy, self.trusted_proxy_ips)
            .replace(".", "_")
            .replace(":", "_")
        )
        bucket = f"lug:rate:{key}:{address}"
        count = await self.client.incr(bucket)
        if count == 1:
            await self.client.expire(bucket, window)
        return {
            "allowed": count <= limit,
            "retryAfter": window,
            "store": self.store_name,
        }

    async def close(self) -> None:
        await self.client.aclose()

    async def ready(self) -> bool:
        return bool(await self.client.ping())


async def create_rate_limiter(
    redis_url: str, trust_proxy: bool, trusted_proxy_ips: tuple[str, ...]
) -> MemoryRateLimiter | RedisRateLimiter:
    if not redis_url:
        return MemoryRateLimiter(trust_proxy, trusted_proxy_ips)
    from redis.asyncio import Redis

    client = Redis.from_url(redis_url, decode_responses=True)
    await client.ping()
    return RedisRateLimiter(client, trust_proxy, trusted_proxy_ips)
