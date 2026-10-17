"""CPU-only reading and worker checks. Optional actual frontend: DSH_GPT_SOVITS_ROOT."""
import ast
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

os.environ['CUDA_VISIBLE_DEVICES'] = '-1'
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SURFACE = '\u9e7f\u76ee'
READING = '\u30ab\u30ca\u30e1'
ORIGINAL = SURFACE + '\u3055\u3093'
CORRECTED = READING + '\u3055\u3093'
SOURCE = (ROOT / 'scripts/tts/readings/ja.json').read_bytes()
TEMP = tempfile.TemporaryDirectory()
config = Path(TEMP.name) / 'config.json'
config.write_text(json.dumps({'root': TEMP.name, 'url': 'http://127.0.0.1:9883', 'token': 'test'}), encoding='utf-8')
spec = importlib.util.spec_from_file_location('worker', ROOT / 'scripts/tts/serve.py')
worker = importlib.util.module_from_spec(spec)
with patch.object(sys, 'argv', ['serve.py', '--config', str(config)]):
    spec.loader.exec_module(worker)


class ReadingTest(unittest.TestCase):
    def test_language_scope_and_unchanged_characters(self):
        self.assertEqual(worker.READINGS.sha256, hashlib.sha256(SOURCE).hexdigest())
        self.assertEqual(worker.READINGS.version, 'madoka-proper-readings-v2')
        for language in ('ja', 'all_ja'):
            self.assertEqual(worker.READINGS.apply(' \n<' + ORIGINAL + '> & ' + ORIGINAL, language), ' \n<' + CORRECTED + '> & ' + CORRECTED)
            self.assertEqual(worker.READINGS.apply('Other names 123!?', language), 'Other names 123!?')
            self.assertEqual(worker.READINGS.apply(CORRECTED, language), CORRECTED)
        for language in ('zh', 'all_zh', 'en', 'yue', 'all_yue', 'ko', 'all_ko', 'auto', 'JA', 'ja-JP'):
            self.assertEqual(worker.READINGS.apply(ORIGINAL, language), ORIGINAL)

    def test_literal_longest_match_without_recursion(self):
        entries = [{'surface': s, 'reading': r, 'lang': 'ja'} for s, r in [('a', 'b'), ('ab', 'a'), ('b', 'c'), ('[x].', '$&')]]
        lexicon = worker.ReadingLexicon(json.dumps({'version': 'test', 'entries': entries}).encode())
        self.assertEqual(lexicon.apply('ab a b ab [x].', 'ja'), 'a b c a $&')
        for entries in ([], [{'surface': '', 'reading': 'x', 'lang': 'ja'}], [{'surface': 'a', 'reading': 'b', 'lang': 'en'}], [entries[0], entries[0]]):
            with self.assertRaises(ValueError):
                worker.ReadingLexicon(json.dumps({'version': 'test', 'entries': entries}).encode())

    def test_actual_worker_engine_boundary_covers_both_fields_independently(self):
        import numpy as np
        import soundfile as sf
        engine = Mock()
        engine.run.return_value = [(24000, np.ones(1024, dtype=np.float32) * .1)]
        for language in ('ja', 'zh', 'en'):
            for prompt_language in ('ja', 'zh', 'en'):
                reference = {'path': 'not-read.wav', 'text': ORIGINAL, 'lang': prompt_language}
                voice = {'public': {'state': 'ready'}, 'revision': 'test', 'params': worker.PARAMS,
                         'cache': Path(TEMP.name), 'refs': {'default': reference}, 'engine': engine, 'rate': 24000}
                body = {'voice': 'test', 'revision': 'test', 'key': 'f' * 64, 'text': ORIGINAL, 'language': language}
                # Exercise synthesize itself, but never read/write reference or output audio.
                with patch.dict(worker.voices, {'test': voice}), patch.object(sf, 'write'), patch.object(Path, 'replace'), patch.object(worker, 'engine_cache', Mock(run=lambda slot, inputs: slot['engine'].run(inputs))):
                    worker.synthesize(body)
                inputs = engine.run.call_args.args[0]
                self.assertEqual(inputs['text'], CORRECTED if language == 'ja' else ORIGINAL)
                self.assertEqual(inputs['prompt_text'], CORRECTED if prompt_language == 'ja' else ORIGINAL)
                self.assertEqual(inputs['text_lang'], 'en' if language == 'en' else 'all_' + language)
                self.assertEqual(inputs['prompt_lang'], 'en' if prompt_language == 'en' else 'all_' + prompt_language)
                self.assertEqual({k: inputs[k] for k in worker.PARAMS}, worker.PARAMS)
                self.assertEqual(body['text'], ORIGINAL)
                self.assertEqual(reference['text'], ORIGINAL)

    def test_rule_version_and_hash_change_worker_cache_revision(self):
        asset = Path(TEMP.name) / 'fake-asset.txt'
        asset.write_text('not a model or audio', encoding='utf-8')
        def voice():
            return {'id': 'test', 'modelSetId': 'test', 'modelVersion': 'v3', 'lora': None, 'sv': None,
                    'gpt': {'path': asset, 'sha256': ''}, 'sovits': {'path': asset, 'sha256': ''},
                    'refs': {'default': {'path': asset, 'sha256': '', 'text': ORIGINAL, 'lang': 'ja'}}}
        original = worker.verify(voice())
        for field in ('version', 'reading'):
            data = json.loads(SOURCE)
            if field == 'version':
                data['version'] = 'kaname-reading-v2'
            else:
                data['entries'][0]['reading'] = 'different'
            with patch.object(worker, 'READINGS', worker.ReadingLexicon(json.dumps(data).encode())):
                self.assertNotEqual(worker.verify(voice()), original)
        self.assertEqual(worker.verify(voice()), original)

    def test_legacy_azure_offline_ssml_retains_kanji(self):
        import numpy as np
        import soundfile as sf
        voice = {'params': {'voiceName': 'ja-JP-NanamiNeural'}, 'credentials': {'region': 'fake', 'key': 'fake'}}
        with patch.object(worker.urllib.request, 'urlopen', return_value=io.BytesIO(b'')) as request, patch.object(sf, 'read', return_value=(np.ones(1), 24000)):
            worker.azure_synthesize(voice, ORIGINAL + '<&>', 'ja', 'calm', {'pitch': 5, 'rate': -3})
        ssml = request.call_args.args[0].data.decode('utf-8')
        self.assertIn(ORIGINAL + '&lt;&amp;&gt;', ssml)
        self.assertIn('xml:lang="ja-JP"', ssml)
        self.assertNotIn('<sub', ssml)
        self.assertNotIn('<phoneme', ssml)


@unittest.skipUnless(os.environ.get('DSH_GPT_SOVITS_ROOT'), 'Set DSH_GPT_SOVITS_ROOT for installed CPU G2P evidence')
class ActualFrontendTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(os.environ['DSH_GPT_SOVITS_ROOT']) / 'GPT_SoVITS'
        # Importing upstream japanese.py can rebuild a dictionary. Refuse rather than write to it.
        dictionary = cls.root / 'text/ja_userdic'
        assert all(ord(ch) < 128 for ch in str(cls.root))
        assert (dictionary / 'user.dict').is_file()
        assert hashlib.md5((dictionary / 'userdict.csv').read_bytes()).hexdigest() == (dictionary / 'userdict.md5').read_text()
        sys.path.insert(0, str(cls.root))
        import pyopenjtalk
        assert all(ord(ch) < 128 for ch in pyopenjtalk.OPEN_JTALK_DICT_DIR.decode('utf-8'))
        from text.cleaner import clean_text
        from text import japanese
        cls.clean_text = staticmethod(clean_text)
        cls.japanese = japanese

    def test_exact_phonemes_and_prosody(self):
        before = self.clean_text(ORIGINAL, 'ja', version='v2')[0]
        after = self.clean_text(worker.READINGS.apply(ORIGINAL, 'ja'), 'ja', version='v2')[0]
        target = self.clean_text(CORRECTED, 'ja', version='v2')[0]
        hiragana = self.clean_text('\u304b\u306a\u3081\u3055\u3093', 'ja', version='v2')[0]
        print('frontend=' + str(self.root / 'text/japanese.py'))
        print('before=' + ' '.join(before))
        print('after=' + ' '.join(after))
        print('katakana=' + ' '.join(target))
        print('hiragana=' + ' '.join(hiragana))
        print('before_kana=' + self.japanese.pyopenjtalk.g2p(ORIGINAL, kana=True))
        print('after_kana=' + self.japanese.pyopenjtalk.g2p(CORRECTED, kana=True))
        self.assertEqual(after, target)
        self.assertNotEqual(before, after)
        self.assertIn('k a n o m e', ' '.join(p for p in before if p not in '^$#[]_?'))
        self.assertIn('k a n a m e', ' '.join(p for p in after if p not in '^$#[]_?'))
        self.assertEqual(self.japanese.g2p(CORRECTED), after)
        place = '\u898b\u6edd\u539f\u3067\u9b54\u5973\u3068\u6226\u3063\u305f'
        place_before = self.clean_text(place, 'ja', version='v2')[0]
        place_after = self.clean_text(worker.READINGS.apply(place, 'ja'), 'ja', version='v2')[0]
        place_target = self.clean_text('\u30df\u30bf\u30ad\u30cf\u30e9\u3067\u9b54\u5973\u3068\u6226\u3063\u305f', 'ja', version='v2')[0]
        print('place_before=' + ' '.join(place_before))
        print('place_after=' + ' '.join(place_after))
        self.assertEqual(place_after, place_target)
        self.assertIn('t a k i b a r a', ' '.join(p for p in place_before if p not in '^$#[]_?'))
        self.assertIn('t a k i h a r a', ' '.join(p for p in place_after if p not in '^$#[]_?'))
        for version in ('v3', 'v2ProPlus'):
            self.assertEqual(self.clean_text(CORRECTED, 'ja', version=version)[0], after)

    def test_upstream_prompt_cache_recomputes_for_processed_prompt(self):
        # Execute only the installed pipeline's real prompt-cache block, never construct TTS/models.
        path = self.root / 'TTS_infer_pack/TTS.py'
        tree = ast.parse(path.read_text(encoding='utf-8'))
        blocks = [node for node in ast.walk(tree) if isinstance(node, ast.If)
                  and ast.unparse(node.test) == 'not no_prompt_text'
                  and any(isinstance(child, ast.Compare) and ast.unparse(child).startswith("self.prompt_cache['prompt_text'] != prompt_text") for child in ast.walk(node))]
        self.assertEqual(len(blocks), 1, 'Upstream prompt cache contract changed; inspect before accepting')
        block = compile(ast.Module(body=blocks, type_ignores=[]), str(path), 'exec')
        extract = Mock(side_effect=lambda text, lang, version: (self.clean_text(text, 'ja', version)[0], 'CPU-feature-sentinel', text))
        engine = types.SimpleNamespace(prompt_cache={'prompt_text': ORIGINAL + '\u3002', 'phones': ['old-kanome']},
                                       configs=types.SimpleNamespace(version='v2'),
                                       text_preprocessor=types.SimpleNamespace(segment_and_extract_feature_for_text=extract))
        env = {'self': engine, 'no_prompt_text': False, 'prompt_text': worker.READINGS.apply(ORIGINAL, 'ja'),
               'prompt_lang': 'all_ja', 'splits': {'\u3002', '.'}, 'i18n': lambda value: value}
        with contextlib.redirect_stdout(io.StringIO()):
            exec(block, env)
            exec(block, env)
        self.assertEqual(extract.call_count, 1)
        self.assertEqual(engine.prompt_cache['prompt_text'], CORRECTED + '\u3002')
        self.assertEqual(engine.prompt_cache['phones'], self.clean_text(CORRECTED + '\u3002', 'ja', 'v2')[0])
        self.assertEqual(engine.prompt_cache['bert_features'], 'CPU-feature-sentinel')


if __name__ == '__main__':
    try:
        unittest.main()
    finally:
        TEMP.cleanup()
