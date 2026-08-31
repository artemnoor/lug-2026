import unittest

from apps.api.app.config import create_config


class ConfigTests(unittest.TestCase):
    def test_lug_env_is_canonical_for_python_configuration(self):
        config = create_config({"LUG_ENV": "test", "NODE_ENV": "production"})
        self.assertEqual(config.node_env, "test")
        self.assertEqual(config.database_provider, "json")

    def test_production_requires_explicit_operational_dependencies(self):
        with self.assertRaises(ValueError):
            create_config({"LUG_ENV": "production"})
