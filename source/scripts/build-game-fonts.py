"""Build local, renamed OFL web-font subsets from the official cached source fonts.

Install the optional tool only into .cache/font-tools with:
python -m pip install --target .cache/font-tools "fonttools[woff]"
The game and its normal JS build do not depend on Python.
"""
from pathlib import Path
import hashlib
import json
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / '.cache/font-tools'))
from fontTools import subset
from fontTools.ttLib import TTFont

SOURCE = ROOT / '.cache/fonts-source'
DESTINATION = ROOT / 'public/fonts'
DESTINATION.mkdir(parents=True, exist_ok=True)

characters = {chr(code) for code in range(32, 127)}
for path in (ROOT / 'src').rglob('*'):
    if path.suffix in {'.ts', '.tsx', '.css'} and 'tests' not in path.parts:
        characters.update(char for char in path.read_text(encoding='utf-8') if ord(char) >= 32)
characters.update('五阵破军威力增幅伤害武者射手术士暗客卫士刀剑长兵弓弩法器暗器庞统赵云诸葛亮关羽吕布淬旌翎戟ⅠⅡⅢ×＋－→↗∞◇✓')
chinese = {ord(char) for char in characters if '\u3400' <= char <= '\u9fff'}

specifications = [
    ('MaShanZheng-Regular.ttf', 'Pojun Brush', 'poj-brush.woff2', 'MaShanZheng-OFL.txt', 'https://github.com/google/fonts/tree/main/ofl/mashanzheng'),
    ('LXGWWenKaiLite-Regular.ttf', 'Pojun Text', 'poj-text.woff2', 'LXGWWenKai-OFL.txt', 'https://github.com/lxgw/LxgwWenKai-Lite'),
]
manifest = []
for filename, family, output, license_file, upstream in specifications:
    source = SOURCE / filename
    font = TTFont(source)
    cmap = font.getBestCmap()
    missing = sorted(chinese - set(cmap))
    if missing and family == 'Pojun Text':
        raise RuntimeError(f'{filename} lacks runtime Chinese characters: {[f"U+{code:04X}" for code in missing]}')
    options = subset.Options()
    options.name_IDs = ['*']
    options.name_languages = ['*']
    options.notdef_glyph = True
    options.notdef_outline = True
    options.recommended_glyphs = True
    tool = subset.Subsetter(options=options)
    tool.populate(unicodes={ord(char) for char in characters} & set(cmap))
    tool.subset(font)
    postscript = family.replace(' ', '') + '-Regular'
    names = {1: family, 2: 'Regular', 3: f'1.0;Pojun;{postscript}', 4: family + ' Regular', 6: postscript, 16: family, 17: 'Regular', 18: family, 25: family.replace(' ', '')}
    for entry in font['name'].names:
        if entry.nameID in names:
            entry.string = names[entry.nameID].encode(entry.getEncoding(), errors='replace')
    for name_id, value in names.items():
        font['name'].setName(value, name_id, 3, 1, 0x409)
    font.flavor = 'woff2'
    destination = DESTINATION / output
    font.save(destination)
    check = TTFont(destination)
    assert (chinese - set(missing)).issubset(check.getBestCmap()), output
    assert all(not re.search('LXGW|WenKai|MaShanZheng', entry.toUnicode(), re.I) for entry in check['name'].names if entry.nameID in names), output
    (DESTINATION / license_file).write_bytes((SOURCE / license_file).read_bytes())
    manifest.append({'family': family, 'file': output, 'bytes': destination.stat().st_size, 'glyphs': check['maxp'].numGlyphs, 'runtimeChineseCharacters': len(chinese), 'missingChineseCharacters': len(missing), 'fallbackCharacters': [chr(code) for code in missing], 'fallbackFamily': 'Pojun Text' if missing else None, 'source': upstream, 'sourceFile': filename, 'sourceSHA256': hashlib.sha256(source.read_bytes()).hexdigest(), 'license': license_file, 'modification': 'Runtime character subset, WOFF2 conversion, renamed family and PostScript names. Original copyright and OFL retained.'})

(DESTINATION / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(manifest, ensure_ascii=True, indent=2))
