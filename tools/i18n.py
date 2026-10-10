"""Переводы веб-панели: какие надписи есть в коде и всё ли переведено.

Исходный язык — русский. В static/app.js каждая надпись обёрнута в L('…'), и этот русский
текст — ключ перевода. Сервер (panel.py) свои сообщения шлёт по-русски, браузер переводит их
тем же словарём (Lsrv): %s и %d в них становятся {0}, {1}…
Словари — static/i18n/<код>.js: window.PANEL_I18N = { "русский текст": "перевод", … }.

    python tools/i18n.py check          — по каждому языку: сколько переведено, чего нет, что лишнее,
                                          где не совпали подстановки {0}
    python tools/i18n.py keys > k.txt   — все ключи (номер, ключ), \\n внутри ключа — как \\n
    python tools/i18n.py build en tr.txt — собрать static/i18n/en.js из файла «номер<TAB>перевод»
    python tools/i18n.py sync           — переписать все словари в порядке ключей, без лишних

Добавили надпись в app.js — оберните её в L('…'), запустите check и допишите переводы.
Нет перевода — панель покажет русский текст, ничего не сломается.
"""
import ast
import io
import json
import re
import sys
import tokenize
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP_JS = ROOT / 'static' / 'app.js'
PANEL_PY = ROOT / 'panel.py'
I18N_DIR = ROOT / 'static' / 'i18n'
CYR = re.compile('[А-Яа-яЁё]')
PH = re.compile(r'\{(\d+)\}')
PY_FMT = re.compile(r'%[-+ 0#]*\d*(?:\.\d+)?[sdrfx]')   # %s, %d, %.1f — место подстановки

LANGS = {'en': 'English', 'de': 'Deutsch', 'fr': 'Français', 'es': 'Español', 'pt': 'Português',
         'pl': 'Polski', 'ja': '日本語', 'zh': '中文（简体）'}

# строки panel.py, которые в браузер не попадают: команды ядру, файлы, журнал процесса
PY_SKIP = ('unban %s %s', '# Добавлено веб-панелью', '-- Самодельные предметы', '-- Залить обратно',
           'Панель: %d зон', 'AreaTable.dbc не прочитан', 'GeoLite2-Country.mmdb не прочитан',
           'не база MaxMind', 'неизвестный размер записи')


# ----------------------------------------------------------------- app.js: ключи из L('…')

class JsScan:
    """Мини-разбор JS: пропускает комментарии, строки, регулярки; заходит внутрь ${…}."""
    KW = {'return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw',
          'instanceof', 'yield', 'await'}
    ESC = {'n': '\n', 't': '\t', 'r': '\r', '0': '\0'}

    def __init__(self, src):
        self.src = src
        self.keys = []

    def string(self, i):
        """Строка '…' или "…" с позиции i: (конец, значение)."""
        q, j, out = self.src[i], i + 1, []
        while self.src[j] != q:
            if self.src[j] == '\\':
                c = self.src[j + 1]
                if c == 'u':
                    out.append(chr(int(self.src[j + 2:j + 6], 16)))
                    j += 6
                    continue
                out.append(self.ESC.get(c, c))
                j += 2
                continue
            out.append(self.src[j])
            j += 1
        return j + 1, ''.join(out)

    def skip_ws(self, j):
        while j < len(self.src):
            if self.src[j] in ' \t\r\n':
                j += 1
            elif self.src.startswith('//', j):
                j = self.src.index('\n', j)
            elif self.src.startswith('/*', j):
                j = self.src.index('*/', j) + 2
            else:
                break
        return j

    def l_call(self, j, ctx=False):
        """После «L(»: первый аргумент — строка или сумма строк. Записывает ключ.
        Lx('контекст', 'текст') даёт ключ «контекст|текст»."""
        j = self.skip_ws(j)
        prefix = ''
        if ctx:
            if self.src[j] not in '\'"':
                return
            j, prefix = self.string(j)
            j = self.skip_ws(j)
            if self.src[j] != ',':
                return
            prefix += '|'
            j = self.skip_ws(j + 1)
        if self.src[j] not in '\'"':
            return
        j, val = self.string(j)
        val = prefix + val
        while True:
            k = self.skip_ws(j)
            if self.src[k] != '+':
                break
            k = self.skip_ws(k + 1)
            if self.src[k] not in '\'"':
                break
            j, more = self.string(k)
            val += more
        self.keys.append((val, self.src.count('\n', 0, j) + 1))

    def code(self, i, stop_brace=False):
        src, n, depth, prev = self.src, len(self.src), 0, None
        while i < n:
            c = src[i]
            if c in ' \t\r\n':
                i += 1
            elif src.startswith('//', i):
                j = src.find('\n', i)
                i = n if j < 0 else j
            elif src.startswith('/*', i):
                i = src.index('*/', i) + 2
            elif c in '\'"':
                i, _ = self.string(i)
                prev = 'v'
            elif c == '`':
                i += 1
                while src[i] != '`':
                    if src[i] == '\\':
                        i += 2
                    elif src.startswith('${', i):
                        i = self.code(i + 2, True) + 1
                    else:
                        i += 1
                i += 1
                prev = 'v'
            elif c == '/' and (prev is None or prev in self.KW or prev not in ('v', ')', ']', '}')):
                j, cls = i + 1, False
                while cls or src[j] != '/':
                    if src[j] == '\\':
                        j += 1
                    elif src[j] == '[':
                        cls = True
                    elif src[j] == ']':
                        cls = False
                    j += 1
                i = j + 1
                while i < n and src[i].isalpha():
                    i += 1
                prev = 'v'
            elif c.isalpha() or c in '_$':
                j = i
                while j < n and (src[j].isalnum() or src[j] in '_$'):
                    j += 1
                word = src[i:j]
                if word in ('L', 'Lx') and src[i - 1] != '.':
                    k = self.skip_ws(j)
                    if src[k] == '(':
                        self.l_call(k + 1, word == 'Lx')
                prev = word if word in self.KW else 'v'
                i = j
            elif c.isdigit():
                while i < n and (src[i].isalnum() or src[i] in '._'):
                    i += 1
                prev = 'v'
            else:
                if stop_brace and c == '}' and depth == 0:
                    return i
                depth += c == '{'
                depth -= c == '}'
                prev = c
                i += 1
        return i


def js_keys():
    sc = JsScan(APP_JS.read_text(encoding='utf-8'))
    sc.code(0)
    return sc.keys


# ----------------------------------------------------------------- panel.py: тексты сервера

def py_to_ph(text):
    """'%s: от %d до %d.' → '{0}: от {1} до {2}.' (нумерация заново в каждой строке)."""
    out = []
    for line in text.split('\n'):
        n = [0]

        def sub(m):
            if m.group(0) == '%%':
                return '%'
            n[0] += 1
            return '{%d}' % (n[0] - 1)
        out.append(re.sub(r'%%|%[-+ 0#]*\d*(?:\.\d+)?[sdrfx]', sub, line))
    return '\n'.join(out)


def py_keys():
    src = PANEL_PY.read_text(encoding='utf-8')
    toks = [t for t in tokenize.generate_tokens(io.StringIO(src).readline)
            if t.type not in (tokenize.NL, tokenize.COMMENT)]
    keys = []
    i = 0
    while i < len(toks):
        t = toks[i]
        if t.type != tokenize.STRING:
            i += 1
            continue
        # подряд идущие строки Python склеивает сам
        j, parts = i, []
        while j < len(toks) and toks[j].type == tokenize.STRING:
            parts.append(toks[j])
            j += 1
        prev = toks[i - 1] if i else None
        is_doc = prev is None or prev.type in (tokenize.INDENT, tokenize.NEWLINE, tokenize.DEDENT) and \
            parts[0].string.startswith(('"""', "'''")) and toks[j].type == tokenize.NEWLINE
        i = j
        if is_doc or any(p.string[:1] in 'bBfF' for p in parts):
            continue
        try:
            val = "".join(ast.literal_eval(p.string) for p in parts)
        except Exception:
            continue
        if not isinstance(val, str) or not CYR.search(val) or any(s in val for s in PY_SKIP):
            continue
        nxt = toks[j] if j < len(toks) else None
        if nxt is not None and nxt.type == tokenize.OP and nxt.string == '%' or PY_FMT.search(val):
            val = py_to_ph(val)
        elif '{' in val:
            continue        # .format-шаблоны и SQL — не тексты для людей
        if nxt is not None and nxt.type == tokenize.OP and nxt.string == '+':
            val += '{%d}' % len(PH.findall(val.split('\n')[-1]))
        for line in val.split('\n'):
            line = line.strip(' ')
            if CYR.search(line):
                keys.append((line, parts[0].start[0]))
    return keys


def all_keys():
    seen = {}
    for k, ln in js_keys():
        seen.setdefault(k, 'app.js:%d' % ln)
    for k, ln in py_keys():
        seen.setdefault(k, 'panel.py:%d' % ln)
    return seen


# ----------------------------------------------------------------- словари

HEAD = ('// {name} — перевод веб-панели WoW. Ключ — русский текст из static/app.js и panel.py,\n'
        '// {{0}}, {{1}}… — места для чисел и имён, их надо сохранить. Проверка: python tools/i18n.py check\n')


def load_dict(code):
    p = I18N_DIR / ('%s.js' % code)
    if not p.exists():
        return {}
    text = p.read_text(encoding='utf-8')
    body = text[text.index('{', text.index('PANEL_I18N')):text.rindex('}') + 1]
    return json.loads(body)


def save_dict(code, d, keys):
    order = [k for k in keys if k in d]
    lines = ['%s: %s' % (json.dumps(k, ensure_ascii=False), json.dumps(d[k], ensure_ascii=False)) for k in order]
    I18N_DIR.mkdir(exist_ok=True)
    (I18N_DIR / ('%s.js' % code)).write_text(
        HEAD.format(name=LANGS.get(code, code)) + 'window.PANEL_I18N = {\n' + ',\n'.join(lines) + '\n};\n',
        encoding='utf-8', newline='\n')


def ph_set(s):
    return sorted(set(PH.findall(s)))


def check():
    keys = all_keys()
    print('ключей: %d (app.js и panel.py)' % len(keys))
    bad = 0
    for code, name in LANGS.items():
        d = load_dict(code)
        missing = [k for k in keys if k not in d]
        extra = [k for k in d if k not in keys]
        wrong = [k for k in keys if k in d and ph_set(k) != ph_set(d[k])]
        empty = [k for k in keys if k in d and not d[k].strip()]
        print('%-3s %-14s переведено %4d / %d, нет %d, лишних %d, подстановки не совпали %d, пустых %d' % (
            code, name, len(keys) - len(missing), len(keys), len(missing), len(extra), len(wrong), len(empty)))
        for k in missing[:8]:
            print('      нет: %s   (%s)' % (k.replace('\n', '\\n')[:90], keys[k]))
        for k in wrong[:8]:
            print('      {}: %s  →  %s' % (k[:60], d[k][:60]))
        bad += len(wrong) + len(empty)
    return bad


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'check'
    if cmd == 'check':
        sys.exit(1 if check() else 0)
    keys = list(all_keys())
    if cmd == 'keys':
        for n, k in enumerate(keys, 1):
            print('%d\t%s' % (n, k.replace('\\', '\\\\').replace('\n', '\\n')))
    elif cmd == 'build':
        code, src = sys.argv[2], Path(sys.argv[3])
        d = load_dict(code)
        for line in src.read_text(encoding='utf-8').splitlines():
            if not line.strip() or line.startswith('#'):
                continue
            num, _, tr = line.partition('\t')
            k = keys[int(num) - 1]
            d[k] = tr.replace('\\n', '\n')
        save_dict(code, d, keys)
        print('%s: %d переводов' % (code, len(d)))
    elif cmd == 'sync':
        for code in LANGS:
            save_dict(code, load_dict(code), keys)
    else:
        print(__doc__)


if __name__ == '__main__':
    main()
