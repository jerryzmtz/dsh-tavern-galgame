"""Disk cache lifecycle with temporary files; no models, server or network."""
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
TEMP = tempfile.TemporaryDirectory()
config = Path(TEMP.name) / 'config.json'
config.write_text(json.dumps({'root': TEMP.name, 'url': 'http://127.0.0.1:9883'}), encoding='utf-8')
spec = importlib.util.spec_from_file_location('cache_worker', ROOT / 'scripts/tts/serve.py')
worker = importlib.util.module_from_spec(spec)
with patch.object(sys, 'argv', ['serve.py', '--config', str(config)]):
    spec.loader.exec_module(worker)
MIB = 1024 ** 2
DAY = 86400


class VoiceCacheTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.revisions = ['a' * 64, 'b' * 64]
        self.voices = {}
        for index, revision in enumerate(self.revisions):
            cache = self.root / revision
            cache.mkdir()
            voice_id = str(index)
            self.voices[voice_id] = {'revision': revision, 'cache': cache, 'params': {},
                                     'public': {'id': voice_id, 'label': voice_id, 'state': 'ready', 'revision': revision}}
        for patcher in (patch.object(worker, 'cache_root', self.root),
                        patch.object(worker, 'voices', self.voices),
                        patch.object(worker, 'config', {})):
            patcher.start()
            self.addCleanup(patcher.stop)

    def wav(self, voice=0, key='c', size=10, age=0):
        path = self.voices[str(voice)]['cache'] / (key * 64 + '.wav')
        with path.open('wb') as output:
            output.truncate(size)
        used = time.time() - age
        os.utime(path, (used, used))
        return path

    def body(self):
        return {'voice': '0', 'revision': self.revisions[0], 'key': 'c' * 64,
                'text': 'hello', 'language': 'en'}

    def test_stale_revision_folders_removed_and_other_entries_untouched(self):
        stale = self.root / ('d' * 64)
        stale.mkdir()
        (stale / 'old.wav').write_bytes(b'old')
        empty = self.root / ('e' * 64)
        empty.mkdir()
        unrelated = self.root / 'notes'
        unrelated.mkdir()
        (unrelated / 'keep.txt').write_bytes(b'keep')
        yaml = self.root / 'infer-0.yaml'
        yaml.write_bytes(b'keep')
        hash_file = self.root / ('f' * 64)
        hash_file.write_bytes(b'keep')
        current = self.wav()
        worker.prune_cache(stale=True)
        self.assertFalse(stale.exists())
        self.assertFalse(empty.exists())
        self.assertTrue(current.exists())
        self.assertTrue(all((self.root / revision).is_dir() for revision in self.revisions))
        self.assertTrue(unrelated.is_dir())
        self.assertEqual(yaml.read_bytes(), b'keep')
        self.assertEqual(hash_file.read_bytes(), b'keep')

    def test_age_expiry_is_by_last_use_and_ignores_noncache_files(self):
        expired = self.wav(age=31 * DAY)
        recent = self.wav(voice=1, age=29 * DAY)
        unrelated = expired.parent / 'notes.wav'
        unrelated.write_bytes(b'keep')
        os.utime(unrelated, (0, 0))
        worker.prune_cache()
        self.assertFalse(expired.exists())
        self.assertTrue(recent.exists())
        self.assertTrue(unrelated.exists())

    def test_budget_is_global_lru_not_per_revision(self):
        worker.config['cacheLimitMB'] = 64
        old = self.wav(voice=1, size=40 * MIB, age=200)
        recent = self.wav(size=40 * MIB, age=100)
        worker.prune_cache()
        self.assertFalse(old.exists())
        self.assertTrue(recent.exists())
        self.assertLessEqual(sum(p.stat().st_size for p in self.root.glob('*/*.wav')), 64 * MIB)

    def test_age_expiry_precedes_budget_eviction(self):
        worker.config.update(cacheLimitMB=64, cacheMaxAgeDays=1)
        expired = self.wav(voice=1, size=40 * MIB, age=2 * DAY)
        recent = self.wav(size=40 * MIB, age=100)
        worker.prune_cache()
        self.assertFalse(expired.exists())
        self.assertTrue(recent.exists())

    def test_synthesis_hit_refreshes_mtime_without_engine(self):
        target = self.wav(age=2 * DAY)
        before = time.time()
        result = worker.synthesize(self.body())
        self.assertTrue(result['ready'])
        self.assertGreaterEqual(target.stat().st_mtime, before - 1)
        self.assertEqual(target.stat().st_size, 10)

    def test_audio_download_refreshes_mtime(self):
        target = self.wav(age=2 * DAY)
        handler = worker.Handler.__new__(worker.Handler)
        handler.path = '/audio/' + 'c' * 64
        handler.authorized = Mock(return_value=True)
        handler.send_response = Mock()
        handler.send_header = Mock()
        handler.end_headers = Mock()
        handler.wfile = io.BytesIO()
        before = time.time()
        with patch.dict(worker.state, state='ready'):
            handler.do_GET()
        self.assertGreaterEqual(target.stat().st_mtime, before - 1)
        self.assertEqual(handler.wfile.getvalue(), target.read_bytes())
        handler.send_response.assert_called_once_with(200)

    def test_hit_changes_global_eviction_order(self):
        worker.config['cacheLimitMB'] = 64
        hit = self.wav(size=40 * MIB, age=200)
        other = self.wav(voice=1, size=40 * MIB, age=100)
        worker.synthesize(self.body())
        worker.prune_cache()
        self.assertTrue(hit.exists())
        self.assertFalse(other.exists())

    def test_new_write_prunes_all_current_revisions(self):
        import numpy as np
        expired = self.wav(voice=1, age=31 * DAY)
        self.voices['0']['backend'] = 'azure'
        with patch.object(worker, 'azure_synthesize', return_value=(24000, np.ones(1024) * .1)):
            worker.synthesize(self.body())
        self.assertFalse(expired.exists())
        self.assertTrue((self.voices['0']['cache'] / ('c' * 64 + '.wav')).is_file())

    def test_startup_prunes_after_registration(self):
        stale = self.root / ('d' * 64)
        stale.mkdir()
        expired = self.wav(voice=1, age=31 * DAY)
        current = self.wav()
        parsed = [{'id': voice_id, 'label': voice_id} for voice_id in self.voices]
        registered = {key: dict(value) for key, value in self.voices.items()}
        def register(_):
            self.voices.update(registered)
        with patch.object(worker, 'definitions', return_value=(parsed, [])), \
                patch.object(worker, 'initialize_gpt', side_effect=register), \
                patch.dict(worker.state):
            worker.initialize()
            self.assertEqual(worker.state['state'], 'ready')
        self.assertFalse(stale.exists())
        self.assertFalse(expired.exists())
        self.assertTrue(current.exists())

    def test_config_defaults_and_valid_boundaries(self):
        self.assertEqual(worker.cache_settings(), (1024 * MIB, 30 * DAY))
        for limit, age in ((64, 1), (102400, 3650), (64.5, 1.5)):
            with self.subTest(limit=limit, age=age):
                worker.config.update(cacheLimitMB=limit, cacheMaxAgeDays=age)
                self.assertEqual(worker.cache_settings(), (int(limit * MIB), int(age * DAY)))

    def test_config_rejects_invalid_values(self):
        for key, invalid in (
                ('cacheLimitMB', [63, 102401, True, None, '1024', float('nan'), float('inf')]),
                ('cacheMaxAgeDays', [0, 3651, False, None, '30', float('nan'), float('inf')])):
            for value in invalid:
                with self.subTest(key=key, value=value), patch.dict(worker.config, {key: value}):
                    with self.assertRaisesRegex(ValueError, key):
                        worker.cache_settings()

    def test_invalid_config_does_not_delete_cache_on_startup(self):
        worker.config['cacheLimitMB'] = 0
        stale = self.root / ('d' * 64)
        stale.mkdir()
        with patch.object(worker, 'definitions', return_value=([], [])), \
                patch.object(worker.traceback, 'print_exc'), patch.dict(worker.state):
            worker.initialize()
            self.assertEqual(worker.state['state'], 'error')
        self.assertTrue(stale.exists())


if __name__ == '__main__':
    unittest.main()
