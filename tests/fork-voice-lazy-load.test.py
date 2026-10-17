"""Lazy worker residency with fake CUDA and engines; no models, server or network."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
TEMP = tempfile.TemporaryDirectory()
config = Path(TEMP.name) / 'config.json'
config.write_text(json.dumps({'root': TEMP.name, 'url': 'http://127.0.0.1:9883'}), encoding='utf-8')
spec = importlib.util.spec_from_file_location('lazy_worker', ROOT / 'scripts/tts/serve.py')
worker = importlib.util.module_from_spec(spec)
with patch.object(sys, 'argv', ['serve.py', '--config', str(config)]):
    spec.loader.exec_module(worker)
GB = 1024 ** 3


class FakeCuda:
    def __init__(self):
        self.used = int(.2 * GB)  # Shared parts never belong to an engine.
        self.empty_calls = 0

    def memory_allocated(self):
        return self.used

    memory_reserved = memory_allocated

    def synchronize(self):
        pass

    def empty_cache(self):
        self.empty_calls += 1


class FakeEngine:
    def __init__(self, cuda, size):
        self.cuda, self.size = cuda, size
        cuda.used += size

    def __del__(self):
        self.cuda.used -= self.size

    def run(self, inputs):
        import numpy as np
        return [(24000, np.ones(1024, dtype=np.float32) * .1)]


class LazyLoadTest(unittest.TestCase):
    def setUp(self):
        self.cuda = FakeCuda()
        self.cache = worker.VoiceEngineCache(worker.vram_limit(1.1), self.cuda)

    def slot(self, key, size=.35):
        return {'public': {'id': key, 'state': 'ready', 'loaded': False, 'loadState': 'unloaded'},
                'factory': Mock(side_effect=lambda: FakeEngine(self.cuda, int(size * GB)))}

    def use(self, slot):
        with self.cache.use(slot):
            pass

    def test_registration_is_lazy_and_first_request_loads_once(self):
        slot = self.slot('a')
        slot['factory'].assert_not_called()
        self.use(slot)
        self.use(slot)
        slot['factory'].assert_called_once()
        self.assertTrue(slot['public']['loaded'])
        self.assertEqual(slot['public']['state'], 'ready')

    def test_lru_eviction_and_reload_keep_shared_parts(self):
        a, b, c = [self.slot(k) for k in 'abc']
        for slot in (a, b, a, c):
            self.use(slot)
        self.assertEqual(list(self.cache.entries), ['a', 'c'])
        self.assertFalse(b['public']['loaded'])
        self.assertEqual(b['public']['state'], 'ready')
        self.assertLessEqual(self.cuda.used, self.cache.limit)
        self.assertGreater(self.cuda.empty_calls, 0)
        self.use(b)
        self.assertEqual(b['factory'].call_count, 2)
        for key in list(self.cache.entries):
            self.cache.evict(key)
        self.assertEqual(self.cuda.used, int(.2 * GB))

    def test_pinned_voice_is_never_evicted(self):
        a, b, c = [self.slot(k) for k in 'abc']
        self.use(a)
        self.use(b)
        with self.cache.use(a):
            # Make A oldest, while still pinned, to exercise exclusion from victim selection.
            self.cache.entries.move_to_end('a', last=False)
            self.use(c)
            self.assertIn('a', self.cache.entries)
            self.assertNotIn('b', self.cache.entries)

    def test_concurrent_requests_wait_for_one_load(self):
        slot = self.slot('a')
        started, release = threading.Event(), threading.Event()
        def factory():
            started.set()
            self.assertTrue(release.wait(3))
            return FakeEngine(self.cuda, int(.35 * GB))
        slot['factory'].side_effect = factory
        errors, done = [], []
        def request():
            try:
                self.use(slot)
                done.append(True)
            except Exception as error:
                errors.append(error)
        threads = [threading.Thread(target=request) for _ in range(4)]
        threads[0].start()
        self.assertTrue(started.wait(3))
        for thread in threads[1:]:
            thread.start()
        time.sleep(.03)
        self.assertEqual(done, [])
        release.set()
        for thread in threads:
            thread.join(3)
            self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(len(done), 4)
        slot['factory'].assert_called_once()

    def test_oversized_engine_is_released_and_retry_is_possible(self):
        slot = self.slot('large', 1.2)
        with self.assertRaises(worker.VoiceError):
            self.use(slot)
        self.assertFalse(slot['public']['loaded'])
        self.assertEqual(slot['public']['loadState'], 'error')
        self.assertEqual(self.cuda.used, int(.2 * GB))
        self.assertEqual(self.cache.pinned, set())
        self.cache.limit = worker.vram_limit(2)
        self.use(slot)
        self.assertTrue(slot['public']['loaded'])

    def test_factory_failure_can_retry(self):
        slot = self.slot('a')
        slot['factory'].side_effect = ValueError('bad weights')
        with self.assertRaisesRegex(ValueError, 'bad weights'):
            self.use(slot)
        self.assertEqual(list(self.cache.entries), [])
        slot['factory'].side_effect = lambda: FakeEngine(self.cuda, int(.35 * GB))
        self.use(slot)
        self.assertEqual(slot['factory'].call_count, 2)

    def test_synthesis_cache_hit_needs_no_engine(self):
        with tempfile.TemporaryDirectory() as directory:
            slot = self.slot('a')
            slot.update(revision='r', params={}, cache=Path(directory))
            key = 'a' * 64
            (Path(directory) / (key + '.wav')).write_bytes(b'cached')
            with patch.dict(worker.voices, {'a': slot}), patch.object(worker, 'engine_cache', self.cache):
                result = worker.synthesize({'voice': 'a', 'revision': 'r', 'key': key, 'text': 'hello', 'language': 'en'})
            self.assertTrue(result['ready'])
            slot['factory'].assert_not_called()

    def test_synthesis_miss_loads_and_replay_after_eviction_does_not(self):
        with tempfile.TemporaryDirectory() as directory:
            slot = self.slot('a')
            slot.update(revision='r', params={}, cache=Path(directory), rate=24000,
                        refs={'default': {'path': 'unused.wav', 'text': 'hi', 'lang': 'en'}})
            body = {'voice': 'a', 'revision': 'r', 'key': 'b' * 64, 'text': 'hello', 'language': 'en'}
            with patch.dict(worker.voices, {'a': slot}), patch.object(worker, 'engine_cache', self.cache):
                worker.synthesize(body)
                self.cache.evict('a')
                worker.synthesize(body)
            slot['factory'].assert_called_once()

    def test_startup_loads_only_shared_parts_and_factories_capture_each_voice(self):
        counts = {'bert': 0, 'hubert': 0, 'sv': 0, 'gpt': 0, 'vits': 0}
        class TTS:
            def __init__(self, configs):
                self.configs = configs
                self.vocoder = self.sv_model = None
                self.vocoder_configs = {}
                self._init_models()

            def init_bert_weights(self, path):
                counts['bert'] += 1
                self.bert_model = self.bert_tokenizer = object()

            def init_cnhuhbert_weights(self, path):
                counts['hubert'] += 1
                self.cnhuhbert_model = object()

            def init_sv_model(self):
                if self.sv_model is None:
                    counts['sv'] += 1
                    self.sv_model = SimpleNamespace(embedding_model=SimpleNamespace(modules=lambda: [], state_dict=lambda: {}))

            def init_t2s_weights(self, path):
                counts['gpt'] += 1

            def init_vits_weights(self, path):
                counts['vits'] += 1
                self.init_sv_model()
                self.is_v2pro = True
                self.configs.use_vocoder = False
                self.configs.sampling_rate = 32000

        def configs(path):
            return SimpleNamespace(**json.loads(Path(path).read_text(encoding='utf-8'))['custom'])
        modules = {
            'torch': SimpleNamespace(cuda=self.cuda, serialization=SimpleNamespace(add_safe_globals=lambda _: None)),
            'yaml': SimpleNamespace(safe_dump=lambda doc, **_: json.dumps(doc)),
            'utils': SimpleNamespace(HParams=object), 'sv': SimpleNamespace(),
            'GPT_SoVITS.TTS_infer_pack.TTS': SimpleNamespace(TTS=TTS, TTS_Config=configs),
            'process_ckpt': SimpleNamespace(get_sovits_version_from_path_fast=lambda _: ('v2', 'v2ProPlus', False), load_sovits_new=Mock()),
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'GPT-SoVITS/GPT_SoVITS/pretrained_models').mkdir(parents=True)
            parsed = [{'id': key, 'label': key, 'modelVersion': 'v2ProPlus',
                       'gpt': {'path': root / (key + '.ckpt')}, 'sovits': {'path': root / (key + '.pth')},
                       'sv': {'path': root / 'sv.pth', 'sha256': 'shared-sv'}, 'lora': None, 'refs': {}} for key in 'ab']
            slots = {v['id']: {'public': worker.public(v, 'loading')} for v in parsed}
            with patch.dict(sys.modules, modules), patch.object(sys, 'path', list(sys.path)), patch.dict(worker.os.environ), patch.object(worker.os, 'chdir'), patch.object(worker, 'root', root), patch.object(worker, 'cache_root', root / 'cache'), patch.object(worker, 'voices', slots), patch.object(worker, 'verify', side_effect=lambda v: v['id']), patch.object(worker, 'engine_cache', None):
                worker.initialize_gpt(parsed)
                self.assertEqual(counts, {'bert': 1, 'hubert': 1, 'sv': 1, 'gpt': 0, 'vits': 0})
                for key in 'ab':
                    self.assertEqual(slots[key]['public']['state'], 'ready')
                    self.assertFalse(slots[key]['public']['loaded'])
                    with worker.engine_cache.use(slots[key]) as engine:
                        self.assertEqual(Path(engine.configs.t2s_weights_path), root / (key + '.ckpt'))
                self.assertEqual(counts, {'bert': 1, 'hubert': 1, 'sv': 1, 'gpt': 2, 'vits': 2})

    def test_limit_validation(self):
        self.assertEqual(worker.vram_limit(), 12 * GB)
        for valid in (1, 1.5, 12, 64):
            self.assertEqual(worker.vram_limit(valid), int(valid * GB))
        for invalid in (None, True, False, '12', 0, .99, 64.1, float('nan'), float('inf'), [], {}):
            with self.subTest(value=invalid), self.assertRaisesRegex(ValueError, 'vramLimitGB'):
                worker.vram_limit(invalid)


if __name__ == '__main__':
    unittest.main()
