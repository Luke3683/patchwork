"""Downloads the CC0 photo textures the open world uses, from Poly Haven.

The results are already in the repo, so you only need this to change the set.
Run it from the project folder:  python tools/fetch-textures.py
"""
import json
import os
import urllib.request

TEXTURES = {
    'asphalt': 'clean_asphalt',
    'grass': 'leafy_grass',
    'rock': 'aerial_rocks_02',
    'sand': 'coast_sand_01',
    'snow': 'snow_02',
    'sidewalk': 'concrete_pavement',
    'plaster': 'painted_plaster_wall',
    'brick': 'brick_wall_001',
    'concrete': 'concrete_floor_02',
}
MAPS = {'diff': 'Diffuse', 'nor': 'nor_gl', 'rough': 'Rough'}
OUT = os.path.join('assets', 'textures')
AGENT = {'User-Agent': 'patchwork-game-dev'}


def fetch(url):
    request = urllib.request.Request(url, headers=AGENT)
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


os.makedirs(OUT, exist_ok=True)
total = 0
credits = []
for name, asset in TEXTURES.items():
    files = json.loads(fetch(f'https://api.polyhaven.com/files/{asset}'))
    info = json.loads(fetch(f'https://api.polyhaven.com/info/{asset}'))
    credits.append(f'- {name}: "{info["name"]}" by {", ".join(info["authors"])} (https://polyhaven.com/a/{asset})')
    for short, key in MAPS.items():
        entry = files[key]['1k']['jpg']
        data = fetch(entry['url'])
        path = os.path.join(OUT, f'{name}_{short}.jpg')
        with open(path, 'wb') as f:
            f.write(data)
        total += len(data)
        print(f'{path}  {len(data) // 1024} KB')

with open(os.path.join(OUT, 'CREDITS.md'), 'w', encoding='utf-8') as f:
    f.write('# Texture credits\n\nAll textures are CC0 (public domain) from [Poly Haven](https://polyhaven.com).\n\n')
    f.write('\n'.join(credits) + '\n')
print(f'Total: {total // (1024 * 1024)} MB')
