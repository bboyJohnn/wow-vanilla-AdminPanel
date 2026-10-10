"""Minimal read-only MPQ reader (format v1, WoW 1.12 client archives) + layered "virtual FS".

Supports: header search (512-byte aligned, MPQ\\x1b user-data header), encrypted hash/block tables,
sector offset tables (incl. MPQ_FILE_SECTOR_CRC 0x04000000 extra entry), encrypted files
(MPQ_FILE_ENCRYPTED 0x10000, MPQ_FILE_FIX_KEY 0x20000), single-unit files (0x01000000),
compression (MPQ_FILE_COMPRESS 0x200) with masks zlib 0x02 and bzip2 0x10.
NOT supported (raises ValueError): MPQ_FILE_IMPLODE 0x100 (PKWARE DCL), huffman 0x01, ADPCM 0x40/0x80,
PKWARE mask 0x08 -- none of these is used by the WorldMap textures / WorldMap*.dbc in a 1.12 client
(verified: all used blocks have flags 0x80000200 or 0x84000200, mask 0x02 zlib).
"""
import os
import struct
import sys
import zlib
import bz2

CRYPT = []


def _init():
    seed = 0x00100001
    table = [0] * 0x500
    for i in range(0x100):
        idx = i
        for _ in range(5):
            seed = (seed * 125 + 3) % 0x2AAAAB
            t1 = (seed & 0xFFFF) << 16
            seed = (seed * 125 + 3) % 0x2AAAAB
            t2 = seed & 0xFFFF
            table[idx] = t1 | t2
            idx += 0x100
    CRYPT.extend(table)


_init()

FILE_IMPLODE = 0x00000100
FILE_COMPRESS = 0x00000200
FILE_ENCRYPTED = 0x00010000
FILE_FIX_KEY = 0x00020000
FILE_SINGLE_UNIT = 0x01000000
FILE_SECTOR_CRC = 0x04000000
FILE_EXISTS = 0x80000000

STATS = {}          # (flags, mask) -> count, filled while reading (diagnostics)


def hash_string(s, kind):
    s1, s2 = 0x7FED7FED, 0xEEEEEEEE
    for ch in s.upper().replace('/', '\\'):
        c = ord(ch)
        s1 = (CRYPT[(kind << 8) + c] ^ (s1 + s2)) & 0xFFFFFFFF
        s2 = (c + s1 + s2 + (s2 << 5) + 3) & 0xFFFFFFFF
    return s1


def decrypt(data, key):
    n = len(data) // 4
    vals = list(struct.unpack('<%dI' % n, data[:n * 4]))
    seed = 0xEEEEEEEE
    for i in range(n):
        seed = (seed + CRYPT[0x400 + (key & 0xFF)]) & 0xFFFFFFFF
        ch = vals[i] ^ ((key + seed) & 0xFFFFFFFF)
        key = (((~key << 0x15) + 0x11111111) | (key >> 0x0B)) & 0xFFFFFFFF
        seed = (ch + seed + (seed << 5) + 3) & 0xFFFFFFFF
        vals[i] = ch
    return struct.pack('<%dI' % n, *vals) + data[n * 4:]


class MPQ:
    def __init__(self, path):
        self.path = path
        self.f = open(path, 'rb')
        self.base = self._find_header()
        self.f.seek(self.base)
        head = self.f.read(32)
        (_, hsize, asize, ver, shift, hpos, bpos, hcount, bcount) = struct.unpack('<4sIIHHIIII', head)
        self.sector = 512 << shift
        self.f.seek(self.base + hpos)
        h = decrypt(self.f.read(hcount * 16), hash_string('(hash table)', 3))
        self.hashes = [struct.unpack_from('<IIHHI', h, i * 16) for i in range(hcount)]
        self.f.seek(self.base + bpos)
        b = decrypt(self.f.read(bcount * 16), hash_string('(block table)', 3))
        self.blocks = [struct.unpack_from('<IIII', b, i * 16) for i in range(bcount)]
        self._names = None

    def _find_header(self):
        pos = 0
        size = os.fstat(self.f.fileno()).st_size
        while pos < size:
            self.f.seek(pos)
            sig = self.f.read(16)
            if sig[:4] == b'MPQ\x1a':
                return pos
            if sig[:4] == b'MPQ\x1b':                  # user data header -> real header offset
                return pos + struct.unpack_from('<I', sig, 8)[0]
            pos += 512
        raise ValueError('MPQ header not found: %s' % self.path)

    def find(self, name):
        name = name.replace('/', '\\')
        a, b = hash_string(name, 1), hash_string(name, 2)
        start = hash_string(name, 0) % len(self.hashes)
        i = start
        while True:
            ha, hb, loc, plat, bi = self.hashes[i]
            if bi == 0xFFFFFFFF:
                return None
            if ha == a and hb == b and bi != 0xFFFFFFFE:
                blk = self.blocks[bi]
                return blk if blk[3] & FILE_EXISTS else None
            i = (i + 1) % len(self.hashes)
            if i == start:
                return None

    def names(self):
        if self._names is None:
            lst = self.read('(listfile)')
            self._names = lst.decode('latin-1').split() if lst else []
        return self._names

    def read(self, name):
        name = name.replace('/', '\\')
        blk = self.find(name)
        if not blk:
            return None
        off, csize, fsize, flags = blk
        key = None
        if flags & FILE_ENCRYPTED:
            key = hash_string(name.rsplit('\\', 1)[-1], 3)
            if flags & FILE_FIX_KEY:
                key = ((key + off) ^ fsize) & 0xFFFFFFFF
        self.f.seek(self.base + off)
        raw = self.f.read(csize)
        if flags & FILE_SINGLE_UNIT:
            if key is not None:
                raw = decrypt(raw, key)
            return self._unpack(raw, fsize, flags) if csize < fsize else raw[:fsize]
        nsec = (fsize + self.sector - 1) // self.sector
        if not flags & (FILE_IMPLODE | FILE_COMPRESS):    # stored, sector by sector
            if key is None:
                return raw[:fsize]
            out = [decrypt(raw[s * self.sector:(s + 1) * self.sector], (key + s) & 0xFFFFFFFF) for s in range(nsec)]
            return b''.join(out)[:fsize]
        # sector offset table: nsec+1 entries (+1 more when FILE_SECTOR_CRC; we ignore the CRC block)
        tsize = (nsec + 1) * 4
        table = raw[:tsize]
        if key is not None:
            table = decrypt(table, (key - 1) & 0xFFFFFFFF)
        offs = struct.unpack('<%dI' % (nsec + 1), table)
        out = []
        for s in range(nsec):
            part = raw[offs[s]:offs[s + 1]]
            if key is not None:
                part = decrypt(part, (key + s) & 0xFFFFFFFF)
            want = min(self.sector, fsize - s * self.sector)
            out.append(self._unpack(part, want, flags) if len(part) < want else part[:want])
        return b''.join(out)

    @staticmethod
    def _unpack(data, want, flags):
        if flags & FILE_IMPLODE:
            raise ValueError('PKWARE implode (MPQ_FILE_IMPLODE) not supported')
        mask = data[0]
        STATS[(flags, mask)] = STATS.get((flags, mask), 0) + 1
        body = data[1:]
        # decompression order used by Storm: bzip2 -> pkware -> zlib -> huffman -> adpcm
        if mask & 0x10:
            body = bz2.decompress(body)
            mask &= ~0x10
        if mask & 0x08:
            raise ValueError('PKWARE DCL compression mask 0x08 not supported')
        if mask & 0x02:
            body = zlib.decompress(body)
            mask &= ~0x02
        if mask:
            raise ValueError('compression mask %#x not supported' % mask)
        return body


# Load order of a 1.12.1 client, LOWEST priority first. Later archives override earlier ones.
# Archives of the locale folders (ruRU, enUS, deDE…) come last — see client_order().
DEFAULT_ORDER = [
    'base.MPQ', 'dbc.MPQ', 'fonts.MPQ', 'interface.MPQ', 'misc.MPQ', 'model.MPQ', 'sound.MPQ', 'speech.MPQ',
    'terrain.MPQ', 'texture.MPQ', 'wmo.MPQ', 'backup.MPQ',
    'patch.MPQ', 'patch-2.MPQ', 'patch-3.MPQ',
]


def client_order(data_dir):
    """DEFAULT_ORDER plus the archives of every locale folder (4 letters: ruRU, enUS…), patches last."""
    order = list(DEFAULT_ORDER)
    for loc in sorted(os.listdir(data_dir)):
        sub = os.path.join(data_dir, loc)
        if len(loc) == 4 and os.path.isdir(sub):
            names = [n for n in os.listdir(sub) if n.lower().endswith('.mpq')]
            names.sort(key=lambda n: (n.lower().startswith('patch'), n.lower()))
            order += [os.path.join(loc, n) for n in names]
    return order


class WowData:
    """Layered view over the client archives: read() returns the file from the highest-priority archive."""

    def __init__(self, data_dir, order=None, only=None):
        self.archives = []
        for rel in order or client_order(data_dir):
            if only and rel not in only:
                continue
            p = os.path.join(data_dir, rel)
            if os.path.isfile(p):
                self.archives.append((rel, MPQ(p)))

    def locate(self, name):
        for rel, m in reversed(self.archives):
            if m.find(name):
                return rel
        return None

    def read(self, name):
        for rel, m in reversed(self.archives):
            if m.find(name):
                return m.read(name)
        return None

    def listdir(self, prefix):
        prefix = prefix.lower().replace('/', '\\')
        seen = {}
        for rel, m in self.archives:
            for n in m.names():
                if n.lower().startswith(prefix):
                    seen[n.lower()] = n
        return sorted(seen.values())


if __name__ == '__main__':
    m = MPQ(sys.argv[1])
    if sys.argv[2] == 'list':
        pat = sys.argv[3].lower() if len(sys.argv) > 3 else ''
        for n in m.names():
            if pat in n.lower():
                blk = m.find(n)
                print(n, blk[2] if blk else '?', hex(blk[3]) if blk else '')
    elif sys.argv[2] == 'get':
        data = m.read(sys.argv[3])
        open(sys.argv[4], 'wb').write(data)
        print(len(data))
