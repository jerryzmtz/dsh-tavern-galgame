"""Isolated Azure service contract checks; no credentials, network or GPU."""
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
import urllib.error

import numpy as np
import soundfile as sf

TEMP = tempfile.TemporaryDirectory()
config = Path(TEMP.name) / 'config.json'
config.write_text(json.dumps({'root': TEMP.name, 'url': 'http://127.0.0.1:9883', 'token': 'test'}), encoding='utf-8')
spec = importlib.util.spec_from_file_location('worker', Path(__file__).resolve().parents[1] / 'scripts/tts/serve.py')
worker = importlib.util.module_from_spec(spec)
with patch.object(sys, 'argv', ['serve.py', '--config', str(config)]):
    spec.loader.exec_module(worker)


class AzureTest(unittest.TestCase):
    def voice(self, name='en-US-AshleyNeural'):
        return worker.parse_voice({'id': 'test', 'engine': 'azure', 'voiceName': name, 'pitch': '+25%', 'rate': '+8%'})

    def test_capabilities_and_validation(self):
        self.assertEqual(self.voice()['languages'], ['en'])
        self.assertEqual(self.voice('zh-CN-XiaoxiaoNeural')['languages'], ['zh'])
        self.assertEqual(self.voice('ja-JP-NanamiNeural')['languages'], ['ja'])
        for params in ({'pitch': 51}, {'pitch': -51}, {'rate': 101}, {'rate': -51}, {'rate': True}):
            with self.assertRaises(worker.VoiceError):
                worker.azure_params(params)
        for capability in worker.AZURE_CAPABILITIES.values():
            self.assertTrue(set(capability['moodStyles'].values()) <= set(capability['styles']))
            self.assertTrue(set(capability['moodStyles']) <= set(worker.MOODS))
        first = self.voice()
        second = self.voice()
        second['params']['pitch'] = 26
        self.assertNotEqual(worker.verify(first), worker.verify(second))

    def test_ssml_styles_and_errors(self):
        wav = io.BytesIO()
        sf.write(wav, np.ones(2400, dtype=np.float32) * .1, 24000, format='WAV', subtype='PCM_16')
        for name, style in [('en-US-AshleyNeural', None), ('zh-CN-XiaoxiaoNeural', 'cheerful'), ('zh-CN-YunxiNeural', 'cheerful')]:
            voice = self.voice(name)
            voice['credentials'] = {'region': 'testregion', 'key': 'not-a-real-key'}
            with patch.object(worker.urllib.request, 'urlopen', return_value=io.BytesIO(wav.getvalue())) as request:
                rate, audio = worker.azure_synthesize(voice, '<hello> & hi', voice['languages'][0], 'joy', voice['params'])
                xml = request.call_args.args[0].data.decode('utf-8')
                self.assertIn('&lt;hello&gt; &amp; hi', xml)
                self.assertIn('pitch="+25%" rate="+8%"', xml)
                self.assertEqual('mstts:express-as style=' in xml, style is not None)
                self.assertEqual(request.call_args.kwargs['timeout'], 45)
                self.assertEqual(rate, 24000)
                self.assertEqual(audio.ndim, 1)
            for code in (401, 429, 500, 503):
                error = urllib.error.HTTPError('https://test', code, 'SECRET MUST NOT ESCAPE', {}, None)
                with patch.object(worker.urllib.request, 'urlopen', side_effect=error):
                    with self.assertRaises(worker.VoiceError) as result:
                        worker.azure_synthesize(voice, 'test', voice['languages'][0], 'joy', voice['params'])
                    self.assertNotIn('SECRET', str(result.exception))
                    self.assertEqual(result.exception.code, code if code < 500 else 502)
            with patch.object(worker.urllib.request, 'urlopen', side_effect=TimeoutError()):
                with self.assertRaises(worker.VoiceError) as result:
                    worker.azure_synthesize(voice, 'test', voice['languages'][0], 'joy', voice['params'])
                self.assertEqual(result.exception.code, 504)

    def test_custom_mood_is_neutral_and_clone_uses_default_reference(self):
        wav = io.BytesIO()
        raw = np.sin(np.arange(2400, dtype=np.float32) * .1) * .02
        sf.write(wav, raw, 24000, format='WAV', subtype='PCM_16')
        voice = self.voice('zh-CN-XiaoxiaoNeural')
        voice['credentials'] = {'region': 'testregion', 'key': 'not-a-real-key'}
        with patch.object(worker.urllib.request, 'urlopen', return_value=io.BytesIO(wav.getvalue())) as request:
            worker.azure_synthesize(voice, 'test', 'zh', 'spark-2_x', voice['params'])
            self.assertNotIn('mstts:express-as', request.call_args.args[0].data.decode('utf-8'))
        engine = Mock()
        engine.run.return_value = [(24000, raw)]
        default = {'path': 'default.wav', 'text': 'default transcript', 'lang': 'ja'}
        clone = {'public': {'state': 'ready', 'languages': ['ja']}, 'revision': 'clone-revision',
                 'params': {}, 'cache': Path(TEMP.name), 'refs': {'default': default, 'joy': {'path': 'joy.wav'}},
                 'engine': engine, 'rate': 24000}
        with patch.dict(worker.voices, {'custom-mood-clone': clone}), patch.object(worker, 'engine_cache', Mock(run=lambda slot, inputs: slot['engine'].run(inputs))):
            worker.synthesize({'voice': 'custom-mood-clone', 'revision': 'clone-revision', 'key': 'c' * 64,
                               'text': 'test', 'language': 'ja', 'mood': 'spark-2_x'})
        self.assertEqual(engine.run.call_args.args[0]['ref_audio_path'], 'default.wav')
        self.assertEqual(engine.run.call_args.args[0]['prompt_text'], 'default transcript')

    def test_shared_loudness_and_cache(self):
        voice = self.voice()
        revision = worker.verify(voice)
        voice.update(backend='azure', revision=revision, cache=Path(TEMP.name), public=worker.public(voice, 'ready', '', revision))
        worker.voices['test'] = voice
        raw = np.sin(np.arange(24000, dtype=np.float32) * .1) * .02
        body = {'voice': 'test', 'revision': revision, 'key': 'a' * 64, 'text': 'hello', 'language': 'en', 'mood': 'joy', 'params': {'pitch': -5, 'rate': 10}}
        with patch.object(worker, 'azure_synthesize', return_value=(24000, raw)) as synth:
            worker.synthesize(body)
            worker.synthesize(body)
            self.assertEqual(synth.call_count, 1)
            self.assertEqual(synth.call_args.args[-1], {'pitch': -5, 'rate': 10})
        audio, rate = sf.read(Path(TEMP.name) / ('a' * 64 + '.wav'))
        self.assertEqual(rate, 24000)
        self.assertAlmostEqual(20 * np.log10(np.sqrt(np.mean(audio ** 2))), -20, delta=.05)
        self.assertLessEqual(abs(audio).max(), worker.PEAK_CEILING + 1 / 32768)
        with self.assertRaises(worker.VoiceError):
            worker.synthesize({**body, 'language': 'zh'})
        with self.assertRaises(worker.VoiceError):
            worker.synthesize({**body, 'params': {'style': 'cheerful'}})


if __name__ == '__main__':
    unittest.main()
