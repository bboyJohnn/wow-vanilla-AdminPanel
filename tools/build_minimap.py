"""Top-down view of the world map — tiles from the minimaps of YOUR OWN WoW 1.12.1 client, like on wow.tools.

    python tools/build_minimap.py "C:\\Games\\World of Warcraft"
    (or as part of everything: python tools/build_assets.py "C:\\Games\\World of Warcraft")

The client keeps one 256×256 minimap picture per terrain square (ADT, 533⅓ yards): textures\\Minimap\\<md5>.blp;
which square is in which file is listed in textures\\Minimap\\md5translate.trs ("Azeroth\\map30_48.blp → <md5>.blp";
the first number is the column from west to east, the second the row from north to south). Square (c, r) starts
in the world at X = (32 − r)·533⅓ (north edge) and Y = (32 − c)·533⅓ (west edge).

Writes static/wow/minimap/<map>/<z>/<c>_<r>.webp — a pyramid of 256×256 tiles: z = 6 are the minimaps themselves
(64×64 squares per continent), every level below is half the size, z = 0 is the whole continent in one tile.
Single-colour squares (open sea, placeholders) are skipped — the page fills them with the sea colour. Next to them
minimap.json: which tiles exist and the frame of each continent. About 1900 tiles, 22 MB, 1–2 minutes.
Needs Python 3 and Pillow (it reads BLP).
"""
import io
import json
import os
import re
import sys
import time

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mpq import WowData  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'static', 'wow', 'minimap')
MAPS = {0: 'Azeroth', 1: 'Kalimdor'}
SEA = (0, 29, 40)                       # colour of the open sea on 1.12 minimaps
TOP = 6                                 # 2^6 = 64 squares per side
QUALITY = 78
# the minimaps themselves are already DXT1-compressed (4×4 blocks) — a second lossy pass would add its own
QUALITY_TOP = 92
BS = '\\'


def tile_names(wd):
    """md5translate.trs → {map: {(c, r): file name}}."""
    raw = wd.read(BS.join(['textures', 'Minimap', 'md5translate.trs']))
    if not raw:
        sys.exit('No textures\\Minimap\\md5translate.trs in the client — is this really a 1.12 game folder?')
    out = {m: {} for m in MAPS}
    for line in raw.decode('latin-1').splitlines():
        if '\t' not in line:
            continue
        name, md5 = line.split('\t', 1)
        for mapid, folder in MAPS.items():
            m = re.fullmatch(r'%s\\map(\d+)_(\d+)\.blp' % folder, name.strip(), re.I)
            if m:
                out[mapid][int(m.group(1)), int(m.group(2))] = md5.strip()
    return out


def save(img, path, quality=QUALITY):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, 'WEBP', quality=quality, method=5)
    return os.path.getsize(path)


def frame(tiles):
    """Frame of the continent in squares [c0, r0, c1, r1): the largest group of tiles (islands a couple of squares
    off the coast belong to it), without test scraps in a corner of the map (Kalimdor has a 3×3 one at 0_0)."""
    left, groups = set(tiles), []
    while left:
        stack, group = [left.pop()], []
        while stack:
            c, r = stack.pop()
            group.append((c, r))
            for n in [(c + dc, r + dr) for dc in range(-3, 4) for dr in range(-3, 4)]:
                if n in left:
                    left.remove(n)
                    stack.append(n)
        groups.append(group)
    main = max(groups, key=len)
    cs, rs = [c for c, _ in main], [r for _, r in main]
    return [max(0, min(cs) - 1), max(0, min(rs) - 1), min(64, max(cs) + 2), min(64, max(rs) + 2)]


def build(client):
    wd = WowData(os.path.join(client, 'Data'))
    names = tile_names(wd)
    manifest = {'tile': 256, 'top': TOP, 'yards': 1600 / 3, 'sea': '#%02x%02x%02x' % SEA, 'maps': {}}
    t0 = time.time()
    total = 0
    for mapid, folder in MAPS.items():
        level = {}
        for (c, r), md5 in sorted(names[mapid].items()):
            raw = wd.read(BS.join(['textures', 'Minimap', md5]))
            if not raw:
                continue
            img = Image.open(io.BytesIO(raw)).convert('RGB')
            if img.size != (256, 256):
                img = img.resize((256, 256), Image.LANCZOS)
            lo, hi = zip(*img.getextrema())
            if lo == hi:                                    # single colour: sea or placeholder
                continue
            level[c, r] = img
            total += save(img, os.path.join(OUT, str(mapid), str(TOP), '%d_%d.webp' % (c, r)), QUALITY_TOP)
        have = {TOP: sorted(level)}
        box = frame(level)
        print('  %s: %d tiles, frame %s, %.0f s' % (folder, len(level), box, time.time() - t0))
        for z in range(TOP - 1, -1, -1):                   # one level down: four tiles → one half the size
            up = {}
            for c, r in {(c // 2, r // 2) for c, r in level}:
                img = Image.new('RGB', (256, 256), SEA)
                for dc in (0, 1):
                    for dr in (0, 1):
                        child = level.get((c * 2 + dc, r * 2 + dr))
                        if child:
                            img.paste(child.resize((128, 128), Image.LANCZOS), (dc * 128, dr * 128))
                up[c, r] = img
                total += save(img, os.path.join(OUT, str(mapid), str(z), '%d_%d.webp' % (c, r)))
            have[z] = sorted(up)
            level = up
        manifest['maps'][str(mapid)] = {
            'name': folder, 'box': box,
            'tiles': {str(z): ['%d_%d' % cr for cr in have[z]] for z in sorted(have)},
        }
    with open(os.path.join(OUT, 'minimap.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, separators=(',', ':'))
    count = sum(len(v) for m in manifest['maps'].values() for v in m['tiles'].values())
    print('  done: %d tiles, %.1f MB, %.0f s' % (count, total / 1048576, time.time() - t0))


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args or not os.path.isdir(os.path.join(args[0], 'Data')):
        sys.exit(__doc__ + '\nGive the folder of the game client (the one with Data\\ inside).')
    build(args[0])
