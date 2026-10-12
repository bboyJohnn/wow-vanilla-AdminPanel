"""Game files for the panel's "World of Warcraft" look — from YOUR OWN WoW 1.12.1 client.

The repository has no Blizzard files. Run this on the computer where the game client is installed,
then copy the static/ folder (or just the new files) to the server:

    python tools/build_assets.py "C:\\Games\\World of Warcraft"
    python tools/build_assets.py "C:\\Games\\World of Warcraft" --only fonts,music
    python tools/build_assets.py "C:\\Games\\World of Warcraft" --json    — also rebuild maps.json / areas.json

What it writes (all optional — the panel works without them, it only looks plainer):
    static/fonts/frizqt.ttf, morpheus.ttf  — Friz Quadrata (whole interface) and Morpheus (headings)
    static/music/*.mp3                     — 13 tracks: main theme, capitals, zones, taverns
    static/wow/maps/*.webp                 — 49 world/continent/zone maps for the map teleport (needs Pillow)
    static/wow/minimap/                    — top-down view tiles from the client minimaps (needs Pillow)

Needs Python 3.8+. Maps also need Pillow: pip install pillow.
Backgrounds and race/class pictures (static/wow/bg-*.jpg, static/wow/renders/) come from Blizzard's
Fan Site Kit, not from the client — see README.
"""
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mpq import WowData  # noqa: E402

STATIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'static')

FONTS = {'frizqt.ttf': 'Fonts\\FRIZQT__.TTF', 'morpheus.ttf': 'Fonts\\MORPHEUS.TTF'}

# file in static/music → file in the client (sound.MPQ). The order and titles are in app.js (MUSIC).
MUSIC = {
    'main': 'Sound\\Music\\GlueScreenMusic\\wow_main_theme.mp3',
    'stormwind': 'Sound\\Music\\CityMusic\\Stormwind\\stormwind04-zone.mp3',
    'elwynn': 'Sound\\Music\\ZoneMusic\\Forest\\DayForest01.mp3',
    'ironforge': 'Sound\\Music\\CityMusic\\Ironforge\\IronForge Walking 01.mp3',
    'dunmorogh': 'Sound\\Music\\ZoneMusic\\Mountain\\DayMountain01.mp3',
    'darnassus': 'Sound\\Music\\CityMusic\\Darnassus\\Darnassus Walking 1.mp3',
    'tavern-a': 'Sound\\Music\\ZoneMusic\\TavernAlliance\\TavernAlliance01.mp3',
    'orgrimmar': 'Sound\\Music\\CityMusic\\Orgrimmar\\orgrimmar01-zone.mp3',
    'barrens': 'Sound\\Music\\ZoneMusic\\BarrenDry\\DayBarrenDry01.mp3',
    'thunderbluff': 'Sound\\Music\\CityMusic\\ThunderBluff\\Thunderbluff Walking 01.mp3',
    'undercity': 'Sound\\Music\\CityMusic\\Undercity\\undercity01-zone.mp3',
    'tavern-h': 'Sound\\Music\\ZoneMusic\\TavernHorde\\TavernHorde01.mp3',
    'mulgore': 'Sound\\Music\\ZoneMusic\\Plains\\DayPlains01.mp3',
}


def _checksum(data):
    data += b'\0' * (-len(data) % 4)
    return sum(struct.unpack('>%dI' % (len(data) // 4), data)) & 0xFFFFFFFF


def fix_font(font):
    """FRIZQT__.TTF of the client has a broken last cmap segment (0xFFFF → glyph 65535): Chrome rejects the
    whole font ("OTS parsing error: cmap: Range glyph reference too high"). Point that segment to glyph 0
    and recompute the checksums. The letters themselves are not touched."""
    font = bytearray(font)
    tables = {}
    for i in range(struct.unpack_from('>H', font, 4)[0]):
        tag, _sum, off, length = struct.unpack_from('>4sIII', font, 12 + 16 * i)
        tables[tag] = (12 + 16 * i, off, length)
    num_glyphs = struct.unpack_from('>H', font, tables[b'maxp'][1] + 4)[0]
    _rec, cmap, cmap_len = tables[b'cmap']
    changed = False
    for k in range(struct.unpack_from('>H', font, cmap + 2)[0]):
        sub = cmap + struct.unpack_from('>HHI', font, cmap + 4 + 8 * k)[2]
        if struct.unpack_from('>H', font, sub)[0] != 4:
            continue
        segs = struct.unpack_from('>H', font, sub + 6)[0] // 2
        ends, starts = sub + 14, sub + 16 + 2 * segs
        deltas, ranges = starts + 2 * segs, starts + 4 * segs
        for s in range(segs):
            end, start = struct.unpack_from('>H', font, ends + 2 * s)[0], struct.unpack_from('>H', font, starts + 2 * s)[0]
            delta, rng = struct.unpack_from('>H', font, deltas + 2 * s)[0], struct.unpack_from('>H', font, ranges + 2 * s)[0]
            if start == end == 0xFFFF and rng == 0 and (0xFFFF + delta) & 0xFFFF >= num_glyphs:
                struct.pack_into('>H', font, deltas + 2 * s, 1)          # 0xFFFF + 1 → glyph 0
                changed = True
    if not changed:
        return bytes(font)
    rec, off, length = tables[b'cmap']
    struct.pack_into('>I', font, rec + 4, _checksum(bytes(font[off:off + length])))
    head = tables[b'head'][1]
    struct.pack_into('>I', font, head + 8, 0)
    struct.pack_into('>I', font, head + 8, (0xB1B0AFBA - _checksum(bytes(font))) & 0xFFFFFFFF)
    return bytes(font)


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(data)
    print('  %-28s %7.0f KB' % (os.path.relpath(path, STATIC), len(data) / 1024))


def build_fonts(wd):
    for out, name in FONTS.items():
        data = wd.read(name)
        if not data:
            print('  not found in the client:', name)
            continue
        write(os.path.join(STATIC, 'fonts', out), fix_font(data) if out == 'frizqt.ttf' else data)


def build_music(wd):
    for out, name in MUSIC.items():
        data = wd.read(name)
        if not data:
            print('  not found in the client:', name)
            continue
        write(os.path.join(STATIC, 'music', out + '.mp3'), data)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args or not os.path.isdir(os.path.join(args[0], 'Data')):
        sys.exit(__doc__ + '\nGive the folder of the game client (the one with Data\\ inside).')
    only = {'fonts', 'music', 'maps', 'minimap'}
    for a in sys.argv[1:]:
        if a.startswith('--only='):
            only = set(a.split('=', 1)[1].split(','))
    if '--only' in sys.argv[1:]:
        i = sys.argv.index('--only')
        only = set(sys.argv[i + 1].split(',')) if i + 1 < len(sys.argv) else only
        args = [a for a in args if a != sys.argv[i + 1]]
    client = args[0]
    wd = WowData(os.path.join(client, 'Data'))
    print('Client archives: %s' % ', '.join(rel for rel, _ in wd.archives))
    if 'fonts' in only:
        print('Fonts:')
        build_fonts(wd)
    if 'music' in only:
        print('Music:')
        build_music(wd)
    if only & {'maps', 'minimap'}:
        try:
            import PIL  # noqa: F401
        except ImportError:
            sys.exit('  Pillow is needed for the maps: pip install pillow')
    if 'maps' in only:
        print('World maps:')
        import build_maps
        build_maps.build(client, images=True, write_json='--json' in sys.argv)
    if 'minimap' in only:
        print('Top-down view (minimap tiles):')
        import build_minimap
        build_minimap.build(client)
    print('Done. Copy static/fonts, static/music, static/wow/maps and static/wow/minimap to the panel on the server.')


if __name__ == '__main__':
    main()
