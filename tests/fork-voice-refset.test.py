"""Offline fixture tests; no corpus, service or paid requests."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/tts'))
import build_voice_refset as builder
import select_refset as selector


class RefsetTests(unittest.TestCase):
    def fixture(self):
        root = Path(tempfile.mkdtemp(prefix='refset-fixture-'))
        clips = []
        for i, kana in enumerate(['アイウエオ', 'カキクケコ', 'サシスセソ']):
            file = root / f'{i}.wav'
            sf.write(file, .2 * np.sin(np.arange(32000 * 4) * (i + 1) * .05), 32000, subtype='PCM_16')
            clips.append({'path': str(file), 'text': kana, 'kana': kana, 'clean': True,
                          'emotion': str(i), 'source_kind': 'game' if i < 2 else 'anime'})
        source = root / 'input.json'
        source.write_text(json.dumps({'clips': clips}), encoding='utf-8')
        return root, source, clips

    def test_dry_run_deterministic_game_priority_and_count(self):
        root, source, clips = self.fixture()
        result = builder.build(source, root / 'out', 8, True)
        self.assertFalse((root / 'out').exists())
        self.assertEqual(result['coverage']['seconds'], 8)
        pool = [selector.enrich(c) for c in clips]
        selected = selector.select(pool, 8)['clips']
        self.assertTrue(all(c['source_kind'] == 'game' for c in selected))
        self.assertEqual(selected, selector.select(list(reversed(pool)), 8)['clips'])
        self.assertEqual(len(selector.select(pool, 90, max_clips=1)['clips']), 1)

    def test_encode_hashes_transcripts_and_no_overwrite(self):
        root, source, _ = self.fixture()
        result = builder.build(source, root / 'out', 8, False)
        data = json.loads(Path(result['manifest']).read_text('utf-8'))
        self.assertEqual(len(data['references']), 2)
        for i, c in enumerate(data['clips']):
            raw = (root / 'out' / c['file']).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(), c['media'])
            self.assertEqual(sf.info(root / 'out' / c['file']).channels, 1)
            self.assertEqual((root / 'out' / f'{i+1:02d}.txt').read_text('utf-8'), c['text'])
        with self.assertRaises(builder.CliError):
            builder.build(source, root / 'out', 8, False)

    def test_reject_unreviewed_holdout_bad_hash_and_silence(self):
        root, source, clips = self.fixture()
        clips[0]['clean'] = False
        clips[1]['split'] = 'holdout'
        clips[2]['text'] = ''
        source.write_text(json.dumps({'clips': clips}), encoding='utf-8')
        with self.assertRaises(builder.CliError):
            builder.build(source, root / 'out')
        clips[0].update(clean=True, sha256='0' * 64)
        with self.assertRaises(ValueError):
            selector.enrich(clips[0])
        sf.write(root / 'silent.wav', np.zeros(32000 * 4), 32000)
        self.assertFalse(selector.select([selector.enrich({'path': str(root / 'silent.wav'), 'text': 'a', 'kana': 'ア'})], 90)['clips'])

    def test_json_errors_no_arguments_and_partial_encoder_failure(self):
        cli = ROOT / 'scripts/tts/build_voice_refset.py'
        result = subprocess.run([sys.executable, str(cli), '--json'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(json.loads(result.stdout)['outcome'], 'not_applied')
        root, source, _ = self.fixture()
        with patch.object(builder.subprocess, 'run', side_effect=[None, RuntimeError('backend private diagnostic')]), patch('sys.stdout', new_callable=io.StringIO) as out:
            status = builder.main(['--input', str(source), '--output', str(root/'partial'), '--apply', '--json'])
        self.assertEqual(status, 7)
        error = json.loads(out.getvalue())
        self.assertEqual(error['outcome'], 'partial')
        self.assertNotIn('private diagnostic', out.getvalue())


if __name__ == '__main__':
    unittest.main()
