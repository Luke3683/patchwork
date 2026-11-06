"""Unpacks the parts of Quaternius' Downtown City MegaKit (CC0) that the open world uses.

Download the Standard version from https://quaternius.itch.io/downtown-city-megakit, then:

    python tools/prepare-city.py path/to/Downtown_City_MegaKit.zip

The results are already in the repo, so you only need this to change the set.
"""
import io
import json
import os
import sys
import zipfile

from PIL import Image

PIECES = [
    'Building_Large_2', 'Building_Medium_2_001', 'Building_Small_1',
    'Prop_ACUnit', 'Prop_Bollard', 'Prop_Planter_Single', 'Prop_ManholeCover', 'Prop_Drain',
]
TEXTURES = {
    'T_RedBrick_BaseColor.png': 1024, 'T_RedBrick_Normal.png': 1024, 'T_RedBrick_ORM.png': 512,
    'T_Trim_BaseColor.png': 1024, 'T_Trim_Normal.png': 1024, 'T_Trim_ORM.png': 512,
    'T_MetalConcrete_BaseColor.png': 1024, 'T_MetalConcrete_Normal.png': 1024, 'T_MetalConcrete_ORM.png': 512,
    'T_Concrete_BaseColor.png': 1024, 'T_Concrete_Normal.png': 1024, 'T_Concrete_ORM.png': 512,
    'T_lit_interior_1.png': 512, 'T_lit_interior_2.png': 512, 'T_dark_interior.png': 512,
}
OUT = os.path.join('assets', 'city')
KIT = 'Exports/glTF (Godot)/'

os.makedirs(OUT, exist_ok=True)
pack = zipfile.ZipFile(sys.argv[1])
total = 0
for name in PIECES:
    doc = json.loads(pack.read(f'{KIT}{name}.gltf'))
    # The game supplies its own materials, so only their names and colors matter here.
    for material in doc.get('materials', []):
        pbr = material.get('pbrMetallicRoughness', {})
        for key in ('normalTexture', 'occlusionTexture', 'emissiveTexture'):
            material.pop(key, None)
        pbr.pop('baseColorTexture', None)
        pbr.pop('metallicRoughnessTexture', None)
    for key in ('images', 'textures', 'samplers'):
        doc.pop(key, None)
    blob = pack.read(f'{KIT}{name}.bin')
    with open(os.path.join(OUT, f'{name}.gltf'), 'w', encoding='utf-8') as f:
        json.dump(doc, f, separators=(',', ':'))
    with open(os.path.join(OUT, f'{name}.bin'), 'wb') as f:
        f.write(blob)
    total += len(blob)
    print(name, len(blob) // 1024, 'KB')

listing = {n.rsplit('/', 1)[-1]: n for n in pack.namelist() if n.startswith('Textures/') and 'Unreal' not in n}
for name, size in TEXTURES.items():
    image = Image.open(io.BytesIO(pack.read(listing[name]))).convert('RGB')
    image.thumbnail((size, size))
    path = os.path.join(OUT, name.replace('.png', '.jpg'))
    image.save(path, quality=86)
    total += os.path.getsize(path)
    print(name, image.size, os.path.getsize(path) // 1024, 'KB')

with open(os.path.join(OUT, 'CREDITS.md'), 'w', encoding='utf-8') as f:
    f.write('# City kit\n\nFrom the [Downtown City MegaKit](https://quaternius.itch.io/downtown-city-megakit) by Quaternius, CC0 (public domain). Thank you!\n')
print('Total', total // (1024 * 1024), 'MB')
