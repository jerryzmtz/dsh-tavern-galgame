"""Audio-only cache identity and a versioned source guard; no server, models or network."""
import ast
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
WORKER_PATH = ROOT / 'scripts/tts/serve.py'
SOURCE = WORKER_PATH.read_text(encoding='utf-8')
TEMP = tempfile.TemporaryDirectory()
CONFIG = Path(TEMP.name) / 'config.json'
CONFIG.write_text(json.dumps({'root': TEMP.name, 'url': 'http://127.0.0.1:9883'}), encoding='utf-8')


def load_worker(source=SOURCE):
    spec = importlib.util.spec_from_file_location('revision_worker', WORKER_PATH)
    module = importlib.util.module_from_spec(spec)
    with patch.object(sys, 'argv', ['serve.py', '--config', str(CONFIG)]):
        exec(compile(source, str(WORKER_PATH), 'exec'), module.__dict__)
    return module


worker = load_worker()


def audio_source_hash(source):
    """Guard audio code, not HTTP handlers, disk cache or engine residency policy."""
    tree = ast.parse(source)
    functions = {'ReadingLexicon', 'normalize_loudness', 'azure_params', 'azure_synthesize', 'render_audio'}
    constants = {'MODEL_VERSIONS', 'MOODS', 'TARGET_RMS_DB', 'PEAK_CEILING'}
    nodes = [node for node in tree.body if
             isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in functions or
             isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in constants for t in node.targets)]
    # The inference precision/model configuration and WAV encoding live outside the helpers.
    initialize = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'initialize_gpt')
    common = [node for node in ast.walk(initialize) if isinstance(node, ast.Assign)
              and any(isinstance(t, ast.Name) and t.id == 'common' for t in node.targets)]
    synthesize = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'synthesize')
    encoding = [node for node in ast.walk(synthesize) if isinstance(node, ast.Expr)
                and isinstance(node.value, ast.Call) and ast.unparse(node.value.func) == 'sf.write']
    assert len(nodes) == len(functions) + len(constants) and len(common) == len(encoding) == 1
    parts = [ast.get_source_segment(source, node) for node in nodes + common + encoding]
    return hashlib.sha256('\n\n'.join(parts).encode('utf-8')).hexdigest()


# When audio code changes, bump AUDIO_PIPELINE_VERSION and ADD its reviewed hash here.
# Do not replace an existing version's hash to accept different audio under the same identity.
AUDIO_SOURCE_HASHES = {1: '05ae612ba22387e1c4d3414f4ddfc0b0bfdf187c9c406c28868016947c52397d'}


class RevisionTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        for name in ('gpt', 'sovits', 'lora', 'sv', 'default', 'joy'):
            (self.root / name).write_bytes(name.encode())

    def asset(self, name):
        return {'path': self.root / name, 'sha256': None}

    def voice(self, version='v3'):
        return {'id': 'test', 'label': 'Test', 'modelSetId': 'models', 'modelVersion': version,
                'gpt': self.asset('gpt'), 'sovits': self.asset('sovits'),
                'lora': {**self.asset('lora'), 'rank': 32} if version == 'v3' else None,
                'sv': self.asset('sv') if version == 'v2ProPlus' else None,
                'refs': {slot: {**self.asset(slot), 'text': 'reference ' + slot, 'lang': 'ja'}
                         for slot in ('default', 'joy')}}

    def azure(self):
        return {'id': 'azure', 'engine': 'azure', 'params': {'voiceName': 'ja-JP-NanamiNeural', 'pitch': 0, 'rate': 0},
                'languages': ['ja']}

    def test_non_audio_source_edits_leave_revisions_and_guard_unchanged(self):
        edits = [('# Shared by every voice;', '# Unrelated documentation.\n# Shared by every voice;'),
                 ("('cacheLimitMB', 1024,", "('cacheLimitMB', 2048,"),
                 ('self.estimates.get(key, 512 * 1024 ** 2)', 'self.estimates.get(key, 256 * 1024 ** 2)'),
                 ('def log_message(self, *_):\n        pass', 'def log_message(self, *_):\n        return None')]
        for old, new in edits:
            with self.subTest(edit=old):
                self.assertEqual(SOURCE.count(old), 1)
                changed = SOURCE.replace(old, new)
                alternate = load_worker(changed)
                # Also change the on-disk source seen by any accidental whole-file hash.
                path = self.root / 'changed-serve.py'
                path.write_text(changed, encoding='utf-8')
                alternate.__file__ = str(path)
                for voice in (self.voice(), self.voice('v2ProPlus'), self.azure()):
                    self.assertEqual(worker.verify(copy.deepcopy(voice)), alternate.verify(copy.deepcopy(voice)))
                self.assertEqual(audio_source_hash(SOURCE), audio_source_hash(changed))

    def test_model_and_reference_bytes_change_revision(self):
        for version, names in (('v3', ('gpt', 'sovits', 'lora', 'default', 'joy')),
                               ('v2ProPlus', ('gpt', 'sovits', 'sv', 'default', 'joy'))):
            for name in names:
                with self.subTest(version=version, asset=name):
                    before = worker.verify(self.voice(version))
                    path = self.root / name
                    original = path.read_bytes()
                    path.write_bytes(original + b' changed')
                    self.assertNotEqual(before, worker.verify(self.voice(version)))
                    path.write_bytes(original)

    def test_reference_text_language_slot_and_lora_rank_change_revision(self):
        original = worker.verify(self.voice())
        for field, value in (('text', 'different'), ('lang', 'en')):
            voice = self.voice()
            voice['refs']['joy'][field] = value
            self.assertNotEqual(original, worker.verify(voice))
        voice = self.voice()
        voice['refs']['sad'] = voice['refs'].pop('joy')
        self.assertNotEqual(original, worker.verify(voice))
        voice = self.voice()
        voice['lora']['rank'] = 64
        self.assertNotEqual(original, worker.verify(voice))
        voice['lora'] = None
        self.assertNotEqual(original, worker.verify(voice))

    def test_model_version_and_effective_params_change_revision(self):
        voice = self.voice()
        original = worker.verify(copy.deepcopy(voice))
        # Isolate the version itself from its normally different parameters/assets.
        with patch.dict(worker.MODEL_VERSIONS, {'other-version': worker.MODEL_VERSIONS['v3']}):
            voice['modelVersion'] = 'other-version'
            self.assertNotEqual(original, worker.verify(voice))
        for version in ('v3', 'v2ProPlus'):
            original = worker.verify(self.voice(version))
            with patch.dict(worker.MODEL_VERSIONS[version]['params'], {'temperature': 0.5}):
                self.assertNotEqual(original, worker.verify(self.voice(version)))
        original = worker.verify(self.voice('v2ProPlus'))
        with patch.dict(worker.PARAMS, {'sample_steps': 64, 'super_sampling': True}):
            self.assertEqual(original, worker.verify(self.voice('v2ProPlus')))

    def test_readings_change_local_but_not_azure_revision(self):
        local, azure = worker.verify(self.voice()), worker.verify(self.azure())
        with patch.object(worker.READINGS, 'revision', 'different-lexicon'):
            self.assertNotEqual(local, worker.verify(self.voice()))
            self.assertEqual(azure, worker.verify(self.azure()))

    def test_pipeline_version_changes_all_backends(self):
        for voice in (self.voice(), self.voice('v2ProPlus'), self.azure()):
            original = worker.verify(copy.deepcopy(voice))
            with patch.object(worker, 'AUDIO_PIPELINE_VERSION', worker.AUDIO_PIPELINE_VERSION + 1):
                self.assertNotEqual(original, worker.verify(copy.deepcopy(voice)))

    def test_azure_voice_params_and_styles_change_revision(self):
        original = worker.verify(self.azure())
        for field, value in (('voiceName', 'ja-JP-KeitaNeural'), ('pitch', 5), ('rate', -10)):
            voice = self.azure()
            voice['params'][field] = value
            self.assertNotEqual(original, worker.verify(voice))
        with patch.dict(worker.AZURE_CAPABILITIES, {'ja-JP-NanamiNeural': {'styles': ['cheerful'], 'moodStyles': {'joy': 'cheerful'}}}):
            self.assertNotEqual(original, worker.verify(self.azure()))

    def test_metadata_paths_and_operational_settings_do_not_change_revision(self):
        for voice in (self.voice(), self.voice('v2ProPlus'), self.azure()):
            original = worker.verify(copy.deepcopy(voice))
            voice.update(id='renamed', label='New label', note='New note', modelSetId='renamed-models', experimental=True)
            for item in [voice[k] for k in ('gpt', 'sovits', 'lora', 'sv') if voice.get(k)] + list(voice.get('refs', {}).values()):
                relocated = item['path'].with_suffix('.copy')
                relocated.write_bytes(item['path'].read_bytes())
                item['path'] = relocated
            with patch.dict(worker.config, {'cacheLimitMB': 2048, 'cacheMaxAgeDays': 2, 'vramLimitGB': 8}):
                self.assertEqual(original, worker.verify(voice))

    def test_pinned_asset_identity_and_missing_assets(self):
        # private fork: a pinned sha256 is the asset identity; the local file is not re-hashed on start.
        voice = self.voice()
        voice['gpt']['sha256'] = '0' * 64
        pinned = worker.verify(voice)
        self.assertEqual(voice['gpt']['sha256'], '0' * 64)
        self.assertNotEqual(pinned, worker.verify(self.voice()))
        repinned = self.voice()
        repinned['gpt']['sha256'] = '1' * 64
        self.assertNotEqual(pinned, worker.verify(repinned))
        voice = self.voice()
        voice['gpt']['path'] = self.root / 'missing'
        with self.assertRaises(FileNotFoundError):
            worker.verify(voice)

    def test_audio_source_matches_pipeline_version(self):
        self.assertIn(worker.AUDIO_PIPELINE_VERSION, AUDIO_SOURCE_HASHES,
                      'Add the reviewed source hash for the new AUDIO_PIPELINE_VERSION')
        self.assertEqual(audio_source_hash(SOURCE), AUDIO_SOURCE_HASHES[worker.AUDIO_PIPELINE_VERSION],
                         'Audio code changed: bump AUDIO_PIPELINE_VERSION and add its reviewed source hash')

    def test_guard_detects_audio_changes(self):
        for old, new in (('frame = 512', 'frame = 256'), ('TARGET_RMS_DB = -20.0', 'TARGET_RMS_DB = -19.0'),
                         # private fork: target the legacy cache encoder; portable synthesis has its own encoder.
                         ("text_lang='en'", "text_lang='zh'"), ("sf.write(part, audio, sr, format='WAV', subtype='PCM_16')", "sf.write(part, audio, sr, format='WAV', subtype='PCM_24')"),
                         ("'is_half': True", "'is_half': False"), ("self.readings[match.group()]", "match.group()")):
            with self.subTest(edit=old):
                self.assertEqual(SOURCE.count(old), 1)
                self.assertNotEqual(audio_source_hash(SOURCE), audio_source_hash(SOURCE.replace(old, new)))

    def test_publication_and_stale_request_use_the_same_revision(self):
        voice = self.voice()
        revision = worker.verify(voice)
        info = worker.public(voice, 'ready', revision=revision)
        slot = {'revision': revision, 'public': info, 'cache': self.root / revision, 'params': worker.PARAMS}
        slot['cache'].mkdir()
        key = 'a' * 64
        (slot['cache'] / (key + '.wav')).write_bytes(b'cached')
        body = {'voice': voice['id'], 'revision': revision, 'text': 'hello', 'language': 'en', 'key': key}
        with patch.dict(worker.voices, {voice['id']: slot}, clear=True), patch.dict(worker.state):
            worker.publish(final=True)
            self.assertEqual(worker.state['voices'][0]['revision'], revision)
            with patch.object(worker, 'render_audio', side_effect=AssertionError('cache hit rendered')):
                self.assertEqual(worker.synthesize(body)['revision'], revision)
            body['revision'] = '0' * 64
            with self.assertRaises(worker.VoiceError) as error:
                worker.synthesize(body)
            self.assertEqual(error.exception.code, 409)


if __name__ == '__main__':
    try:
        unittest.main()
    finally:
        TEMP.cleanup()
