"""Personal local GPT-SoVITS worker. Authenticated loopback only; never reads Tavern saves.

Voices are data-driven (docs/fork/dialogue-voice.md): the service config may name a JSON
file under "models" with model hashes and paths, without any registered voice, or an
optional "voices" export catalogue with per-mood references. The independent reference-v1
API always synthesizes from caller-supplied figure bytes, text and parameters. Shared parts stay resident; voice engines load on demand and are
evicted in LRU order within vramLimitGB. Requests never fall back to another voice.
One global lock keeps GPU work serial, including lazy loads.

Each voice names its GPT-SoVITS model version ("modelVersion", default v3). v3 voices render
through the shared BigVGAN vocoder at 24 kHz; v2ProPlus voices are full acoustic models at
their native 32 kHz, need the speaker-verification checkpoint ("sv") and never touch the v3
vocoder or a v3 base model.
"""
import argparse
import importlib.util
import contextlib
import gc
import hashlib
import math
from collections import OrderedDict
import hmac
import io
import json
import os
from pathlib import Path
import re
import shutil
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
from xml.sax.saxutils import escape, quoteattr
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MOODS = ('joy', 'anger', 'sad', 'anxious', 'calm', 'shy', 'disgust', 'love')
SLOTS = ('default',) + MOODS
VOICE_ID = re.compile(r'[a-z0-9][a-z0-9_-]{0,39}(?:/[a-z0-9][a-z0-9_-]{0,39})?')
SHA = re.compile(r'[a-f0-9]{64}')
LANGS = ('ja', 'zh', 'en')
AZURE_CREDENTIALS = Path(os.environ.get('DSH_AZURE_CREDENTIALS_FILE', str(Path(__file__).with_name('azure-speech.json'))))
AZURE_TIMEOUT = 45
# private fork: all service resources are adjacent; no Tavern repository/runtime dependency.
AZURE_CAPABILITIES = json.loads(Path(__file__).with_name('azure-voices.json').read_text(encoding='utf-8'))
# Bump for audio-affecting code changes, not cache, residency or HTTP changes.
# Keep the versioned source guard in tests/fork-voice-revision.test.py in sync.
AUDIO_PIPELINE_VERSION = 1
# Shared by every voice; part of each voice revision, so a change never serves old audio.
PARAMS = {
    'text_split_method': 'cut5', 'batch_size': 1, 'seed': 20260927,
    'top_k': 15, 'top_p': 1.0, 'temperature': 1.0, 'speed_factor': 1.0,
    'sample_steps': 32, 'super_sampling': False, 'streaming_mode': False,
    'parallel_infer': True, 'repetition_penalty': 1.35,
}
# Supported model versions. v2ProPlus has no diffusion vocoder: sample_steps and
# super_sampling do not apply, so they are neither sent nor part of its revision.
MODEL_VERSIONS = {
    'v3': {'vocoder': True, 'sv': False, 'lora': True, 'rate': 24000, 'params': PARAMS},
    'v2ProPlus': {'vocoder': False, 'sv': True, 'lora': False, 'rate': 32000,
                  'params': {k: v for k, v in PARAMS.items() if k not in ('sample_steps', 'super_sampling')}},
}
MAX_VOICES = 32

# private fork: load the pure portable boundary without changing the inference import path.
_portable_spec = importlib.util.spec_from_file_location('figure_portable', Path(__file__).with_name('portable.py'))
portable = importlib.util.module_from_spec(_portable_spec)
_portable_spec.loader.exec_module(portable)


# Text normalization changes require an AUDIO_PIPELINE_VERSION bump.
class ReadingLexicon:
    """Speech-only, single-pass longest match; the hash covers the exact shared file bytes."""
    def __init__(self, source):
        data = json.loads(source)
        self.version = data.get('version')
        entries = data.get('entries')
        if not isinstance(self.version, str) or not self.version or not isinstance(entries, list) or not entries:
            raise ValueError('Invalid reading lexicon')
        self.readings = {}
        for entry in entries:
            surface, reading = entry.get('surface'), entry.get('reading')
            if (entry.get('lang') != 'ja' or not isinstance(surface, str) or not surface
                    or not isinstance(reading, str) or not reading or surface in self.readings):
                raise ValueError('Invalid reading entry')
            self.readings[surface] = reading
        self.pattern = re.compile('|'.join(re.escape(s) for s in sorted(self.readings, key=len, reverse=True)))
        self.sha256 = hashlib.sha256(source).hexdigest()
        self.revision = self.version + ':' + self.sha256

    def apply(self, text, language):
        if language not in ('ja', 'all_ja'):
            return text
        return self.pattern.sub(lambda match: self.readings[match.group()], text)


READINGS = ReadingLexicon((Path(__file__).resolve().parent / 'readings/ja.json').read_bytes())
print('[voice-readings] version=' + READINGS.version + ' sha256=' + READINGS.sha256, flush=True)

parser = argparse.ArgumentParser()
parser.add_argument('--config', required=True)
args = parser.parse_args()
config = json.loads(Path(args.config).read_text(encoding='utf-8'))
root = Path(config['root'])
port = int(config['url'].rsplit(':', 1)[1])
cache_root = Path(config.get('cache') or root / 'tavern-cache')
state = {'state': 'loading', 'version': '', 'error': '', 'voices': []}
lock = threading.Lock()
voices = {}  # id -> verified metadata, factory, refs, cache and revision
engine_cache = None


class VoiceError(Exception):
    """User-facing error with an HTTP status; the message never contains paths."""
    def __init__(self, message, code=400):
        super().__init__(message)
        self.code = code


def cache_settings():
    values = []
    for key, default, low, high, scale in (
            ('cacheLimitMB', 1024, 64, 102400, 1024 ** 2),
            ('cacheMaxAgeDays', 30, 1, 3650, 86400)):
        raw = config.get(key, default)
        if isinstance(raw, bool) or not isinstance(raw, (int, float)) or not math.isfinite(raw) or not low <= raw <= high:
            raise ValueError(f'{key} must be a number from {low} to {high}')
        values.append(int(raw * scale))
    return tuple(values)


def prune_cache(stale=False):
    """Called under the synthesis lock; only revision directories and cache WAVs are managed."""
    limit, max_age = cache_settings()
    current = {voice['revision'] for voice in voices.values() if voice.get('revision')}
    cutoff = time.time() - max_age
    files = []
    for directory in cache_root.glob('*'):
        if not SHA.fullmatch(directory.name) or directory.is_symlink() or not directory.is_dir():
            continue
        if directory.name not in current:
            if stale:
                shutil.rmtree(directory)
            continue
        for path in directory.glob('*.wav'):
            if not re.fullmatch(r'[a-f0-9]{64}\.wav', path.name) or path.is_symlink() or not path.is_file():
                continue
            stat = path.stat()
            if stat.st_mtime < cutoff:
                path.unlink()
            else:
                files.append((stat.st_mtime, stat.st_size, path))
    total = sum(size for _, size, _ in files)
    for _, size, path in sorted(files):
        if total <= limit:
            break
        path.unlink()
        total -= size


def vram_limit(raw=12):
    if isinstance(raw, bool) or not isinstance(raw, (int, float)) or not math.isfinite(raw) or not 1 <= raw <= 64:
        raise ValueError('vramLimitGB must be a number from 1 to 64')
    return int(raw * 1024 ** 3)


class VoiceEngineCache:
    """Serial, pinned LRU. Only this cache owns private engines; factories own shared parts.

    Reserved memory includes the shared baseline and allocator slack. Unknown engines use
    a conservative initial estimate; measured deltas replace it after their first load.
    This is a residency budget, not a hard allocator cap on transient inference tensors.
    """
    def __init__(self, limit, cuda, changed=lambda: None):
        self.limit, self.cuda, self.changed = limit, cuda, changed
        self.entries = OrderedDict()
        self.pinned = set()
        self.estimates = {}
        self.mutex = threading.RLock()

    def reclaim(self):
        gc.collect()
        self.cuda.empty_cache()

    def evict(self, key):
        if key in self.pinned:
            raise VoiceError('Cannot evict an in-use voice', 503)
        entry = self.entries.pop(key)
        entry['slot']['public'].update(loaded=False, loadState='unloaded')
        del entry
        self.reclaim()
        self.changed()

    def make_room(self, extra=0):
        if self.cuda.memory_reserved() + extra <= self.limit:
            return
        self.reclaim()
        while self.cuda.memory_reserved() + extra > self.limit:
            victim = next((key for key in self.entries if key not in self.pinned), None)
            if victim is None:
                raise VoiceError('VRAM limit too small for shared parts and the requested voice', 503)
            self.evict(victim)

    @contextlib.contextmanager
    def use(self, slot):
        # Hold through inference: concurrent requests wait for the same load and engine.
        with self.mutex:
            key = slot['public']['id']
            if key not in self.entries:
                slot['public'].update(loaded=False, loadState='loading', loadError='')
                self.changed()
                started = time.monotonic()
                try:
                    self.make_room(self.estimates.get(key, 512 * 1024 ** 2))
                    before = self.cuda.memory_allocated()
                    self.entries[key] = {'engine': slot['factory'](), 'slot': slot}
                    self.cuda.synchronize()
                    self.estimates[key] = max(1, self.cuda.memory_allocated() - before)
                    self.pinned.add(key)
                    self.make_room()
                    slot['public'].update(loaded=True, loadState='loaded')
                    print('voice', key, 'loaded in %.2fs, private %.0f MiB, reserved %.0f MiB' % (
                        time.monotonic() - started, self.estimates[key] / 2**20,
                        self.cuda.memory_reserved() / 2**20), flush=True)
                except Exception:
                    self.pinned.discard(key)
                    if key in self.entries:
                        self.evict(key)
                    slot['public'].update(loaded=False, loadState='error', loadError='Voice load failed; check tavern-voice.log or vramLimitGB')
                    self.reclaim()
                    raise
                finally:
                    self.changed()
            self.entries.move_to_end(key)
            self.pinned.add(key)
            try:
                yield self.entries[key]['engine']
            finally:
                self.pinned.discard(key)

    def run(self, slot, inputs):
        try:
            with self.use(slot) as engine:
                # Keep private speech out of upstream logs, but retain load timings.
                with open(os.devnull, 'w') as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
                    return list(engine.run(inputs))
        finally:
            # Release the local reference before pruning; never move shared parts to CPU.
            engine = None
            with self.mutex:
                with contextlib.suppress(VoiceError):
                    self.make_room()


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def resolve(path):
    value = Path(str(path))
    return value if value.is_absolute() else root / value


def asset(raw, name):
    if not isinstance(raw, dict) or not isinstance(raw.get('path'), str) or not raw['path']:
        raise ValueError(name + ': path missing')
    sha = raw.get('sha256')
    if sha is not None and not (isinstance(sha, str) and SHA.fullmatch(sha)):
        raise ValueError(name + ': sha256 invalid')
    return {'path': resolve(raw['path']), 'sha256': sha}


def parse_voice(raw, model_only=False):
    """Validate one voice entry of the voices file; raises ValueError on schema problems."""
    if raw.get('engine') == 'azure':
        params = raw.get('params', raw)
        name = params.get('voiceName', '')
        if not isinstance(name, str) or not re.fullmatch(r'(ja|zh|en)-[A-Z]{2}-[A-Za-z0-9-]+Neural', name):
            raise ValueError('Azure voiceName invalid')
        language = name.split('-')[0]
        languages = raw.get('languages', [language]) if 'Multilingual' in name else [language]
        if not isinstance(languages, list) or not languages or any(lang not in LANGS for lang in languages):
            raise ValueError('Azure languages invalid')
        normalized = {'voiceName': name}
        normalized.update(azure_params(params))
        return {'id': raw['id'], 'label': str(raw.get('label') or raw['id'])[:40], 'note': str(raw.get('note') or '')[:120],
                'modelSetId': str(raw.get('modelSetId') or raw['id'])[:60], 'engine': 'azure', 'params': normalized,
                'languages': list(dict.fromkeys(languages)), 'lang': language}
    if raw.get('engine', 'gpt-sovits') != 'gpt-sovits':
        raise ValueError('engine unsupported')
    model_version = raw.get('modelVersion', 'v3')
    if model_version not in MODEL_VERSIONS:
        raise ValueError('modelVersion unsupported')
    spec = MODEL_VERSIONS[model_version]
    voice = {
        'id': raw['id'], 'label': str(raw.get('label') or raw['id'])[:40], 'note': str(raw.get('note') or '')[:120],
        'modelSetId': str(raw.get('modelSetId') or raw['id'])[:60], 'experimental': raw.get('experimental') is True,
        'modelVersion': model_version,
        'gpt': asset(raw.get('gpt'), 'gpt'), 'sovits': asset(raw.get('sovits'), 'sovits'), 'lora': None, 'sv': None, 'refs': {},
    }
    if spec['sv']:
        voice['sv'] = asset(raw.get('sv'), 'sv')
    elif raw.get('sv') is not None:
        raise ValueError('sv: only used by v2ProPlus')
    if raw.get('lora') is not None:
        if not spec['lora']:
            raise ValueError('lora: not supported for ' + model_version)
        voice['lora'] = asset(raw['lora'], 'lora')
        rank = raw['lora'].get('rank')
        if not isinstance(rank, int) or rank <= 0:
            raise ValueError('lora: rank invalid')
        voice['lora']['rank'] = rank
    references = {} if model_only else raw.get('references')
    if not isinstance(references, dict) or not model_only and 'default' not in references:
        raise ValueError('references: default missing')
    for slot, ref in references.items():
        if slot not in SLOTS:
            raise ValueError('references: unknown slot ' + str(slot)[:24])
        item = asset(ref, 'reference ' + slot)
        if not isinstance(ref.get('text'), str) or not ref['text'].strip() or ref.get('lang') not in LANGS:
            raise ValueError('reference ' + slot + ': text or lang invalid')
        item.update(text=ref['text'].strip(), lang=ref['lang'])
        voice['refs'][slot] = item
    return voice


def legacy_definitions():
    """Original single-voice setup: Homura weights and the mood map from reference-inventory.json."""
    inventory = json.loads((root / 'reference-inventory.json').read_text(encoding='utf-8'))
    prefixes = {'calm': '47_', 'love': 'ありがとう', 'sad': '40_', 'anger': 'いったい'}
    refs = {}
    for mood, prefix in prefixes.items():
        entry = next(r for r in inventory if r['name'].startswith(prefix))
        refs[mood] = {'path': entry['path'], 'text': re.sub(r'^\d+_', '', Path(entry['name']).stem).replace('_(Vocals)', ''), 'lang': 'ja'}
    refs['default'] = refs['calm']
    return [{'id': 'homura', 'label': '晓美焰', 'modelSetId': 'homura-v3',
             'gpt': {'path': str(root / 'homura/homura50.ckpt')}, 'sovits': {'path': str(root / 'homura/homura.pth')}, 'references': refs}]


def definitions():
    """Returns (parsed voices, rejected [(id, reason)])."""
    # private fork: an installed model inventory needs no registered voice/reference.
    model_only = bool(config.get('models'))
    source_key = 'models' if model_only else 'voices'
    if config.get(source_key):
        raw = json.loads(resolve(config[source_key]).read_text(encoding='utf-8'))
        entries = raw.get(source_key) if isinstance(raw, dict) else None
        if not isinstance(entries, list):
            raise ValueError('voices file: "voices" must be a list')
    else:
        entries = []
    if len(entries) > MAX_VOICES:
        raise ValueError(f'voices file: at most {MAX_VOICES} entries are supported (got {len(entries)})')
    parsed, rejected, seen = [], [], set()
    for entry in entries:
        voice_id = entry.get('id') if isinstance(entry, dict) else None
        if not isinstance(voice_id, str) or not VOICE_ID.fullmatch(voice_id) or voice_id in seen:
            print('skipping voice entry with invalid or duplicate id', flush=True)
            continue
        seen.add(voice_id)
        try:
            parsed.append(parse_voice(entry, model_only=model_only))
        except (ValueError, KeyError, TypeError, VoiceError) as error:
            print('voice', voice_id, 'config invalid:', error, flush=True)
            rejected.append((voice_id, str(entry.get('label') or voice_id)[:40]))
    return parsed, rejected


def public(voice, status, error='', revision=''):
    return {'id': voice['id'], 'label': voice['label'], 'note': voice.get('note', ''), 'modelSetId': voice.get('modelSetId', ''),
            'modelVersion': voice.get('modelVersion', ''), 'experimental': voice.get('experimental', False),
            'state': status, 'revision': revision, 'error': error,
            'engine': voice.get('engine', 'gpt-sovits'), 'languages': voice.get('languages', list(LANGS)),
            **({'params': voice['params']} if voice.get('engine') == 'azure' else {})}


def verify(voice):
    """Returns the revision. Asset identity is the pinned sha256, or the file's sha256 when the entry pins none.

    private fork: a pinned asset is a local file named by the operator's own configuration; it is not
    re-hashed on every start (model weights are hundreds of MB). Downloads and imports verify at their boundary."""
    if voice.get('engine') == 'azure':
        fingerprint = {'audioPipeline': AUDIO_PIPELINE_VERSION, 'engine': 'azure',
                       'params': voice['params'], 'styles': AZURE_CAPABILITIES.get(voice['params']['voiceName'], {}), 'format': 'riff-24khz-16bit-mono-pcm'}
        return hashlib.sha256(json.dumps(fingerprint, sort_keys=True).encode('utf-8')).hexdigest()
    items = [('gpt', voice['gpt']), ('sovits', voice['sovits'])] + ([('lora', voice['lora'])] if voice['lora'] else [])
    items += [('sv', voice['sv'])] if voice['sv'] else []
    items += [('ref:' + slot, ref) for slot, ref in sorted(voice['refs'].items())]
    for name, item in items:
        if not item['path'].is_file():
            raise FileNotFoundError(voice['id'] + ' ' + name + ' missing: ' + str(item['path']))
        if not item['sha256']:
            item['sha256'] = sha256_file(item['path'])
    fingerprint = {
        'audioPipeline': AUDIO_PIPELINE_VERSION, 'readings': READINGS.revision,
        'modelVersion': voice['modelVersion'],
        'gpt': voice['gpt']['sha256'], 'sovits': voice['sovits']['sha256'],
        'lora': [voice['lora']['sha256'], voice['lora']['rank']] if voice['lora'] else None,
        'sv': voice['sv']['sha256'] if voice['sv'] else None,
        'refs': {slot: [ref['sha256'], ref['text'], ref['lang']] for slot, ref in voice['refs'].items()},
        'params': MODEL_VERSIONS[voice['modelVersion']]['params'],
    }
    return hashlib.sha256(json.dumps(fingerprint, sort_keys=True, ensure_ascii=False).encode('utf-8')).hexdigest()


def publish(final=False):
    listed = [dict(v['public']) for v in voices.values()]
    ready = [v for v in listed if v['state'] == 'ready']
    state['voices'] = listed
    if final:
        state['version'] = hashlib.sha256(json.dumps([[v['id'], v['state'], v['revision']] for v in listed]).encode('utf-8')).hexdigest()
        if ready:
            state.update(state='ready', error='')
        else:
            state.update(state='error', error='没有可用的声音模型，请检查 tavern-voice.log 和模型文件')


def initialize():
    parsed = []
    try:
        parsed, rejected = definitions()
        vram_limit(config.get('vramLimitGB', 12))
        cache_settings()
        for voice in parsed:
            voices[voice['id']] = {'public': public(voice, 'loading')}
        for voice_id, label in rejected:
            voices[voice_id] = {'public': public({'id': voice_id, 'label': label}, 'unavailable', '声音配置无效')}
        publish()
        cache_root.mkdir(parents=True, exist_ok=True)
        for voice in parsed:
            if voice.get('engine') != 'azure':
                continue
            try:
                credentials = json.loads(AZURE_CREDENTIALS.read_text(encoding='utf-8'))
                if not isinstance(credentials.get('key'), str) or not credentials['key'].strip() or not re.fullmatch(r'[a-z0-9-]{1,40}', str(credentials.get('region', ''))):
                    raise ValueError('invalid credentials')
                revision = verify(voice)
                cache = cache_root / revision
                cache.mkdir(parents=True, exist_ok=True)
                voices[voice['id']].update(backend='azure', credentials=credentials, params=voice['params'],
                                         cache=cache, revision=revision, rate=24000, public=public(voice, 'ready', '', revision))
            except Exception:
                # Never log credentials or Azure response bodies.
                voices[voice['id']]['public'] = public(voice, 'unavailable', 'Azure 配置不可用，请检查密钥文件')
            publish()
        local = [voice for voice in parsed if voice.get('engine') != 'azure']
        if local:
            initialize_gpt(local)
        with lock:
            prune_cache(stale=True)
        publish(final=True)
    except Exception:
        traceback.print_exc()
        state.update(state='error', error='声音配置加载失败，请检查本地服务日志')


def initialize_gpt(parsed):
    global engine_cache
    try:
        limit = vram_limit(config.get('vramLimitGB', 12))
        os.environ['TORCH_FORCE_WEIGHTS_ONLY_LOAD'] = '1'
        os.environ['HF_HOME'] = str(root / 'hf-cache')
        os.chdir(root / 'GPT-SoVITS')
        sys.path[:0] = [str(root / 'GPT-SoVITS'), str(root / 'GPT-SoVITS/GPT_SoVITS')]
        import torch
        import yaml
        from utils import HParams
        torch.serialization.add_safe_globals([HParams])
        from GPT_SoVITS.TTS_infer_pack.TTS import TTS, TTS_Config
        from process_ckpt import get_sovits_version_from_path_fast, load_sovits_new
        import sv as sv_module  # same module object TTS.py imports SV from

        class Engine(TTS):
            """TTS that can borrow inference-only parts from already loaded engines:
            BERT + HuBERT (identical files and precision for every version), the vocoder
            (same version only) and the speaker-verification model (same checkpoint only).
            Borrowed parts hold no per-voice state; t2s and the acoustic model (LoRA merged
            into its own copy) stay private to each engine."""
            def __init__(self, configs, encoders=None, vocoder=None, sv_model=None, shared_only=False):
                self._shared_only = shared_only
                self._borrow = (encoders, vocoder, sv_model)
                super().__init__(configs)

            def _init_models(self):
                encoders, vocoder, sv_model = self._borrow
                if vocoder is not None:
                    self.vocoder = vocoder.vocoder
                    self.vocoder_configs = dict(vocoder.vocoder_configs)
                if sv_model is not None:
                    self.sv_model = sv_model.sv_model  # init_sv_model() keeps an existing one
                if self._shared_only:
                    spec = MODEL_VERSIONS[self.configs.version]
                    if spec['vocoder'] and vocoder is None:
                        self.init_vocoder(self.configs.version)
                    if spec['sv'] and sv_model is None:
                        self.init_sv_model()
                else:
                    self.init_t2s_weights(self.configs.t2s_weights_path)
                    self.init_vits_weights(self.configs.vits_weights_path)
                if encoders is None:
                    self.init_bert_weights(self.configs.bert_base_path)
                    self.init_cnhuhbert_weights(self.configs.cnhuhbert_base_path)
                else:
                    self.bert_tokenizer, self.bert_model = encoders.bert_tokenizer, encoders.bert_model
                    self.cnhuhbert_model = encoders.cnhuhbert_model

        def check_engine(engine, voice):
            """Refuses an engine that silently fell back to upstream defaults or took the wrong backend."""
            model_version = voice['modelVersion']
            spec = MODEL_VERSIONS[model_version]
            configs = engine.configs
            if Path(configs.t2s_weights_path) != voice['gpt']['path']:
                raise ValueError('GPT weights path was replaced by an upstream default')
            expected_vits = voice['lora']['path'] if voice['lora'] else voice['sovits']['path']
            if Path(configs.vits_weights_path) != expected_vits:
                raise ValueError('SoVITS weights path was replaced by an upstream default')
            if configs.version != model_version or bool(configs.use_vocoder) != spec['vocoder']:
                raise ValueError('engine backend does not match ' + model_version)
            rate = engine.vocoder_configs['sr'] if configs.use_vocoder else configs.sampling_rate
            if rate != spec['rate']:
                raise ValueError('unexpected output sample rate %s' % rate)
            if spec['sv']:
                if not engine.is_v2pro or engine.sv_model is None or engine.vocoder is not None:
                    raise ValueError('v2ProPlus engine lacks the speaker model or holds a vocoder')
                model = engine.sv_model.embedding_model
                if any(m.training for m in model.modules()):
                    raise ValueError('speaker model is not in eval mode')
                # Floating inference state only. The official checkpoint's 157 +inf BatchNorm
                # num_batches_tracked counters (fp16 export overflow, see the lab's
                # speaker-encoder-audit.json) are cast into int64 buffers by load_state_dict
                # and are never read in eval, so they are not floating point here.
                if not all(bool(torch.isfinite(t).all()) for t in model.state_dict().values() if t.is_floating_point()):
                    raise ValueError('speaker model has non-finite inference state')

        (root / 'GPT-SoVITS/GPT_SoVITS/pretrained_models/fast_langdetect').mkdir(exist_ok=True)
        cache_root.mkdir(parents=True, exist_ok=True)
        engine_cache = VoiceEngineCache(limit, torch.cuda, publish)
        # Sharing keys: encoders by (BERT, HuBERT) paths - every engine loads them with the same
        # device and precision; vocoder by model version; speaker model by checkpoint sha256.
        shared_encoders, shared_vocoders, shared_sv = {}, {}, {}
        for voice in parsed:
            slot = voices[voice['id']]
            try:
                revision = verify(voice)
            except Exception as error:
                print('voice', voice['id'], 'unavailable:', error, flush=True)
                slot['public'] = public(voice, 'unavailable', '模型或参考文件缺失或校验失败')
                publish()
                continue
            try:
                vits_path = voice['lora']['path'] if voice['lora'] else voice['sovits']['path']
                _, model_version, is_lora = get_sovits_version_from_path_fast(str(vits_path))
                if model_version != voice['modelVersion']:
                    raise ValueError('SoVITS file is ' + str(model_version) + ', voice entry says ' + voice['modelVersion'])
                if bool(voice['lora']) != bool(is_lora):
                    raise ValueError('SoVITS/LoRA kind does not match the voice entry')
                if voice['lora'] and load_sovits_new(str(vits_path)).get('lora_rank') != voice['lora']['rank']:
                    raise ValueError('LoRA rank does not match the voice entry')
                # Model/precision configuration changes require an AUDIO_PIPELINE_VERSION bump.
                common = {
                    'bert_base_path': 'GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large',
                    'cnhuhbert_base_path': 'GPT_SoVITS/pretrained_models/chinese-hubert-base',
                    'device': 'cuda', 'is_half': True, 'version': model_version,
                    't2s_weights_path': str(voice['gpt']['path']),
                }
                # Upstream resolves a LoRA's base from default_configs[version]; point it at the verified base.
                document = {'custom': dict(common, vits_weights_path=str(vits_path)),
                            model_version: dict(common, vits_weights_path=str(voice['sovits']['path']))}
                path = cache_root / ('infer-' + hashlib.sha256(voice['id'].encode('utf-8')).hexdigest() + '.yaml')
                path.write_text(yaml.safe_dump(document, allow_unicode=True), encoding='utf-8')
                torch.cuda.synchronize()
                encoder_key = (common['bert_base_path'], common['cnhuhbert_base_path'])
                sv_key = voice['sv']['sha256'] if voice['sv'] else None
                encoders = shared_encoders.get(encoder_key)
                vocoder = shared_vocoders.get(model_version) if MODEL_VERSIONS[model_version]['vocoder'] else None
                sv_model = shared_sv.get(sv_key) if sv_key else None
                if voice['sv']:
                    # Upstream sv.py reads this module global when it builds the speaker model.
                    sv_module.sv_path = str(voice['sv']['path'])
                # Holders have encoders/vocoder/SV only, never t2s/vits or voice prompt state.
                if encoders is None or (MODEL_VERSIONS[model_version]['vocoder'] and vocoder is None) or (sv_key and sv_model is None):
                    shared = Engine(TTS_Config(str(path)), encoders, vocoder, sv_model, shared_only=True)
                    shared_encoders.setdefault(encoder_key, shared)
                    if MODEL_VERSIONS[model_version]['vocoder']:
                        shared_vocoders.setdefault(model_version, shared)
                    if sv_key:
                        shared_sv.setdefault(sv_key, shared)
                encoders = shared_encoders[encoder_key]
                vocoder = shared_vocoders.get(model_version)
                sv_model = shared_sv.get(sv_key)
                torch.cuda.synchronize()
                print('voice', voice['id'], 'verified; shared reserved %.0f MiB' % (torch.cuda.memory_reserved() / 2**20), flush=True)

                def factory(voice=voice, path=path, encoders=encoders, vocoder=vocoder, sv_model=sv_model):
                    engine = Engine(TTS_Config(str(path)), encoders, vocoder, sv_model)
                    check_engine(engine, voice)
                    return engine

                cache = cache_root / revision
                cache.mkdir(parents=True, exist_ok=True)
                refs = {slot: {'path': str(ref['path']), 'text': ref['text'], 'lang': ref['lang']} for slot, ref in voice['refs'].items()}
                slot['portableModel'] = portable.model_key({'engine': 'gpt-sovits', 'modelVersion': model_version,
                    **{key: {'sha256': voice[key]['sha256']} for key in ('gpt', 'sovits', 'sv', 'lora') if voice.get(key)}})
                slot.update(factory=factory, refs=refs, cache=cache, revision=revision, params=MODEL_VERSIONS[model_version]['params'],
                            rate=MODEL_VERSIONS[model_version]['rate'], public={**public(voice, 'ready', '', revision),
                            'loaded': False, 'loadState': 'unloaded', 'loadError': ''})
            except Exception:
                traceback.print_exc()
                slot['public'] = public(voice, 'unavailable', '模型加载失败，请检查 tavern-voice.log')
                with contextlib.suppress(Exception):
                    torch.cuda.empty_cache()
            publish()
        publish(final=True)
    except Exception:
        traceback.print_exc()
        for voice in parsed:
            if voices[voice['id']]['public']['state'] == 'loading':
                voices[voice['id']]['public'] = public(voice, 'unavailable', '模型加载失败，请检查本地服务日志')
        publish(final=True)


# Loudness: GPT-SoVITS output level follows the reference clip (Homura's came out near -38 dBFS,
# Madoka's near -29). Bring every line to one speech level: RMS of the voiced part to -20 dBFS,
# peaks capped at -1 dBFS so nothing clips. Bump AUDIO_PIPELINE_VERSION for changes here.
TARGET_RMS_DB = -20.0
PEAK_CEILING = 10 ** (-1.0 / 20)

def normalize_loudness(audio):
    import numpy as np
    data = audio.astype(np.float32)
    if np.issubdtype(audio.dtype, np.integer):
        data = data / 32768.0
    frame = 512
    usable = len(data) // frame * frame
    if usable == 0:
        return data
    frames = data[:usable].reshape(-1, frame)
    energy = np.sqrt(np.mean(frames ** 2, axis=1))
    voiced = energy[energy > energy.max() * 0.1]
    rms = float(np.sqrt(np.mean(voiced ** 2))) if len(voiced) else float(np.sqrt(np.mean(data ** 2)))
    peak = float(np.max(np.abs(data)))
    if rms <= 1e-6 or peak <= 1e-6:
        return data
    gain = min(10 ** (TARGET_RMS_DB / 20) / rms, PEAK_CEILING / peak)
    return np.clip(data * gain, -1.0, 1.0)


def azure_params(raw):
    result = {}
    for field, maximum in (('pitch', 50), ('rate', 100)):
        value = raw.get(field, 0)
        if isinstance(value, bool) or not re.fullmatch(r'[+-]?\d+(?:\.\d+)?%?', str(value)):
            raise VoiceError('Azure 音高或语速无效')
        number = float(str(value).rstrip('%'))
        if not -50 <= number <= maximum:
            raise VoiceError('Azure 音高或语速超出范围')
        result[field] = number
    return result


# SSML/output format changes require an AUDIO_PIPELINE_VERSION bump.
def azure_synthesize(voice, text, language, mood, params):
    import soundfile as sf
    name = voice['params']['voiceName']
    locale = '-'.join(name.split('-')[:2])
    spoken = escape(text)
    if 'Multilingual' in name and language != locale.split('-')[0]:
        spoken = '<lang xml:lang=' + quoteattr({'ja': 'ja-JP', 'zh': 'zh-CN', 'en': 'en-US'}[language]) + '>' + spoken + '</lang>'
    prosody = '<prosody pitch="%+g%%" rate="%+g%%">%s</prosody>' % (params['pitch'], params['rate'], spoken)
    capability = AZURE_CAPABILITIES.get(name, {})
    style = capability.get('moodStyles', {}).get(mood)
    if style and style in capability.get('styles', []):
        prosody = '<mstts:express-as style=' + quoteattr(style) + ' styledegree="1">' + prosody + '</mstts:express-as>'
    ssml = '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang=' + quoteattr(locale) + '><voice name=' + quoteattr(name) + '>' + prosody + '</voice></speak>'
    credentials = voice['credentials']
    request = urllib.request.Request('https://' + credentials['region'] + '.tts.speech.microsoft.com/cognitiveservices/v1',
        data=ssml.encode('utf-8'), headers={'Ocp-Apim-Subscription-Key': credentials['key'], 'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm', 'User-Agent': 'DSH-Tavern-Voice'})
    try:
        with urllib.request.urlopen(request, timeout=AZURE_TIMEOUT) as response:
            data = response.read(16 * 1024 * 1024 + 1)
        if len(data) > 16 * 1024 * 1024:
            raise VoiceError('Azure 音频过大', 502)
        audio, rate = sf.read(io.BytesIO(data), dtype='float32')
    except urllib.error.HTTPError as error:
        code = error.code
        error.close()
        message = 'Azure 鉴权失败，请检查密钥和区域' if code in (401, 403) else 'Azure 请求过于频繁，请稍后重试' if code == 429 else 'Azure 服务暂时不可用' if code >= 500 else 'Azure 拒绝语音请求'
        raise VoiceError(message, code if code in (401, 403, 429) else 502) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise VoiceError('Azure 连接失败或请求超时', 504) from None
    if rate != 24000 or audio.ndim != 1:
        raise VoiceError('Azure 音频格式异常', 502)
    return rate, audio


# Inference, normalization and any future resampling changes require an AUDIO_PIPELINE_VERSION bump.
def render_audio(voice, text, language, mood, params):
    import numpy as np
    if voice.get('backend') == 'azure':
        sr, audio = azure_synthesize(voice, text, language, mood, params)
    else:
        ref = voice['refs'].get(mood if mood in MOODS else 'default') or voice['refs']['default']
        inputs = dict(voice['params'], text=READINGS.apply(text, language), text_lang='en' if language == 'en' else 'all_' + language, ref_audio_path=ref['path'],
                      prompt_text=READINGS.apply(ref['text'], ref['lang']), prompt_lang='en' if ref['lang'] == 'en' else 'all_' + ref['lang'])
        # Upstream keys prompt phones/BERT on prompt_text; pass the corrected text before that lookup.
        chunks = engine_cache.run(voice, inputs)
        if not chunks or {sr for sr, _ in chunks} != {voice['rate']}:
            raise ValueError('语音输出格式异常')
        sr = chunks[0][0]
        audio = np.concatenate([a for _, a in chunks])
    if not len(audio) or not np.isfinite(audio).all() or not np.any(audio):
        raise ValueError('语音输出为空')
    audio = normalize_loudness(audio)
    return sr, audio


def synthesize(body):
    import soundfile as sf
    voice_id = body.get('voice')
    voice = voices.get(voice_id) if isinstance(voice_id, str) else None
    if voice is None:
        raise VoiceError('未知声音：' + voice_id if isinstance(voice_id, str) and VOICE_ID.fullmatch(voice_id) else '未知声音', 404)
    info = voice['public']
    if info['state'] != 'ready':
        raise VoiceError('声音不可用：' + info['label'] + (('（' + info['error'] + '）') if info['error'] else ''), 503)
    if body.get('revision') != voice['revision']:
        raise VoiceError('声音模型已更新，请刷新后重试', 409)
    key = body.get('key', '')
    text = body.get('text', '')
    language = body.get('language')
    if not isinstance(key, str) or not re.fullmatch(r'[a-f0-9]{64}', key) or language not in LANGS or not isinstance(text, str) or not 0 < len(text) <= 1500:
        raise VoiceError('台词参数无效')
    mood = body.get('mood')
    if language not in info.get('languages', LANGS):
        raise VoiceError('该声音不支持请求的配音语言')
    params = voice['params']
    if voice.get('backend') == 'azure':
        patch = body.get('params', {})
        if not isinstance(patch, dict) or any(field not in ('pitch', 'rate') for field in patch):
            raise VoiceError('只能修改 Azure 音高和语速')
        params = azure_params({**params, **patch})
    cache = voice['cache']
    with lock:
        target = cache / (key + '.wav')
        if not target.exists():
            sr, audio = render_audio(voice, text, language, mood, params)
            part = target.with_suffix('.part')
            # Encoding changes require an AUDIO_PIPELINE_VERSION bump.
            sf.write(part, audio, sr, format='WAV', subtype='PCM_16')
            part.replace(target)
            prune_cache()
        else:
            target.touch()
    return {'ready': True, 'voice': voice_id, 'revision': voice['revision']}


# private fork: an independent figure request borrows only verified model weights, never
# the selected catalogue voice's reference, text, language, readings or parameters.
def synthesize_portable(body):
    import numpy as np
    import soundfile as sf
    with lock:
        try:
            slot, inputs = portable.materialize(body, list(voices.values()), cache_root)
        except (ValueError, TypeError, KeyError):
            raise VoiceError('Portable model, reference or parameters invalid', 400)
        chunks = engine_cache.run(slot, inputs)
        if not chunks or {sr for sr, _ in chunks} != {slot['rate']}:
            raise VoiceError('Invalid output audio', 500)
        audio = np.concatenate([a for _, a in chunks])
        if not len(audio) or not np.isfinite(audio).all() or not np.any(audio):
            raise VoiceError('Empty output audio', 500)
        output = io.BytesIO()
        sf.write(output, normalize_loudness(audio), slot['rate'], format='WAV', subtype='PCM_16')
        return output.getvalue()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def authorized(self):
        # private fork: retain the installed service config's canonical credential field.
        return not self.headers.get('Origin') and hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + config['token'])

    def send_json(self, value, code=200):
        data = json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self.authorized():
            return self.send_json({'error': 'unauthorized'}, 403)
        if self.path == '/v1/info':
            return self.send_json({**state, 'protocol': 'dsh-tts-reference-v1', 'revision': 'reference-v1:' + str(AUDIO_PIPELINE_VERSION),
                'capabilities': {'voiceKinds': ['reference'], 'referenceInput': ['bytes-v1'], 'paid': False}})
        if self.path == '/v1/voices':
            return self.send_json({'voices': [{**item, 'kind': 'reference'} for item in state['voices'] if 'default' in voices.get(item['id'], {}).get('refs', {})]})
        if state['state'] == 'ready' and re.fullmatch(r'/audio/[a-f0-9]{64}', self.path):
            name = self.path.rsplit('/', 1)[1] + '.wav'
            # Request keys include the voice ID and its audio revision.
            for voice in list(voices.values()):
                if not voice.get('cache'):
                    continue
                try:
                    with lock:
                        target = voice['cache'] / name
                        data = target.read_bytes()
                        target.touch()
                except FileNotFoundError:
                    continue
                self.send_response(200)
                self.send_header('Content-Type', 'audio/wav')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            return self.send_json({'error': '音频缓存已清理，请重新生成'}, 404)
        self.send_json({'error': 'not found'}, 404)

    def do_POST(self):
        if not self.authorized():
            return self.send_json({'error': 'unauthorized'}, 403)
        # private fork: respond before stopping the accept loop; never wait on inference.
        if self.path == '/shutdown':
            if self.headers.get('Transfer-Encoding') or self.headers.get('Content-Length', '0') != '0':
                return self.send_json({'error': 'shutdown body must be empty'}, 400)
            self.send_json({'state': 'stopping'})
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return
        if self.path not in ('/v1/synthesize', '/v1/export'):
            return self.send_json({'error': 'not found'}, 404)
        if state['state'] != 'ready':
            return self.send_json({'error': state['error'] or '模型尚未加载完成'}, 503)
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if self.headers.get('Transfer-Encoding') or not 0 < size <= (45 * 1024 * 1024 if self.path == '/v1/synthesize' else 16000):
                raise VoiceError('请求过大或为空')
            body = json.loads(self.rfile.read(size))
            if not isinstance(body, dict):
                raise VoiceError('请求格式无效')
            if self.path == '/v1/synthesize':
                spec = body.get('voice')
                if not isinstance(spec, dict) or spec.get('kind') != 'reference':
                    raise VoiceError('Reference voice required', 400)
                data = synthesize_portable({**spec, 'text': body.get('text'), 'language': body.get('language')})
                self.send_response(200)
                self.send_header('Content-Type', 'audio/wav')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            elif self.path == '/v1/export':
                slot = voices.get(body.get('voiceId'))
                if not slot or body.get('revision') != slot.get('revision'):
                    raise VoiceError('Voice revision changed', 409)
                try:
                    with lock:
                        self.send_json(portable.export_voice(slot))
                except ValueError:
                    raise VoiceError('Voice export unavailable', 409)

        except VoiceError as error:
            self.send_json({'error': str(error)}, error.code)
        except Exception:
            traceback.print_exc()
            self.send_json({'error': '合成失败，请重试或检查本地服务日志'}, 500)


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    threading.Thread(target=initialize, daemon=True).start()
    print('Tavern voice worker listening on loopback', port, flush=True)
    try:
        server.serve_forever(poll_interval=0.1)
    finally:
        server.server_close()
