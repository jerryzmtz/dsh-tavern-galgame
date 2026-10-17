"""private fork: portable model matching and reference boundary, no model or server needed."""
import base64
import copy
import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import subprocess
import unittest
import wave

spec = importlib.util.spec_from_file_location('portable', Path(__file__).resolve().parents[1] / 'scripts/tts/portable.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class PortableTests(unittest.TestCase):
    def fixture(self):
        stream = io.BytesIO()
        with wave.open(stream, 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(32000)
            w.writeframes(b'\x01\x02' * 100)
        audio = stream.getvalue()
        model = {'id': 'arbitrary-author-id', 'engine': 'gpt-sovits', 'modelVersion': 'v2ProPlus', **{k: {'sha256': c * 64} for k, c in [('gpt', 'a'), ('sovits', 'b'), ('sv', 'c')]}}
        slot = {'portableModel': p.model_key(model), 'public': {'state': 'ready'}, 'params': {'seed': 1}}
        body = {'model': model, 'text': 'figure text', 'language': 'ja', 'params': {'seed': 2, 'speed_factor': 1.2},
                'reference': {'sha256': hashlib.sha256(audio).hexdigest(), 'base64': base64.b64encode(audio).decode(), 'promptText': 'figure prompt', 'promptLanguage': 'ja'}}
        return slot, body, audio

    def test_content_only_resolution_and_figure_input(self):
        slot, body, audio = self.fixture()
        with tempfile.TemporaryDirectory() as directory:
            selected, inputs = p.materialize(body, [slot], directory)
            self.assertIs(selected, slot)
            self.assertEqual(inputs['prompt_text'], 'figure prompt')
            self.assertEqual(inputs['text'], 'figure text')
            self.assertEqual(inputs['seed'], 2)
            self.assertEqual(Path(inputs['ref_audio_path']).read_bytes(), audio)
            self.assertEqual(slot['params'], {'seed': 1})
            self.assertEqual(p.materialize(body, [slot], directory)[1], inputs)
            # private fork: the content-addressed cache file is reused as is and no partial files remain.
            self.assertEqual(sorted(f.name for f in (Path(directory) / 'portable-references').iterdir()), [Path(inputs['ref_audio_path']).name])

    def test_no_id_fallback_or_unverified_reference(self):
        slot, body, _ = self.fixture()
        for mutate in [lambda b: b['model']['gpt'].update(sha256='d' * 64), lambda b: b['reference'].update(sha256='d' * 64), lambda b: b['reference'].update(base64='bad'), lambda b: b.update(params={'url': 'http://host'}), lambda b: b.update(params={'speed_factor': 100}), lambda b: b.update(language='invalid')]:
            candidate = copy.deepcopy(body)
            mutate(candidate)
            with tempfile.TemporaryDirectory() as directory, self.assertRaises((ValueError, wave.Error)):
                p.materialize(candidate, [slot], directory)

    def test_mp3_is_decoded_only_inside_worker(self):
        slot, body, audio = self.fixture()
        encoded = subprocess.run(['ffmpeg', '-v', 'error', '-f', 'wav', '-i', 'pipe:0', '-acodec', 'libmp3lame', '-b:a', '192k', '-f', 'mp3', 'pipe:1'], input=audio, capture_output=True, check=True).stdout
        body['reference'].update(sha256=hashlib.sha256(encoded).hexdigest(), base64=base64.b64encode(encoded).decode())
        with tempfile.TemporaryDirectory() as directory:
            _, inputs = p.materialize(body, [slot], directory)
            decoded = Path(inputs['ref_audio_path']).read_bytes()
            self.assertTrue(decoded.startswith(b'RIFF'))
            with wave.open(io.BytesIO(decoded), 'rb') as w:
                self.assertEqual(w.getnchannels(), 1)
                self.assertEqual(w.getsampwidth(), 2)
                self.assertGreater(w.getnframes(), 0)
            self.assertEqual(p.materialize(body, [slot], directory)[1], inputs)
            source = Path(directory) / 'reference.mp3'
            source.write_bytes(encoded)
            slot.update(refs={'default': {'path': source, 'text': 'original', 'lang': 'ja'}})
            slot['public'].update(label='Voice', languages=['ja'])
            self.assertTrue(p.export_voice(slot)['voice']['references'][0]['file'].endswith('.mp3'))

    def test_export_is_closed_and_path_free(self):
        slot, body, audio = self.fixture()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'reference.wav'
            path.write_bytes(audio)
            slot.update(refs={'default': {'path': path, 'text': 'original', 'lang': 'ja'}})
            slot['public'].update(label='Voice', languages=['ja'])
            exported = p.export_voice(slot)
            self.assertEqual(exported['voice']['references'][0]['transcript'], 'original')
            self.assertEqual(base64.b64decode(exported['media'][body['reference']['sha256']]), audio)
            self.assertNotIn(str(path), str(exported))
            # private fork: the export names media by the bytes it carries, without a startup-digest recheck.
            changed = audio[:-2] + b'\x03\x04'
            path.write_bytes(changed)
            exported = p.export_voice(slot)
            sha = hashlib.sha256(changed).hexdigest()
            self.assertEqual(exported['voice']['references'][0]['sha256'], sha)
            self.assertEqual(base64.b64decode(exported['media'][sha]), changed)


if __name__ == '__main__':
    unittest.main()
