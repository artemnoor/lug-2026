"""Production configuration must fail closed before any service starts."""

import unittest

from apps.api.app.config import create_config


def production_env() -> dict[str, str]:
    return {
        "NODE_ENV": "production",
        "LUG_DATABASE_PROVIDER": "postgres",
        "LUG_DATABASE_URL": "postgresql://lug:secret@db/lug",
        "LUG_DATABASE_SSL_MODE": "verify-full",
        "LUG_OPERATIONS_TOKEN": "x" * 32,
        "REDIS_URL": "redis://:secret@redis:6379/0",
        "LUG_ALLOWED_HOSTS": "lug.example.test",
        "LUG_TRUST_PROXY": "true",
        "LUG_TRUSTED_PROXY_IPS": "127.0.0.1",
        "LUG_FILE_STORAGE_PROVIDER": "s3",
        "LUG_S3_BUCKET": "lug-private",
        "LUG_S3_SERVER_SIDE_ENCRYPTION": "AES256",
        "LUG_EMAIL_MODE": "smtp",
        "LUG_EMAIL_VERIFICATION_SECRET": "y" * 32,
        "LUG_EMAIL_OUTBOX_ENCRYPTION_KEY": "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
        "LUG_SMTP_HOST": "smtp.example.test",
        "LUG_SMTP_FROM": "noreply@example.test",
        "LUG_SMTP_STARTTLS": "true",
    }


class ProductionConfigTests(unittest.TestCase):
    def test_complete_production_config_is_accepted(self) -> None:
        config = create_config(production_env())
        self.assertEqual(config.database_provider, "postgres")
        self.assertEqual(config.allowed_hosts, ("lug.example.test",))
        self.assertEqual(config.database_ssl_mode, "verify-full")
        self.assertEqual(config.s3_server_side_encryption, "AES256")

    def test_required_shared_dependencies_fail_closed(self) -> None:
        for key in (
            "LUG_DATABASE_URL",
            "LUG_DATABASE_SSL_MODE",
            "LUG_OPERATIONS_TOKEN",
            "REDIS_URL",
            "LUG_ALLOWED_HOSTS",
            "LUG_EMAIL_OUTBOX_ENCRYPTION_KEY",
            "LUG_S3_SERVER_SIDE_ENCRYPTION",
            "LUG_TRUST_PROXY",
            "LUG_TRUSTED_PROXY_IPS",
            "LUG_EMAIL_VERIFICATION_SECRET",
            "LUG_SMTP_HOST",
            "LUG_SMTP_FROM",
        ):
            with self.subTest(key=key):
                environment = production_env()
                environment.pop(key)
                with self.assertRaises(ValueError):
                    create_config(environment)

    def test_database_url_does_not_switch_test_or_development_to_postgres(self) -> None:
        config = create_config({"NODE_ENV": "test", "DATABASE_URL": "postgresql://ignored"})
        self.assertEqual(config.database_provider, "json")
        self.assertEqual(config.database_url, "")

    def test_staging_cookies_are_secure_when_https_is_required(self) -> None:
        environment = production_env()
        environment["NODE_ENV"] = "staging"
        config = create_config(environment)
        self.assertTrue(config.secure_cookies)

    def test_hardened_s3_endpoint_cannot_downgrade_to_http(self) -> None:
        environment = production_env()
        environment["LUG_S3_ENDPOINT_URL"] = "http://object-storage.internal"
        with self.assertRaises(ValueError):
            create_config(environment)

    def test_hardened_environment_cannot_log_verification_codes(self) -> None:
        environment = production_env()
        environment["LUG_EMAIL_LOG_CODE"] = "true"
        with self.assertRaises(ValueError):
            create_config(environment)


if __name__ == "__main__":
    unittest.main()
