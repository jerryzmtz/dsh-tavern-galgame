import ast
import hashlib
import re
from pathlib import Path
# private fork: inspect the worker AST without importing GPU models or starting HTTP.
source = (Path(__file__).resolve().parents[1] / 'scripts/tts/serve.py').read_text(encoding='utf-8')
module = ast.parse(source)
pattern = next(node.value for node in module.body if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'VOICE_ID' for t in node.targets))
regex = eval(compile(ast.Expression(pattern), '<voice-id>', 'eval'), {'re': re})
for value in ['madoka-magica/homura_long', 'madoka-magica/homura_megane', 'mygo/soyo', 'neuro-sama/neuro', 'xiaoxiao', 'yunxi']:
    assert regex.fullmatch(value), value
for value in ['/voice', 'work/', 'work//voice', '../voice', 'work/../voice', 'work/name/more']:
    assert not regex.fullmatch(value), value
expr = next(node.value for node in ast.walk(module) if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'path' for t in node.targets) and 'infer-' in ast.unparse(node.value))
files = [eval(compile(ast.Expression(expr), '<infer-file>', 'eval'), {'cache_root': Path('cache'), 'voice': {'id': value}, 'hashlib': hashlib}) for value in ['madoka-magica/homura_long','madoka-magica_homura_long']]
assert all(file.parent == Path('cache') and file.name.startswith('infer-') and file.suffix == '.yaml' for file in files)
assert files[0] != files[1]
print('Python server voice validation and hash-only inference filenames: PASS')
