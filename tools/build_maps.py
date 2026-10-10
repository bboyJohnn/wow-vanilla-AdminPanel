"""World map images for the map teleport — from YOUR OWN WoW 1.12.1 client (the server has no client).

    python tools/build_maps.py "C:\\Games\\World of Warcraft"          — images + JSON
    python tools/build_maps.py "C:\\Games\\World of Warcraft" --json   — JSON only

Writes static/wow/maps/<Name>.webp (1002×668, like the in-game map window) and static/wow/maps/maps.json:
the world, both continents and all their zones — bounds in world coordinates and names (English and Russian),
plus areas.json — names of all zones and subzones. The repository already ships both JSON files; rebuilding
them from a non-Russian client leaves English names in place of Russian ones.
Needs Python 3 and Pillow (it reads BLP). The MPQ reader is our own — tools/mpq.py.
Usually you run tools/build_assets.py, which calls this together with fonts and music.

How the game draws it (FrameXML/WorldMapFrame.lua): a zone is 12 tiles 256×256 (4×3, 1002×668 visible),
over them the "explored" pieces from WorldMapOverlay.dbc: a texture is cut into 256 tiles, the last one in
a row/column is a power of two ≥ the rest. Without the pieces a zone is empty until you explore it;
we draw all of them — the map as seen by someone who has explored everything.
"""
import io
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mpq import WowData  # noqa: E402

W, H = 1002, 668
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'static', 'wow', 'maps')
QUALITY = 78


def dbc(data):
    sig, nrec, nf, rs, ss = struct.unpack_from('<4sIIII', data)
    assert sig == b'WDBC', sig
    strs = data[20 + nrec * rs:]

    def rows():
        for r in range(nrec):
            yield data[20 + r * rs:20 + (r + 1) * rs]

    def text(off):
        return strs[off:strs.index(b'\0', off)].decode('utf-8', 'replace') if 0 <= off < len(strs) else ''
    return list(rows()), text


def blp(wd, path):
    from PIL import Image
    raw = wd.read(path)
    return Image.open(io.BytesIO(raw)).convert('RGB') if raw else None


def compose(wd, name, overlays):
    from PIL import Image
    canvas = Image.new('RGB', (1024, 768))
    for i in range(12):
        tile = blp(wd, 'Interface\\WorldMap\\%s\\%s%d.blp' % (name, name, i + 1))
        if tile is None:
            return None
        canvas.paste(tile.resize((256, 256)) if tile.size != (256, 256) else tile, ((i % 4) * 256, (i // 4) * 256))
    for tex, tw, th, ox, oy in overlays:
        wide, tall = -(-tw // 256), -(-th // 256)
        for j in range(tall):
            ph = 256 if j < tall - 1 else (th % 256 or 256)
            for k in range(wide):
                pw = 256 if k < wide - 1 else (tw % 256 or 256)
                path = 'Interface\\WorldMap\\%s\\%s%d.blp' % (name, tex, j * wide + k + 1)
                raw = wd.read(path)
                if not raw:
                    continue
                im = Image.open(io.BytesIO(raw)).convert('RGBA').crop((0, 0, pw, ph))
                canvas.paste(im, (ox + 256 * k, oy + 256 * j), im)
    return canvas.crop((0, 0, W, H))


def area_names(wd, russian):
    """id → name from AreaTable.dbc of the highest-priority archive: the Russian locale (ruRU\\…) or the rest."""
    for rel, m in reversed(wd.archives):
        if rel.lower().startswith('ruru') != russian:
            continue
        raw = m.read('DBFilesClient\\AreaTable.dbc')
        if raw:
            rows, text = dbc(raw)
            return {struct.unpack_from('<I', r, 0)[0]: text(struct.unpack_from('<I', r, 44)[0]) for r in rows}
    return {}


def build(client, images=True, write_json=True):
    wd = WowData(os.path.join(client, 'Data'))
    os.makedirs(OUT, exist_ok=True)
    en = area_names(wd, False)
    ru = area_names(wd, True)

    rows, text = dbc(wd.read('DBFilesClient\\WorldMapArea.dbc'))
    areas = []
    for r in rows:
        wid, mapid, areaid, name_off = struct.unpack_from('<4I', r, 0)
        left, right, top, bottom = struct.unpack_from('<4f', r, 16)
        areas.append(dict(id=wid, map=mapid, area=areaid, file=text(name_off), bounds=[left, right, top, bottom]))
    rows, text = dbc(wd.read('DBFilesClient\\WorldMapOverlay.dbc'))
    overlays = {}
    for r in rows:
        vals = struct.unpack_from('<17I', r, 0)
        overlays.setdefault(vals[1], []).append((text(vals[8]), vals[9], vals[10], vals[11], vals[12]))

    # Where the continents are on the world map (fractions of width/height: x1, y1, x2, y2) — from the World picture.
    hits = {1: [0.11, 0.18, 0.38, 0.88], 0: [0.66, 0.08, 0.91, 0.84]}
    manifest = {'world': {'file': 'World'}, 'continents': [], 'zones': []}
    jobs = [('World', [])]
    for a in areas:
        if a['map'] not in (0, 1):          # battlegrounds: the core does not teleport there by coordinates
            continue
        names = {'en': en.get(a['area'], a['file']), 'ru': ru.get(a['area']) or en.get(a['area'], a['file'])}
        if a['area'] == 0:                  # continent row: Kalimdor / Azeroth (Eastern Kingdoms)
            names = {'en': 'Kalimdor', 'ru': 'Калимдор'} if a['map'] == 1 else {'en': 'Eastern Kingdoms', 'ru': 'Восточные королевства'}
            manifest['continents'].append(dict(a, names=names, hit=hits[a['map']]))
        else:
            manifest['zones'].append(dict(a, names=names))
        jobs.append((a['file'], overlays.get(a['id'], [])))

    total = 0
    for name, ovl in (jobs if images else []):
        img = compose(wd, name, ovl)
        if img is None:
            print('  no textures:', name)
            continue
        path = os.path.join(OUT, name + '.webp')
        img.save(path, 'WEBP', quality=QUALITY, method=6)
        total += os.path.getsize(path)
        print('  %-24s %3d pieces  %6.0f KB' % (name, len(ovl), os.path.getsize(path) / 1024))
    if write_json:
        manifest['zones'].sort(key=lambda z: z['names']['en'])
        with open(os.path.join(OUT, 'maps.json'), 'w', encoding='utf-8') as f:
            json.dump(manifest, f, ensure_ascii=False, separators=(',', ':'))
        # names of all zones and subzones (the server's AreaTable.dbc may be English only) — the panel shows them
        # in the page language
        names = {a: [en[a], ru.get(a) or en[a]] for a in en if en[a]}
        with open(os.path.join(OUT, 'areas.json'), 'w', encoding='utf-8') as f:
            json.dump(names, f, ensure_ascii=False, separators=(',', ':'))
        print('  maps.json, areas.json: %d zone names' % len(names))
    if images:
        print('  %d maps, %.1f MB' % (len(jobs), total / 1048576))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        sys.exit(__doc__)
    build(args[0], images='--json' not in sys.argv, write_json=True)


if __name__ == '__main__':
    main()
