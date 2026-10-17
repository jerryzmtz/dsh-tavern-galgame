"""private fork: exercise the production auth method with a redacted service config, without model imports."""
import ast
import hmac
from pathlib import Path
from types import SimpleNamespace
import unittest

source = Path(__file__).resolve().parents[1] / 'scripts/tts/serve.py'
tree = ast.parse(source.read_text(encoding='utf-8'))
handler = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'Handler')
method = next(node for node in handler.body if isinstance(node, ast.FunctionDef) and node.name == 'authorized')
namespace = {'config': {'token': 'test-only-redacted'}, 'hmac': hmac}
exec(compile(ast.Module(body=[method], type_ignores=[]), str(source), 'exec'), namespace)


class WorkerAuthTests(unittest.TestCase):
    def test_installed_token_field_authenticates(self):
        self.assertTrue(namespace['authorized'](SimpleNamespace(headers={'Authorization': 'Bearer test-only-redacted'})))

    def test_missing_wrong_or_browser_origin_is_denied(self):
        for headers in [{}, {'Authorization': 'Bearer wrong'}, {'Authorization': 'Bearer test-only-redacted', 'Origin': 'http://example.test'}]:
            with self.subTest(headers=headers):
                self.assertFalse(namespace['authorized'](SimpleNamespace(headers=headers)))


if __name__ == '__main__':
    unittest.main()
