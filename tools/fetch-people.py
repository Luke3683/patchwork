"""Downloads the animated people the open world uses, and trims them to what the game plays.

All of them are by Quaternius, from Poly Pizza. The results are already in the repo, so
you only need this to change the set. Run it from the project folder:

    python tools/fetch-people.py
"""
import json
import os
import re
import struct
import time
import urllib.request

PEOPLE = {
    'casual': 'kZ3DmIoGip',
    'hoodie': 'gKLBoRsyKe',
    'beach': 'DojKLcO34E',
    'punk': 'BTALZymknF',
    'suit': 'sOUciDsoVV',
    'worker': 'E8079Ahx7k',
    'soldier': 'oAArCNHjFB',
    'adventurer': 'ZwF0K7WBmu',
    'formal': 'nIItLV9nxS',
    'woman2': 'qJ2gsTUBHL',
    'dress': 'zMyPlQXBzq',
    'womancasual': 'jpKRgGDxhk',
    'tanktop': 'XqzeZGB7iU',
    'punk2': 'djXoqejw6w',
}
KEEP = {'Idle', 'Idle_Neutral', 'Walk', 'Run', 'Punch_Left', 'Punch_Right', 'Kick_Right', 'HitRecieve', 'Death', 'Wave', 'Interact'}
OUT = os.path.join('assets', 'people')
AGENT = {'User-Agent': 'patchwork-game-dev'}


def fetch(url):
    request = urllib.request.Request(url, headers=AGENT)
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def read_glb(data):
    size = struct.unpack('<I', data[12:16])[0]
    doc = json.loads(data[20:20 + size])
    offset = 20 + size
    bin_size = struct.unpack('<I', data[offset:offset + 4])[0]
    return doc, data[offset + 8:offset + 8 + bin_size]


def write_glb(doc, blob):
    while len(blob) % 4:
        blob += b'\0'
    doc['buffers'] = [{'byteLength': len(blob)}]
    text = json.dumps(doc, separators=(',', ':')).encode()
    while len(text) % 4:
        text += b' '
    total = 12 + 8 + len(text) + 8 + len(blob)
    return (struct.pack('<III', 0x46546C67, 2, total)
            + struct.pack('<II', len(text), 0x4E4F534A) + text
            + struct.pack('<II', len(blob), 0x004E4942) + blob)


def trim(doc, blob):
    """Drops the animations the game never plays, and the data only they used."""
    doc['animations'] = [a for a in doc['animations'] if a['name'].split('|')[-1] in KEEP]
    used = set()
    for mesh in doc['meshes']:
        for prim in mesh['primitives']:
            used.update(prim['attributes'].values())
            if 'indices' in prim:
                used.add(prim['indices'])
    for skin in doc.get('skins', []):
        if 'inverseBindMatrices' in skin:
            used.add(skin['inverseBindMatrices'])
    for anim in doc['animations']:
        for sampler in anim['samplers']:
            used.update((sampler['input'], sampler['output']))
    # Rebuild with one tightly packed view per accessor.
    accessors, views = [], []
    out = bytearray()
    remap = {}
    for old in sorted(used):
        acc = dict(doc['accessors'][old])
        view = doc['bufferViews'][acc['bufferView']]
        comps = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[acc['type']]
        width = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}[acc['componentType']]
        stride = view.get('byteStride', comps * width)
        start = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
        raw = bytearray()
        for i in range(acc['count']):
            raw += blob[start + i * stride:start + i * stride + comps * width]
        while len(out) % 4:
            out.append(0)
        views.append({'buffer': 0, 'byteOffset': len(out), 'byteLength': len(raw)})
        out += raw
        acc['bufferView'] = len(views) - 1
        acc.pop('byteOffset', None)
        remap[old] = len(accessors)
        accessors.append(acc)
    for mesh in doc['meshes']:
        for prim in mesh['primitives']:
            prim['attributes'] = {k: remap[v] for k, v in prim['attributes'].items()}
            if 'indices' in prim:
                prim['indices'] = remap[prim['indices']]
    for skin in doc.get('skins', []):
        if 'inverseBindMatrices' in skin:
            skin['inverseBindMatrices'] = remap[skin['inverseBindMatrices']]
    for anim in doc['animations']:
        for sampler in anim['samplers']:
            sampler['input'] = remap[sampler['input']]
            sampler['output'] = remap[sampler['output']]
    doc['accessors'] = accessors
    doc['bufferViews'] = views
    return doc, bytes(out)


os.makedirs(OUT, exist_ok=True)
credits = []
total = 0
for name, model in PEOPLE.items():
    page = fetch(f'https://poly.pizza/m/{model}').decode('utf-8', 'replace')
    title = re.search(r'<title>([^<|]+)', page)
    title = title.group(1).strip() if title else name
    licence = 'CC-BY 3.0' if 'CC-BY' in page else 'CC0'
    urls = re.findall(r'https://static\.poly\.pizza/[\w-]+\.glb', page)
    doc, blob = read_glb(fetch(urls[0]))
    names = {a['name'].split('|')[-1] for a in doc.get('animations', [])}
    joints = len(doc['skins'][0]['joints']) if doc.get('skins') else 0
    tris = sum(doc['accessors'][p['indices']]['count'] // 3 for m in doc['meshes'] for p in m['primitives'])
    if joints != 62 or not {'Walk', 'Run', 'Punch_Right', 'Death'} <= names or doc.get('images'):
        print(f'{name}: skipped, a different kind of model ({joints} joints, {sorted(names)[:4]}, images {len(doc.get("images", []))})')
        continue
    data = write_glb(*trim(doc, blob))
    with open(os.path.join(OUT, f'{name}.glb'), 'wb') as f:
        f.write(data)
    total += len(data)
    credits.append(f'- {name}: "{title}" by Quaternius, {licence} (https://poly.pizza/m/{model})')
    print(f'{name}: {tris} triangles, {len(data) // 1024} KB, {licence}')
    time.sleep(1)

with open(os.path.join(OUT, 'CREDITS.md'), 'w', encoding='utf-8') as f:
    f.write('# People\n\nAll models and animations are by [Quaternius](https://quaternius.com), from [Poly Pizza](https://poly.pizza). Thank you!\n\n')
    f.write('\n'.join(credits) + '\n')
print(f'Total: {total // 1024} KB')
