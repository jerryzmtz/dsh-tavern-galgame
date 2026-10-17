"""Isolated voice registration checks; no worker startup, models or network."""
import ast
import contextlib
import io
import json
from pathlib import Path
import re
import tempfile
import traceback
import unittest
from unittest.mock import Mock


SOURCE = Path(__file__).resolve().parents[1] / 'scripts/tts/serve.py'


def load_definitions(config, resolve, parse_voice):
    tree = ast.parse(SOURCE.read_text(encoding='utf-8'), filename=str(SOURCE))
    # Execute only registration logic and its capacity constant, never worker startup.
    nodes = [node for node in tree.body
             if (isinstance(node, ast.FunctionDef) and node.name in ('definitions', 'initialize', 'publish'))
             or (isinstance(node, ast.Assign)
                 and any(isinstance(target, ast.Name) and target.id == 'MAX_VOICES'
                         for target in node.targets))]
    namespace = {
        'json': json, 'config': config, 'resolve': resolve, 'parse_voice': parse_voice,
        'VOICE_ID': re.compile(r'[a-z0-9][a-z0-9_-]{0,39}'),
        'VoiceError': type('VoiceError', (Exception,), {}),
        'traceback': traceback, 'hashlib': __import__('hashlib'),
        'voices': {}, 'state': {'state': 'loading', 'version': '', 'error': '', 'voices': []},
    }
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), 'exec'), namespace)
    return namespace


class VoiceCapacityTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.fixture = Path(temporary.name) / 'voices.json'
        self.parse_voice = Mock(side_effect=self.parse_entry)
        self.resolve = Mock(return_value=self.fixture)
        self.worker = load_definitions({'voices': 'fixture.json'}, self.resolve, self.parse_voice)

    @staticmethod
    def parse_entry(entry):
        if entry.get('invalid'):
            raise ValueError('invalid test voice')
        return dict(entry)

    @staticmethod
    def entries(count):
        return [{'id': 'voice-' + str(index)} for index in range(count)]

    def register(self, entries):
        self.fixture.write_text(json.dumps({'version': 1, 'voices': entries}), encoding='utf-8')
        with contextlib.redirect_stdout(io.StringIO()):
            return self.worker['definitions']()

    def test_twenty_distinct_voices_are_retained(self):
        entries = self.entries(20)
        parsed, rejected = self.register(entries)
        self.assertEqual(parsed, entries)
        self.assertEqual(rejected, [])
        self.assertEqual(self.parse_voice.call_count, 20)
        self.resolve.assert_called_once_with('fixture.json')

    def test_thirty_two_voices_are_accepted(self):
        self.assertEqual(self.worker['MAX_VOICES'], 32)
        entries = self.entries(32)
        self.assertEqual(self.register(entries), (entries, []))
        self.assertEqual(self.parse_voice.call_count, 32)

    def test_thirty_three_voices_are_rejected_before_parsing(self):
        with self.assertRaisesRegex(ValueError, r'voices file:.*32'):
            self.register(self.entries(33))
        self.parse_voice.assert_not_called()

    def test_invalid_and_duplicate_ids_are_still_skipped(self):
        entries = self.entries(20)
        mixed = [None, {}, {'id': 1}, {'id': 'Invalid ID'}, entries[0], entries[0]] + entries[1:]
        self.assertEqual(self.register(mixed), (entries, []))
        self.assertEqual(self.parse_voice.call_count, 20)

    def test_invalid_configuration_is_rejected_and_duplicate_stays_skipped(self):
        invalid = {'id': 'invalid', 'label': 'Invalid fixture', 'invalid': True}
        valid = {'id': 'valid'}
        parsed, rejected = self.register([invalid, {'id': 'invalid'}, valid])
        self.assertEqual(parsed, [valid])
        self.assertEqual(rejected, [('invalid', 'Invalid fixture')])
        self.assertEqual(self.parse_voice.call_count, 2)

    def test_oversized_registry_reports_failed_health_instead_of_loading_forever(self):
        self.fixture.write_text(json.dumps({'voices': self.entries(33)}), encoding='utf-8')
        with contextlib.redirect_stderr(io.StringIO()):
            self.worker['initialize']()
        self.assertEqual(self.worker['state']['state'], 'error')
        self.assertTrue(self.worker['state']['error'])
        self.assertEqual(self.worker['state']['voices'], [])
        self.parse_voice.assert_not_called()

    def test_non_list_voices_still_fail(self):
        with self.assertRaisesRegex(ValueError, 'must be a list'):
            self.register({'id': 'not-a-list'})
        self.parse_voice.assert_not_called()


if __name__ == '__main__':
    unittest.main()
