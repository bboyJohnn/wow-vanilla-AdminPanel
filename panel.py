#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WoW Web Panel — веб-панель управления сервером CMaNGOS Classic (WoW 1.12.1).

    python3 panel.py           — запустить панель
    python3 panel.py --check   — проверить настройки: файлы, база, SOAP — и выйти

Где живёт и как до неё добраться
--------------------------------
Панель — один процесс на той же машине, что и мир (mangosd): она читает его
mangosd.conf, DBC и .map-файлы, журналы и список процессов в /proc. Слушает
PANEL_HOST:PANEL_PORT (по умолчанию 127.0.0.1:8090) и пускает только адреса из
PANEL_ALLOWED_PEERS, а дальше всё равно спрашивает пароль. Открывать её снаружи —
через SSH-туннель или обратный прокси с HTTPS (см. README).

Как она управляет сервером
--------------------------
Команды — через SOAP ядра (SOAP.Enabled = 1 в mangosd.conf). В отличие от
консоли, SOAP возвращает ответ на каждую команду, а не пишет его в лог.
Данные для таблиц и графиков — прямо из базы, тем же пользователем, что и ядро.
Все настройки — в файле .env рядом с panel.py (образец — .env.example).

Удаление аккаунтов и персонажей идёт только через ядро, не прямым SQL: только
сервер знает, как снять персонажа со всеми вещами, почтой и гильдией.
"""

import array
import asyncio
import base64
import functools
import hashlib
import hmac
import ipaddress
import json
import mimetypes
import mmap
import os
import re
import secrets
import signal
import sqlite3
import struct
import sys
import time
import traceback
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from xml.etree import ElementTree
from xml.sax.saxutils import escape as xml_escape

import pymysql
from aiohttp import web

# В минимальных системах и контейнерах нет /etc/mime.types: без этого рисунки .webp и шрифты игры уходили бы как
# application/octet-stream, а с заголовком nosniff браузер такие файлы может не взять.
for _types in (mimetypes, getattr(__import__('aiohttp.web_fileresponse').web_fileresponse, 'CONTENT_TYPES', None)):
    if _types is not None:     # у aiohttp своя таблица типов для раздачи файлов
        _types.add_type('image/webp', '.webp')
        _types.add_type('font/ttf', '.ttf')

# --- настройки из .env -------------------------------------------------------
# Всё, что панели нужно знать о сервере, — в файле .env рядом с panel.py (образец —
# .env.example). Обязательны только путь к mangosd.conf, пароль панели и служебный
# аккаунт SOAP: базы, порт SOAP, номер реалма, папки DataDir и LogsDir панель берёт
# из самого mangosd.conf. Любое из этого можно задать в .env вручную — тогда .env главнее.
# Значение может ссылаться на ключ выше: ${WOW_DIR}/etc. Текст после « #» — пояснение.

BASE = Path(__file__).resolve().parent
ENV_REF = re.compile(r'\$\{(\w+)\}')
ENV_COMMENT = re.compile(r'(?:^|\s+)#.*$')
CONF_KV = re.compile(r'^\s*([A-Za-z0-9_.]+)\s*=\s*(.*?)\s*$')


def load_env(path):
    env = {}
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        value = value.strip()
        if len(value) > 1 and value[0] == value[-1] and value[0] in '"\'':
            value = value[1:-1]
        else:
            value = ENV_COMMENT.sub('', value)      # «ключ=значение   # пояснение»
        env[key.strip()] = ENV_REF.sub(lambda m: env.get(m.group(1), os.environ.get(m.group(1), '')), value)
    return env


ENV_FILE = Path(os.environ.get('PANEL_ENV') or BASE / '.env')
if not ENV_FILE.exists():
    sys.exit('No settings file %s: copy .env.example to .env and fill it in (see README).' % ENV_FILE)
ENV = load_env(ENV_FILE)


def env_path(key, default):
    return Path(ENV.get(key) or default)


def required(key):
    value = (ENV.get(key) or '').strip()
    if not value:
        sys.exit('%s is empty in %s — see .env.example and README.' % (key, ENV_FILE))
    return value


def read_conf(path):
    """Ключи и значения конфига ядра (mangosd.conf, realmd.conf), кавычки сняты."""
    values = {}
    try:
        for line in path.read_text(encoding='utf-8', errors='replace').splitlines():
            m = CONF_KV.match(line)
            if m and not line.lstrip().startswith('#'):
                values[m.group(1)] = m.group(2).strip('"')
    except OSError:
        pass
    return values


def core_dir(value, default):
    """Папка из конфига ядра. Относительный путь ядро считает от своей рабочей папки —
    обычно это папка с mangosd (WOW_BIN)."""
    if not value:
        return default
    path = Path(value)
    return path if path.is_absolute() else (BIN / path).resolve()


# --- пути --------------------------------------------------------------------

CONF = Path(required('WOW_MANGOSD_CONF'))                        # .../etc/mangosd.conf
if not CONF.exists():
    sys.exit('WOW_MANGOSD_CONF: file %s not found.' % CONF)
CORE = read_conf(CONF)
WOW = env_path('WOW_DIR', CONF.parent.parent)                   # папка сервера: bin/, etc/…
BIN = env_path('WOW_BIN', WOW / 'bin')                          # mangosd и realmd, их рабочая папка
REALMD_CONF = env_path('WOW_REALMD_CONF', CONF.parent / 'realmd.conf')
REALMD = read_conf(REALMD_CONF)
CORE_LOGS = env_path('WOW_LOGS', core_dir(CORE.get('LogsDir'), BIN))      # Server.log, DBErrors.log, Char.log…
REALMD_LOGS = core_dir(REALMD.get('LogsDir'), BIN)
CONF_BACKUPS = env_path('WOW_CONF_BACKUPS', CONF.parent / 'backups')
WOW_DATA = env_path('WOW_DATA', core_dir(CORE.get('DataDir'), BIN))      # DataDir: dbc/, maps/, vmaps/…
DBC = env_path('WOW_DBC', WOW_DATA / 'dbc')
MAPS = env_path('WOW_MAPS', WOW_DATA / 'maps')                  # высоты земли для телепорта по карте
STATIC = BASE / 'static'
DATA = env_path('PANEL_DATA', BASE / 'data')
PANEL_DB = DATA / 'panel.db'

HOST = ENV.get('PANEL_HOST') or '127.0.0.1'
PORT = int(ENV.get('PANEL_PORT') or '8090')
PASSWORD_HASH = required('PANEL_PASSWORD_HASH')
SECRET = bytes.fromhex(required('PANEL_SECRET'))


def parse_peers(text):
    """Кого пускать: адреса и сети через запятую — 127.0.0.1, ::1, 192.168.0.0/24."""
    nets = []
    for item in text.split(','):
        if item.strip():
            try:
                nets.append(ipaddress.ip_network(item.strip(), strict=False))
            except ValueError:
                sys.exit('PANEL_ALLOWED_PEERS: «%s» is not an IP address or network.' % item.strip())
    return nets


ALLOWED_PEERS = parse_peers(ENV.get('PANEL_ALLOWED_PEERS') or '127.0.0.1,::1')


def peer_allowed(addr):
    try:
        ip = ipaddress.ip_address(addr or '')
    except ValueError:
        return False
    if ip.version == 6 and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return any(ip in net for net in ALLOWED_PEERS)


SOAP_HOST = ENV.get('SOAP_HOST') or CORE.get('SOAP.IP') or '127.0.0.1'
if SOAP_HOST in ('0.0.0.0', '::'):
    SOAP_HOST = '127.0.0.1'
SOAP_PORT = int(ENV.get('SOAP_PORT') or CORE.get('SOAP.Port') or '7878')
SOAP_USER = required('SOAP_USER')
SOAP_PASS = required('SOAP_PASS')
SOAP_AUTH = 'Basic ' + base64.b64encode(('%s:%s' % (SOAP_USER, SOAP_PASS)).encode()).decode()


def db_info(key):
    """«хост;порт;пользователь;пароль;база» — так mangosd.conf задаёт базы. Хост «.» —
    сокет: тогда во втором поле путь к нему."""
    parts = CORE.get(key, '').split(';')
    return parts if len(parts) == 5 else [''] * 5


# Доступ к базе — из LoginDatabaseInfo в mangosd.conf или DB_* в .env. Панель ходит во все
# три базы одним пользователем, поэтому у него должны быть права на каждую.
LOGIN_DB, CHAR_DB, WORLD_DB = (db_info(k) for k in ('LoginDatabaseInfo', 'CharacterDatabaseInfo', 'WorldDatabaseInfo'))
DB_HOST = ENV.get('DB_HOST') or LOGIN_DB[0] or '127.0.0.1'
DB_PORT = ENV.get('DB_PORT') or LOGIN_DB[1] or '3306'
DB = dict(user=ENV.get('DB_USER') or LOGIN_DB[2], password=ENV.get('DB_PASSWORD') or LOGIN_DB[3])
if not DB['user']:
    sys.exit('No database user: set DB_USER/DB_PASSWORD in .env or LoginDatabaseInfo in mangosd.conf.')
if DB_HOST == '.':
    DB['unix_socket'] = DB_PORT
else:
    DB.update(host=DB_HOST, port=int(DB_PORT))
R = ENV.get('DB_REALMD') or LOGIN_DB[4] or 'classicrealmd'
C = ENV.get('DB_CHARS') or CHAR_DB[4] or 'classiccharacters'
W = ENV.get('DB_WORLD') or WORLD_DB[4] or 'classicmangos'
REALM_ID = int(ENV.get('REALM_ID') or CORE.get('RealmID') or '1')
# Как панель называет сервер: шапка меню, экран входа, адрес под меню и необязательная ссылка
# «Все панели» на вашу страницу-список (адрес или «:порт» — тот же адрес, другой порт).
SITE = {'title': ENV.get('PANEL_TITLE') or 'WoW Server', 'address': ENV.get('PANEL_ADDRESS') or '',
        'hub': ENV.get('PANEL_HUB') or ''}

COOKIE = 'wowpanel'
SESSION_DAYS = 7
SAMPLE_EVERY = 300          # раз в 5 минут пишем онлайн и нагрузку в историю
SAMPLE_KEEP_DAYS = 180

# Аккаунты-боты от выключенного модуля плейерботов и служебный аккаунт SOAP.
# В статистике по умолчанию их не считаем: 1800 ботов утопили бы четырёх живых.
BOT_LIKE = 'RNDBOT%'
SERVICE_ACCOUNT = SOAP_USER.upper()

# --- справочники игры --------------------------------------------------------

RACES = {1: ('Человек', 'A'), 2: ('Орк', 'H'), 3: ('Дворф', 'A'), 4: ('Ночной эльф', 'A'),
         5: ('Нежить', 'H'), 6: ('Таурен', 'H'), 7: ('Гном', 'A'), 8: ('Тролль', 'H')}
CLASSES = {1: 'Воин', 2: 'Паладин', 3: 'Охотник', 4: 'Разбойник', 5: 'Жрец',
           7: 'Шаман', 8: 'Маг', 9: 'Чернокнижник', 11: 'Друид'}
GM_LEVELS = {0: 'Игрок', 1: 'Модератор', 2: 'Гейм-мастер', 3: 'Администратор'}
EQUIP_SLOTS = ['Голова', 'Шея', 'Плечи', 'Рубашка', 'Грудь', 'Пояс', 'Ноги', 'Ступни',
               'Запястья', 'Кисти рук', 'Палец', 'Палец', 'Аксессуар', 'Аксессуар', 'Спина',
               'Правая рука', 'Левая рука', 'Дальний бой', 'Гербовая накидка']

# Настройки mangosd.conf, которые можно менять из панели. Остальные ~1800 строк
# конфига намеренно недоступны: там пути, пароли и параметры, от которых мир
# просто не запустится. kind: int | float | bool | text.
# reload=True — подхватывается командой reload config без перезапуска мира.
CONFIG_GROUPS = [
    ('Опыт и добыча', [
        ('Rate.XP.Kill', 'Опыт за убийства', 'float', 0, 100, True),
        ('Rate.XP.Quest', 'Опыт за задания', 'float', 0, 100, True),
        ('Rate.XP.Explore', 'Опыт за исследование', 'float', 0, 100, True),
        ('Rate.Drop.Money', 'Выпадение денег', 'float', 0, 100, True),
        ('Rate.Drop.Item.Poor', 'Добыча: серые', 'float', 0, 100, True),
        ('Rate.Drop.Item.Normal', 'Добыча: белые', 'float', 0, 100, True),
        ('Rate.Drop.Item.Uncommon', 'Добыча: зелёные', 'float', 0, 100, True),
        ('Rate.Drop.Item.Rare', 'Добыча: синие', 'float', 0, 100, True),
        ('Rate.Drop.Item.Epic', 'Добыча: фиолетовые', 'float', 0, 100, True),
        ('Rate.Drop.Item.Legendary', 'Добыча: оранжевые', 'float', 0, 100, True),
        ('Rate.Honor', 'Очки чести', 'float', 0, 100, True),
        ('Rate.Reputation.Gain', 'Репутация', 'float', 0, 100, True),
        ('Rate.Rest.InGame', 'Отдых в игре', 'float', 0, 100, True),
        ('Rate.Rest.Offline.InTavernOrCity', 'Отдых офлайн в таверне', 'float', 0, 100, True),
        ('Rate.Rest.Offline.InWilderness', 'Отдых офлайн в поле', 'float', 0, 100, True),
    ]),
    ('Навыки', [
        ('SkillGain.Crafting', 'Рост ремёсел за раз', 'int', 1, 20, True),
        ('SkillGain.Gathering', 'Рост сбора за раз', 'int', 1, 20, True),
        ('SkillGain.Weapon', 'Рост владения оружием', 'int', 1, 20, True),
        ('SkillGain.Defense', 'Рост защиты', 'int', 1, 20, True),
        ('MaxPrimaryTradeSkill', 'Основных профессий', 'int', 0, 11, False),
        ('AlwaysMaxSkillForLevel', 'Навыки оружия сразу максимальны', 'bool', 0, 1, False),
    ]),
    ('Игроки', [
        ('Motd', 'Приветствие при входе', 'text', 0, 255, True),
        ('MaxPlayerLevel', 'Максимальный уровень', 'int', 1, 60, False),
        ('StartPlayerLevel', 'Стартовый уровень', 'int', 1, 60, False),
        ('StartPlayerMoney', 'Стартовые деньги (медь)', 'int', 0, 100000000, False),
        ('PlayerLimit', 'Лимит игроков онлайн', 'int', -3, 10000, False),
        ('CharactersPerRealm', 'Персонажей на аккаунт', 'int', 1, 10, False),
        ('CharactersCreatingDisabled', 'Запрет создания (0 нет, 1 Альянс, 2 Орда, 3 все)', 'int', 0, 3, False),
        ('SkipCinematics', 'Пропуск роликов (0 нет, 1 первый, 2 все)', 'int', 0, 2, False),
    ]),
    ('Фракции вместе', [
        ('AllowTwoSide.Accounts', 'Обе фракции на аккаунте', 'bool', 0, 1, False),
        ('AllowTwoSide.Interaction.Chat', 'Общий чат', 'bool', 0, 1, False),
        ('AllowTwoSide.Interaction.Channel', 'Общие каналы', 'bool', 0, 1, False),
        ('AllowTwoSide.Interaction.Group', 'Общие группы', 'bool', 0, 1, False),
        ('AllowTwoSide.Interaction.Guild', 'Общие гильдии', 'bool', 0, 1, False),
        ('AllowTwoSide.Interaction.Trade', 'Торговля', 'bool', 0, 1, False),
        ('AllowTwoSide.Interaction.Auction', 'Общий аукцион', 'bool', 0, 1, False),
        ('AllowTwoSide.Interaction.Mail', 'Почта', 'bool', 0, 1, False),
        ('AllowTwoSide.WhoList', 'Общий список «Кто»', 'bool', 0, 1, False),
        ('AllowTwoSide.AddFriend', 'Друзья из другой фракции', 'bool', 0, 1, False),
    ]),
    ('Мир', [
        ('ActivateWeather', 'Погода', 'bool', 0, 1, False),
        ('Instance.ResetTimeHour', 'Час сброса подземелий', 'int', 0, 23, False),
        ('Instance.IgnoreLevel', 'Пускать в подземелья без уровня', 'bool', 0, 1, False),
        ('Instance.IgnoreRaid', 'Пускать в рейды без рейда', 'bool', 0, 1, False),
        ('Rate.Creature.Normal.HP', 'Здоровье обычных мобов', 'float', 0.1, 10, False),
        ('Rate.Creature.Normal.Damage', 'Урон обычных мобов', 'float', 0.1, 10, False),
        ('Rate.Creature.Elite.Elite.HP', 'Здоровье элиты', 'float', 0.1, 10, False),
        ('Rate.Creature.Elite.Elite.Damage', 'Урон элиты', 'float', 0.1, 10, False),
        ('Rate.Creature.Elite.WORLDBOSS.HP', 'Здоровье мировых боссов', 'float', 0.1, 10, False),
        ('Rate.Creature.Elite.WORLDBOSS.Damage', 'Урон мировых боссов', 'float', 0.1, 10, False),
    ]),
]
CONFIG_SPEC = {k: (label, kind, lo, hi, reload) for _, items in CONFIG_GROUPS for k, label, kind, lo, hi, reload in items}

# Настройки ботов (ike3 playerbots и его бот аукциона). Ядро читает их только при
# запуске мира, поэтому после записи панель предлагает перезапуск. Остальные ~3500
# строк aiplayerbot.conf (таланты, шансы классов, стратегии) из панели не меняются.
# Элемент: (ключ, файл, подпись, вид, мин, макс, подсказка). Файл: ai | ah.
BOT_CONFS = {'ai': env_path('WOW_PLAYERBOT_CONF', CONF.parent / 'aiplayerbot.conf'),
             'ah': env_path('WOW_AHBOT_CONF', CONF.parent / 'ahbot.conf')}
BOT_GROUPS = [
    ('main', 'Главное', [
        ('AiPlayerbot.Enabled', 'ai', 'Система ботов включена', 'bool', 0, 1,
         'Главный рубильник. Выключено — ботов в мире нет совсем.'),
        ('AiPlayerbot.RandomBotAutologin', 'ai', 'Боты сами заходят в игру', 'bool', 0, 1,
         'Без этого система включена, но случайные боты в мире не появляются.'),
        ('AiPlayerbot.MinRandomBots', 'ai', 'Ботов в игре — не меньше', 'int', 0, 2000, None),
        ('AiPlayerbot.MaxRandomBots', 'ai', 'Ботов в игре — не больше', 'int', 0, 2000,
         'Число ботов в мире плавает между этими значениями и меняется раз в 30–120 минут.'),
        ('AiPlayerbot.RandomBotMinLevel', 'ai', 'Уровень ботов — от', 'int', 1, 60, None),
        ('AiPlayerbot.RandomBotMaxLevel', 'ai', 'Уровень ботов — до', 'int', 1, 60, None),
        ('AiPlayerbot.RandomBotLoginAtStartup', 'ai', 'Все боты заходят сразу при запуске мира', 'bool', 0, 1,
         'Иначе заходят постепенно, небольшими партиями.'),
        ('AiPlayerbot.RandomBotsMaxLoginsPerInterval', 'ai', 'Сколько ботов заходит за раз', 'int', 1, 100,
         'Размер партии при постепенном входе. По умолчанию 10.'),
        ('AiPlayerbot.botActiveAlone', 'ai', 'Активны вдали от игроков, %', 'int', 0, 100,
         'Сколько процентов ботов живут полной жизнью, даже когда рядом нет игроков. Больше — живее мир, '
         'но выше нагрузка. По умолчанию 10.'),
    ]),
    ('behavior', 'Поведение', [
        ('AiPlayerbot.RandomBotInvitePlayer', 'ai', 'Зовут игроков в группы и гильдии', 'bool', 0, 1,
         'Игрок может отказаться от приглашений, включив «Не беспокоить» (/dnd).'),
        ('AiPlayerbot.RandomBotGroupNearby', 'ai', 'Собираются в группы с ботами рядом', 'bool', 0, 1, None),
        ('AiPlayerbot.RandomBotJoinLfg', 'ai', 'Ищут группу (LFG)', 'bool', 0, 1, None),
        ('AiPlayerbot.RandomBotJoinBG', 'ai', 'Ходят на поля боя', 'bool', 0, 1, None),
        ('AiPlayerbot.RandomBotAutoJoinBG', 'ai', 'Сами встают в очередь на поля боя', 'bool', 0, 1,
         'Если сервер не тормозит.'),
        ('AiPlayerbot.EnableGreet', 'ai', 'Здороваются с игроками', 'bool', 0, 1, None),
        ('AiPlayerbot.EnableBroadcasts', 'ai', 'Пишут в общие чаты', 'bool', 0, 1,
         'Торговля, поиск группы, добыча, задания, уровни. Выключите, если чат слишком шумный.'),
        ('AiPlayerbot.BotAcceptDuelMinimumLevel', 'ai', 'Принимают дуэли с уровня', 'int', 1, 60, None),
        ('AiPlayerbot.RandomBotTeleportNearPlayer', 'ai', 'Перебираются в зоны рядом с игроками', 'bool', 0, 1,
         'Если по уровню подходят. Вокруг игроков становится люднее.'),
        ('AiPlayerbot.SyncLevelWithPlayers', 'ai', 'Уровень ботов не выше, чем у игроков + 5', 'bool', 0, 1,
         'Когда в игре никого нет, берётся уровень 1.'),
    ]),
    ('gear', 'Экипировка', [
        ('AiPlayerbot.RandomGearMaxLevel', 'ai', 'Потолок уровня вещей (item level)', 'int', 1, 500,
         'Фаза 1 (MC, Ony, ZG) — 71, BWL — 77, AQ — 88, Naxx — 100. 500 — без ограничения.'),
        ('AiPlayerbot.RandomGearUpgradeEnabled', 'ai', 'Сами обновляют экипировку по уровню', 'bool', 0, 1, None),
        ('AiPlayerbot.RandomGearLoweringChance', 'ai', 'Доля ботов с вещами похуже', 'float', 0, 1,
         'От 0 до 1: 0.15 — у 15% ботов вещи проще.'),
        ('AiPlayerbot.RandomBotMaxLevelChance', 'ai', 'Шанс сразу получить максимальный уровень', 'float', 0, 1,
         'От 0 до 1, при первом создании бота: 0.15 — 15%.'),
        ('AiPlayerbot.RandomBotShowHelmet', 'ai', 'Показывают шлем', 'bool', 0, 1, None),
        ('AiPlayerbot.RandomBotShowCloak', 'ai', 'Показывают плащ', 'bool', 0, 1, None),
    ]),
    ('guilds', 'Гильдии и боты игроков', [
        ('AiPlayerbot.RandomBotGuildCount', 'ai', 'Сколько гильдий у ботов', 'int', 0, 200, None),
        ('AiPlayerbot.RandomBotFormGuild', 'ai', 'Создают новые гильдии', 'bool', 0, 1,
         'Покупают хартию, собирают подписи и регистрируют гильдию.'),
        ('AiPlayerbot.RandomBotGuildNearby', 'ai', 'Зовут ботов рядом в свою гильдию', 'bool', 0, 1, None),
        ('AiPlayerbot.BotAutologin', 'ai', 'Персонажи игрока заходят ботами вместе с ним', 'bool', 0, 1,
         'Все остальные персонажи аккаунта входят в игру ботами, когда входит игрок.'),
        ('AiPlayerbot.AllowGuildBots', 'ai', 'Можно брать ботами персонажей своей гильдии', 'bool', 0, 1,
         'Командой .bot add Имя в игре.'),
        ('AiPlayerbot.AllowMultiAccountAltBots', 'ai', '…и персонажей с чужих аккаунтов', 'bool', 0, 1,
         'Нужна предыдущая галочка и общая гильдия.'),
    ]),
    ('ahbot', 'Бот аукциона', [
        ('AhBot.Enabled', 'ah', 'Бот аукциона включён', 'bool', 0, 1,
         'Выставляет товары на аукцион и покупает их, чтобы аукцион не пустовал.'),
        ('AhBot.UpdateInterval', 'ah', 'Как часто проверяет аукцион, секунд', 'int', 10, 3600, None),
    ]),
]
BOT_SPEC = {k: (conf, label, kind, lo, hi) for _, _, items in BOT_GROUPS for k, conf, label, kind, lo, hi, _hint in items}

# Журналы на вкладке «Логи»: файлы самого ядра (имена и папки — из mangosd.conf и realmd.conf)
# и свои: PANEL_LOGS=Подпись=/путь/к/файлу.log, … — например, вывод скрипта запуска.
CHAR_LOG = env_path('WOW_CHAR_LOG', CORE_LOGS / (CORE.get('CharLogFile') or 'Char.log'))
LOG_FILES = {
    'server': ('Server.log ядра', CORE_LOGS / (CORE.get('LogFile') or 'Server.log')),
    'dberrors': ('Ошибки мировой базы', CORE_LOGS / (CORE.get('DBErrorLogFile') or 'DBErrors.log')),
    'char': ('Действия с персонажами', CHAR_LOG),
    'eventai': ('Ошибки скриптов мобов', CORE_LOGS / (CORE.get('EventAIErrorLogFile') or 'EventAIErrors.log')),
    'realmd_core': ('Realmd.log ядра', REALMD_LOGS / (REALMD.get('LogFile') or 'Realmd.log')),
}
for _n, _item in enumerate(i for i in (ENV.get('PANEL_LOGS') or '').split(',') if '=' in i):
    _label, _path = (s.strip() for s in _item.split('=', 1))
    LOG_FILES['extra%d' % (_n + 1)] = (_label, Path(_path))

# Службы, которые показывает «Обзор»: PANEL_SERVICES=имя:процесс[:скрипт],… Процесс — имя
# исполняемого файла (несколько — через «|»), скрипт — для программ на python и т. п., где
# процесс у всех один. «self» — сама панель.
SERVICE_LABELS = {'mariadb': 'База данных', 'mysql': 'База данных', 'realmd': 'Авторизация',
                  'mangosd': 'Игровой мир', 'panel': 'Эта панель'}


def parse_services(text):
    out = []
    for item in text.split(','):
        parts = [p.strip() for p in item.split(':')]
        if len(parts) >= 2 and parts[0] and parts[1]:
            out.append((parts[0], SERVICE_LABELS.get(parts[0], parts[0]), parts[1], parts[2] if len(parts) > 2 and parts[2] else None))
    return out


SERVICES = parse_services(ENV.get('PANEL_SERVICES') or 'mariadb:mariadbd|mysqld,realmd:realmd,mangosd:mangosd,panel:self')
# Какие службы панель может перезапустить, убив процесс (SIGTERM): поднять её снова должен
# тот, кто её запускает, — systemd с Restart=always или ваш скрипт-перезапускатель.
# Мир так не трогаем — только через server restart, чтобы он сохранил игроков.
# Базу и саму панель не трогаем вовсе. Без перезапускателя сюда ничего не вписывать.
KILLABLE = {k.strip() for k in (ENV.get('PANEL_KILLABLE') or '').split(',') if k.strip()} - {'mangosd', 'panel', 'mariadb', 'mysql'}

# --- проверки ввода ----------------------------------------------------------

ACCOUNT_RE = re.compile(r'^[A-Za-z0-9_]{2,16}$')
# Имена персонажей в классике бывают и кириллицей, поэтому белый список букв
# не годится: запрещаем только то, что ломает разбор консольной команды.
CHARNAME_RE = re.compile(r'^[^\s"\'\\|%;#]{2,12}$')
PASSWORD_RE = re.compile(r'^[A-Za-z0-9!@$^&*()_+\-=.,]{4,16}$')
DURATION_RE = re.compile(r'^(-1|(?:\d+[dhms])+)$')
TELE_RE = re.compile(r'^[A-Za-z0-9_\'-]{1,50}$')
BAD_CHARS = re.compile(r'[\r\n\x00]')
WOW_CODES = re.compile(r'\|c[0-9a-fA-F]{8}|\|r|\|H[^|]*\|h|\|h')


class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def need(cond, message):
    if not cond:
        raise ApiError(message)


def account_arg(value):
    value = str(value or '').strip()
    need(ACCOUNT_RE.match(value), 'Логин: 2–16 латинских букв, цифр или «_».')
    return value.upper()


def char_arg(value):
    value = str(value or '').strip()
    need(CHARNAME_RE.match(value), 'Имя персонажа: 2–12 символов, без пробелов и кавычек.')
    return value


def text_arg(value, maxlen=255, what='Текст'):
    """Свободный текст для команды. Кавычки выкидываем: в send mail/items/money
    текст заключается в кавычки, и лишняя кавычка сломала бы разбор. Вертикальную
    черту тоже — в WoW ею начинаются цветовые коды и ссылки."""
    value = re.sub(r'\s+', ' ', str(value or '').replace('"', '').replace('|', '')).strip()
    need(value, '%s не может быть пустым.' % what)
    need(len(value) <= maxlen, '%s длиннее %d символов.' % (what, maxlen))
    return value


def int_arg(value, lo, hi, what='Число'):
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError):
        raise ApiError('%s: нужно целое число.' % what)
    need(lo <= number <= hi, '%s: допустимо от %d до %d.' % (what, lo, hi))
    return number


def ip_arg(value):
    try:
        return str(ipaddress.ip_address(str(value or '').strip()))
    except ValueError:
        raise ApiError('Некорректный IP-адрес.')


def duration_arg(value):
    value = str(value or '').strip().lower().replace(' ', '')
    need(DURATION_RE.match(value), 'Срок: -1 навсегда или вроде 30m, 12h, 7d, 1d12h.')
    return value


def gen_password(length=10):
    alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    return ''.join(secrets.choice(alphabet) for _ in range(length))


# --- JSON ----------------------------------------------------------------------


def _json_default(obj):
    # Время из базы отдаём секундами Unix: браузер сам покажет его в поясе
    # пользователя. Наивное время из MariaDB — это время сервера.
    if isinstance(obj, datetime):
        return int(obj.timestamp())
    if isinstance(obj, date):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return int(obj) if obj == obj.to_integral_value() else float(obj)
    if isinstance(obj, bytes):
        return obj.decode('utf-8', 'replace')
    raise TypeError(type(obj).__name__)


jdumps = functools.partial(json.dumps, default=_json_default, ensure_ascii=False)


def ok(data=None, **extra):
    payload = {'ok': True}
    if data is not None:
        payload['data'] = data
    payload.update(extra)
    return web.json_response(payload, dumps=jdumps)


def json_error(message, status=400):
    return web.json_response({'ok': False, 'error': message}, status=status, dumps=jdumps)


async def body(request):
    try:
        data = await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ApiError('Тело запроса — не JSON.')
    need(isinstance(data, dict), 'Тело запроса — не объект.')
    return data


# --- база ----------------------------------------------------------------------


def _connect():
    return pymysql.connect(**DB, charset='utf8mb4', cursorclass=pymysql.cursors.DictCursor,
                           autocommit=True, connect_timeout=5, read_timeout=30, write_timeout=30)


def _db_query(sql, args=None, one=False):
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, args)
            rows = list(cur.fetchall())
    finally:
        conn.close()
    if one:
        return rows[0] if rows else None
    return rows


def _db_exec(sql, args=None):
    conn = _connect()
    try:
        with conn.cursor() as cur:
            return cur.execute(sql, args)
    finally:
        conn.close()


async def dbq(sql, args=None, one=False):
    try:
        return await asyncio.to_thread(_db_query, sql, args, one)
    except pymysql.MySQLError as e:
        raise ApiError('Ошибка базы: %s' % (e.args[-1] if e.args else e), 502)


async def dbx(sql, args=None):
    try:
        return await asyncio.to_thread(_db_exec, sql, args)
    except pymysql.MySQLError as e:
        raise ApiError('Ошибка базы: %s' % (e.args[-1] if e.args else e), 502)


# --- SOAP ----------------------------------------------------------------------

SOAP_ENVELOPE = (
    '<?xml version="1.0" encoding="utf-8"?>'
    '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" '
    'xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/" '
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
    'xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:ns1="urn:MaNGOS">'
    '<SOAP-ENV:Body><ns1:executeCommand><command>{}</command></ns1:executeCommand>'
    '</SOAP-ENV:Body></SOAP-ENV:Envelope>')
SOAP_LOCK = None


def clean_wow(text):
    return WOW_CODES.sub('', text or '').replace('\r', '').strip()


def _find_local(root, name):
    for el in root.iter():
        tag = el.tag.rsplit('}', 1)[-1]
        if tag == name:
            return el
    return None


async def _soap_exchange(payload, timeout):
    """Один запрос к SOAP ядра, ответ целиком (b'' — ядро оборвало связь).

    Соединение закрываем обычным образом. 26.09 пробовали закрывать сбросом
    (SO_LINGER 0), чтобы порт 7878 не оставался в TIME_WAIT, — после такого мир
    вешался на выключении («SOAP shutting down» и тишина) в двух случаях из трёх, при
    обычном закрытии — ни разу из трёх. Точную причину в ядре найти не удалось. Порт может
    ещё минуту после перезапуска мира оставаться занятым — поэтому в примере службы systemd
    для мира стоит Restart=on-failure с паузой: не сумев открыть порт, мир запустится снова."""
    reader, writer = await asyncio.wait_for(asyncio.open_connection(SOAP_HOST, SOAP_PORT), timeout)
    try:
        head = ('POST / HTTP/1.1\r\nHost: %s:%d\r\nContent-Type: text/xml; charset=utf-8\r\n'
                'SOAPAction: "executeCommand"\r\nAuthorization: %s\r\nContent-Length: %d\r\n'
                'Connection: close\r\n\r\n' % (SOAP_HOST, SOAP_PORT, SOAP_AUTH, len(payload))).encode('ascii')
        writer.write(head + payload)
        await writer.drain()
        return await asyncio.wait_for(reader.read(-1), timeout)
    finally:
        writer.close()


async def soap(cmd, timeout=20):
    """Выполнить консольную команду ядра. Возвращает (успех, текст ответа)."""
    cmd = (cmd or '').strip()
    if not cmd or BAD_CHARS.search(cmd):
        return False, 'Пустая команда или перевод строки внутри — отклонено.'
    payload = SOAP_ENVELOPE.format(xml_escape(cmd)).encode('utf-8')
    try:
        async with SOAP_LOCK:
            data = await _soap_exchange(payload, timeout)
    except asyncio.TimeoutError:
        return False, 'Мир не ответил за %d с — занят или завис.' % timeout
    except OSError:
        return False, 'SOAP недоступен: мир не запущен или ещё грузится.'
    if not data:
        # Особенность этой сборки ядра: на неудачную команду SOAP рвёт соединение,
        # не отдав ни байта, хотя по исходнику должен вернуть fault с текстом.
        # Сам SOAP и мир при этом живы. Текст ошибки добывает run_cmd.
        return False, None
    head, _, raw = data.partition(b'\r\n\r\n')
    try:
        status = int(head.split(b' ', 2)[1])
    except (IndexError, ValueError):
        return False, 'Непонятный ответ SOAP: ' + data[:200].decode('utf-8', 'replace')
    if status == 401:
        return False, 'SOAP отверг логин или пароль служебного аккаунта.'
    if status == 403:
        return False, 'У служебного аккаунта SOAP нет прав администратора.'
    try:
        root = ElementTree.fromstring(raw)
    except ElementTree.ParseError:
        return False, 'Непонятный ответ SOAP (HTTP %d): %s' % (status, raw[:300].decode('utf-8', 'replace'))
    result = _find_local(root, 'result')
    if result is not None:
        return True, clean_wow(result.text)
    fault = _find_local(root, 'faultstring')
    text = clean_wow(fault.text if fault is not None else '')
    return False, text or 'Команда не выполнена (ядро не объяснило почему).'


# --- журнал панели и история -------------------------------------------------


def panel_db():
    conn = sqlite3.connect(PANEL_DB, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_panel_db():
    DATA.mkdir(parents=True, exist_ok=True)
    with panel_db() as conn:
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS samples (
                ts INTEGER PRIMARY KEY, online INTEGER, cpu REAL, mem_mb INTEGER, world_mb INTEGER);
            CREATE TABLE IF NOT EXISTS audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, action TEXT, detail TEXT,
                ok INTEGER, output TEXT);
            CREATE INDEX IF NOT EXISTS audit_ts ON audit(ts);
            CREATE TABLE IF NOT EXISTS schedule (
                id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, at INTEGER, delay INTEGER, created INTEGER);
            CREATE TABLE IF NOT EXISTS countdown (
                id INTEGER PRIMARY KEY CHECK (id = 1), kind TEXT, started INTEGER, deadline INTEGER, source TEXT);
            CREATE TABLE IF NOT EXISTS item_trash (
                id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, char_guid INTEGER, char_name TEXT, item_guid INTEGER,
                entry INTEGER, name TEXT, inv TEXT, inst TEXT, restored INTEGER DEFAULT 0);
            CREATE TABLE IF NOT EXISTS custom_changes (kind TEXT, id INTEGER, ts INTEGER, PRIMARY KEY (kind, id));
            CREATE TABLE IF NOT EXISTS npc_flag_patch (entry INTEGER PRIMARY KEY, original INTEGER, ts INTEGER);
            CREATE TABLE IF NOT EXISTS quest_loot (quest INTEGER, loot INTEGER, item INTEGER, chance REAL, creature INTEGER);
            DELETE FROM schedule WHERE kind <> 'restart';
        ''')
    os.chmod(PANEL_DB, 0o600)


def audit(action, detail, success=True, output=''):
    try:
        with panel_db() as conn:
            conn.execute('INSERT INTO audit(ts, action, detail, ok, output) VALUES (?,?,?,?,?)',
                         (int(time.time()), action, detail, 1 if success else 0, (output or '')[:4000]))
    except sqlite3.Error as e:
        print('audit write failed:', e, file=sys.stderr)


REJECTED = ('Ядро отклонило команду, не объяснив причину: скорее всего, неверные аргументы '
            'или цель не найдена.')


async def explain_rejection(cmd):
    """Текст ошибки для отклонённой команды — без её повторного выполнения.

    SOAP этой сборки на отказ рвёт соединение и теряет ответ ядра. Повторять
    команду ради текста нельзя: некоторые команды выполняются, но всё равно
    сообщают «неудачу» (так делает смена пароля, чтобы пароль не попал в журнал),
    и повтор выполнил бы их дважды. Поэтому объясняем по справочнику команд."""
    words = cmd.split()
    for n in range(min(len(words), 4), 0, -1):
        row = await dbq(f'SELECT name, help FROM {W}.command WHERE name = %s', (' '.join(words[:n]).lower(),), one=True)
        if row:
            help_text = (row['help'] or '').replace('\r', '').strip()
            return REJECTED + ('\n\nСправка по «%s»:\n%s' % (row['name'], help_text) if help_text else '')
    return 'Такой команды нет: «%s». Полный список — в справочнике справа в разделе «Консоль».' % (words[0] if words else cmd)


async def run_cmd(action, detail, cmd):
    success, output = await soap(cmd)
    if output is None:
        output = await explain_rejection(cmd)
    audit(action, detail, success, output)
    return {'success': success, 'output': output}


async def char_target(name, need_online=False):
    """Проверка цели до ядра: так видна понятная причина, а не обрыв SOAP."""
    row = await dbq(f'SELECT guid, name, online FROM {C}.characters WHERE name = %s', (name,), one=True)
    need(row, 'Персонажа «%s» нет.' % name)
    need(row['online'] or not need_online,
         '%s сейчас не в игре — эта команда работает только с теми, кто онлайн.' % row['name'])
    return row['name']


async def account_target(username):
    row = await dbq(f'SELECT id FROM {R}.account WHERE username = %s', (username,), one=True)
    need(row, 'Аккаунта %s нет.' % username)
    return username


# --- процессы и нагрузка -----------------------------------------------------

CLK = os.sysconf('SC_CLK_TCK')
NCPU = os.cpu_count() or 1
CPU_STATE = {'procs': {}, 'cg': None, 'cpu': {}, 'cg_pct': None}


def _read(path, default=''):
    try:
        with open(path, 'r', encoding='utf-8', errors='replace') as f:
            return f.read()
    except OSError:
        return default


def scan_procs():
    found = {name: os.getpid() for name, _label, want, _script in SERVICES if want == 'self'}
    for pid in os.listdir('/proc'):
        if not pid.isdigit():
            continue
        try:
            with open('/proc/%s/cmdline' % pid, 'rb') as f:
                raw = f.read()
        except OSError:
            continue
        argv = [a.decode('utf-8', 'replace') for a in raw.split(b'\0') if a]
        if not argv:
            continue
        exe = os.path.basename(argv[0])
        for name, _label, want, script in SERVICES:
            if exe in want.split('|') and (script is None or any(os.path.basename(a) == script for a in argv[1:])):
                found.setdefault(name, int(pid))
    return found


def proc_info(pid):
    stat = _read('/proc/%d/stat' % pid)
    if not stat:
        return None
    fields = stat[stat.rfind(')') + 2:].split()
    ticks = int(fields[11]) + int(fields[12])
    started = int(fields[19]) / CLK
    uptime = float(_read('/proc/uptime', '0 0').split()[0])
    rss = 0
    for line in _read('/proc/%d/status' % pid).splitlines():
        if line.startswith('VmRSS:'):
            rss = int(line.split()[1]) * 1024
            break
    return {'pid': pid, 'rss': rss, 'ticks': ticks, 'age': max(0, int(uptime - started))}


# В контейнере (cgroup v2 со своим memory.current) считаем его память и процессор — с лимитом
# контейнера; на обычном сервере — всю машину.
IN_CONTAINER = os.path.exists('/sys/fs/cgroup/memory.current')


def cgroup_stats():
    if not IN_CONTAINER:
        return machine_stats()
    mem = _read('/sys/fs/cgroup/memory.current').strip()
    limit = _read('/sys/fs/cgroup/memory.max').strip()
    usage = 0
    for line in _read('/sys/fs/cgroup/cpu.stat').splitlines():
        if line.startswith('usage_usec'):
            usage = int(line.split()[1])
    return {'mem': int(mem) if mem.isdigit() else None,
            'limit': int(limit) if limit.isdigit() else None,
            'usage_usec': usage}


def machine_stats():
    """Память и процессор всей машины — в тех же полях, что у cgroup_stats."""
    info = {}
    for line in _read('/proc/meminfo').splitlines():
        key, _, rest = line.partition(':')
        if key in ('MemTotal', 'MemAvailable'):
            info[key] = int(rest.split()[0]) * 1024
    usage = 0
    cpu = _read('/proc/stat').split('\n', 1)[0].split()
    if cpu and cpu[0] == 'cpu':
        ticks = [int(x) for x in cpu[1:9]]          # user nice system idle iowait irq softirq steal
        usage = (sum(ticks) - ticks[3] - ticks[4]) * 1000000 // CLK
    total, avail = info.get('MemTotal'), info.get('MemAvailable')
    return {'mem': total - avail if total and avail is not None else None, 'limit': total, 'usage_usec': usage}


def host_stats():
    info = {}
    for line in _read('/proc/meminfo').splitlines():
        key, _, rest = line.partition(':')
        if key in ('MemTotal', 'MemAvailable'):
            info[key] = int(rest.split()[0]) * 1024
    load = _read('/proc/loadavg', '0 0 0').split()[:3]
    try:
        vfs = os.statvfs(str(WOW))
        disk_total = vfs.f_blocks * vfs.f_frsize
        disk_free = vfs.f_bavail * vfs.f_frsize
    except OSError:
        disk_total = disk_free = None
    return {'mem_total': info.get('MemTotal'), 'mem_avail': info.get('MemAvailable'),
            'load': [float(x) for x in load], 'disk_total': disk_total, 'disk_free': disk_free,
            'ncpu': NCPU}


def dir_size(path):
    total = 0
    try:
        for entry in os.scandir(path):
            try:
                if entry.is_file(follow_symlinks=False):
                    total += entry.stat(follow_symlinks=False).st_size
                elif entry.is_dir(follow_symlinks=False):
                    total += dir_size(entry.path)
            except OSError:
                pass
    except OSError:
        pass
    return total


def cpu_tick():
    """Раз в 10 с снимаем счётчики CPU, чтобы на обзоре был процент, а не секунды."""
    now = time.monotonic()
    procs = scan_procs()
    fresh = {}
    for name, pid in procs.items():
        info = proc_info(pid)
        if not info:
            continue
        prev = CPU_STATE['procs'].get(name)
        if prev and prev['pid'] == pid and now > prev['t']:
            CPU_STATE['cpu'][name] = (info['ticks'] - prev['ticks']) / CLK / (now - prev['t']) * 100
        fresh[name] = {'pid': pid, 'ticks': info['ticks'], 't': now}
    CPU_STATE['procs'] = fresh
    cg = cgroup_stats()
    prev = CPU_STATE['cg']
    if prev and now > prev['t']:
        CPU_STATE['cg_pct'] = (cg['usage_usec'] - prev['usage']) / 1e6 / (now - prev['t']) / NCPU * 100
    CPU_STATE['cg'] = {'usage': cg['usage_usec'], 't': now}


def services_snapshot():
    procs = scan_procs()
    result = []
    for name, label, _exe, _script in SERVICES:
        pid = procs.get(name)
        info = proc_info(pid) if pid else None
        result.append({
            'name': name, 'label': label, 'running': bool(info),
            'pid': pid, 'rss': info['rss'] if info else None, 'age': info['age'] if info else None,
            'cpu': round(CPU_STATE['cpu'].get(name, 0), 1) if info else None,
            'restartable': name in KILLABLE or name == 'mangosd',
        })
    return result


# --- зоны из DBC -------------------------------------------------------------

AREAS = {}


AREA_PARENT = {}                # подзона → зона (Круговзор → Зимние Ключи)
AREA_BY_FLAG = {}               # в .map-файлах ядра записан флаг исследования зоны, а не её номер


def load_areas():
    """Названия зон берём из AreaTable.dbc клиента: в мировой базе их нет."""
    names = {}
    try:
        raw = (DBC / 'AreaTable.dbc').read_bytes()
        sig, count, fields, size, strings = struct.unpack('<4s4I', raw[:20])
        if sig != b'WDBC' or fields < 12:
            return names
        block = raw[20 + count * size: 20 + count * size + strings]
        for i in range(count):
            rec = struct.unpack_from('<%dI' % fields, raw, 20 + i * size)
            off = rec[11]
            if rec[2]:
                AREA_PARENT[rec[0]] = rec[2]
            AREA_BY_FLAG.setdefault(rec[3], rec[0])
            if 0 < off < len(block):
                names[rec[0]] = block[off:block.find(b'\0', off)].decode('utf-8', 'replace')
    except (OSError, struct.error) as e:
        print('AreaTable.dbc не прочитан:', e, file=sys.stderr)
    return names


def zone_name(zone_id):
    return AREAS.get(zone_id) or ('зона %s' % zone_id if zone_id else '—')


def decorate_char(row):
    race = RACES.get(row.get('race'), ('?', '?'))
    row['race_name'] = race[0]
    row['faction'] = race[1]
    row['class_name'] = CLASSES.get(row.get('class'), '?')
    if 'zone' in row:
        row['zone_name'] = zone_name(row['zone'])
    return row


# --- страна по IP ----------------------------------------------------------------
# База GeoLite2-Country (бесплатная, с сайта MaxMind) — файл data/GeoLite2-Country.mmdb или
# путь в GEOIP_DB. Нет файла — страны просто не показываются. Адреса игроков никуда не
# отправляются: страна ищется в этом файле.

GEO_DB = env_path('GEOIP_DB', DATA / 'GeoLite2-Country.mmdb')
GEO_LAN = {'code': 'LAN', 'name': 'локальная сеть'}
GEO = {'db': None, 'mtime': None, 'cache': {}}


class MMDB:
    """Читатель формата MaxMind DB без сторонних модулей (модуль maxminddb не нужен).
    Умеет одно — найти запись по IP-адресу. Формат: двоичное дерево по битам
    адреса, листья указывают в раздел данных, данные — свой компактный формат."""

    MARKER = b'\xab\xcd\xefMaxMind.com'

    def __init__(self, path):
        with open(path, 'rb') as f:
            self.buf = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
        pos = self.buf.rfind(self.MARKER, max(0, len(self.buf) - 128 * 1024))
        if pos < 0:
            raise ValueError('%s — не база MaxMind' % path)
        meta_start = pos + len(self.MARKER)
        meta = self._decode(meta_start, meta_start)[0]
        self.nodes = meta['node_count']
        self.rsize = meta['record_size']
        if self.rsize not in (24, 28, 32):
            raise ValueError('неизвестный размер записи %s' % self.rsize)
        self.nbytes = self.rsize // 4
        self.data = self.nodes * self.nbytes + 16
        # IPv4 в базе IPv6 лежит под ::/96 — спускаемся на 96 нулевых битов один раз
        self.v4 = 0
        if meta.get('ip_version') == 6:
            node = 0
            for _ in range(96):
                if node >= self.nodes:
                    break
                node = self._record(node, 0)
            self.v4 = node

    def _record(self, node, bit):
        b, off = self.buf, node * self.nbytes
        if self.rsize == 24:
            off += bit * 3
            return int.from_bytes(b[off:off + 3], 'big')
        if self.rsize == 28:
            if bit:
                return ((b[off + 3] & 0x0F) << 24) | int.from_bytes(b[off + 4:off + 7], 'big')
            return ((b[off + 3] & 0xF0) << 20) | int.from_bytes(b[off:off + 3], 'big')
        off += bit * 4
        return int.from_bytes(b[off:off + 4], 'big')

    def _decode(self, off, base):
        """Одно значение с позиции off → (значение, позиция после него).
        base — начало раздела, от которого отсчитываются указатели."""
        b = self.buf
        ctrl = b[off]
        off += 1
        kind = ctrl >> 5
        if kind == 1:                                   # указатель на другое место раздела
            size = (ctrl >> 3) & 3
            if size == 3:
                ptr = int.from_bytes(b[off:off + 4], 'big')
            else:
                ptr = ((ctrl & 7) << (8 * (size + 1))) | int.from_bytes(b[off:off + size + 1], 'big')
                ptr += (0, 2048, 526336)[size]
            return self._decode(base + ptr, base)[0], off + size + 1
        if kind == 0:                                   # расширенный тип — номер в следующем байте
            kind = 7 + b[off]
            off += 1
        size = ctrl & 0x1F
        if size >= 29:
            extra = size - 28
            size = (29, 285, 65821)[extra - 1] + int.from_bytes(b[off:off + extra], 'big')
            off += extra
        if kind == 2:                                   # строка UTF-8
            return b[off:off + size].decode('utf-8', 'replace'), off + size
        if kind == 7:                                   # словарь
            out = {}
            for _ in range(size):
                key, off = self._decode(off, base)
                out[key], off = self._decode(off, base)
            return out, off
        if kind == 11:                                  # массив
            out = []
            for _ in range(size):
                val, off = self._decode(off, base)
                out.append(val)
            return out, off
        if kind in (5, 6, 9, 10):                       # беззнаковые целые
            return int.from_bytes(b[off:off + size], 'big'), off + size
        if kind == 8:                                   # int32
            val = int.from_bytes(b[off:off + size], 'big')
            return (val - (1 << 32) if size == 4 and val >> 31 else val), off + size
        if kind == 3:
            return struct.unpack('>d', b[off:off + 8])[0], off + 8
        if kind == 15:
            return struct.unpack('>f', b[off:off + 4])[0], off + 4
        if kind == 14:
            return bool(size), off
        if kind == 4:
            return bytes(b[off:off + size]), off + size
        return None, off

    def get(self, ip):
        addr = ipaddress.ip_address(ip)
        packed = addr.packed
        node = self.v4 if addr.version == 4 else 0
        for i in range(len(packed) * 8):
            if node >= self.nodes:
                break
            node = self._record(node, (packed[i >> 3] >> (7 - (i & 7))) & 1)
        if node > self.nodes:
            return self._decode(node - self.nodes - 16 + self.data, self.data)[0]
        return None


def geo_db():
    """Открытая база; если файл заменили (обновили копию) — открываем заново."""
    try:
        mtime = GEO_DB.stat().st_mtime
    except OSError:
        return None
    if GEO['db'] is None or GEO['mtime'] != mtime:
        try:
            GEO['db'] = MMDB(GEO_DB)
        except (OSError, ValueError, KeyError, IndexError) as e:
            print('GeoLite2-Country.mmdb не прочитан:', e, file=sys.stderr)
            GEO['db'] = None
        GEO['mtime'] = mtime
        GEO['cache'].clear()
    return GEO['db']


def country_of(ip):
    """{'code': 'RU', 'name': 'Россия'}; локальный адрес — LAN; не нашли — None."""
    if not ip:
        return None
    cache = GEO['cache']
    if ip in cache:
        return cache[ip]
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return None
    res = None
    if addr.is_private or addr.is_loopback or addr.is_link_local:
        res = GEO_LAN
    else:
        db = geo_db()
        if db:
            try:
                rec = db.get(ip) or {}
            except (ValueError, IndexError, KeyError, struct.error):
                rec = {}
            c = rec.get('country') or rec.get('registered_country') or {}
            if c.get('iso_code'):
                names = c.get('names') or {}
                res = {'code': c['iso_code'], 'name': names.get('ru') or names.get('en') or c['iso_code']}
    if len(cache) > 5000:
        cache.clear()
    cache[ip] = res
    return res


def with_country(rows, key='ip'):
    for r in rows:
        r['country'] = country_of(r.get(key))
    return rows


# --- авторизация -------------------------------------------------------------

LOGIN_FAILS = []
LOGIN_LIMIT = 5
LOGIN_WINDOW = 600


def verify_password(password):
    try:
        _algo, n, r, p, salt, digest = PASSWORD_HASH.split('$')
        got = hashlib.scrypt(password.encode('utf-8'), salt=bytes.fromhex(salt),
                             n=int(n), r=int(r), p=int(p), dklen=len(bytes.fromhex(digest)))
        return hmac.compare_digest(got, bytes.fromhex(digest))
    except (ValueError, TypeError):
        return False


def make_token():
    payload = base64.urlsafe_b64encode(jdumps({'exp': int(time.time()) + SESSION_DAYS * 86400,
                                               'n': secrets.token_hex(8)}).encode()).decode().rstrip('=')
    sig = hmac.new(SECRET, payload.encode(), hashlib.sha256).hexdigest()
    return payload + '.' + sig


def check_token(token):
    try:
        payload, sig = token.rsplit('.', 1)
        good = hmac.new(SECRET, payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, good):
            return False
        data = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
        return data.get('exp', 0) > time.time()
    except (ValueError, AttributeError, TypeError):
        return False


SECURITY_HEADERS = {
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https://wow.zamimg.com; style-src 'self'; "
                               "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; "
                               "base-uri 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
}


@web.middleware
async def guard(request, handler):
    if not peer_allowed(request.remote):
        return web.Response(status=403, text='Forbidden')
    path = request.path
    if path.startswith('/api/'):
        # Защита от подделки запросов с чужих страниц: браузер не пошлёт
        # собственный заголовок кросс-доменно без разрешения CORS, а его нет.
        if request.method == 'POST' and request.headers.get('X-Panel') != '1':
            return json_error('Запрос без заголовка панели отклонён.', 400)
        if path not in ('/api/login', '/api/session') and not check_token(request.cookies.get(COOKIE, '')):
            return json_error('Нужно войти заново.', 401)
    try:
        resp = await handler(request)
    except ApiError as e:
        resp = json_error(str(e), e.status)
    except web.HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 — панель не должна падать из-за одной ручки
        traceback.print_exc()
        resp = json_error('Внутренняя ошибка панели: %s' % e.__class__.__name__, 500)
    for key, value in SECURITY_HEADERS.items():
        resp.headers.setdefault(key, value)
    if path.startswith('/api/') or path == '/':
        resp.headers['Cache-Control'] = 'no-store'
    return resp


async def h_index(request):
    return web.FileResponse(STATIC / 'index.html')


def site_info():
    """Название сервера и что у него есть. bots — модуль playerbots (есть его конфиг);
    music, art — файлы из клиента игры и Fan Site Kit в static/ (их собирает
    tools/build_assets.py или кладут руками); container — панель в контейнере."""
    return {**SITE, 'bots': any(p.exists() for p in BOT_CONFS.values()),
            'music': (STATIC / 'music' / 'main.mp3').exists(),
            'art': (STATIC / 'wow' / 'bg-portal.jpg').exists(),
            'container': IN_CONTAINER}


async def h_session(request):
    return ok({'authed': check_token(request.cookies.get(COOKIE, '')), 'site': site_info()})


async def h_login(request):
    data = await body(request)
    now = time.time()
    LOGIN_FAILS[:] = [t for t in LOGIN_FAILS if now - t < LOGIN_WINDOW]
    if len(LOGIN_FAILS) >= LOGIN_LIMIT:
        wait = int(LOGIN_WINDOW - (now - LOGIN_FAILS[0])) + 1
        raise ApiError('Слишком много неверных попыток. Подождите %d мин.' % max(1, wait // 60 + 1), 429)
    password = str(data.get('password') or '')
    if not password or not await asyncio.to_thread(verify_password, password):
        LOGIN_FAILS.append(now)
        audit('login', 'неверный пароль', False)
        raise ApiError('Неверный пароль.', 403)
    LOGIN_FAILS.clear()
    audit('login', 'вход в панель')
    resp = ok()
    resp.set_cookie(COOKIE, make_token(), max_age=SESSION_DAYS * 86400, httponly=True,
                    samesite='Strict', path='/')
    return resp


async def h_logout(request):
    resp = ok()
    resp.del_cookie(COOKIE, path='/')
    return resp


# --- обзор -------------------------------------------------------------------

SERVER_INFO_RE = {
    'players': re.compile(r'Online players:\s*(\d+)', re.I),
    'max': re.compile(r'Online players:\s*\d+\s*\(max:\s*(\d+)\)', re.I),
    'uptime': re.compile(r'uptime:\s*(.+)', re.I),
}


def parse_server_info(text):
    info = {'raw': text}
    for key, rx in SERVER_INFO_RE.items():
        m = rx.search(text or '')
        if m:
            info[key] = m.group(1).strip()
    first = (text or '').splitlines()[0] if text else ''
    info['version'] = first
    return info


async def h_overview(request):
    counts = await dbq(f'''
        SELECT
          (SELECT COUNT(*) FROM {R}.account WHERE username NOT LIKE %s AND username <> %s) AS accounts,
          (SELECT COUNT(*) FROM {R}.account WHERE username LIKE %s) AS bot_accounts,
          (SELECT COUNT(*) FROM {C}.characters c JOIN {R}.account a ON a.id = c.account
             WHERE a.username NOT LIKE %s) AS chars,
          (SELECT COUNT(*) FROM {C}.characters c JOIN {R}.account a ON a.id = c.account
             WHERE a.username LIKE %s) AS bot_chars,
          (SELECT COUNT(*) FROM {C}.characters WHERE online = 1) AS online,
          (SELECT COUNT(*) FROM {C}.guild) AS guilds,
          (SELECT COUNT(*) FROM {R}.account_banned WHERE active = 1) AS bans,
          (SELECT COUNT(*) FROM {R}.ip_banned) AS ip_bans,
          (SELECT COUNT(*) FROM {R}.account WHERE username NOT LIKE %s
             AND joindate >= NOW() - INTERVAL 1 DAY) AS new_day,
          (SELECT COUNT(DISTINCT accountId) FROM {R}.account_logons
             WHERE loginTime >= NOW() - INTERVAL 1 DAY) AS logins_day,
          (SELECT COUNT(*) FROM {C}.gm_tickets WHERE closed = 0) AS tickets
    ''', (BOT_LIKE, SERVICE_ACCOUNT, BOT_LIKE, BOT_LIKE, BOT_LIKE, BOT_LIKE), one=True)
    realm = await dbq(f'SELECT id, name, address, port, allowedSecurityLevel, population, realmbuilds '
                      f'FROM {R}.realmlist WHERE id = %s', (REALM_ID,), one=True)
    session = await dbq(f'SELECT starttime, uptime, maxplayers FROM {R}.uptime WHERE realmid = %s '
                        f'ORDER BY starttime DESC LIMIT 1', (REALM_ID,), one=True)
    logins = await dbq(f'''
        SELECT l.loginTime AS at, l.ip, l.loginSource AS source, a.username, a.id AS account_id
        FROM {R}.account_logons l LEFT JOIN {R}.account a ON a.id = l.accountId
        ORDER BY l.id DESC LIMIT 10''')
    newest = await dbq(f'''
        SELECT id, username, joindate FROM {R}.account
        WHERE username NOT LIKE %s AND username <> %s ORDER BY id DESC LIMIT 6''', (BOT_LIKE, SERVICE_ACCOUNT))
    success, text = await soap('server info', timeout=6)
    server = parse_server_info(text) if success else {'error': text}
    cg = cgroup_stats()
    host = host_stats()
    services = services_snapshot()
    history = samples_since(time.time() - 86400)

    alerts = []
    for svc in services:
        if not svc['running'] and svc['name'] != 'panel':
            alerts.append(('critical', 'Служба «%s» не запущена.' % svc['label']))
    if not success:
        alerts.append(('serious', 'Мир не отвечает на SOAP: ' + text))
    if host['disk_free'] is not None and host['disk_free'] < 2 * 1024 ** 3:
        alerts.append(('serious', 'На диске меньше 2 ГБ свободного места.'))
    if cg['mem'] and cg['limit'] and cg['mem'] > 0.9 * cg['limit']:
        alerts.append(('serious', 'Занято больше 90% памяти.'))
    if realm and realm['allowedSecurityLevel'] > 0:
        alerts.append(('warning', 'Включён режим обслуживания: игроки не могут войти.'))
    if counts['tickets']:
        alerts.append(('warning', 'Открытых обращений к ГМ: %d.' % counts['tickets']))

    return ok({
        'counts': counts, 'realm': realm, 'session': session, 'server': server,
        'services': services, 'logins': with_country(logins), 'newest': newest, 'history': history,
        'container': {'mem': cg['mem'], 'limit': cg['limit'],
                      'cpu': round(CPU_STATE['cg_pct'], 1) if CPU_STATE['cg_pct'] is not None else None},
        'host': host, 'alerts': [{'level': lvl, 'text': t} for lvl, t in alerts],
        'now': int(time.time()),
    })


def samples_since(since):
    with panel_db() as conn:
        rows = conn.execute('SELECT ts, online, cpu, mem_mb, world_mb FROM samples WHERE ts >= ? ORDER BY ts',
                            (int(since),)).fetchall()
    return [dict(r) for r in rows]


# --- онлайн ------------------------------------------------------------------

async def h_online(request):
    rows = await dbq(f'''
        SELECT c.guid, c.name, c.level, c.race, c.class, c.gender, c.zone, c.map, c.totaltime,
               c.leveltime, c.money, a.id AS account_id, a.username, a.gmlevel, g.name AS guild,
               (SELECT l.ip FROM {R}.account_logons l WHERE l.accountId = a.id ORDER BY l.id DESC LIMIT 1) AS ip
        FROM {C}.characters c
        JOIN {R}.account a ON a.id = c.account
        LEFT JOIN {C}.guild_member gm ON gm.guid = c.guid
        LEFT JOIN {C}.guild g ON g.guildid = gm.guildid
        WHERE c.online = 1
        ORDER BY c.level DESC, c.name''')
    return ok(with_country([decorate_char(r) for r in rows]))


# --- аккаунты ----------------------------------------------------------------

ACCOUNT_SORT = {'id': 'a.id', 'username': 'a.username', 'gmlevel': 'a.gmlevel', 'joindate': 'a.joindate',
                'chars': 'chars', 'last_login': 'last_login'}


async def h_accounts(request):
    qs = request.query
    where, args = ['a.username <> %s'], [SERVICE_ACCOUNT]
    if qs.get('bots') != '1':
        where.append('a.username NOT LIKE %s')
        args.append(BOT_LIKE)
    term = qs.get('q', '').strip()
    if term:
        if term.isdigit():
            where.append('(a.id = %s OR a.username LIKE %s)')
            args += [int(term), '%' + term + '%']
        else:
            where.append('a.username LIKE %s')
            args.append('%' + term.replace('%', '').replace('_', r'\_') + '%')
    if qs.get('filter') == 'banned':
        where.append(f'EXISTS (SELECT 1 FROM {R}.account_banned b WHERE b.account_id = a.id AND b.active = 1)')
    elif qs.get('filter') == 'gm':
        where.append('a.gmlevel > 0')
    elif qs.get('filter') == 'online':
        where.append(f'EXISTS (SELECT 1 FROM {C}.characters c WHERE c.account = a.id AND c.online = 1)')
    sort = ACCOUNT_SORT.get(qs.get('sort', 'id'), 'a.id')
    direction = 'ASC' if qs.get('dir') == 'asc' else 'DESC'
    limit = min(int_arg(qs.get('limit', 50), 1, 500, 'limit'), 500)
    offset = int_arg(qs.get('offset', 0), 0, 10 ** 7, 'offset')
    clause = ' AND '.join(where)
    total = await dbq(f'SELECT COUNT(*) AS n FROM {R}.account a WHERE {clause}', args, one=True)
    rows = await dbq(f'''
        SELECT a.id, a.username, a.gmlevel, a.joindate, a.locked, a.lockedIp, a.failed_logins,
               a.mutetime, a.locale, a.os,
               (SELECT COUNT(*) FROM {C}.characters c WHERE c.account = a.id) AS chars,
               (SELECT COUNT(*) FROM {C}.characters c WHERE c.account = a.id AND c.online = 1) AS online,
               (SELECT MAX(l.loginTime) FROM {R}.account_logons l WHERE l.accountId = a.id) AS last_login,
               (SELECT l.ip FROM {R}.account_logons l WHERE l.accountId = a.id ORDER BY l.id DESC LIMIT 1) AS last_ip,
               (SELECT COUNT(*) FROM {R}.account_banned b WHERE b.account_id = a.id AND b.active = 1) AS banned
        FROM {R}.account a WHERE {clause}
        ORDER BY {sort} {direction}, a.id DESC LIMIT %s OFFSET %s''', args + [limit, offset])
    return ok(with_country(rows, 'last_ip'), total=total['n'])


async def account_by(ident):
    if str(ident).isdigit():
        row = await dbq(f'SELECT id, username, gmlevel, joindate, locked, lockedIp, failed_logins, mutetime, '
                        f'locale, os, platform, expansion, email FROM {R}.account WHERE id = %s',
                        (int(ident),), one=True)
    else:
        row = await dbq(f'SELECT id, username, gmlevel, joindate, locked, lockedIp, failed_logins, mutetime, '
                        f'locale, os, platform, expansion, email FROM {R}.account WHERE username = %s',
                        (account_arg(ident),), one=True)
    need(row, 'Аккаунт не найден.')
    return row


async def h_account(request):
    acc = await account_by(request.query.get('id', ''))
    chars = await dbq(f'''
        SELECT c.guid, c.name, c.level, c.race, c.class, c.gender, c.zone, c.online, c.money,
               c.totaltime, c.logout_time, g.name AS guild
        FROM {C}.characters c
        LEFT JOIN {C}.guild_member gm ON gm.guid = c.guid
        LEFT JOIN {C}.guild g ON g.guildid = gm.guildid
        WHERE c.account = %s ORDER BY c.level DESC''', (acc['id'],))
    logons = with_country(await dbq(f'SELECT loginTime AS at, ip, loginSource AS source FROM {R}.account_logons '
                                    f'WHERE accountId = %s ORDER BY id DESC LIMIT 2000', (acc['id'],)))
    bans = await dbq(f'SELECT banned_at, expires_at, banned_by, unbanned_at, unbanned_by, reason, active '
                     f'FROM {R}.account_banned WHERE account_id = %s ORDER BY banned_at DESC', (acc['id'],))
    acc['gm_name'] = GM_LEVELS.get(acc['gmlevel'], str(acc['gmlevel']))
    acc['is_bot'] = acc['username'].startswith('RNDBOT')
    return ok({'account': acc, 'characters': [decorate_char(c) for c in chars],
               'logons': logons, 'bans': bans, 'now': int(time.time())})


def protect_service_account(username):
    need(username.upper() != SERVICE_ACCOUNT,
         'Это служебный аккаунт панели — через него работает SOAP. Трогать его отсюда нельзя.')


async def h_account_create(request):
    data = await body(request)
    username = account_arg(data.get('username'))
    password = str(data.get('password') or '').strip() or gen_password()
    need(PASSWORD_RE.match(password), 'Пароль: 4–16 символов, латиница, цифры и !@$^&*()_+-=.,')
    level = int_arg(data.get('gmlevel', 0), 0, 3, 'Уровень прав')
    exists = await dbq(f'SELECT id FROM {R}.account WHERE username = %s', (username,), one=True)
    need(not exists, 'Такой логин уже занят.')
    success, output = await soap('account create %s %s' % (username, password))
    audit('account.create', 'аккаунт %s' % username, success, output or REJECTED)
    if not success:
        raise ApiError(output or 'Ядро не создало аккаунт.')
    if level:
        result = await run_cmd('account.gmlevel', '%s → %d' % (username, level),
                               'account set gmlevel %s %d' % (username, level))
        output += '\n' + result['output']
    return ok({'username': username, 'password': password, 'output': output})


async def h_account_password(request):
    data = await body(request)
    username = account_arg(data.get('username'))
    protect_service_account(username)
    await account_target(username)
    password = str(data.get('password') or '').strip() or gen_password()
    need(PASSWORD_RE.match(password), 'Пароль: 4–16 символов, латиница, цифры и !@$^&*()_+-=.,')
    # Ядро после успешной смены пароля нарочно отвечает «неудачей», чтобы пароль
    # не попал в журнал команд, — и SOAP рвёт соединение. Поэтому успех проверяем
    # по базе: при каждой смене пароля ядро заводит новую соль SRP.
    salt_sql = f'SELECT s FROM {R}.account WHERE username = %s'
    before = await dbq(salt_sql, (username,), one=True)
    success, output = await soap('account set password %s %s %s' % (username, password, password))
    after = await dbq(salt_sql, (username,), one=True)
    changed = bool(before and after and before['s'] != after['s'])
    output = 'Пароль изменён.' if changed else (output or 'Ядро не сменило пароль.')
    audit('account.password', 'новый пароль для %s' % username, changed, output)
    need(changed, output)
    return ok({'username': username, 'password': password, 'output': output})


async def h_account_gmlevel(request):
    data = await body(request)
    username = account_arg(data.get('username'))
    protect_service_account(username)
    level = int_arg(data.get('level'), 0, 3, 'Уровень прав')
    await account_target(username)
    return ok(await run_cmd('account.gmlevel', '%s → %s' % (username, GM_LEVELS[level]),
                            'account set gmlevel %s %d' % (username, level)))


async def h_account_delete(request):
    data = await body(request)
    username = account_arg(data.get('username'))
    protect_service_account(username)
    need(data.get('confirm') == username, 'Для удаления впишите логин ещё раз.')
    await account_target(username)
    return ok(await run_cmd('account.delete', 'удалён аккаунт %s со всеми персонажами' % username,
                            'account delete %s' % username))


async def h_account_lock(request):
    """Привязка аккаунта к IP: realmd пустит его только с этого адреса."""
    data = await body(request)
    acc = await account_by(data.get('id'))
    protect_service_account(acc['username'])
    if data.get('lock'):
        ip = data.get('ip')
        if not ip:
            last = await dbq(f'SELECT ip FROM {R}.account_logons WHERE accountId = %s ORDER BY id DESC LIMIT 1',
                             (acc['id'],), one=True)
            need(last and last['ip'], 'У аккаунта нет ни одного входа — не к чему привязать.')
            ip = last['ip']
        ip = ip_arg(ip)
        await dbx(f'UPDATE {R}.account SET locked = 1, lockedIp = %s WHERE id = %s', (ip, acc['id']))
        audit('account.lock', '%s привязан к %s' % (acc['username'], ip))
        return ok({'locked': True, 'ip': ip})
    await dbx(f'UPDATE {R}.account SET locked = 0 WHERE id = %s', (acc['id'],))
    audit('account.lock', '%s отвязан от IP' % acc['username'])
    return ok({'locked': False})


# --- персонажи ---------------------------------------------------------------

CHAR_SORT = {'level': 'c.level', 'name': 'c.name', 'money': 'c.money', 'played': 'c.totaltime',
             'logout': 'c.logout_time', 'kills': 'c.stored_honorable_kills', 'guid': 'c.guid'}


async def h_characters(request):
    qs = request.query
    if qs.get('deleted') == '1':
        rows = await dbq(f'''
            SELECT c.guid, c.deleteInfos_Name AS name, c.deleteInfos_Account AS account_id, c.deleteDate,
                   c.level, c.race, c.class, a.username
            FROM {C}.characters c LEFT JOIN {R}.account a ON a.id = c.deleteInfos_Account
            WHERE c.deleteDate IS NOT NULL ORDER BY c.deleteDate DESC LIMIT 200''')
        return ok([decorate_char(r) for r in rows], total=len(rows))
    where, args = ['1=1'], []
    if qs.get('bots') != '1':
        where.append('a.username NOT LIKE %s')
        args.append(BOT_LIKE)
    term = qs.get('q', '').strip()
    if term:
        where.append('(c.name LIKE %s OR a.username LIKE %s)')
        like = '%' + term.replace('%', '').replace('_', r'\_') + '%'
        args += [like, like]
    for key, column, spec in (('race', 'c.race', RACES), ('class', 'c.class', CLASSES)):
        if qs.get(key, '').isdigit() and int(qs[key]) in spec:
            where.append('%s = %%s' % column)
            args.append(int(qs[key]))
    if qs.get('online') == '1':
        where.append('c.online = 1')
    sort = CHAR_SORT.get(qs.get('sort', 'level'), 'c.level')
    direction = 'ASC' if qs.get('dir') == 'asc' else 'DESC'
    limit = int_arg(qs.get('limit', 50), 1, 500, 'limit')
    offset = int_arg(qs.get('offset', 0), 0, 10 ** 7, 'offset')
    clause = ' AND '.join(where)
    base = f'FROM {C}.characters c JOIN {R}.account a ON a.id = c.account WHERE {clause}'
    total = await dbq('SELECT COUNT(*) AS n ' + base, args, one=True)
    rows = await dbq(f'''
        SELECT c.guid, c.name, c.level, c.race, c.class, c.gender, c.zone, c.online, c.money, c.totaltime,
               c.logout_time, c.stored_honorable_kills AS kills, c.honor_highest_rank AS hrank,
               a.id AS account_id, a.username,
               (SELECT g.name FROM {C}.guild_member gm JOIN {C}.guild g ON g.guildid = gm.guildid
                  WHERE gm.guid = c.guid) AS guild
        {base} ORDER BY {sort} {direction}, c.guid LIMIT %s OFFSET %s''', args + [limit, offset])
    return ok([decorate_char(r) for r in rows], total=total['n'])


# --- карточка персонажа --------------------------------------------------------

CHAR_DBC = {}
CHAR_LOCK = None
RES_COLS = ('holy_res', 'fire_res', 'nature_res', 'frost_res', 'shadow_res', 'arcane_res')
STAT_COLS = ', '.join('it.stat_type%d, it.stat_value%d' % (i, i) for i in range(1, 11))
# Границы рангов репутации: Ненависть … Превознесение (как в ReputationMgr ядра)
REP_STEPS = ((-42000, -6000), (-6000, -3000), (-3000, 0), (0, 3000), (3000, 9000), (9000, 21000),
             (21000, 42000), (42000, 43000))


def _icon_file(path):
    """'Interface\\Icons\\Ability_Rogue_Eviscerate' → 'ability_rogue_eviscerate' — имя на wow.zamimg.com."""
    return path.replace('\\', '/').rsplit('/', 1)[-1].lower() if path else ''


def _load_char_dbc():
    """Справочники для карточки персонажа из DBC клиента: репутации, таланты,
    навыки, семейства питомцев и сколько всего районов можно открыть."""
    icons = {}
    raw, count, fields, size, block = _dbc('SpellIcon.dbc')
    for i in range(count):
        iid, off = struct.unpack_from('<2I', raw, 20 + i * size)
        icons[iid] = _icon_file(_dbc_str(block, off))
    factions = {}
    raw, count, fields, size, block = _dbc('Faction.dbc')
    for i in range(count):
        r = struct.unpack_from('<%di' % fields, raw, 20 + i * size)
        # 1 — место в окне репутации, 2–5 маски рас, 6–9 маски классов, 10–13 стартовые значения, 18 — группа
        factions[r[0]] = {'name': _dbc_str(block, r[19]), 'list': r[1], 'race': r[2:6], 'cls': r[6:10],
                          'base': r[10:14], 'parent': r[18]}
    headers = {f['parent'] for f in factions.values() if f['parent']}
    tabs = {}
    raw, count, fields, size, block = _dbc('TalentTab.dbc')
    for i in range(count):
        r = struct.unpack_from('<%dI' % fields, raw, 20 + i * size)
        tabs[r[0]] = {'id': r[0], 'name': _dbc_str(block, r[1]), 'icon': icons.get(r[10], ''), 'cls': r[12], 'order': r[13]}
    talents, trows = {}, {}
    raw, count, fields, size, block = _dbc('Talent.dbc')
    for i in range(count):
        r = struct.unpack_from('<%dI' % fields, raw, 20 + i * size)
        for rank, spell in enumerate(r[4:9], 1):       # заклинание каждого ранга таланта
            if spell:
                talents[spell] = (r[0], r[1], rank)
        # ряд, столбец, ранги, от какого таланта зависит — для дерева на вкладке «Таланты»
        trows[r[0]] = {'id': r[0], 'tab': r[1], 'row': r[2], 'col': r[3], 'ranks': [x for x in r[4:9] if x],
                       'dep': r[13], 'dep_rank': r[16]}
    skills = {}
    raw, count, fields, size, block = _dbc('SkillLine.dbc')
    for i in range(count):
        r = struct.unpack_from('<%di' % fields, raw, 20 + i * size)
        skills[r[0]] = (_dbc_str(block, r[3]), r[1], icons.get(r[21], ''))
    families = {}
    raw, count, fields, size, block = _dbc('CreatureFamily.dbc')
    for i in range(count):
        r = struct.unpack_from('<%dI' % fields, raw, 20 + i * size)
        families[r[0]] = (_dbc_str(block, r[8]), _icon_file(_dbc_str(block, r[17])))
    bits = set()
    raw, count, fields, size, block = _dbc('AreaTable.dbc')
    for i in range(count):
        r = struct.unpack_from('<%di' % fields, raw, 20 + i * size)
        if r[3] > 0:
            bits.add(r[3])
    return {'factions': factions, 'headers': headers, 'tabs': tabs, 'talents': talents, 'talent_rows': trows,
            'skills': skills, 'families': families, 'explore_total': len(bits), 'spell_icons': icons}


async def char_dbc():
    if not CHAR_DBC:
        async with CHAR_LOCK:
            if not CHAR_DBC:
                CHAR_DBC.update(await asyncio.to_thread(_load_char_dbc))
    return CHAR_DBC


def visual_rank(rank):
    """Звание PvP: ядро хранит 0..18, игроку показывает −4..14 (1 — рядовой/разведчик)."""
    rank = rank or 0
    return rank - 4 if rank > 4 else -rank


def bit_count(text):
    """Сколько единичных битов в строке чисел через пробел (exploredZones, taximask)."""
    total = 0
    for part in (text or '').split():
        try:
            total += bin(int(part) & 0xFFFFFFFF).count('1')
        except ValueError:
            pass
    return total


def rep_rank(value):
    """→ (номер ранга 0..7, сколько набрано внутри ранга, ширина ранга)."""
    for i, (lo, hi) in enumerate(REP_STEPS):
        if value < hi:
            return i, max(0, value - lo), hi - lo
    return 7, 999, 1000


def item_brief(it, icons):
    return {'bag': it['bag'], 'slot': it['slot'], 'guid': it['item'], 'entry': it['entry'], 'count': it['count'],
            'name': it['name'] or 'предмет #%s' % it['entry'], 'quality': it['Quality'] or 0,
            'ilvl': it['ilvl'], 'req': it['req'], 'icon': icons.get(it['displayid'] or 0, ''),
            'inv': it['inv'], 'size': it['bag_size'] or 0, 'dur': it['durability'], 'maxdur': it['maxdur']}


def inventory_layout(items, icons):
    """Раскладка вещей как в игре. В character_inventory у вещи с bag = 0 слот
    общий: 0–18 надето, 19–22 сумки, 23–38 рюкзак, 39–62 банк, 63–68 сумки банка,
    69–80 выкуп у торговца, 81–96 связка ключей. Вещь внутри сумки лежит
    с bag = guid этой сумки и номером ячейки в ней."""
    top = {r['slot']: r for r in items if r['bag'] == 0}
    inner = {}
    for r in items:
        if r['bag']:
            inner.setdefault(r['bag'], []).append(item_brief(r, icons))

    def container(slot):
        bag = top.get(slot)
        if not bag:
            return None
        out = item_brief(bag, icons)
        out['items'] = sorted(inner.pop(bag['item'], []), key=lambda x: x['slot'])
        return out

    def pick(lo, hi):
        return [item_brief(top[s], icons) for s in range(lo, hi) if s in top]

    bags = [b for b in map(container, range(19, 23)) if b]
    bank_bags = [b for b in map(container, range(63, 69)) if b]
    return {'equipped': pick(0, 19), 'backpack': pick(23, 39), 'bags': bags, 'bank': pick(39, 63),
            'bank_bags': bank_bags, 'buyback': pick(69, 81), 'keyring': pick(81, 97),
            'other': [it for rest in inner.values() for it in rest]}   # сумки не нашлось — покажем отдельно


def gear_summary(items):
    """Что даёт надетое: броня, характеристики, сопротивления, средний уровень вещей."""
    worn = [r for r in items if r['bag'] == 0 and r['slot'] < 19]
    stats, res, armor = {}, {}, 0
    for r in worn:
        armor += r['armor'] or 0
        for i in range(1, 11):
            kind, value = r['stat_type%d' % i], r['stat_value%d' % i]
            if value and kind is not None:
                stats[kind] = stats.get(kind, 0) + value
        for key in RES_COLS:
            if r[key]:
                res[key] = res.get(key, 0) + r[key]
    # рубашка и гербовая накидка в средний уровень не идут, как и в игре
    levels = [r['ilvl'] for r in worn if r['slot'] not in (3, 18) and r['ilvl']]
    return {'armor': armor, 'stats': stats, 'res': res, 'worn': len(worn),
            'ilvl': round(sum(levels) / len(levels), 1) if levels else None}


def talent_points(cd, cls, spells):
    """Очки в каждой ветке талантов: у каждого таланта берём старший изученный ранг."""
    best, tab_of = {}, {}
    for sid in spells:
        t = cd['talents'].get(sid)
        if t and t[2] > best.get(t[0], 0):
            best[t[0]] = t[2]
            tab_of[t[0]] = t[1]
    points = {}
    for tid, rank in best.items():
        points[tab_of[tid]] = points.get(tab_of[tid], 0) + rank
    mask = 1 << (cls - 1) if cls else 0
    tabs = sorted((t for t in cd['tabs'].values() if t['cls'] & mask), key=lambda t: t['order'])
    return [{'id': t['id'], 'name': t['name'], 'icon': t['icon'], 'points': points.get(t['id'], 0)} for t in tabs]


def reputation_list(cd, race, cls, rows):
    """Репутации, которые игрок видит в окне репутации, со стартовым значением
    для его расы и класса: в базе ядро хранит только набранное сверх него."""
    race_mask, class_mask = 1 << (race - 1), 1 << (cls - 1)
    out = []
    for r in rows:
        f = cd['factions'].get(r['faction'])
        if not f or f['list'] < 0 or r['faction'] in cd['headers'] or not f['name'].strip() or f['name'].startswith(' '):
            continue
        if not (r['flags'] & 1) or r['flags'] & 0x0C:          # не видна или скрыта
            continue
        base = next((f['base'][i] for i in range(4)
                     if (not f['race'][i] or f['race'][i] & race_mask) and (not f['cls'][i] or f['cls'][i] & class_mask)), 0)
        value = base + r['standing']
        rank, cur, span = rep_rank(value)
        parent = cd['factions'].get(f['parent'])
        out.append({'id': r['faction'], 'name': f['name'], 'group': parent['name'] if parent else '',
                    'value': value, 'rank': rank, 'cur': cur, 'span': span, 'war': bool(r['flags'] & 2)})
    out.sort(key=lambda x: -x['value'])
    return out


def appearance(pb, pb2):
    """Внешность из playerBytes: номера вариантов в окне создания персонажа."""
    return {'skin': pb & 0xFF, 'face': (pb >> 8) & 0xFF, 'hair_style': (pb >> 16) & 0xFF,
            'hair_color': (pb >> 24) & 0xFF, 'facial': pb2 & 0xFF}


async def h_character(request):
    guid = int_arg(request.query.get('guid'), 1, 2 ** 31, 'guid')
    row = await dbq(f'''
        SELECT c.guid, c.account AS account_id, c.name, c.race, c.class, c.gender, c.level, c.xp, c.money,
               c.online, c.totaltime, c.leveltime, c.logout_time, c.map, c.zone, c.health, c.power1,
               c.playerBytes, c.playerBytes2, c.rest_bonus, c.ammoId, c.exploredZones, c.taximask,
               c.honor_highest_rank AS hrank, c.honor_standing AS standing, c.stored_honor_rating AS rating,
               c.stored_honorable_kills AS kills, c.stored_dishonorable_kills AS dishonor, c.at_login,
               c.deleteDate, c.deleteInfos_Name, c.deleteInfos_Account, a.username, a.gmlevel,
               g.name AS guild, g.guildid, gm.`rank` AS guild_rank, gr.rname AS guild_rank_name
        FROM {C}.characters c
        LEFT JOIN {R}.account a ON a.id = c.account
        LEFT JOIN {C}.guild_member gm ON gm.guid = c.guid
        LEFT JOIN {C}.guild g ON g.guildid = gm.guildid
        LEFT JOIN {C}.guild_rank gr ON gr.guildid = gm.guildid AND gr.rid = gm.`rank`
        WHERE c.guid = %s''', (guid,), one=True)
    need(row, 'Персонаж не найден.')
    icons, cd = await item_icons(), await char_dbc()
    account = row['account_id'] or row['deleteInfos_Account'] or 0
    (items, skills, reps, spells, pets, quests, mail, xp, logons) = await asyncio.gather(
        dbq(f'''SELECT ci.bag, ci.slot, ci.item, ii.itemEntry AS entry, ii.count, ii.durability,
                       it.name, it.Quality, it.ItemLevel AS ilvl, it.RequiredLevel AS req, it.displayid,
                       it.InventoryType AS inv, it.ContainerSlots AS bag_size, it.armor, it.MaxDurability AS maxdur,
                       {STAT_COLS}, {', '.join('it.' + k for k in RES_COLS)}
                FROM {C}.character_inventory ci
                JOIN {C}.item_instance ii ON ii.guid = ci.item
                LEFT JOIN {W}.item_template it ON it.entry = ii.itemEntry
                WHERE ci.guid = %s ORDER BY ci.bag, ci.slot''', (guid,)),
        dbq(f'SELECT skill, value, max FROM {C}.character_skills WHERE guid = %s', (guid,)),
        dbq(f'SELECT faction, standing, flags FROM {C}.character_reputation WHERE guid = %s', (guid,)),
        dbq(f'SELECT spell FROM {C}.character_spell WHERE guid = %s AND disabled = 0', (guid,)),
        dbq(f'''SELECT p.name, p.level, p.PetType AS type, p.slot, ct.Name AS creature, ct.Family AS family
                FROM {C}.character_pet p LEFT JOIN {W}.creature_template ct ON ct.Entry = p.entry
                WHERE p.owner = %s ORDER BY p.slot''', (guid,)),
        dbq(f'''SELECT COALESCE(SUM(rewarded), 0) AS done,
                       COALESCE(SUM(rewarded = 0 AND status IN (1, 3, 5)), 0) AS active
                FROM {C}.character_queststatus WHERE guid = %s''', (guid,), one=True),
        dbq(f'SELECT COUNT(*) AS n, COALESCE(SUM(money), 0) AS money FROM {C}.mail WHERE receiver = %s',
            (guid,), one=True),
        dbq(f'SELECT xp_for_next_level AS xp FROM {W}.player_xp_for_level WHERE lvl = %s', (row['level'],), one=True),
        dbq(f'SELECT loginTime AS at, ip, loginSource AS source FROM {R}.account_logons '
            f'WHERE accountId = %s ORDER BY id DESC LIMIT 12', (account,)))
    ammo = None
    if row['ammoId']:
        it = await dbq(f'SELECT entry, name, Quality, displayid, ItemLevel AS ilvl FROM {W}.item_template WHERE entry = %s',
                       (row['ammoId'],), one=True)
        if it:
            ammo = {'entry': it['entry'], 'name': it['name'], 'quality': it['Quality'], 'ilvl': it['ilvl'],
                    'icon': icons.get(it['displayid'], ''), 'count': 0}

    char = decorate_char(row)
    char.update(appearance(char.pop('playerBytes') or 0, char.pop('playerBytes2') or 0))
    char['explored'] = bit_count(char.pop('exploredZones'))
    char['explore_total'] = cd['explore_total']
    char['taxi'] = bit_count(char.pop('taximask'))
    char['xp_next'] = xp['xp'] if xp else None
    char['rank'] = visual_rank(char['hrank'])
    quality = {}
    for it in items:
        quality[it['Quality'] or 0] = quality.get(it['Quality'] or 0, 0) + 1
    skill_out = []
    for s in skills:
        name, cat, icon = cd['skills'].get(s['skill'], ('', 0, ''))
        skill_out.append({'id': s['skill'], 'value': s['value'], 'max': s['max'], 'name': name, 'cat': cat, 'icon': icon})
    pet_out = []
    for p in pets:
        fam = cd['families'].get(p['family'] or 0, ('', ''))
        pet_out.append({'name': p['name'], 'level': p['level'], 'type': p['type'], 'slot': p['slot'],
                        'creature': p['creature'], 'family': fam[0], 'icon': fam[1]})
    return ok({'character': char, 'inv': inventory_layout(items, icons), 'gear': gear_summary(items),
               'ammo': ammo, 'quality': quality, 'skills': skill_out,
               'reputation': reputation_list(cd, row['race'], row['class'], reps) if row['race'] and row['class'] else [],
               'talents': talent_points(cd, row['class'], [s['spell'] for s in spells]), 'spells': len(spells),
               'pets': pet_out, 'quests': quests, 'mail': mail, 'logons': with_country(logons),
               'sessions': (await sessions_of([row]))[guid][-6:][::-1], 'trash': trash_of(guid),
               'now': int(time.time())})


# --- сессии персонажей из Char.log ----------------------------------------------
# Ядро пишет в Char.log (CharLogFile в mangosd.conf, папка LogsDir) каждый вход и выход
# персонажа — по нему видно, когда персонаж играл и сколько, а не только когда
# входил аккаунт. Время в файле — часы сервера, как и в базе.

CHAR_LOG_RE = re.compile(r'^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) Account: (\d+) \(IP: ([^)]*)\) '
                         r'(Login|Logout|Create|Delete) Character:\[([^\]]*)\] \(guid: (\d+)\)')
CHARLOG = {'key': None, 'events': {}, 'first': None}


def char_log_events():
    """{guid: [(время, Login|Logout|Create|Delete, IP, аккаунт)]}. Файл перечитывается,
    только если изменился: 15 тысяч строк — доли секунды."""
    try:
        st = CHAR_LOG.stat()
    except OSError:
        return {}
    key = (st.st_size, st.st_mtime)
    if CHARLOG['key'] != key:
        events, first = {}, None
        with open(CHAR_LOG, encoding='utf-8', errors='replace') as f:
            for line in f:
                m = CHAR_LOG_RE.match(line)
                if not m:
                    continue
                ts = int(datetime.strptime(m.group(1), '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc).timestamp())
                first = ts if first is None else min(first, ts)
                events.setdefault(int(m.group(6)), []).append((ts, m.group(4), m.group(3), int(m.group(2))))
        CHARLOG.update(key=key, events=events, first=first)
    return CHARLOG['events']


def build_sessions(events, starts, online, logout_time, now):
    """Сессии из пар «вход — выход». Вход без выхода (мир упал или перезапустился)
    закрываем ближайшим запуском мира после него (cut — время конца примерное);
    если персонаж сейчас в игре — последняя сессия идёт (ongoing)."""
    out, cur = [], None

    def close(sess, end, cut):
        sess['end'], sess['cut'] = end, cut
        sess['secs'] = max(0, end - sess['start']) if end else None
        out.append(sess)

    for ts, kind, ip, _acc in events:
        if kind == 'Login':
            if cur:
                close(cur, next((s for s in starts if cur['start'] < s <= ts), None), True)
            cur = {'start': ts, 'ip': ip if ip[:1].isdigit() else None, 'ongoing': False}
        elif kind == 'Logout' and cur:
            close(cur, ts, False)
            cur = None
    if cur:
        restart = next((s for s in starts if s > cur['start']), None)
        if online and not restart:
            cur['ongoing'] = True
            close(cur, now, False)
        elif logout_time and logout_time > cur['start'] and (not restart or logout_time <= restart):
            close(cur, logout_time, False)
        else:
            close(cur, restart, True)
    return out


async def world_starts():
    rows = await dbq(f'SELECT starttime FROM {R}.uptime WHERE realmid = %s ORDER BY starttime', (REALM_ID,))
    return [r['starttime'] for r in rows]


async def sessions_of(chars):
    """Сессии нескольких персонажей: chars — строки с guid, online, logout_time."""
    events = await asyncio.to_thread(char_log_events)
    starts = await world_starts()
    now = int(time.time())
    out = {}
    for c in chars:
        ses = build_sessions(events.get(c['guid'], []), starts, c.get('online'), c.get('logout_time'), now)
        for s in ses:
            s['country'] = country_of(s['ip'])
        out[c['guid']] = ses
    return out


async def h_character_sessions(request):
    guid = int_arg(request.query.get('guid'), 1, 2 ** 31, 'guid')
    row = await dbq(f'SELECT guid, online, logout_time FROM {C}.characters WHERE guid = %s', (guid,), one=True)
    need(row, 'Персонаж не найден.')
    ses = (await sessions_of([row]))[guid]
    created = next((e[0] for e in char_log_events().get(guid, []) if e[1] == 'Create'), None)
    return ok({'sessions': ses, 'created': created, 'log_from': CHARLOG['first'], 'now': int(time.time())})


# --- таланты: полные деревья -------------------------------------------------------

async def h_character_talents(request):
    guid = int_arg(request.query.get('guid'), 1, 2 ** 31, 'guid')
    row = await dbq(f'SELECT class, level FROM {C}.characters WHERE guid = %s', (guid,), one=True)
    need(row, 'Персонаж не найден.')
    cd, data = await char_dbc(), await dbc_data()
    learned = {r['spell'] for r in await dbq(f'SELECT spell FROM {C}.character_spell WHERE guid = %s AND disabled = 0',
                                             (guid,))}
    mask = 1 << (row['class'] - 1) if row['class'] else 0
    tabs = sorted((t for t in cd['tabs'].values() if t['cls'] & mask), key=lambda t: t['order'])
    out = []
    for t in tabs:
        talents, points = [], 0
        for tal in cd['talent_rows'].values():
            if tal['tab'] != t['id'] or not tal['ranks']:
                continue
            ranks = tal['ranks']
            rank = max((i + 1 for i, s in enumerate(ranks) if s in learned), default=0)
            points += rank
            first = data['spells'].get(ranks[0])
            cur = ranks[rank - 1] if rank else None
            nxt = ranks[rank] if rank < len(ranks) else None
            talents.append({'id': tal['id'], 'row': tal['row'], 'col': tal['col'], 'max': len(ranks), 'rank': rank,
                            'name': first[0] if first else '?', 'icon': cd['spell_icons'].get(first[13], '') if first else '',
                            'desc': spell_text(data, cur) if cur else '', 'next': spell_text(data, nxt) if nxt else '',
                            'dep': tal['dep'] or None, 'dep_rank': tal['dep_rank']})
        talents.sort(key=lambda x: (x['row'], x['col']))
        out.append({'id': t['id'], 'name': t['name'], 'icon': t['icon'], 'points': points, 'talents': talents})
    return ok({'tabs': out, 'level': row['level'], 'spent': sum(t['points'] for t in out),
               'available': max(0, (row['level'] or 0) - 9)})


# --- вещи: убрать и вернуть ----------------------------------------------------------
# Ядро не умеет удалять вещь командой, поэтому — прямо в базе и только пока персонаж
# не в игре: у игрока в игре инвентарь живёт в памяти мира и при сохранении перезаписал
# бы базу. Так же удаляет испорченные вещи само ядро (Player::_LoadInventory):
# строка в character_inventory + строка в item_instance. Удалённое кладётся в «корзину»
# (таблица item_trash в panel.db) — его можно вернуть, пока ячейка свободна.

EQUIP_CACHE_SLOTS = 20          # equipmentCache: по 2 числа на слот 0–18 и на первую сумку (19)


def _db_tx(check, stmts):
    """Несколько запросов одной транзакцией. check — (sql, args): если он вернул
    online = 1, ничего не делаем и отвечаем False (игрок успел войти)."""
    conn = _connect()
    conn.autocommit(False)
    try:
        with conn.cursor() as cur:
            if check:
                cur.execute(*check)
                row = cur.fetchone()
                if not row or row.get('online'):
                    conn.rollback()
                    return False
            for sql, args in stmts:
                cur.execute(sql, args)
        conn.commit()
        return True
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


async def dbtx(check, stmts):
    try:
        return await asyncio.to_thread(_db_tx, check, stmts)
    except pymysql.MySQLError as e:
        raise ApiError('Ошибка базы: %s' % (e.args[-1] if e.args else e), 502)


def _cache_with(cache, slot, entry):
    """equipmentCache с другой вещью в слоте — так её видно на экране выбора персонажа."""
    vals = (cache or '').split()
    vals += ['0'] * (EQUIP_CACHE_SLOTS * 2 - len(vals))
    vals[slot * 2] = str(entry)
    vals[slot * 2 + 1] = '0'
    return ' '.join(vals) + ' '


def _insert(table, row):
    cols = list(row)
    for c in cols:
        need(re.fullmatch(r'[A-Za-z0-9_]+', c), 'Странное имя столбца в копии: %s' % c)
    return ('INSERT INTO %s (%s) VALUES (%s)' % (table, ', '.join('`%s`' % c for c in cols), ', '.join(['%s'] * len(cols))),
            [row[c] for c in cols])


async def wait_offline(guid, name):
    """Кикнуть и дождаться, пока мир сохранит персонажа и снимет флаг online."""
    await run_cmd('char.kick', 'кик %s, чтобы изменить вещи' % name, 'kick %s' % name)
    for _ in range(20):
        await asyncio.sleep(1)
        r = await dbq(f'SELECT online FROM {C}.characters WHERE guid = %s', (guid,), one=True)
        if r and not r['online']:
            return
    raise ApiError('Персонаж так и не вышел из игры за 20 секунд — вещи не тронуты.')


async def h_item_remove(request):
    data = await body(request)
    guid = int_arg(data.get('guid'), 1, 2 ** 31, 'guid')
    item = int_arg(data.get('item'), 1, 2 ** 32 - 1, 'Вещь')
    ch = await dbq(f'SELECT name, online, equipmentCache FROM {C}.characters WHERE guid = %s', (guid,), one=True)
    need(ch, 'Персонаж не найден.')
    if ch['online']:
        need(data.get('kick') is True, 'Персонаж в игре. Убрать вещь можно, когда он не в игре — '
                                       'или поставьте галочку «выкинуть из игры».')
        await wait_offline(guid, ch['name'])
        ch = await dbq(f'SELECT name, online, equipmentCache FROM {C}.characters WHERE guid = %s', (guid,), one=True)
    inv = await dbq(f'SELECT * FROM {C}.character_inventory WHERE guid = %s AND item = %s', (guid, item), one=True)
    need(inv, 'Такой вещи у персонажа нет — может быть, её уже продали или выбросили в игре.')
    inst = await dbq(f'SELECT * FROM {C}.item_instance WHERE guid = %s', (item,), one=True)
    tpl = await dbq(f'SELECT name FROM {W}.item_template WHERE entry = %s', (inv['item_template'],), one=True)
    name = tpl['name'] if tpl else 'предмет #%s' % inv['item_template']
    inside = await dbq(f'SELECT COUNT(*) AS n FROM {C}.character_inventory WHERE guid = %s AND bag = %s', (guid, item), one=True)
    need(not inside['n'], 'В этой сумке лежат вещи (%d) — сначала уберите их.' % inside['n'])
    stmts = [(f'DELETE FROM {C}.character_inventory WHERE guid = %s AND item = %s', (guid, item)),
             (f'DELETE FROM {C}.item_instance WHERE guid = %s', (item,)),
             (f'DELETE FROM {C}.item_loot WHERE guid = %s', (item,))]
    if inv['bag'] == 0 and inv['slot'] < EQUIP_CACHE_SLOTS:
        stmts.append((f'UPDATE {C}.characters SET equipmentCache = %s WHERE guid = %s',
                      (_cache_with(ch['equipmentCache'], inv['slot'], 0), guid)))
    done = await dbtx((f'SELECT online FROM {C}.characters WHERE guid = %s FOR UPDATE', (guid,)), stmts)
    need(done, 'Персонаж успел войти в игру — вещь не тронута.')
    with panel_db() as conn:
        conn.execute('INSERT INTO item_trash(ts, char_guid, char_name, item_guid, entry, name, inv, inst) '
                     'VALUES (?,?,?,?,?,?,?,?)', (int(time.time()), guid, ch['name'], item, inv['item_template'], name,
                                                 jdumps(inv), jdumps(inst or {})))
    audit('item.remove', '%s: %s (вещь #%d)' % (ch['name'], name, item))
    return ok({'success': True, 'output': '«%s» убран у %s. Вернуть можно в «Инвентаре» → «Убранные вещи».' % (name, ch['name'])})


async def h_item_restore(request):
    data = await body(request)
    tid = int_arg(data.get('id'), 1, 10 ** 9, 'id')
    with panel_db() as conn:
        t = conn.execute('SELECT * FROM item_trash WHERE id = ?', (tid,)).fetchone()
    need(t and not t['restored'], 'Такой убранной вещи нет или её уже вернули.')
    inv, inst = json.loads(t['inv']), json.loads(t['inst'])
    need(inst, 'В копии нет данных о самой вещи — вернуть нельзя.')
    guid = inv['guid']
    ch = await dbq(f'SELECT name, online, equipmentCache FROM {C}.characters WHERE guid = %s', (guid,), one=True)
    need(ch, 'Этого персонажа больше нет.')
    need(not ch['online'], 'Персонаж в игре — вернуть вещь можно, когда он выйдет.')
    busy = await dbq(f'SELECT item FROM {C}.character_inventory WHERE guid = %s AND bag = %s AND slot = %s',
                     (guid, inv['bag'], inv['slot']), one=True)
    need(not busy, 'Ячейка, где лежала вещь, уже занята — освободите её в игре и попробуйте снова.')
    if inv['bag']:
        bag = await dbq(f'SELECT item FROM {C}.character_inventory WHERE guid = %s AND item = %s', (guid, inv['bag']), one=True)
        need(bag, 'Сумки, в которой лежала вещь, у персонажа больше нет.')
    taken = await dbq(f'SELECT guid FROM {C}.item_instance WHERE guid = %s', (inst['guid'],), one=True)
    need(not taken, 'Номер вещи уже занят другой вещью — вернуть нельзя.')
    stmts = [_insert(f'{C}.item_instance', inst), _insert(f'{C}.character_inventory', inv)]
    if inv['bag'] == 0 and inv['slot'] < EQUIP_CACHE_SLOTS:
        stmts.append((f'UPDATE {C}.characters SET equipmentCache = %s WHERE guid = %s',
                      (_cache_with(ch['equipmentCache'], inv['slot'], inv['item_template']), guid)))
    done = await dbtx((f'SELECT online FROM {C}.characters WHERE guid = %s FOR UPDATE', (guid,)), stmts)
    need(done, 'Персонаж успел войти в игру — ничего не изменено.')
    with panel_db() as conn:
        conn.execute('UPDATE item_trash SET restored = ? WHERE id = ?', (int(time.time()), tid))
    audit('item.restore', '%s: %s (вещь #%d)' % (ch['name'], t['name'], inst['guid']))
    return ok({'success': True, 'output': '«%s» снова у %s, на прежнем месте.' % (t['name'], ch['name'])})


def trash_of(guid):
    with panel_db() as conn:
        rows = conn.execute('SELECT id, ts, item_guid, entry, name FROM item_trash WHERE char_guid = ? AND restored = 0 '
                            'ORDER BY id DESC LIMIT 20', (guid,)).fetchall()
    return [dict(r) for r in rows]


# --- аккаунт: статистика ------------------------------------------------------

async def h_account_stats(request):
    acc = await account_by(request.query.get('id', ''))
    chars = await dbq(f'''
        SELECT c.guid, c.name, c.level, c.race, c.class, c.gender, c.money, c.totaltime, c.online, c.logout_time,
               c.zone, c.stored_honorable_kills AS kills, c.honor_highest_rank AS hrank
        FROM {C}.characters c WHERE c.account = %s ORDER BY c.totaltime DESC''', (acc['id'],))
    logons = with_country(await dbq(f'SELECT loginTime AS at, ip, loginSource AS source FROM {R}.account_logons '
                                    f'WHERE accountId = %s ORDER BY id DESC LIMIT 5000', (acc['id'],)))
    ses = await sessions_of(chars)
    sessions = []
    for c in chars:
        c['rank'] = visual_rank(c['hrank'])
        decorate_char(c)
        for s in ses[c['guid']]:
            s['guid'], s['name'] = c['guid'], c['name']
            sessions.append(s)
    sessions.sort(key=lambda s: s['start'])
    icons = await item_icons()
    owned = f'''FROM {C}.item_instance ii JOIN {C}.characters c ON c.guid = ii.owner_guid
                LEFT JOIN {W}.item_template it ON it.entry = ii.itemEntry WHERE c.account = %s'''
    quality = await dbq(f'SELECT COALESCE(it.Quality, 0) AS q, COUNT(*) AS n {owned} GROUP BY q ORDER BY q', (acc['id'],))
    best = await dbq(f'''SELECT ii.itemEntry AS entry, it.name, it.Quality AS quality, it.displayid, it.ItemLevel AS ilvl,
                                c.name AS owner, c.guid AS owner_guid
                         {owned} AND it.Quality >= 3 ORDER BY it.Quality DESC, it.ItemLevel DESC LIMIT 30''', (acc['id'],))
    for b in best:
        b['icon'] = icons.get(b.pop('displayid') or 0, '')
    return ok({'account': {'id': acc['id'], 'username': acc['username'], 'joindate': acc['joindate']},
               'characters': chars, 'logons': logons, 'sessions': sessions, 'quality': quality, 'best': best,
               'log_from': CHARLOG['first'], 'now': int(time.time())})


async def tele_names():
    rows = await dbq(f'SELECT name FROM {W}.game_tele WHERE name <> %s ORDER BY name', (TELE_POINT,))
    return [r['name'] for r in rows]


async def h_tele(request):
    return ok(await tele_names())


def money_arg(data):
    gold = int_arg(data.get('gold', 0) or 0, 0, 100000, 'Золото')
    silver = int_arg(data.get('silver', 0) or 0, 0, 99, 'Серебро')
    copper = int_arg(data.get('copper', 0) or 0, 0, 99, 'Медь')
    total = gold * 10000 + silver * 100 + copper
    need(total > 0, 'Сумма должна быть больше нуля.')
    return total


async def h_character_action(request):
    data = await body(request)
    action = str(data.get('action') or '')
    if action == 'restore':
        guid = int_arg(data.get('guid'), 1, 2 ** 31, 'guid')
        new_name = data.get('newname')
        cmd = 'character deleted restore %d' % guid
        if new_name:
            cmd += ' ' + char_arg(new_name)
        return ok(await run_cmd('char.restore', 'восстановлен персонаж #%d' % guid, cmd))

    name = char_arg(data.get('name'))
    # Кик, починка и сообщение на экран работают только с теми, кто в игре;
    # остальное ядро умеет и с офлайн-персонажами.
    name = await char_target(name, need_online=action in ('kick', 'repair', 'message'))
    simple = {
        'kick': ('char.kick', 'кик %s', 'kick %s'),
        'rename': ('char.rename', 'переименование %s при входе', 'character rename %s'),
        'revive': ('char.revive', 'воскрешение %s', 'revive %s'),
        'repair': ('char.repair', 'починка вещей %s', 'repairitems %s'),
        'unmute': ('char.unmute', 'снята немота %s', 'unmute %s'),
        'pinfo': ('char.pinfo', 'справка по %s', 'pinfo %s'),
        'reputation': ('char.reputation', 'репутация %s', 'character reputation %s'),
        'reset_talents': ('char.reset', 'сброс талантов %s', 'reset talents %s'),
        'reset_spells': ('char.reset', 'сброс заклинаний %s', 'reset spells %s'),
        'reset_stats': ('char.reset', 'пересчёт характеристик %s', 'reset stats %s'),
        'reset_honor': ('char.reset', 'сброс чести %s', 'reset honor %s'),
        'reset_level': ('char.reset', 'сброс уровня %s до 1', 'reset level %s'),
    }
    if action in simple:
        kind, detail, cmd = simple[action]
        return ok(await run_cmd(kind, detail % name, cmd % name))
    if action == 'message':
        text = text_arg(data.get('text'), 200, 'Сообщение')
        return ok(await run_cmd('char.message', '%s: %s' % (name, text), 'send message %s %s' % (name, text)))
    if action == 'mail':
        subject = text_arg(data.get('subject'), 60, 'Тема')
        text = text_arg(data.get('text'), 500, 'Текст письма')
        return ok(await run_cmd('char.mail', 'письмо %s: %s' % (name, subject),
                                'send mail %s "%s" "%s"' % (name, subject, text)))
    if action == 'money':
        subject = text_arg(data.get('subject') or 'Подарок', 60, 'Тема')
        text = text_arg(data.get('text') or 'От администрации', 500, 'Текст письма')
        total = money_arg(data)
        return ok(await run_cmd('char.money', 'деньги %s: %d меди' % (name, total),
                                'send money %s "%s" "%s" %d' % (name, subject, text, total)))
    if action == 'items':
        subject = text_arg(data.get('subject') or 'Подарок', 60, 'Тема')
        text = text_arg(data.get('text') or 'От администрации', 500, 'Текст письма')
        items = data.get('items') or []
        need(isinstance(items, list) and 0 < len(items) <= 12, 'От 1 до 12 предметов за письмо.')
        parts, entries = [], []
        for it in items:
            entry = int_arg(it.get('id'), 1, 10 ** 6, 'ID предмета')
            count = int_arg(it.get('count', 1), 1, 1000, 'Количество')
            parts.append('%d:%d' % (entry, count))
            entries.append(entry)
        known = await dbq(f'SELECT entry FROM {W}.item_template WHERE entry IN (%s)' % ','.join(['%s'] * len(entries)),
                          entries)
        missing = sorted(set(entries) - {r['entry'] for r in known})
        need(not missing, 'Таких предметов нет в базе: %s' % ', '.join(map(str, missing)))
        return ok(await run_cmd('char.items', 'предметы %s: %s' % (name, ' '.join(parts)),
                                'send items %s "%s" "%s" %s' % (name, subject, text, ' '.join(parts))))
    if action == 'level':
        level = int_arg(data.get('level'), 1, 60, 'Уровень')
        return ok(await run_cmd('char.level', '%s → %d уровень' % (name, level),
                                'character level %s %d' % (name, level)))
    if action == 'tele':
        location = str(data.get('location') or '').strip()
        need(TELE_RE.match(location) and location in await tele_names(), 'Нет такой точки телепорта.')
        return ok(await run_cmd('char.tele', '%s → %s' % (name, location), 'tele name %s %s' % (name, location)))
    if action == 'mute':
        minutes = int_arg(data.get('minutes'), 1, 525600, 'Минуты')
        return ok(await run_cmd('char.mute', 'немота %s на %d мин' % (name, minutes), 'mute %s %d' % (name, minutes)))
    if action == 'ban':
        duration = duration_arg(data.get('duration'))
        reason = text_arg(data.get('reason'), 200, 'Причина')
        return ok(await run_cmd('ban.character', 'бан %s на %s: %s' % (name, duration, reason),
                                'ban character %s %s "%s"' % (name, duration, reason)))
    if action == 'erase':
        need(data.get('confirm') == name, 'Для окончательного удаления впишите имя ещё раз.')
        return ok(await run_cmd('char.erase', 'персонаж %s удалён навсегда' % name, 'character erase %s' % name))
    raise ApiError('Неизвестное действие.')


# --- карта мира: телепорт в любую точку ----------------------------------------
# Картинки карт и границы зон — static/wow/maps (собирает tools/build_maps.py из клиента).
# Панель получает от карты мировые x, y и сама находит высоту: читает .map-файлы ядра
# (DataDir/maps, формат z1.4 — так же, как GridMap::getHeight в CMaNGOS). Здания и пещеры
# лежат в vmaps, их так не видно, поэтому рядом ищем ещё ближайшего НПС: он стоит на
# настоящем полу, и если он в двух шагах, лучше встать на его высоту.

GRID_SIZE = 533.33333
MAP_LIMIT = 17066.0             # дальше края карты ядро не пускает (MAP_HALFSIZE - 0.5)
TELE_MAPS = {0: 'Восточные королевства', 1: 'Калимдор'}
TELE_POINT = 'panel_tp'         # своя строка game_tele: через неё ядро переносит онлайн-персонажа
TELE_LOCK = None
NEAR_NPC = 25                   # ярдов: ближе — берём высоту НПС, а не земли
GRIDS = {}                      # (карта, gx, gy) → разобранный .map; держим последние 24
HOLE_H = (0x1111, 0x2222, 0x4444, 0x8888)
HOLE_V = (0x000F, 0x00F0, 0x0F00, 0xF000)


def _grid(mapid, gx, gy):
    key = (mapid, gx, gy)
    if key in GRIDS:
        return GRIDS[key]
    grid = None
    try:
        raw = (MAPS / ('%03d%02d%02d.map' % key)).read_bytes()
    except OSError:
        raw = b''
    if raw[:8] == b'MAPSz1.4':
        area_off, _, h_off, _, l_off, _, holes_off, _ = struct.unpack_from('<8I', raw, 8)
        grid = {'garea': 0, 'area': None, 'holes': None, 'h': None, 'liq': None}
        if area_off:
            _, flags, grid['garea'] = struct.unpack_from('<4sHH', raw, area_off)
            if not flags & 1:
                grid['area'] = array.array('H', raw[area_off + 8:area_off + 8 + 512])
        if holes_off:
            grid['holes'] = array.array('H', raw[holes_off:holes_off + 512])
        if h_off:
            _, flags, base, top = struct.unpack_from('<4sIff', raw, h_off)
            p = h_off + 16
            if flags & 1:                           # MAP_HEIGHT_NO_HEIGHT — ровная клетка
                grid['h'] = ('flat', base)
            else:
                code, size, scale = ('H', 2, (top - base) / 65535) if flags & 2 else \
                    ('B', 1, (top - base) / 255) if flags & 4 else ('f', 4, None)
                v9 = array.array(code, raw[p:p + 16641 * size])
                v8 = array.array(code, raw[p + 16641 * size:p + 16641 * size + 16384 * size])
                grid['h'] = ('grid', v9, v8, base, scale)
        if l_off:
            _, flags, gflags, _, ox, oy, width, height, level = struct.unpack_from('<4sBBHBBBBf', raw, l_off)
            p = l_off + 16
            types = None
            if not flags & 1:                       # MAP_LIQUID_NO_TYPE
                types = raw[p + 512:p + 768]
                p += 768
            levels = None if flags & 2 else array.array('f', raw[p:p + width * height * 4])
            grid['liq'] = (gflags, types, ox, oy, width, height, level, levels)
    if len(GRIDS) >= 24:
        GRIDS.pop(next(iter(GRIDS)))
    GRIDS[key] = grid
    return grid


def _cell(x, y, res):
    """Мировые x, y → номер файла (gx, gy) и доля внутри клетки — как в GridMap.cpp."""
    fx, fy = res * (32 - x / GRID_SIZE), res * (32 - y / GRID_SIZE)
    return int(fx), int(fy), fx - int(fx), fy - int(fy)


def terrain_at(mapid, x, y):
    """Высота земли, уровень воды и зона в точке; None там, где данных нет."""
    gx, gy = int(32 - x / GRID_SIZE), int(32 - y / GRID_SIZE)
    grid = _grid(mapid, gx, gy) if 0 <= gx < 64 and 0 <= gy < 64 else None
    if not grid:
        return None, None, 0
    ax, ay, _, _ = _cell(x, y, 16)
    area = grid['area'][(ax & 15) * 16 + (ay & 15)] if grid['area'] else grid['garea']
    xi, yi, fx, fy = _cell(x, y, 128)
    xi, yi = xi & 127, yi & 127
    ground = None
    h = grid['h']
    if h and h[0] == 'flat':
        ground = h[1]
    elif h:
        hole = grid['holes'][(xi // 8) * 16 + yi // 8] if grid['holes'] else 0
        if not hole & HOLE_H[(yi % 8) // 2] & HOLE_V[(xi % 8) // 2]:
            _, v9, v8, base, scale = h
            i = xi * 129 + yi
            h5 = 2 * v8[xi * 128 + yi]
            if fx + fy < 1:
                if fx > fy:
                    h1, h2 = v9[i], v9[i + 129]
                    a, b, c = h2 - h1, h5 - h1 - h2, h1
                else:
                    h1, h3 = v9[i], v9[i + 1]
                    a, b, c = h5 - h1 - h3, h3 - h1, h1
            elif fx > fy:
                h2, h4 = v9[i + 129], v9[i + 130]
                a, b, c = h2 + h4 - h5, h4 - h2, h5 - h4
            else:
                h3, h4 = v9[i + 1], v9[i + 130]
                a, b, c = h4 - h3, h3 + h4 - h5, h5 - h4
            ground = a * fx + b * fy + c
            if scale is not None:
                ground = ground * scale + base
    water = None
    if grid['liq']:
        gflags, types, ox, oy, width, height, level, levels = grid['liq']
        kind = types[(xi >> 3) * 16 + (yi >> 3)] if types else gflags
        lx, ly = xi - oy, yi - ox
        if kind and 0 <= lx < height and 0 <= ly < width:
            water = levels[lx * width + ly] if levels else level
    return ground, water, area


def place_name(flag):
    area = AREA_BY_FLAG.get(flag, 0)
    zone = AREA_PARENT.get(area, area)
    return {'area': area, 'zone': zone, 'area_name': AREAS.get(area, ''), 'zone_name': AREAS.get(zone, '')}


def coord_arg(value, what):
    try:
        v = float(value)
    except (TypeError, ValueError):
        raise ApiError('%s — не число.' % what)
    need(abs(v) <= MAP_LIMIT, '%s за краем карты.' % what)
    return v


async def point_info(mapid, x, y):
    ground, water, area = await asyncio.to_thread(terrain_at, mapid, x, y)
    rows = await dbq(f'''
        SELECT t.Name AS name, c.position_x AS x, c.position_y AS y, c.position_z AS z
        FROM {W}.creature c JOIN {W}.creature_template t ON t.Entry = c.id
        WHERE c.map = %s AND c.position_x BETWEEN %s AND %s AND c.position_y BETWEEN %s AND %s''',
                     (mapid, x - 60, x + 60, y - 60, y + 60))
    near = None
    for r in rows:
        d = ((float(r['x']) - x) ** 2 + (float(r['y']) - y) ** 2) ** 0.5
        if near is None or d < near['dist']:
            near = {'name': r['name'], 'dist': round(d, 1), 'z': round(float(r['z']), 2)}
    surface = None if ground is None else max(ground, water) if water is not None else ground
    if near and near['dist'] <= NEAR_NPC:
        z, source = near['z'], 'npc'
    elif surface is not None:
        z, source = surface, 'water' if water is not None and water > ground else 'ground'
    else:
        z, source = None, None
    return dict(place_name(area), map=mapid, x=round(x, 2), y=round(y, 2),
                ground=None if ground is None else round(ground, 2), water=None if water is None else round(water, 2),
                near=near, z=None if z is None else round(z + 0.5, 2), source=source)


def map_arg(value):
    mapid = int_arg(value, 0, 1, 'Карта')
    need(mapid in TELE_MAPS, 'На этой карте телепорт по точке не работает.')
    return mapid


async def h_map_point(request):
    q = request.query
    mapid = map_arg(q.get('map'))
    return ok(await point_info(mapid, coord_arg(q.get('x'), 'X'), coord_arg(q.get('y'), 'Y')))


async def h_map_pins(request):
    """Точки на карте: game_tele, кто сейчас в игре и (если передан) где выбранный персонаж."""
    mapid = map_arg(request.query.get('map'))
    tele = await dbq(f'''SELECT name, position_x AS x, position_y AS y FROM {W}.game_tele
                         WHERE map = %s AND name <> %s ORDER BY name''', (mapid, TELE_POINT))
    online = await dbq(f'''SELECT name, race, class, level, position_x AS x, position_y AS y FROM {C}.characters
                           WHERE online = 1 AND map = %s ORDER BY name''', (mapid,))
    char = None
    if request.query.get('char'):
        char = await dbq(f'''SELECT name, race, class, level, online, map, zone, position_x AS x, position_y AS y
                             FROM {C}.characters WHERE name = %s''', (char_arg(request.query.get('char')),), one=True)
        if char:
            decorate_char(char)
    return ok({'tele': tele, 'online': [decorate_char(r) for r in online], 'char': char})


async def h_map_tele(request):
    data = await body(request)
    name = char_arg(data.get('name'))
    mapid = map_arg(data.get('map'))
    x, y = coord_arg(data.get('x'), 'X'), coord_arg(data.get('y'), 'Y')
    info = await point_info(mapid, x, y)
    z = data.get('z')
    z = info['z'] if z in (None, '') else coord_arg(z, 'Высота')
    need(z is not None and -3000 < z < 3000, 'В этой точке не удалось найти землю — выберите место рядом.')
    o = coord_arg(data.get('o') or 0, 'Поворот') % 6.2831
    row = await dbq(f'SELECT guid, name, online FROM {C}.characters WHERE name = %s', (name,), one=True)
    need(row, 'Персонажа «%s» нет.' % name)
    name = row['name']
    where = '%s, %s (%.0f, %.0f, %.0f)' % (info['zone_name'] or TELE_MAPS[mapid], info['area_name'] or '—', x, y, z)
    if not row['online']:
        # Вне игры — прямо в базе, как это делает и само ядро (Player::SavePositionInDB).
        done = await dbx(f'''UPDATE {C}.characters SET map = %s, position_x = %s, position_y = %s, position_z = %s,
                             orientation = %s, zone = %s WHERE guid = %s AND online = 0''',
                         (mapid, x, y, z, o, info['zone'], row['guid']))
        need(done, '%s только что вошёл в игру — повторите телепорт.' % name)
        audit('char.tele', '%s → %s' % (name, where), True, 'офлайн: позиция записана в базу')
        return ok({'success': True, 'output': 'Персонаж не в игре: он появится в этой точке при входе.', 'point': info})
    # В игре — через свою строку game_tele: ядро умеет переносить живого игрока только к ней.
    async with TELE_LOCK:
        old = await dbq(f'SELECT id FROM {W}.game_tele WHERE name = %s', (TELE_POINT,), one=True)
        if old:
            await dbx(f'''UPDATE {W}.game_tele SET position_x = %s, position_y = %s, position_z = %s, orientation = %s,
                          map = %s WHERE id = %s''', (x, y, z, o, mapid, old['id']))
        else:
            await dbx(f'''INSERT INTO {W}.game_tele (position_x, position_y, position_z, orientation, map, name)
                          VALUES (%s, %s, %s, %s, %s, %s)''', (x, y, z, o, mapid, TELE_POINT))
        reload = await run_cmd('char.tele', 'game_tele перечитана для телепорта %s' % name, 'reload game_tele')
        need(reload['success'], 'Ядро не перечитало game_tele: %s' % (reload['output'] or '—'))
        res = await run_cmd('char.tele', '%s → %s' % (name, where), 'tele name %s %s' % (name, TELE_POINT))
    res['point'] = info
    return ok(res)


# --- модерация -----------------------------------------------------------------

async def h_bans(request):
    now = int(time.time())
    active = await dbq(f'''
        SELECT b.account_id, a.username, b.banned_at, b.expires_at, b.banned_by, b.reason
        FROM {R}.account_banned b LEFT JOIN {R}.account a ON a.id = b.account_id
        WHERE b.active = 1 ORDER BY b.banned_at DESC''')
    ips = await dbq(f'SELECT ip, banned_at, expires_at, banned_by, reason FROM {R}.ip_banned ORDER BY banned_at DESC')
    history = await dbq(f'''
        SELECT b.account_id, a.username, b.banned_at, b.expires_at, b.banned_by, b.unbanned_at,
               b.unbanned_by, b.reason, b.active
        FROM {R}.account_banned b LEFT JOIN {R}.account a ON a.id = b.account_id
        ORDER BY b.banned_at DESC LIMIT 60''')
    muted = await dbq(f'SELECT id, username, mutetime FROM {R}.account WHERE mutetime > %s ORDER BY mutetime',
                      (now,))
    failed = await dbq(f'SELECT id, username, failed_logins FROM {R}.account WHERE failed_logins > 0 '
                       f'ORDER BY failed_logins DESC LIMIT 20')
    locked = await dbq(f'SELECT id, username, lockedIp FROM {R}.account WHERE locked = 1 AND username <> %s',
                       (SERVICE_ACCOUNT,))
    return ok({'active': active, 'ips': ips, 'history': history, 'muted': muted,
               'failed': failed, 'locked': locked, 'now': now})


async def h_ban(request):
    data = await body(request)
    kind = data.get('type')
    duration = duration_arg(data.get('duration'))
    reason = text_arg(data.get('reason'), 200, 'Причина')
    if kind == 'account':
        target = await account_target(account_arg(data.get('target')))
        protect_service_account(target)
    elif kind == 'character':
        target = await char_target(char_arg(data.get('target')))
    elif kind == 'ip':
        target = ip_arg(data.get('target'))
    else:
        raise ApiError('Тип бана: account, character или ip.')
    # Причину — в кавычках: без них ядро берёт только первое слово.
    return ok(await run_cmd('ban.' + kind, '%s на %s: %s' % (target, duration, reason),
                            'ban %s %s %s "%s"' % (kind, target, duration, reason)))


async def h_unban(request):
    data = await body(request)
    kind = data.get('type')
    if kind == 'account':
        target = account_arg(data.get('target'))
    elif kind == 'character':
        target = char_arg(data.get('target'))
    elif kind == 'ip':
        target = ip_arg(data.get('target'))
    else:
        raise ApiError('Тип: account, character или ip.')
    # Эта версия ядра требует после цели ещё и сообщение, хотя справка в базе
    # об этом молчит: без него разбан отвечает подсказкой по синтаксису.
    return ok(await run_cmd('unban.' + kind, 'снят бан с %s' % target,
                            'unban %s %s "Снят через веб-панель"' % (kind, target)))


# --- статистика ----------------------------------------------------------------

async def h_stats(request):
    qs = request.query
    days = int_arg(qs.get('days', 30), 1, 365, 'days')
    bots = qs.get('bots') == '1'
    who = '' if bots else 'AND a.username NOT LIKE %s'
    wargs = [] if bots else [BOT_LIKE]
    chars_from = f'FROM {C}.characters c JOIN {R}.account a ON a.id = c.account WHERE 1=1 {who}'

    classes = await dbq(f'SELECT c.class AS id, COUNT(*) AS n {chars_from} GROUP BY c.class ORDER BY n DESC', wargs)
    races = await dbq(f'SELECT c.race AS id, COUNT(*) AS n {chars_from} GROUP BY c.race ORDER BY n DESC', wargs)
    levels = await dbq(f'SELECT c.level AS level, COUNT(*) AS n {chars_from} GROUP BY c.level ORDER BY c.level', wargs)
    economy = await dbq(f'SELECT COUNT(*) AS chars, COALESCE(SUM(c.money),0) AS money, '
                        f'COALESCE(AVG(c.money),0) AS avg_money, COALESCE(SUM(c.totaltime),0) AS played, '
                        f'COALESCE(AVG(c.level),0) AS avg_level, COALESCE(SUM(c.online),0) AS online {chars_from}',
                        wargs, one=True)

    async def top(order):
        rows = await dbq(f'''SELECT c.guid, c.name, c.level, c.race, c.class, c.gender, c.money, c.totaltime, c.online,
                                    c.stored_honorable_kills AS kills, a.username
                             {chars_from} ORDER BY {order} DESC, c.guid LIMIT 10''', wargs)
        return [decorate_char(r) for r in rows]

    tops = {'level': await top('c.level'), 'money': await top('c.money'),
            'played': await top('c.totaltime'), 'kills': await top('c.stored_honorable_kills')}

    acc_where = '' if bots else 'AND username NOT LIKE %s'
    accounts = await dbq(f'''SELECT COUNT(*) AS n,
                                    (SELECT COUNT(DISTINCT l.accountId) FROM {R}.account_logons l
                                       WHERE l.loginTime >= NOW() - INTERVAL 7 DAY) AS active7
                             FROM {R}.account WHERE username <> %s {acc_where}''', [SERVICE_ACCOUNT] + wargs, one=True)
    regs = await dbq(f'''SELECT DATE(joindate) AS d, COUNT(*) AS n FROM {R}.account
                         WHERE joindate >= CURDATE() - INTERVAL %s DAY AND username <> %s {acc_where}
                         GROUP BY d ORDER BY d''', [days - 1, SERVICE_ACCOUNT] + wargs)
    logins = await dbq(f'''SELECT DATE(loginTime) AS d, COUNT(*) AS n, COUNT(DISTINCT accountId) AS uniq
                           FROM {R}.account_logons WHERE loginTime >= CURDATE() - INTERVAL %s DAY
                           AND loginSource = 1 GROUP BY d ORDER BY d''', (days - 1,))
    guilds = await guild_rows(bots)
    sessions = await dbq(f'SELECT starttime, uptime, maxplayers FROM {R}.uptime WHERE realmid = %s '
                         f'ORDER BY starttime DESC LIMIT 60', (REALM_ID,))
    since = time.time() - days * 86400
    history = samples_since(since)
    restarts = sum(1 for s in sessions if s['starttime'] >= since)
    return ok({
        'days': days, 'bots': bots,
        'classes': [{'id': r['id'], 'name': CLASSES.get(r['id'], '?'), 'n': r['n']} for r in classes],
        'races': [{'id': r['id'], 'name': RACES.get(r['id'], ('?',))[0], 'faction': RACES.get(r['id'], ('?', '?'))[1],
                   'n': r['n']} for r in races],
        'levels': levels, 'economy': economy, 'tops': tops, 'registrations': regs, 'logins': logins,
        'accounts': accounts, 'guilds': guilds, 'sessions': sessions, 'history': history, 'restarts': restarts,
    })


async def guild_rows(bots):
    """Гильдии с фракцией главы. Без ботов — только те, где глава живой игрок."""
    who = '' if bots else 'AND (la.username IS NULL OR la.username NOT LIKE %s)'
    rows = await dbq(f'''
        SELECT g.guildid, g.name, g.createdate, l.name AS leader, l.guid AS leader_guid, l.race, l.class, l.gender,
               (SELECT COUNT(*) FROM {C}.guild_member m WHERE m.guildid = g.guildid) AS members,
               (SELECT COUNT(*) FROM {C}.guild_member m3 JOIN {C}.characters c3 ON c3.guid = m3.guid
                  WHERE m3.guildid = g.guildid AND c3.online = 1) AS online,
               (SELECT ROUND(AVG(c2.level),1) FROM {C}.guild_member m2 JOIN {C}.characters c2 ON c2.guid = m2.guid
                  WHERE m2.guildid = g.guildid) AS avg_level
        FROM {C}.guild g
        LEFT JOIN {C}.characters l ON l.guid = g.leaderguid
        LEFT JOIN {R}.account la ON la.id = l.account
        WHERE 1=1 {who}
        ORDER BY members DESC, g.guildid LIMIT 200''', [] if bots else [BOT_LIKE])
    for r in rows:
        r['faction'] = RACES.get(r['race'], ('', ''))[1] or None
    return rows


# --- статистика по фракциям ------------------------------------------------------

PROF_SKILLS = (171, 164, 333, 202, 182, 186, 393, 165, 197, 185, 129, 356)
LEVEL_BRACKETS = ((1, 9), (10, 19), (20, 29), (30, 39), (40, 49), (50, 59), (60, 60))


def _bracket(level):
    for i, (lo, hi) in enumerate(LEVEL_BRACKETS):
        if lo <= level <= hi:
            return i
    return len(LEVEL_BRACKETS) - 1


def summarize_chars(chars, profs, matrix=False):
    """Сводка по набору персонажей: расы с полом, классы, уровни, звания PvP,
    профессии, где стоят, лучшие. Считаем в Python: персонажей не больше двух тысяч."""
    out = {'chars': len(chars), 'online': 0, 'money': 0, 'played': 0, 'kills': 0, 'dishonor': 0,
           'level60': 0, 'avg_level': 0, 'male': 0, 'female': 0, 'best_rank': 0}
    races, classes, ranks, zones = {}, {}, {}, {}
    brackets = [{'label': '%d–%d' % b if b[0] != b[1] else str(b[0]), 'n': 0, 'money': 0} for b in LEVEL_BRACKETS]
    per_level = [0] * 60
    mtx = {}
    for c in chars:
        out['online'] += c['online'] or 0
        out['money'] += c['money'] or 0
        out['played'] += c['totaltime'] or 0
        out['kills'] += c['kills'] or 0
        out['dishonor'] += c['dishonor'] or 0
        out['avg_level'] += c['level']
        out['level60'] += c['level'] >= 60
        out['female' if c['gender'] else 'male'] += 1
        rank = visual_rank(c['hrank'])
        c['rank'] = rank
        if rank > 0:
            ranks[rank] = ranks.get(rank, 0) + 1
            out['best_rank'] = max(out['best_rank'], rank)
        r = races.setdefault(c['race'], {'id': c['race'], 'name': RACES.get(c['race'], ('?',))[0],
                                         'faction': RACES.get(c['race'], ('?', '?'))[1], 'n': 0, 'male': 0, 'female': 0, 'lv': 0})
        r['n'] += 1
        r['female' if c['gender'] else 'male'] += 1
        r['lv'] += c['level']
        k = classes.setdefault(c['class'], {'id': c['class'], 'name': CLASSES.get(c['class'], '?'), 'n': 0, 'lv': 0})
        k['n'] += 1
        k['lv'] += c['level']
        b = brackets[_bracket(c['level'])]
        b['n'] += 1
        b['money'] += c['money'] or 0
        if 1 <= c['level'] <= 60:
            per_level[c['level'] - 1] += 1
        zones[c['zone']] = zones.get(c['zone'], 0) + 1
        if matrix:
            mtx.setdefault(c['race'], {}).setdefault(c['class'], 0)
            mtx[c['race']][c['class']] += 1
    n = len(chars) or 1
    out['avg_level'] = round(out['avg_level'] / n, 1) if chars else 0
    out['avg_money'] = out['money'] // n if chars else 0
    for x in list(races.values()) + list(classes.values()):
        x['avg_level'] = round(x.pop('lv') / x['n'], 1)
    out['races'] = sorted(races.values(), key=lambda x: -x['n'])
    out['classes'] = sorted(classes.values(), key=lambda x: -x['n'])
    out['brackets'] = brackets
    out['levels'] = per_level
    out['ranks'] = [{'rank': k, 'n': v} for k, v in sorted(ranks.items(), reverse=True)]
    out['zones'] = [{'zone': z, 'name': zone_name(z) if z else 'не записано', 'n': v}
                    for z, v in sorted(zones.items(), key=lambda kv: -kv[1])[:10]]
    guids = {c['guid'] for c in chars}
    by_skill = {}
    for p in profs:
        if p['guid'] in guids:
            s = by_skill.setdefault(p['skill'], {'id': p['skill'], 'n': 0, 'sum': 0, 'max': 0})
            s['n'] += 1
            s['sum'] += p['value']
            s['max'] = max(s['max'], p['value'])
    out['professions'] = sorted(({'id': s['id'], 'n': s['n'], 'avg': round(s['sum'] / s['n']), 'max': s['max']}
                                 for s in by_skill.values()), key=lambda x: -x['n'])

    def top(key):
        rows = sorted(chars, key=lambda c: (-(c[key] or 0), -(c['level'] or 0), c['guid']))[:10]
        return [decorate_char({k: c[k] for k in ('guid', 'name', 'race', 'class', 'gender', 'level', 'money', 'totaltime',
                                                 'kills', 'rank', 'online', 'username')}) for c in rows if c[key]]

    out['tops'] = {'level': top('level'), 'money': top('money'), 'kills': top('kills'), 'played': top('totaltime')}
    if matrix:
        out['matrix'] = mtx
    return out


async def h_stats_factions(request):
    bots = request.query.get('bots') == '1'
    who = '' if bots else 'AND a.username NOT LIKE %s'
    wargs = [] if bots else [BOT_LIKE]
    chars = await dbq(f'''
        SELECT c.guid, c.name, c.race, c.class, c.gender, c.level, c.money, c.totaltime, c.online, c.zone,
               c.stored_honorable_kills AS kills, c.stored_dishonorable_kills AS dishonor,
               c.honor_highest_rank AS hrank, a.username
        FROM {C}.characters c JOIN {R}.account a ON a.id = c.account WHERE 1=1 {who}''', wargs)
    profs = await dbq(f'''
        SELECT s.guid, s.skill, s.value FROM {C}.character_skills s
        JOIN {C}.characters c ON c.guid = s.guid JOIN {R}.account a ON a.id = c.account
        WHERE s.skill IN ({','.join(map(str, PROF_SKILLS))}) {who}''', wargs)
    guilds = await guild_rows(bots)
    out = {'bots': bots}
    for fac in ('A', 'H'):
        part = [c for c in chars if RACES.get(c['race'], ('', ''))[1] == fac]
        out[fac] = summarize_chars(part, profs)
        out[fac]['guilds'] = [g for g in guilds if g['faction'] == fac]
    out['all'] = summarize_chars(chars, profs, matrix=True)
    out['all']['guilds'] = guilds
    return ok(out)


# --- экономика -------------------------------------------------------------------

async def h_stats_economy(request):
    bots = request.query.get('bots') == '1'
    who = '' if bots else 'AND a.username NOT LIKE %s'
    wargs = [] if bots else [BOT_LIKE]
    chars = await dbq(f'''SELECT c.guid, c.name, c.race, c.class, c.gender, c.level, c.money, c.online, a.username
                          FROM {C}.characters c JOIN {R}.account a ON a.id = c.account WHERE 1=1 {who}''', wargs)
    owned = f'''FROM {C}.item_instance ii
                JOIN {C}.characters c ON c.guid = ii.owner_guid JOIN {R}.account a ON a.id = c.account
                LEFT JOIN {W}.item_template it ON it.entry = ii.itemEntry WHERE 1=1 {who}'''
    quality = await dbq(f'SELECT COALESCE(it.Quality, 0) AS q, COUNT(*) AS n {owned} GROUP BY q ORDER BY q', wargs)
    best = await dbq(f'''SELECT ii.itemEntry AS entry, it.name, it.Quality AS quality, it.displayid, it.ItemLevel AS ilvl,
                                COUNT(*) AS n, COUNT(DISTINCT c.guid) AS owners,
                                SUBSTRING_INDEX(GROUP_CONCAT(DISTINCT c.name ORDER BY c.name SEPARATOR ', '), ', ', 4) AS names
                         {owned} AND it.Quality >= 4
                         GROUP BY ii.itemEntry ORDER BY it.Quality DESC, it.ItemLevel DESC, n DESC LIMIT 40''', wargs)
    icons = await item_icons()
    for b in best:
        b['icon'] = icons.get(b.pop('displayid') or 0, '')
    money = sorted((c['money'] or 0 for c in chars), reverse=True)
    total = sum(money)
    brackets = [{'label': '%d–%d' % b if b[0] != b[1] else str(b[0]), 'n': 0, 'money': 0} for b in LEVEL_BRACKETS]
    for c in chars:
        b = brackets[_bracket(c['level'])]
        b['n'] += 1
        b['money'] += c['money'] or 0
    richest = sorted(chars, key=lambda c: (-(c['money'] or 0), c['guid']))[:10]
    return ok({
        'bots': bots, 'chars': len(chars), 'money': total, 'avg': total // len(chars) if chars else 0,
        'median': money[len(money) // 2] if money else 0,
        'top10_share': round(sum(money[:10]) * 100 / total, 1) if total else 0,
        'brackets': brackets, 'quality': quality, 'items': sum(q['n'] for q in quality),
        'best': best, 'richest': [decorate_char(c) for c in richest if c['money']],
    })


# --- входы и страны --------------------------------------------------------------

async def h_stats_logins(request):
    qs = request.query
    days = int_arg(qs.get('days', 30), 1, 3650, 'days')
    where, args = ['l.loginTime >= NOW() - INTERVAL %s DAY'], [days]
    term = qs.get('q', '').strip()
    if term:
        like = '%' + term.replace('%', '').replace('_', r'\_') + '%'
        where.append('(a.username LIKE %s OR l.ip LIKE %s)')
        args += [like, like]
    rows = await dbq(f'''SELECT l.id, l.loginTime AS at, l.ip, l.loginSource AS source, l.accountId AS account_id, a.username
                         FROM {R}.account_logons l LEFT JOIN {R}.account a ON a.id = l.accountId
                         WHERE {' AND '.join(where)} ORDER BY l.id DESC LIMIT 5000''', args)
    with_country(rows)
    ips, countries, accounts = {}, {}, {}
    for r in rows:
        c = r['country'] or {'code': '??', 'name': 'не определена'}
        name = r['username'] or '#%s' % r['account_id']
        ip = ips.setdefault(r['ip'], {'ip': r['ip'], 'country': r['country'], 'n': 0, 'accounts': {}, 'last': r['at']})
        ip['n'] += 1
        ip['accounts'][r['account_id']] = (name, not r['username'])
        k = countries.setdefault(c['code'], {'code': c['code'], 'name': c['name'], 'n': 0, 'ips': set(), 'accounts': set()})
        k['n'] += 1
        k['ips'].add(r['ip'])
        k['accounts'].add(r['account_id'])
        a = accounts.setdefault(r['account_id'], {'id': r['account_id'], 'username': name, 'gone': not r['username'],
                                                  'ips': set(), 'countries': set(), 'n': 0})
        a['n'] += 1
        a['ips'].add(r['ip'])
        a['countries'].add(c['code'])
    ip_list = sorted(ips.values(), key=lambda x: -x['n'])
    for x in ip_list:
        x['accounts'] = [{'id': k, 'username': v[0], 'gone': v[1]} for k, v in x['accounts'].items()]
    return ok({
        'days': days, 'rows': rows, 'truncated': len(rows) >= 5000,
        'countries': sorted(({'code': k['code'], 'name': k['name'], 'n': k['n'], 'ips': len(k['ips']),
                              'accounts': len(k['accounts'])} for k in countries.values()), key=lambda x: -x['n']),
        'ips': ip_list,
        'shared': [x for x in ip_list if len(x['accounts']) > 1],
        'travellers': sorted(({'id': a['id'], 'username': a['username'], 'gone': a['gone'], 'n': a['n'], 'ips': len(a['ips']),
                               'countries': sorted(a['countries'])} for a in accounts.values() if len(a['countries']) > 1),
                             key=lambda x: -len(x['countries'])),
        'accounts': len(accounts),
    })


async def h_guild(request):
    gid = int_arg(request.query.get('id'), 1, 2 ** 31, 'id')
    guild = await dbq(f'SELECT guildid, name, info, motd, createdate, leaderguid FROM {C}.guild WHERE guildid = %s',
                      (gid,), one=True)
    need(guild, 'Гильдия не найдена.')
    members = await dbq(f'''
        SELECT c.guid, c.name, c.level, c.race, c.class, c.gender, c.online, c.logout_time, m.`rank`, r.rname
        FROM {C}.guild_member m JOIN {C}.characters c ON c.guid = m.guid
        LEFT JOIN {C}.guild_rank r ON r.guildid = m.guildid AND r.rid = m.`rank`
        WHERE m.guildid = %s ORDER BY m.`rank`, c.level DESC''', (gid,))
    return ok({'guild': guild, 'members': [decorate_char(m) for m in members]})


# --- сервер --------------------------------------------------------------------

async def h_server(request):
    data = await body(request)
    action = data.get('action')
    if action in ('announce', 'notify'):
        text = text_arg(data.get('text'), 250, 'Сообщение')
        label = 'в чат' if action == 'announce' else 'на экран'
        return ok(await run_cmd('server.' + action, '%s: %s' % (label, text), '%s %s' % (action, text)))
    if action == 'motd':
        text = text_arg(data.get('text'), 250, 'Приветствие')
        result = await run_cmd('server.motd', text, 'server set motd %s' % text)
        if result['success'] and data.get('persist'):
            write_config({'Motd': text})
            result['output'] += '\nЗаписано и в mangosd.conf — переживёт перезапуск.'
        return ok(result)
    if action == 'saveall':
        return ok(await run_cmd('server.saveall', 'сохранить всех', 'saveall'))
    if action == 'restart':
        delay = int_arg(data.get('delay', 60), 0, 86400, 'Задержка')
        result = await run_cmd('server.restart', 'перезапуск мира через %d с' % delay, 'server restart %d' % delay)
        if result['success']:
            countdown_set('restart', delay, 'из панели')
            result['output'] = result['output'] or 'Отсчёт начат: мир перезапустится через %s.' % human_delay(delay)
        return ok(result)
    if action == 'idlerestart':
        delay = int_arg(data.get('delay', 60), 0, 86400, 'Задержка')
        result = await run_cmd('server.idlerestart', 'перезапуск, когда никого не будет, через %d с' % delay,
                               'server idlerestart %d' % delay)
        if result['success']:
            countdown_set('idle', delay, 'из панели')
            result['output'] = result['output'] or ('Запланировано: мир перезапустится не раньше чем через %s, '
                                                    'и только когда в игре никого не будет.' % human_delay(delay))
        return ok(result)
    if action == 'cancel':
        result = await run_cmd('server.cancel', 'отмена перезапуска', 'server restart cancel')
        countdown_clear()
        result['output'] = result['output'] or 'Отсчёт остановлен, мир продолжает работать.'
        return ok(result)
    if action == 'corpses':
        return ok(await run_cmd('server.corpses', 'убрать старые трупы', 'server corpses'))
    if action == 'plimit':
        value = int_arg(data.get('value'), -3, 10000, 'Лимит')
        return ok(await run_cmd('server.plimit', 'лимит игроков %d' % value, 'server plimit %d' % value))
    if action == 'reload_config':
        return ok(await run_cmd('server.reload', 'reload config', 'reload config'))
    if action == 'maintenance':
        level = 3 if data.get('on') else 0
        await dbx(f'UPDATE {R}.realmlist SET allowedSecurityLevel = %s WHERE id = %s', (level, REALM_ID))
        audit('realm.maintenance', 'режим обслуживания ' + ('включён' if level else 'выключен'))
        return ok({'success': True, 'output': 'Сервер авторизации подхватит изменение в течение 20 секунд.'})
    if action == 'realm_name':
        name = text_arg(data.get('name'), 32, 'Имя реалма')
        await dbx(f'UPDATE {R}.realmlist SET name = %s WHERE id = %s', (name, REALM_ID))
        audit('realm.name', name)
        return ok({'success': True, 'output': 'Новое имя появится в списке миров в течение 20 секунд.'})
    if action == 'service_restart':
        name = data.get('service')
        if name == 'mangosd':
            delay = int_arg(data.get('delay', 10), 0, 3600, 'Задержка')
            result = await run_cmd('server.restart', 'перезапуск мира через %d с' % delay, 'server restart %d' % delay)
            if result['success']:
                countdown_set('restart', delay, 'из панели')
                result['output'] = result['output'] or 'Отсчёт начат: мир перезапустится через %s.' % human_delay(delay)
            return ok(result)
        need(name in KILLABLE, 'Эту службу из панели перезапускать нельзя.')
        pid = scan_procs().get(name)
        need(pid, 'Служба и так не запущена.')
        os.kill(pid, signal.SIGTERM)
        audit('service.restart', name)
        return ok({'success': True, 'output': 'Процесс %d остановлен. Поднимет службу тот, кто её запускает (systemd или ваш скрипт).' % pid})
    raise ApiError('Неизвестное действие.')


# --- отсчёт перезапуска и расписание ------------------------------------------
# Ядро не сообщает, идёт ли отсчёт перезапуска: в `server info` его нет (проверено).
# Поэтому отсчёт, начатый из панели — кнопкой или по расписанию, — панель помнит
# сама, и в интерфейсе виден таймер. Отсчёт, начатый из консоли ядра или другой
# программы, панель не видит.

def human_delay(sec):
    sec = int(sec)
    if sec < 60:
        return '%d с' % sec
    if sec % 60:
        return '%d мин %d с' % (sec // 60, sec % 60)
    return '%d мин' % (sec // 60)


def countdown_set(kind, delay, source):
    now = int(time.time())
    with panel_db() as conn:
        conn.execute('INSERT OR REPLACE INTO countdown(id, kind, started, deadline, source) VALUES (1, ?, ?, ?, ?)',
                     (kind, now, now + int(delay), source))


def countdown_clear():
    with panel_db() as conn:
        conn.execute('DELETE FROM countdown')


def countdown_get(world_age):
    with panel_db() as conn:
        row = conn.execute('SELECT kind, started, deadline, source FROM countdown WHERE id = 1').fetchone()
    if not row:
        return None
    row = dict(row)
    now = time.time()
    if world_age is not None:
        # Мир запущен позже, чем начался отсчёт, — перезапуск уже случился.
        if now - world_age > row['started'] + 2:
            countdown_clear()
            return None
        # Срок давно вышел, а мир всё тот же — отсчёт отменили не из панели.
        # У «когда никого не будет» мир после срока ждёт, пока все выйдут, — его не трогаем.
        if row['kind'] == 'restart' and now > row['deadline'] + 180:
            countdown_clear()
            return None
    row['left'] = max(0, int(row['deadline'] - now))
    return row


def world_state():
    world = next((x for x in services_snapshot() if x['name'] == 'mangosd'), {})
    age = world.get('age') if world.get('running') else None
    with panel_db() as conn:
        rows = conn.execute("SELECT id, at, delay FROM schedule WHERE kind = 'restart' ORDER BY at").fetchall()
    return {'running': bool(world.get('running')), 'age': age, 'countdown': countdown_get(age),
            'schedule': [dict(r) for r in rows]}


def when_text(ts):
    return time.strftime('%d.%m.%Y %H:%M %Z', time.localtime(ts))


async def h_world(request):
    return ok(await asyncio.to_thread(world_state))


async def h_world_action(request):
    data = await body(request)
    action = data.get('action')
    if action == 'schedule':
        at = int_arg(data.get('at'), 0, 2 ** 31, 'Время')
        delay = int_arg(data.get('delay', 300), 10, 3600, 'Отсчёт')
        now = int(time.time())
        need(at - delay >= now + 30, 'Слишком скоро: до этого времени меньше, чем длится отсчёт. '
                                     'Чтобы перезапустить сейчас, есть кнопка «Перезапустить».')
        need(at <= now + 90 * 86400, 'Не дальше чем на 90 дней вперёд.')
        with panel_db() as conn:
            conn.execute("INSERT INTO schedule(kind, at, delay, created) VALUES ('restart', ?, ?, ?)", (at, delay, now))
        audit('world.schedule', 'перезапуск мира на %s, отсчёт %s' % (when_text(at), human_delay(delay)))
        return ok({'success': True, 'output': 'Запланировано.'})
    if action == 'unschedule':
        sid = int_arg(data.get('id'), 1, 2 ** 31, 'id')
        with panel_db() as conn:
            conn.execute('DELETE FROM schedule WHERE id = ?', (sid,))
        audit('world.schedule', 'отменён перезапуск по расписанию #%d' % sid)
        return ok({'success': True, 'output': 'Отменено.'})
    raise ApiError('Неизвестное действие.')


async def schedule_loop():
    """Раз в 15 секунд. Перезапуск по расписанию начинает отсчёт заранее — за выбранное
    время до назначенного момента, — чтобы мир перезапустился ровно в срок. Задание
    берётся на один проход (15 с) раньше: иначе проход, опоздавший на эти секунды,
    сдвинул бы перезапуск; отсчёт при этом выходит чуть длиннее выбранного."""
    await asyncio.sleep(20)
    while True:
        try:
            now = int(time.time())
            with panel_db() as conn:
                due = [dict(r) for r in conn.execute(
                    "SELECT id, at, delay FROM schedule WHERE kind = 'restart' AND at - delay <= ? ORDER BY at", (now + 15,))]
                for job in due:
                    conn.execute('DELETE FROM schedule WHERE id = ?', (job['id'],))
            for job in due:
                when = when_text(job['at'])
                if now > job['at'] + 600:
                    audit('world.schedule', 'перезапуск на %s пропущен: панель в это время не работала' % when, False)
                elif not scan_procs().get('mangosd'):
                    audit('world.schedule', 'перезапуск на %s пропущен: мир не работал' % when, False)
                else:
                    left = max(10, job['at'] - now)
                    result = await run_cmd('server.restart', 'перезапуск мира по расписанию на %s' % when,
                                           'server restart %d' % left)
                    if result['success']:
                        countdown_set('restart', left, 'по расписанию')
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        await asyncio.sleep(15)


# --- настройки mangosd.conf ----------------------------------------------------

CONF_LINE = re.compile(r'^(\s*)([A-Za-z0-9_.]+)(\s*=\s*)(.*?)(\s*)$')


def read_config():
    values = {}
    for line in CONF.read_text(encoding='utf-8', errors='replace').splitlines():
        m = CONF_LINE.match(line)
        if m and m.group(2) in CONFIG_SPEC:
            raw = m.group(4)
            values[m.group(2)] = raw[1:-1] if raw.startswith('"') and raw.endswith('"') else raw
    return values


def normalize_config(key, value):
    label, kind, lo, hi, _reload = CONFIG_SPEC[key]
    if kind == 'text':
        return '"%s"' % text_arg(value, hi, label)
    if kind == 'bool':
        need(str(value) in ('0', '1', 'true', 'false', 'True', 'False'), '%s: 0 или 1.' % label)
        return '1' if str(value).lower() in ('1', 'true') else '0'
    if kind == 'int':
        return str(int_arg(value, lo, hi, label))
    try:
        number = float(str(value).replace(',', '.'))
    except ValueError:
        raise ApiError('%s: нужно число.' % label)
    need(lo <= number <= hi, '%s: от %s до %s.' % (label, lo, hi))
    return ('%g' % number) if number != int(number) else str(int(number))


def write_config(changes):
    """Меняем значения на месте, сохраняя всё остальное в файле нетронутым.
    Перед записью — копия в CONF_BACKUPS (etc/backups), последние 20 штук."""
    fixed = {key: normalize_config(key, value) for key, value in changes.items() if key in CONFIG_SPEC}
    need(fixed, 'Нечего менять.')
    text = CONF.read_text(encoding='utf-8', errors='replace')
    lines = text.splitlines(keepends=True)
    seen = set()
    for i, line in enumerate(lines):
        m = CONF_LINE.match(line.rstrip('\n'))
        if m and m.group(2) in fixed and m.group(2) not in seen:
            ending = '\n' if line.endswith('\n') else ''
            lines[i] = m.group(1) + m.group(2) + m.group(3) + fixed[m.group(2)] + ending
            seen.add(m.group(2))
    missing = set(fixed) - seen
    need(not missing, 'В mangosd.conf нет строк: %s' % ', '.join(sorted(missing)))
    CONF_BACKUPS.mkdir(exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    backup = CONF_BACKUPS / ('mangosd.conf.%s' % stamp)
    backup.write_text(text, encoding='utf-8')
    os.chmod(backup, 0o600)
    for old in sorted(CONF_BACKUPS.glob('mangosd.conf.*'))[:-20]:
        old.unlink()
    tmp = CONF.with_suffix('.conf.tmp')
    tmp.write_text(''.join(lines), encoding='utf-8')
    os.chmod(tmp, 0o600)
    os.replace(tmp, CONF)
    audit('config.write', ', '.join('%s = %s' % kv for kv in fixed.items()))
    return fixed, backup.name


async def h_config(request):
    values = read_config()
    groups = []
    for title, items in CONFIG_GROUPS:
        groups.append({'title': title, 'items': [
            {'key': k, 'label': label, 'kind': kind, 'min': lo, 'max': hi, 'reload': reload,
             'value': values.get(k)} for k, label, kind, lo, hi, reload in items if k in values]})
    backups = sorted((p.name for p in CONF_BACKUPS.glob('mangosd.conf.*')), reverse=True)[:10] \
        if CONF_BACKUPS.exists() else []
    return ok({'groups': groups, 'backups': backups})


async def h_config_save(request):
    data = await body(request)
    changes = data.get('changes')
    need(isinstance(changes, dict) and changes, 'Нет изменений.')
    unknown = [k for k in changes if k not in CONFIG_SPEC]
    need(not unknown, 'Эти параметры из панели не меняются: %s' % ', '.join(unknown))
    fixed, backup = await asyncio.to_thread(write_config, changes)
    need_restart = [k for k in fixed if not CONFIG_SPEC[k][4]]
    output = 'Сохранено. Копия прежнего файла: %s' % backup
    if data.get('apply'):
        success, text = await soap('reload config')
        audit('server.reload', 'reload config после правки', success, text)
        output += '\nreload config: ' + (text or ('выполнено' if success else 'ошибка'))
    return ok({'success': True, 'output': output, 'need_restart': need_restart})


# --- боты ---------------------------------------------------------------------

BOT_COMMENTED = re.compile(r'^\s*#\s*([A-Za-z0-9_.]+)(\s*=\s*)(.*?)\s*$')


def bot_value(raw):
    raw = raw.strip()
    if ' #' in raw:
        raw = raw.split(' #', 1)[0].strip()
    return raw


def read_bot_config():
    """Значение из активной строки; если её нет — из закомментированной (это
    значение по умолчанию, его пишут в самом файле)."""
    result = {}
    for conf, path in BOT_CONFS.items():
        active, commented = {}, {}
        try:
            text = path.read_text(encoding='utf-8', errors='replace')
        except OSError:
            text = ''
        for line in text.splitlines():
            m = CONF_LINE.match(line)
            if m and m.group(2) not in active:
                active[m.group(2)] = bot_value(m.group(4))
                continue
            m = BOT_COMMENTED.match(line)
            if m and m.group(1) not in commented:
                commented[m.group(1)] = bot_value(m.group(3))
        for key, (kconf, *_rest) in BOT_SPEC.items():
            if kconf != conf:
                continue
            if key in active:
                result[key] = {'value': active[key], 'default': False}
            elif key in commented:
                result[key] = {'value': commented[key], 'default': True}
    return result


def normalize_bot(key, value):
    _conf, label, kind, lo, hi = BOT_SPEC[key]
    if kind == 'bool':
        need(str(value) in ('0', '1', 'true', 'false', 'True', 'False'), '%s: 0 или 1.' % label)
        return '1' if str(value).lower() in ('1', 'true') else '0'
    if kind == 'int':
        return str(int_arg(value, lo, hi, label))
    try:
        number = float(str(value).replace(',', '.'))
    except ValueError:
        raise ApiError('%s: нужно число.' % label)
    need(lo <= number <= hi, '%s: от %s до %s.' % (label, lo, hi))
    return ('%g' % number) if number != int(number) else str(int(number))


def write_bot_config(changes):
    """Меняем значение на месте. Если активной строки нет — раскомментируем строку
    с этим ключом, а если нет и её — дописываем в конец. Перед записью — копия
    файла в CONF_BACKUPS (последние 20 на каждый файл)."""
    fixed = {key: normalize_bot(key, value) for key, value in changes.items()}
    need(fixed, 'Нечего менять.')
    merged = {k: v['value'] for k, v in read_bot_config().items()}
    merged.update(fixed)
    for lo_key, hi_key, what in (('AiPlayerbot.MinRandomBots', 'AiPlayerbot.MaxRandomBots',
                                  '«Ботов не меньше» не может быть больше, чем «не больше».'),
                                 ('AiPlayerbot.RandomBotMinLevel', 'AiPlayerbot.RandomBotMaxLevel',
                                  'Уровень ботов «от» не может быть больше уровня «до».')):
        if lo_key in merged and hi_key in merged:
            need(int(merged[lo_key]) <= int(merged[hi_key]), what)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    saved = []
    for conf, path in BOT_CONFS.items():
        mine = {k: v for k, v in fixed.items() if BOT_SPEC[k][0] == conf}
        if not mine:
            continue
        text = path.read_text(encoding='utf-8', errors='replace')
        lines = text.splitlines(keepends=True)
        done = set()
        for i, line in enumerate(lines):
            m = CONF_LINE.match(line.rstrip('\n'))
            if m and m.group(2) in mine and m.group(2) not in done:
                ending = '\n' if line.endswith('\n') else ''
                lines[i] = m.group(1) + m.group(2) + m.group(3) + mine[m.group(2)] + ending
                done.add(m.group(2))
        for i, line in enumerate(lines):
            m = BOT_COMMENTED.match(line.rstrip('\n'))
            if m and m.group(1) in mine and m.group(1) not in done:
                lines[i] = '%s = %s\n' % (m.group(1), mine[m.group(1)])
                done.add(m.group(1))
        rest = [k for k in mine if k not in done]
        if rest:
            if lines and not lines[-1].endswith('\n'):
                lines[-1] += '\n'
            lines.append('\n# Добавлено веб-панелью\n')
            lines.extend('%s = %s\n' % (k, mine[k]) for k in rest)
        CONF_BACKUPS.mkdir(exist_ok=True)
        backup = CONF_BACKUPS / ('%s.%s' % (path.name, stamp))
        backup.write_text(text, encoding='utf-8')
        os.chmod(backup, 0o600)
        for old in sorted(CONF_BACKUPS.glob(path.name + '.*'))[:-20]:
            old.unlink()
        tmp = path.with_suffix('.conf.tmp')
        tmp.write_text(''.join(lines), encoding='utf-8')
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
        saved.append(backup.name)
    audit('bots.config', ', '.join('%s = %s' % kv for kv in fixed.items()))
    return fixed, saved


def bots_pending(world_age):
    """Файл настроек ботов изменён после запуска мира — значит, изменения ещё не действуют."""
    if world_age is None:
        return False
    started = time.time() - world_age
    for path in BOT_CONFS.values():
        try:
            if path.stat().st_mtime > started + 1:
                return True
        except OSError:
            pass
    return False


async def h_bots(request):
    cfg = await asyncio.to_thread(read_bot_config)
    world = next((x for x in services_snapshot() if x['name'] == 'mangosd'), {})
    age = world.get('age') if world.get('running') else None
    base = f'FROM {C}.characters c JOIN {R}.account a ON a.id = c.account WHERE a.username LIKE %s'
    totals = await dbq(f'''SELECT COUNT(*) AS chars, COALESCE(SUM(c.online), 0) AS online, MIN(c.level) AS minlvl,
                                  MAX(c.level) AS maxlvl, ROUND(AVG(c.level), 1) AS avglvl {base}''', (BOT_LIKE,), one=True)
    accounts = await dbq(f'SELECT COUNT(*) AS n FROM {R}.account WHERE username LIKE %s', (BOT_LIKE,), one=True)
    levels = await dbq(f'''SELECT LEAST(FLOOR(c.level / 10), 5) AS b, COUNT(*) AS n, COALESCE(SUM(c.online), 0) AS online
                           {base} GROUP BY b ORDER BY b''', (BOT_LIKE,))
    classes = await dbq(f'''SELECT c.class AS id, COUNT(*) AS n, COALESCE(SUM(c.online), 0) AS online
                            {base} GROUP BY c.class ORDER BY n DESC''', (BOT_LIKE,))
    races = await dbq(f'SELECT c.race AS id, COUNT(*) AS n, COALESCE(SUM(c.online), 0) AS online {base} GROUP BY c.race',
                      (BOT_LIKE,))
    online = await dbq(f'''SELECT c.guid, c.name, c.level, c.race, c.class, c.zone, c.online
                           {base} AND c.online = 1 ORDER BY c.level DESC, c.name LIMIT 100''', (BOT_LIKE,))
    players = await dbq(f'''SELECT COUNT(*) AS n FROM {C}.characters c JOIN {R}.account a ON a.id = c.account
                            WHERE c.online = 1 AND a.username NOT LIKE %s''', (BOT_LIKE,), one=True)
    factions = {'A': [0, 0], 'H': [0, 0]}
    for r in races:
        side = RACES.get(r['id'], ('?', '?'))[1]
        if side in factions:
            factions[side][0] += r['n']
            factions[side][1] += int(r['online'])
    groups = [{'id': gid, 'title': title, 'items': [
        {'key': k, 'label': label, 'kind': kind, 'min': lo, 'max': hi, 'hint': hint,
         'value': cfg.get(k, {}).get('value'), 'default': cfg.get(k, {}).get('default', False)}
        for k, _conf, label, kind, lo, hi, hint in items]} for gid, title, items in BOT_GROUPS]
    return ok({
        'groups': groups,
        'totals': {**totals, 'accounts': accounts['n']},
        'levels': [{'from': int(r['b']) * 10 or 1, 'to': 60 if int(r['b']) == 5 else int(r['b']) * 10 + 9,
                    'n': r['n'], 'online': int(r['online'])} for r in levels],
        'classes': [{'id': r['id'], 'name': CLASSES.get(r['id'], '?'), 'n': r['n'], 'online': int(r['online'])} for r in classes],
        'factions': factions,
        'online': [decorate_char(r) for r in online],
        'players_online': players['n'],
        'world_running': bool(world.get('running')),
        'pending': bots_pending(age),
        'mem': cgroup_stats(),
    })


async def h_bots_save(request):
    data = await body(request)
    changes = data.get('changes')
    need(isinstance(changes, dict) and changes, 'Нет изменений.')
    unknown = [k for k in changes if k not in BOT_SPEC]
    need(not unknown, 'Эти параметры из панели не меняются: %s' % ', '.join(unknown))
    fixed, backups = await asyncio.to_thread(write_bot_config, changes)
    return ok({'success': True, 'saved': fixed,
               'output': 'Сохранено. Копии прежних файлов: %s. Боты подхватят изменения после перезапуска мира.'
                         % ', '.join(str(CONF_BACKUPS / b) for b in backups)})


# --- логи, консоль, справочники ------------------------------------------------

def tail_file(path, lines, needle=''):
    try:
        size = path.stat().st_size
    except OSError:
        return None, 0
    chunk = min(size, 2 * 1024 * 1024 if needle else 512 * 1024)
    with open(path, 'rb') as f:
        f.seek(size - chunk)
        text = f.read().decode('utf-8', 'replace')
    rows = text.splitlines()
    if chunk < size:
        rows = rows[1:]
    if needle:
        low = needle.lower()
        rows = [r for r in rows if low in r.lower()]
    return rows[-lines:], size


async def h_logs(request):
    key = request.query.get('file') or next(iter(LOG_FILES))
    need(key in LOG_FILES, 'Нет такого лога.')
    lines = int_arg(request.query.get('lines', 300), 10, 5000, 'Строк')
    label, path = LOG_FILES[key]
    rows, size = await asyncio.to_thread(tail_file, path, lines, request.query.get('q', '').strip())
    files = [{'key': k, 'label': lbl, 'exists': p.exists()} for k, (lbl, p) in LOG_FILES.items()]
    return ok({'file': key, 'label': label, 'path': str(path), 'size': size,
               'lines': rows if rows is not None else [], 'missing': rows is None, 'files': files})


async def h_console(request):
    data = await body(request)
    command = str(data.get('command') or '').strip().lstrip('.')
    need(command, 'Пустая команда.')
    need(len(command) <= 500, 'Команда длиннее 500 символов.')
    need(not BAD_CHARS.search(command), 'Перевод строки в команде — отклонено.')
    return ok(await run_cmd('console', command, command))


async def h_commands(request):
    term = request.query.get('q', '').strip()
    if term:
        rows = await dbq(f'SELECT name, security, help FROM {W}.command WHERE name LIKE %s OR help LIKE %s '
                         f'ORDER BY name LIMIT 300', ('%' + term + '%', '%' + term + '%'))
    else:
        rows = await dbq(f'SELECT name, security, help FROM {W}.command ORDER BY name')
    return ok(rows)


LOOKUP_LINE = re.compile(r'^\s*(\d+)\s*-\s*(.+?)\s*$')


async def h_lookup(request):
    kind = request.query.get('kind', 'item')
    term = request.query.get('q', '').strip()
    need(2 <= len(term) <= 50 and not BAD_CHARS.search(term), 'Строка поиска: от 2 до 50 символов.')
    if kind == 'item':
        like = '%' + term.replace('%', '') + '%'
        where = 'entry = %s OR name LIKE %s' if term.isdigit() else 'name LIKE %s'
        args = (int(term), like) if term.isdigit() else (like,)
        rows = await dbq(f'SELECT entry AS id, name, Quality AS quality, ItemLevel AS ilvl, RequiredLevel AS req '
                         f'FROM {W}.item_template WHERE {where} ORDER BY Quality DESC, ItemLevel DESC LIMIT 60', args)
        return ok({'kind': kind, 'rows': rows})
    need(kind in ('creature', 'quest', 'spell', 'tele', 'area', 'object', 'faction', 'skill'), 'Неизвестный вид поиска.')
    success, output = await soap('lookup %s %s' % (kind, term.replace('"', '')))
    rows = []
    for line in output.splitlines():
        m = LOOKUP_LINE.match(line)
        if m:
            rows.append({'id': int(m.group(1)), 'name': m.group(2)})
    return ok({'kind': kind, 'rows': rows[:200], 'raw': output if not rows else '', 'success': success})


async def h_audit(request):
    limit = int_arg(request.query.get('limit', 300), 1, 2000, 'limit')
    with panel_db() as conn:
        rows = conn.execute('SELECT id, ts, action, detail, ok, output FROM audit ORDER BY id DESC LIMIT ?',
                            (limit,)).fetchall()
    return ok([dict(r) for r in rows])


async def h_tickets(request):
    rows = await dbq(f'SELECT id, author_name, text, created, closed, assignee_name, conclusion '
                     f'FROM {C}.gm_tickets ORDER BY closed ASC, created DESC LIMIT 100')
    return ok(rows)


async def h_system(request):
    """Размеры баз — по information_schema: папки самой базы панели обычно не видны."""
    rows = await dbq('SELECT table_schema AS db, SUM(data_length + index_length) AS size '
                     'FROM information_schema.tables WHERE table_schema IN (%s, %s, %s) GROUP BY table_schema', (R, C, W))
    return ok({'db_sizes': {r['db']: int(r['size'] or 0) for r in rows}, 'host': host_stats(), 'container': cgroup_stats()})


# --- конструктор предметов ----------------------------------------------------
#
# Самодельные предметы — обычные строки item_template в мировой базе с номерами
# от 90000: у classic-db их максимум 25818, и обновления базы туда не залезут.
# Оригинальные предметы панель не меняет — их можно только взять за основу.
#
# Мир читает item_template один раз при запуске, reload для предметов в CMaNGOS
# нет. Поэтому новый или изменённый предмет появляется в игре после перезапуска
# мира; готов ли он, панель спрашивает у самого ядра (lookup item).
#
# Клиенту 1.12 файл Item.dbc не нужен (его в клиенте просто нет): всё о предмете
# он получает от сервера. Внешний вид — номер модели из ItemDisplayInfo.dbc.
# Игроки, уже видевшие предмет, держат его в кэше WDB: после правки старого
# предмета им надо удалить папку WDB в клиенте.

CUSTOM_MIN = 90000
CUSTOM_SQL = DATA / 'custom_items.sql'
ITEM_META = {}
DBC_DATA = {}
DBC_LOCK = None
ITEM_ICONS = {}
ICON_LOCK = None

ITEM_SUBCLASSES = {
    0: set(range(0, 9)), 1: set(range(0, 5)),
    2: {0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 13, 14, 15, 16, 18, 19, 20},
    4: {0, 1, 2, 3, 4, 6, 7, 8, 9}, 5: {0}, 6: {2, 3}, 7: {0, 1, 2, 3},
    9: set(range(0, 10)), 11: {2, 3}, 12: {0}, 13: {0, 1}, 15: set(range(0, 6)),
}
ITEM_STAT_TYPES = {0, 1, 3, 4, 5, 6, 7}
ITEM_TRIGGERS = {0, 1, 2, 4, 5}
INT_RANGES = {'tinyint': 8, 'smallint': 16, 'mediumint': 24, 'int': 32, 'bigint': 64}


def _col_spec(ctype):
    """'tinyint(3) unsigned' → ('int', 0, 255); 'varchar(255)' → ('text', 0, 255)."""
    base = ctype.split('(')[0].strip()
    if base in INT_RANGES:
        bits = INT_RANGES[base]
        if 'unsigned' in ctype:
            return 'int', 0, 2 ** bits - 1
        return 'int', -2 ** (bits - 1), 2 ** (bits - 1) - 1
    if base in ('float', 'double', 'decimal'):
        return 'float', -1e9, 1e9
    m = re.search(r'\((\d+)\)', ctype)
    return 'text', 0, int(m.group(1)) if m else 255


async def item_meta():
    if not ITEM_META:
        rows = await dbq("SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, COLUMN_DEFAULT AS dflt "
                         "FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = %s AND TABLE_NAME = 'item_template' "
                         "ORDER BY ORDINAL_POSITION", (W,))
        cols = []
        for r in rows:
            kind, lo, hi = _col_spec(r['type'])
            dflt = r['dflt']
            if dflt is not None:
                dflt = dflt.strip("'")
                dflt = (float(dflt) if kind == 'float' else int(float(dflt))) if kind != 'text' else dflt
            else:
                dflt = '' if kind == 'text' else 0
            cols.append({'name': r['name'], 'kind': kind, 'min': lo, 'max': hi, 'default': dflt, 'type': r['type']})
        ITEM_META['cols'] = cols
        ITEM_META['by_name'] = {c['name']: c for c in cols}
    return ITEM_META


def _dbc(name):
    raw = (DBC / name).read_bytes()
    sig, count, fields, size, strings = struct.unpack('<4s4I', raw[:20])
    if sig != b'WDBC':
        raise ValueError(name)
    block = raw[20 + count * size: 20 + count * size + strings]
    return raw, count, fields, size, block


def _dbc_str(block, off):
    if 0 < off < len(block):
        return block[off:block.find(b'\0', off)].decode('utf-8', 'replace')
    return ''


def _load_dbc_data():
    """Заклинания, длительности и иконки из DBC клиента. Грузится один раз."""
    spells = {}
    raw, count, fields, size, block = _dbc('Spell.dbc')
    for i in range(count):
        r = struct.unpack_from('<%di' % fields, raw, 20 + i * size)
        name = _dbc_str(block, r[120])
        if not name:
            continue
        # name, rank, описание, атрибуты, шанс, заряды, индекс длительности,
        # базовые очки, кубики, грани, период эффектов
        spells[r[0]] = (name, _dbc_str(block, r[129]), _dbc_str(block, r[138]), r[6], r[25], r[26], r[30],
                        (r[76], r[77], r[78]), (r[67], r[68], r[69]), (r[64], r[65], r[66]), (r[94], r[95], r[96]),
                        (r[100], r[101], r[102]), (r[88], r[89], r[90]), r[117])    # последнее — иконка (SpellIcon)
    durations = {}
    raw, count, fields, size, block = _dbc('SpellDuration.dbc')
    for i in range(count):
        r = struct.unpack_from('<%di' % fields, raw, 20 + i * size)
        durations[r[0]] = r[1]
    radius = {}
    raw, count, fields, size, block = _dbc('SpellRadius.dbc')
    for i in range(count):
        rid, value = struct.unpack_from('<If', raw, 20 + i * size)
        radius[rid] = value
    return {'spells': spells, 'durations': durations, 'radius': radius}


def _load_item_icons():
    """Номер вида предмета → имя иконки. Отдельно от заклинаний: карточке
    персонажа нужны только иконки, а Spell.dbc большой."""
    icons = {}
    raw, count, fields, size, block = _dbc('ItemDisplayInfo.dbc')
    for i in range(count):
        r = struct.unpack_from('<%dI' % fields, raw, 20 + i * size)
        icons[r[0]] = _dbc_str(block, r[5])
    return icons


async def item_icons():
    if not ITEM_ICONS:
        async with ICON_LOCK:
            if not ITEM_ICONS:
                ITEM_ICONS.update(await asyncio.to_thread(_load_item_icons))
    return ITEM_ICONS


async def dbc_data():
    if not DBC_DATA:
        icons = await item_icons()
        async with DBC_LOCK:
            if not DBC_DATA:
                data = await asyncio.to_thread(_load_dbc_data)
                data['icons'] = icons
                DBC_DATA.update(data)
    return DBC_DATA


SPELL_TOKEN = re.compile(r'\$(\d*)([a-zA-Z])(\d?)')


def _fmt_ms(ms):
    if not ms or ms < 0:
        return 'until cancelled'
    sec = ms / 1000
    if sec < 60:
        return '%g sec' % sec
    if sec < 3600:
        return '%g min' % round(sec / 60, 1)
    return '%g hrs' % round(sec / 3600, 1)


def spell_text(data, sid):
    """Описание заклинания с подставленными числами — как в подсказке игры."""
    spells, durations = data['spells'], data['durations']
    sp = spells.get(sid)
    if not sp:
        return ''
    text = re.sub(r'\$l([^:;]*):([^;]*);', lambda m: m.group(2), sp[2])
    text = re.sub(r'\$\{[^}]*\}', 'X', text)

    def value(t, idx):
        lo = t[7][idx] + t[8][idx]
        hi = t[7][idx] + t[8][idx] * max(t[9][idx], 1)
        return str(abs(lo)) if hi <= lo else '%d to %d' % (abs(lo), abs(hi))

    def sub(m):
        ref, code, idx = m.group(1), m.group(2).lower(), int(m.group(3) or 1) - 1
        t = spells.get(int(ref)) if ref else sp
        if not t:
            return 'X'
        idx = min(max(idx, 0), 2)
        if code in ('s', 'm'):
            return value(t, idx)
        if code == 'h':
            return str(t[4])
        if code == 'n':
            return str(t[5])
        if code == 'd':
            return _fmt_ms(durations.get(t[6], 0))
        if code == 't':
            return '%g' % (t[10][idx] / 1000) if t[10][idx] else 'X'
        if code == 'o':
            ticks = durations.get(t[6], 0) // t[10][idx] if t[10][idx] else 1
            return str(abs(t[7][idx] + t[8][idx]) * max(ticks, 1))
        if code == 'x':
            return str(t[11][idx] or 1)
        if code == 'a':
            return '%g' % data['radius'].get(t[12][idx], 0)
        return 'X'

    return SPELL_TOKEN.sub(sub, text).strip()


def spell_info(data, sid):
    sp = data['spells'].get(sid)
    if not sp:
        return None
    return {'id': sid, 'name': sp[0], 'rank': sp[1], 'desc': spell_text(data, sid), 'passive': bool(sp[3] & 0x40)}


async def h_spells(request):
    data = await dbc_data()
    ids = request.query.get('ids', '').strip()
    if ids:
        out = [spell_info(data, int(i)) for i in ids.split(',')[:20] if i.strip().isdigit()]
        return ok([x for x in out if x])
    term = request.query.get('q', '').strip()
    need(term.isdigit() or len(term) >= 2, 'Строка поиска: от 2 символов.')
    low = term.lower()
    prefix = request.query.get('prefix') == '1'
    found = []
    for sid, sp in data['spells'].items():
        if term.isdigit():
            if sid == int(term):
                found.append(sid)
        elif (sp[0].lower().startswith(low) if prefix else (low in sp[0].lower() or low in sp[2].lower())):
            found.append(sid)
    # Эффекты «при надевании» — пассивные заклинания, их показываем первыми;
    # внутри — по силе эффекта, чтобы «Attack Power 20» шёл после «... 18».
    def weight(sid):
        sp = data['spells'][sid]
        return (0 if sp[3] & 0x40 else 1, re.sub(r'[\d\s%+()-]+$', '', sp[0]), abs(sp[7][0] + sp[8][0]), sid)
    found.sort(key=weight)
    return ok([spell_info(data, sid) for sid in found[:120]], total=len(found))


def _item_summary(row, icons):
    return {'entry': row['entry'], 'name': row['name'], 'quality': row['Quality'], 'class': row['class'],
            'subclass': row['subclass'], 'slot': row['InventoryType'], 'ilvl': row['ItemLevel'],
            'req': row['RequiredLevel'], 'displayid': row['displayid'], 'icon': icons.get(row['displayid'], '')}


async def h_items_custom(request):
    data = await dbc_data()
    rows = await dbq(f'SELECT entry, name, Quality, class, subclass, InventoryType, ItemLevel, RequiredLevel, displayid '
                     f'FROM {W}.item_template WHERE entry >= %s ORDER BY entry DESC', (CUSTOM_MIN,))
    counts = await dbq(f'SELECT itemEntry, COUNT(*) AS n FROM {C}.item_instance WHERE itemEntry >= %s GROUP BY itemEntry',
                       (CUSTOM_MIN,))
    have = {r['itemEntry']: r['n'] for r in counts}
    out = []
    for r in rows:
        item = _item_summary(r, data['icons'])
        item['instances'] = have.get(r['entry'], 0)
        out.append(item)
    return ok(out, custom_min=CUSTOM_MIN)


async def h_items_search(request):
    data = await dbc_data()
    term = request.query.get('q', '').strip()
    need(term.isdigit() or len(term) >= 2, 'Строка поиска: от 2 символов.')
    like = '%' + term.replace('%', '').replace('_', r'\_') + '%'
    where = 'entry = %s OR name LIKE %s' if term.isdigit() else 'name LIKE %s'
    args = (int(term), like) if term.isdigit() else (like,)
    rows = await dbq(f'SELECT entry, name, Quality, class, subclass, InventoryType, ItemLevel, RequiredLevel, displayid '
                     f'FROM {W}.item_template WHERE {where} ORDER BY Quality DESC, ItemLevel DESC LIMIT 60', args)
    return ok([_item_summary(r, data['icons']) for r in rows])


async def item_loaded(entry, name):
    """Знает ли уже работающий мир этот предмет. None — спросить не удалось."""
    parts = [p.strip() for p in re.split(r"[^\w\s'-]+", name) if p.strip()]
    probe = max(parts, key=len)[:60] if parts else ''
    if not probe:
        return None
    success, output = await soap('lookup item %s' % probe, timeout=8)
    if output is None:
        return False          # ядро отклонило lookup — значит, ничего не нашло
    if not success:
        return None           # мир не ответил или SOAP недоступен
    return any(line.strip().startswith('%d ' % entry) or line.strip().startswith('%d-' % entry)
               for line in (output or '').splitlines())


async def h_item(request):
    entry = int_arg(request.query.get('entry'), 1, 16777215, 'Номер предмета')
    data = await dbc_data()
    row = await dbq(f'SELECT * FROM {W}.item_template WHERE entry = %s', (entry,), one=True)
    need(row, 'Предмета с таким номером нет.')
    inst = await dbq(f'SELECT COUNT(*) AS n FROM {C}.item_instance WHERE itemEntry = %s', (entry,), one=True)
    spells = [spell_info(data, row['spellid_%d' % i]) for i in range(1, 6) if row['spellid_%d' % i]]
    # brief=1 — для подсказки над вещью в карточке персонажа: без вопроса миру через SOAP
    loaded = None if request.query.get('brief') == '1' else await item_loaded(entry, row['name'])
    return ok({'item': row, 'icon': data['icons'].get(row['displayid'], ''), 'custom': entry >= CUSTOM_MIN,
               'instances': inst['n'], 'spells': [s for s in spells if s], 'loaded': loaded,
               'custom_min': CUSTOM_MIN})


async def h_items_looks(request):
    """Внешние виды, которые в игре встречаются у предметов такого типа, подтипа
    и (если задан) слота: один на номер модели, с иконкой и именем примера."""
    data = await dbc_data()
    qs = request.query
    cls = int_arg(qs.get('class'), 0, 20, 'Тип')
    sub = int_arg(qs.get('subclass'), 0, 30, 'Подтип')
    where, args = ['class = %s', 'subclass = %s', 'entry < %s', 'displayid > 0'], [cls, sub, CUSTOM_MIN]
    if qs.get('slot', '') != '':
        where.append('InventoryType = %s')
        args.append(int_arg(qs.get('slot'), 0, 28, 'Слот'))
    clause = ' AND '.join(where)
    # Служебные предметы разработчиков (заглушки, оружие мобов, тестовые) в игре
    # не встречаются: их виды — в конец списка, а имя примера берём у настоящего.
    dev = '(name LIKE %s OR name LIKE %s OR name LIKE %s OR name LIKE %s OR name LIKE %s OR name REGEXP %s)'
    dev_args = ['[%', 'Monster -%', 'Deprecated%', '%Test%', 'OLD%', '^[0-9]']
    rows = await dbq(f'''SELECT displayid, COUNT(*) AS n, MAX(Quality) AS quality, MAX(ItemLevel) AS ilvl, MIN({dev}) AS dev,
                                SUBSTRING_INDEX(GROUP_CONCAT(name ORDER BY {dev}, Quality DESC, ItemLevel DESC SEPARATOR '|'), '|', 1) AS name
                         FROM {W}.item_template WHERE {clause}
                         GROUP BY displayid ORDER BY dev, MAX(ItemLevel) DESC, MAX(Quality) DESC LIMIT 800''',
                     dev_args + dev_args + args)
    return ok([{'displayid': r['displayid'], 'icon': data['icons'].get(r['displayid'], ''), 'name': r['name'],
                'quality': r['quality'], 'ilvl': r['ilvl'], 'n': r['n'], 'dev': bool(r['dev'])} for r in rows])


async def h_display(request):
    data = await dbc_data()
    did = int_arg(request.query.get('id'), 1, 16777215, 'Номер вида')
    need(did in data['icons'], 'Внешнего вида %d нет в ItemDisplayInfo.dbc.' % did)
    return ok({'icon': data['icons'][did]})


async def h_items_meta(request):
    meta = await item_meta()
    return ok({'cols': meta['cols'], 'custom_min': CUSTOM_MIN})


def _check_item(fields, meta, data):
    """Проверка каждого поля по типу колонки и по тому, что ядро примет."""
    by = meta['by_name']
    clean = {}
    for key, value in fields.items():
        need(key in by and key != 'entry', 'Неизвестное поле: %s' % key)
        col = by[key]
        if col['kind'] == 'text':
            text = re.sub(r'[\r\n\t]+', ' ', str(value if value is not None else '')).strip()
            need(len(text) <= col['max'], '%s: не длиннее %d символов.' % (key, col['max']))
            clean[key] = text
        elif col['kind'] == 'float':
            try:
                number = float(str(value).replace(',', '.'))
            except (TypeError, ValueError):
                raise ApiError('%s: нужно число.' % key)
            need(0 <= number <= 1e7 or key.startswith('spellppm') or key == 'RangedModRange',
                 '%s: недопустимое значение.' % key)
            clean[key] = number
        else:
            try:
                number = int(float(str(value)))
            except (TypeError, ValueError):
                raise ApiError('%s: нужно целое число.' % key)
            need(col['min'] <= number <= col['max'], '%s: от %d до %d.' % (key, col['min'], col['max']))
            clean[key] = number
    full = dict(clean)
    need(str(full.get('name', 'x')).strip(), 'У предмета должно быть название.')
    cls, sub = full.get('class'), full.get('subclass')
    if cls is not None:
        need(cls in ITEM_SUBCLASSES, 'Такого класса предметов в классике нет: %s' % cls)
        if sub is not None:
            need(sub in ITEM_SUBCLASSES[cls], 'Подкласс %s не подходит к классу %s.' % (sub, cls))
    if 'InventoryType' in full:
        need(0 <= full['InventoryType'] <= 28, 'Слот: от 0 до 28.')
    if 'Quality' in full:
        need(0 <= full['Quality'] <= 6, 'Качество: от 0 до 6.')
    if 'bonding' in full:
        need(0 <= full['bonding'] <= 5, 'Привязка: от 0 до 5.')
    for i in range(1, 11):
        if full.get('stat_type%d' % i) is not None:
            need(full['stat_type%d' % i] in ITEM_STAT_TYPES,
                 'Характеристика %d: в классике бывают только мана, здоровье, ловкость, сила, интеллект, дух, выносливость.' % i)
    for i in range(1, 6):
        if full.get('dmg_type%d' % i) is not None:
            need(0 <= full['dmg_type%d' % i] <= 6, 'Тип урона %d: от 0 до 6.' % i)
        sid = full.get('spellid_%d' % i)
        if sid:
            need(sid in data['spells'], 'Заклинания %d нет в Spell.dbc — ядро его не примет.' % sid)
        if full.get('spelltrigger_%d' % i) is not None:
            need(full['spelltrigger_%d' % i] in ITEM_TRIGGERS, 'Способ срабатывания эффекта %d неизвестен.' % i)
    if full.get('displayid'):
        need(full['displayid'] in data['icons'], 'Внешнего вида %d нет в ItemDisplayInfo.dbc.' % full['displayid'])
    return clean


def _sql_value(v):
    if v is None:
        return 'NULL'
    if isinstance(v, bool):
        return str(int(v))
    if isinstance(v, (int, float, Decimal)):
        return repr(float(v)) if isinstance(v, float) else str(v)
    return "'" + pymysql.converters.escape_string(str(v)) + "'"


def item_sql(row, cols):
    names = [c['name'] for c in cols]
    return 'REPLACE INTO `item_template` (%s) VALUES\n(%s);' % (
        ', '.join('`%s`' % n for n in names), ', '.join(_sql_value(row.get(n)) for n in names))


async def export_custom_items():
    """Копия всех самодельных предметов в data/custom_items.sql: переживёт даже
    переустановку мировой базы с нуля — файл заливается обратно одной командой."""
    meta = await item_meta()
    rows = await dbq(f'SELECT * FROM {W}.item_template WHERE entry >= %s ORDER BY entry', (CUSTOM_MIN,))
    head = ('-- Самодельные предметы WoW-сервера (веб-панель), %s\n'
            '-- Залить обратно: mysql -umangos -p %s < custom_items.sql\n\n' % (
                datetime.now().strftime('%Y-%m-%d %H:%M'), W))
    body = '\n\n'.join(item_sql(r, meta['cols']) for r in rows)
    await asyncio.to_thread(CUSTOM_SQL.write_text, head + body + '\n', 'utf-8')


async def h_item_save(request):
    data = await body(request)
    meta = await item_meta()
    dbc = await dbc_data()
    fields = data.get('fields')
    need(isinstance(fields, dict) and fields, 'Нет полей предмета.')
    fields = {k: v for k, v in fields.items() if k != 'entry'}
    clean = _check_item(fields, meta, dbc)
    entry = data.get('entry')
    if entry:
        entry = int_arg(entry, CUSTOM_MIN, 16777215, 'Номер предмета')
        exists = await dbq(f'SELECT entry FROM {W}.item_template WHERE entry = %s', (entry,), one=True)
        need(exists, 'Предмета %d нет — возможно, его удалили.' % entry)
        sets = ', '.join('`%s` = %%s' % k for k in clean)
        await dbx(f'UPDATE {W}.item_template SET {sets} WHERE entry = %s', list(clean.values()) + [entry])
        created = False
    else:
        row = {c['name']: c['default'] for c in meta['cols']}
        base = data.get('base')
        if base:
            src = await dbq(f'SELECT * FROM {W}.item_template WHERE entry = %s',
                            (int_arg(base, 1, 16777215, 'Основа'),), one=True)
            need(src, 'Предмета-основы нет.')
            row.update(src)
        row.update(clean)
        last = await dbq(f'SELECT MAX(entry) AS m FROM {W}.item_template WHERE entry >= %s', (CUSTOM_MIN,), one=True)
        entry = max(CUSTOM_MIN, (last['m'] or CUSTOM_MIN - 1) + 1)
        row['entry'] = entry
        names = [c['name'] for c in meta['cols']]
        await dbx(f'INSERT INTO {W}.item_template (%s) VALUES (%s)' % (
            ', '.join('`%s`' % n for n in names), ', '.join(['%s'] * len(names))), [row[n] for n in names])
        created = True
    saved = await dbq(f'SELECT name FROM {W}.item_template WHERE entry = %s', (entry,), one=True)
    audit('item.create' if created else 'item.update', '#%d %s' % (entry, saved['name']))
    await export_custom_items()
    return ok({'entry': entry, 'created': created, 'loaded': await item_loaded(entry, saved['name'])})


async def h_item_delete(request):
    data = await body(request)
    entry = int_arg(data.get('entry'), CUSTOM_MIN, 16777215, 'Номер предмета')
    row = await dbq(f'SELECT name FROM {W}.item_template WHERE entry = %s', (entry,), one=True)
    need(row, 'Такого предмета нет.')
    need(data.get('confirm') == row['name'], 'Для удаления впишите название предмета точно.')
    await dbx(f'DELETE FROM {W}.item_template WHERE entry = %s AND entry >= %s', (entry, CUSTOM_MIN))
    audit('item.delete', '#%d %s' % (entry, row['name']))
    await export_custom_items()
    return ok({'success': True, 'output': 'Предмет удалён из базы. Мир забудет его после перезапуска.'})


async def h_item_sql(request):
    entry = int_arg(request.query.get('entry'), 1, 16777215, 'Номер предмета')
    meta = await item_meta()
    row = await dbq(f'SELECT * FROM {W}.item_template WHERE entry = %s', (entry,), one=True)
    need(row, 'Предмета с таким номером нет.')
    return ok({'sql': item_sql(row, meta['cols'])})


# --- свои НПС и мобы -----------------------------------------------------------
# Новый НПС — копия creature_template существующего (основа даёт внешность, характеристики
# и добычу) с номером от 90000 (в classic-db creature_template кончается на 18199). Что он
# говорит: окно разговора — gossip_menu + npc_text (как у всех НПС в игре), реплики «при виде
# игрока», «при нападении», «при смерти» — EventAI (creature_ai_scripts) с текстами в
# broadcast_text. Где стоит — строки creature. Ядро перечитывает creature_template, creature,
# EventAI и broadcast_text только при запуске мира: до перезапуска НПС «ждёт перезапуска».
# У каждой таблицы свой диапазон номеров, вычисляемый из номера НПС, — так всё своё легко
# найти, выгрузить в data/custom_npcs.sql и удалить, не задев базу classic-db.

NPC_MIN = 90000
NPC_MAX = 94535                 # gossip_menu.entry — smallint, больше 65535 не влезет
NPC_MENU = 61000                # gossip_menu.entry = NPC_MENU + (entry - NPC_MIN)
NPC_TEXT = 15000000             # npc_text.ID
NPC_BT = 9000000                # broadcast_text.Id = NPC_BT + (entry - NPC_MIN) * 10 + k
NPC_EQUIP = 9000000             # creature_equip_template.entry
NPC_SQL = DATA / 'custom_npcs.sql'
NPC_KINDS = ('npc', 'mob')
NPC_RANKS = (0, 1, 2, 3, 4)     # обычный, элита, редкий элитный, босс, редкий
NPC_TYPES = (1, 2, 3, 4, 5, 6, 7, 8, 9, 10)
NPC_CLASSES = (1, 2, 4, 8)      # воин, паладин, разбойник, маг — от класса зависят здоровье и мана
STAND_STATES = (0, 1, 3, 8)     # стоит, сидит, спит, на коленях
EMOTE_STATES = (0, 10, 69, 173, 64)   # нет, танцует, работает руками, работает с оружием, оглушён
# Разовые жесты (Emotes.dbc): говорит, кланяется, машет, радуется, восклицает, спрашивает, смеётся,
# плачет, аплодирует, указывает, отдаёт честь, смущается
TALK_EMOTES = (0, 1, 2, 3, 4, 5, 6, 11, 18, 21, 25, 66, 24)
UNIT_IMMUNE = 0x100 | 0x200     # UNIT_FLAG_IMMUNE_TO_PLAYER | IMMUNE_TO_NPC — драться с ним нельзя
EAI_GREET, EAI_AGGRO, EAI_DEATH = 1, 2, 3     # номер события EventAI: entry * 100 + k
CHAT_SAY, CHAT_YELL = 0, 1


def npc_ids(entry):
    n = entry - NPC_MIN
    return {'menu': NPC_MENU + n, 'text': NPC_TEXT + n, 'bt': NPC_BT + n * 10, 'equip': NPC_EQUIP + n}


def story_text(value, maxlen, what):
    """Многострочный текст для игры: «|» убираем (им начинаются цветовые коды и ссылки),
    перевод строки — $B, как пишет его сама игра."""
    text = str(value or '').replace('\r', '').replace('|', '')
    text = re.sub(r'[\x00-\x09\x0b-\x1f]', '', text).strip()
    need(len(text) <= maxlen, '%s длиннее %d символов.' % (what, maxlen))
    return re.sub(r'\n', '$B', text)


def story_out(text):
    return (text or '').replace('$B', '\n').replace('$b', '\n')


def mark_changed(kind, ident):
    with panel_db() as conn:
        conn.execute('REPLACE INTO custom_changes(kind, id, ts) VALUES (?,?,?)', (kind, ident, int(time.time())))


def world_started():
    pid = scan_procs().get('mangosd')
    info = proc_info(pid) if pid else None
    return time.time() - info['age'] if info else None


def change_status(kind, idents):
    """«live» — мир запущен после последней правки, «pending» — правка позже запуска мира."""
    started = world_started()
    with panel_db() as conn:
        rows = dict(conn.execute('SELECT id, ts FROM custom_changes WHERE kind = ?', (kind,)).fetchall())
    out = {}
    for i in idents:
        ts = rows.get(i)
        out[i] = 'pending' if started is None or (ts and ts > started - 1) else 'live'
    return out


def rows_sql(table, rows):
    if not rows:
        return ''
    names = list(rows[0].keys())
    vals = ',\n'.join('(%s)' % ', '.join(_sql_value(r[n]) for n in names) for r in rows)
    return 'REPLACE INTO `%s` (%s) VALUES\n%s;\n' % (table, ', '.join('`%s`' % n for n in names), vals)


async def npc_rows():
    """Все свои строки НПС по таблицам — для выгрузки в SQL."""
    lo, hi = NPC_MIN, NPC_MAX
    q = [('creature_template', f'SELECT * FROM {W}.creature_template WHERE Entry BETWEEN %s AND %s ORDER BY Entry', (lo, hi)),
         ('creature_template_addon', f'SELECT * FROM {W}.creature_template_addon WHERE entry BETWEEN %s AND %s', (lo, hi)),
         ('creature_equip_template', f'SELECT * FROM {W}.creature_equip_template WHERE entry BETWEEN %s AND %s',
          (NPC_EQUIP, NPC_EQUIP + hi - lo)),
         ('gossip_menu', f'SELECT * FROM {W}.gossip_menu WHERE entry BETWEEN %s AND %s', (NPC_MENU, NPC_MENU + hi - lo)),
         ('npc_text', f'SELECT * FROM {W}.npc_text WHERE ID BETWEEN %s AND %s', (NPC_TEXT, NPC_TEXT + hi - lo)),
         ('questgiver_greeting', f'SELECT * FROM {W}.questgiver_greeting WHERE Type = 0 AND Entry BETWEEN %s AND %s', (lo, hi)),
         ('broadcast_text', f'SELECT * FROM {W}.broadcast_text WHERE Id BETWEEN %s AND %s', (NPC_BT, NPC_BT + (hi - lo) * 10 + 9)),
         ('creature_ai_scripts', f'SELECT * FROM {W}.creature_ai_scripts WHERE creature_id BETWEEN %s AND %s', (lo, hi)),
         ('creature_loot_template', f'SELECT * FROM {W}.creature_loot_template WHERE entry BETWEEN %s AND %s', (lo, hi)),
         ('creature', f'SELECT * FROM {W}.creature WHERE id BETWEEN %s AND %s ORDER BY guid', (lo, hi))]
    return [(t, await dbq(sql, args)) for t, sql, args in q]


async def export_custom_npcs():
    head = ('-- Свои НПС и мобы WoW-сервера (веб-панель), %s\n'
            '-- Залить обратно: mysql -umangos -p %s < custom_npcs.sql, затем перезапустить мир\n\n' % (
                datetime.now().strftime('%Y-%m-%d %H:%M'), W))
    parts = [rows_sql(t, rows) for t, rows in await npc_rows()]
    await asyncio.to_thread(NPC_SQL.write_text, head + '\n'.join(p for p in parts if p), 'utf-8')


async def own_loot(entry, current):
    """Своя таблица добычи своего моба (номер таблицы = номер НПС): копия добычи основы. Иначе
    задание «собрать» дописало бы предмет и в добычу основы — его стали бы ронять все её копии."""
    if current == entry:
        return entry
    await dbx(f'DELETE FROM {W}.creature_loot_template WHERE entry = %s', (entry,))
    if current:
        await dbx(f'''INSERT INTO {W}.creature_loot_template (entry, item, ChanceOrQuestChance, groupid, mincountOrRef, maxcount,
                          condition_id, comments)
                      SELECT %s, item, ChanceOrQuestChance, groupid, mincountOrRef, maxcount, condition_id, comments
                      FROM {W}.creature_loot_template WHERE entry = %s''', (entry, current))
    await dbx(f'UPDATE {W}.creature_template SET LootId = %s WHERE Entry = %s', (entry, entry))
    return entry


def thumb_url(display):
    return 'https://wow.zamimg.com/modelviewer/classic/webthumbs/npc/%d/%d.webp' % (display & 255, display)


async def npc_spawns(entries):
    if not entries:
        return {}
    rows = await dbq(f'''SELECT guid, id, map, position_x AS x, position_y AS y, position_z AS z, orientation AS o,
                                spawntimesecsmin AS respawn, spawndist AS wander, MovementType AS move
                         FROM {W}.creature WHERE id IN (%s) ORDER BY guid''' % ','.join(['%s'] * len(entries)), list(entries))
    out = {}
    for r in rows:
        for k in ('x', 'y', 'z', 'o'):
            r[k] = round(float(r[k]), 2)
        _, _, flag = await asyncio.to_thread(terrain_at, r['map'], r['x'], r['y']) if r['map'] in TELE_MAPS else (0, 0, 0)
        r.update(place_name(flag))
        out.setdefault(r['id'], []).append(r)
    return out


async def h_npc_list(request):
    rows = await dbq(f'''SELECT Entry AS entry, Name AS name, SubName AS subname, MinLevel AS minlevel, MaxLevel AS maxlevel,
                                DisplayId1 AS display, Faction AS faction, NpcFlags AS npcflags, `Rank` AS `rank`, Civilian AS civilian
                         FROM {W}.creature_template WHERE Entry BETWEEN %s AND %s ORDER BY Entry''', (NPC_MIN, NPC_MAX))
    entries = [r['entry'] for r in rows]
    spawns = await npc_spawns(entries)
    quests = await dbq(f'''SELECT id, COUNT(*) AS n FROM {W}.creature_questrelation WHERE id BETWEEN %s AND %s
                           GROUP BY id''', (NPC_MIN, NPC_MAX))
    qn = {q['id']: q['n'] for q in quests}
    status = change_status('npc', entries)
    for r in rows:
        r.update(thumb=thumb_url(r['display']), spawns=len(spawns.get(r['entry'], [])), quests=qn.get(r['entry'], 0),
                 status='restart' if status[r['entry']] == 'pending' else 'live')
    return ok(rows)


async def h_npc_search(request):
    """Поиск любых существ — для «как выглядит» и для выбора квестодателя."""
    q = str(request.query.get('q') or '').strip()
    need(len(q) >= 2 or q.isdigit(), 'Введите хотя бы 2 буквы.')
    where, args = ('t.Entry = %s', (int(q),)) if q.isdigit() else ('t.Name LIKE %s', ('%' + q + '%',))
    rows = await dbq(f'''SELECT t.Entry AS entry, t.Name AS name, t.SubName AS subname, t.MinLevel AS minlevel,
                                t.MaxLevel AS maxlevel, t.DisplayId1 AS display, t.Faction AS faction, t.NpcFlags AS npcflags,
                                t.CreatureType AS type, t.`Rank` AS `rank`,
                                (SELECT COUNT(*) FROM {W}.creature c WHERE c.id = t.Entry) AS spawns
                         FROM {W}.creature_template t WHERE {where}
                         ORDER BY (t.Name = %s) DESC, spawns DESC, t.Entry LIMIT 40''', args + (q,))
    for r in rows:
        r['thumb'] = thumb_url(r['display']) if r['display'] else None
        r['custom'] = r['entry'] >= NPC_MIN
    return ok(rows)


async def h_npc_models(request):
    """Галерея внешностей: по одному существу на модель, самые частые сверху."""
    qs = request.query
    where, args = ['DisplayId1 > 0', 'Entry < %s'], [NPC_MIN]
    if qs.get('type'):
        where.append('CreatureType = %s')
        args.append(int_arg(qs.get('type'), 0, 15, 'Тип'))
    if qs.get('q'):
        where.append('Name LIKE %s')
        args.append('%' + str(qs.get('q')).strip()[:60] + '%')
    offset = int_arg(qs.get('offset', 0) or 0, 0, 100000, 'Сдвиг')
    rows = await dbq(f'''SELECT DisplayId1 AS display, MIN(Entry) AS entry, MIN(Name) AS name, COUNT(*) AS n
                         FROM {W}.creature_template WHERE {' AND '.join(where)}
                         GROUP BY DisplayId1 ORDER BY n DESC, display LIMIT 61 OFFSET %s''', args + [offset])
    for r in rows:
        r['thumb'] = thumb_url(r['display'])
    return ok({'rows': rows[:60], 'more': len(rows) > 60})


async def npc_detail(entry):
    t = await dbq(f'SELECT * FROM {W}.creature_template WHERE Entry = %s', (entry,), one=True)
    need(t, 'НПС #%d нет.' % entry)
    ids = npc_ids(entry)
    out = {'entry': entry, 'name': t['Name'], 'subname': t['SubName'] or '', 'minlevel': t['MinLevel'],
           'maxlevel': t['MaxLevel'], 'displays': [t['DisplayId%d' % i] for i in range(1, 5) if t['DisplayId%d' % i]],
           'scale': t['Scale'], 'faction': t['Faction'], 'type': t['CreatureType'], 'rank': t['Rank'],
           'unitclass': t['UnitClass'], 'health': t['HealthMultiplier'], 'damage': t['DamageMultiplier'],
           'armor': t['ArmorMultiplier'], 'immune': bool(t['UnitFlags'] & UNIT_IMMUNE),
           'kind': 'npc' if t['Civilian'] else 'mob', 'gold_min': t['MinLootGold'], 'gold_max': t['MaxLootGold'],
           'loot': bool(t['LootId']), 'npcflags': t['NpcFlags']}
    out['thumbs'] = [thumb_url(d) for d in out['displays']]
    texts = await dbq(f'SELECT * FROM {W}.npc_text WHERE ID = %s', (ids['text'],), one=True)
    out['gossip'] = []
    if texts and t['GossipMenuId'] == ids['menu']:
        for i in range(8):
            if texts['text%d_0' % i]:
                out['gossip'].append({'text': story_out(texts['text%d_0' % i]), 'emote': texts['em%d_1' % i]})
    greet = await dbq(f'SELECT Text, EmoteId FROM {W}.questgiver_greeting WHERE Entry = %s AND Type = 0', (entry,), one=True)
    out['greeting'] = {'text': story_out(greet['Text']), 'emote': greet['EmoteId']} if greet else {'text': '', 'emote': 0}
    ai = await dbq(f'SELECT * FROM {W}.creature_ai_scripts WHERE creature_id = %s', (entry,))
    bts = await dbq(f'SELECT Id, Text, ChatTypeID, EmoteID1 FROM {W}.broadcast_text WHERE Id BETWEEN %s AND %s',
                    (ids['bt'], ids['bt'] + 9))
    bt = {b['Id']: b for b in bts}
    out['talk'] = {}
    for row in ai:
        k = row['id'] - entry * 100
        lines = [bt[row['action1_param%d' % i]] for i in (1, 2, 3) if row['action1_param%d' % i] in bt]
        if k in (EAI_GREET, EAI_AGGRO, EAI_DEATH) and lines:
            out['talk'][k] = {'lines': [story_out(b['Text']) for b in lines], 'yell': lines[0]['ChatTypeID'] == CHAT_YELL,
                              'emote': lines[0]['EmoteID1'], 'range': row['event_param2'],
                              'cooldown': row['event_param3'] // 1000}
    addon = await dbq(f'SELECT stand_state, sheath_state, emote FROM {W}.creature_template_addon WHERE entry = %s',
                      (entry,), one=True) or {}
    out['stand'] = addon.get('stand_state', 0)
    out['emote_state'] = addon.get('emote', 0)
    out['armed'] = addon.get('sheath_state', 0) == 1
    equip = await dbq(f'SELECT * FROM {W}.creature_equip_template WHERE entry = %s', (t['EquipmentTemplateId'],), one=True) \
        if t['EquipmentTemplateId'] else None
    out['equip'] = [equip['equipentry%d' % i] if equip else 0 for i in (1, 2, 3)]
    out['equip_items'] = {}
    have = [e for e in out['equip'] if e]
    if have:
        items = await dbq(f'SELECT entry, name, Quality AS quality, displayid FROM {W}.item_template WHERE entry IN (%s)'
                          % ','.join(['%s'] * len(have)), have)
        icons = await item_icons()
        out['equip_items'] = {i['entry']: {'id': i['entry'], 'name': i['name'], 'quality': i['quality'],
                                           'icon': icons.get(i['displayid'])} for i in items}
    out['spawns'] = (await npc_spawns([entry])).get(entry, [])
    out['quests'] = await dbq(f'''SELECT q.entry, q.Title AS title, (r.id IS NOT NULL) AS gives, (i.id IS NOT NULL) AS takes
                                  FROM {W}.quest_template q
                                  LEFT JOIN {W}.creature_questrelation r ON r.quest = q.entry AND r.id = %s
                                  LEFT JOIN {W}.creature_involvedrelation i ON i.quest = q.entry AND i.id = %s
                                  WHERE r.id IS NOT NULL OR i.id IS NOT NULL ORDER BY q.entry''', (entry, entry))
    out['status'] = 'restart' if entry >= NPC_MIN and change_status('npc', [entry])[entry] == 'pending' else 'live'
    return out


async def h_npc(request):
    entry = int_arg(request.query.get('entry'), 1, 16777215, 'Номер НПС')
    return ok(await npc_detail(entry))


def _num(data, key, lo, hi, what, default, cast=float):
    value = data.get(key)
    if value in (None, ''):
        return default
    try:
        value = cast(value)
    except (TypeError, ValueError):
        raise ApiError('%s — не число.' % what)
    need(lo <= value <= hi, '%s: допустимо от %s до %s.' % (what, lo, hi))
    return value


def _talk(data, k, what):
    """Реплики EventAI: до 3 вариантов (ядро выбирает случайно), крик или речь, жест."""
    t = data.get(k) or {}
    lines = [story_text(x, 250, what) for x in (t.get('lines') or [])[:3]]
    lines = [x for x in lines if x]
    if not lines:
        return None
    return {'lines': lines, 'yell': bool(t.get('yell')),
            'emote': _num(t, 'emote', 0, 500, 'Жест', 0, int),
            'range': _num(t, 'range', 3, 40, 'Расстояние', 10, int),
            'cooldown': _num(t, 'cooldown', 10, 3600, 'Пауза между репликами', 60, int)}


async def h_npc_save(request):
    data = await body(request)
    entry = data.get('entry')
    entry = int_arg(entry, NPC_MIN, NPC_MAX, 'Номер НПС') if entry else None
    name = text_arg(data.get('name'), 100, 'Имя')
    subname = re.sub(r'\s+', ' ', str(data.get('subname') or '').replace('|', '').replace('<', '').replace('>', '')).strip()[:100]
    kind = data.get('kind')
    need(kind in NPC_KINDS, 'Неизвестный вид существа.')
    minlevel = _num(data, 'minlevel', 1, 63, 'Уровень', 1, int)
    maxlevel = max(minlevel, _num(data, 'maxlevel', 1, 63, 'Уровень', minlevel, int))
    displays = [int_arg(d, 1, 16777215, 'Модель') for d in (data.get('displays') or [])[:4]]
    need(displays, 'Выберите, как выглядит НПС.')
    known = await dbq(f'SELECT modelid FROM {W}.creature_model_info WHERE modelid IN (%s)' % ','.join(['%s'] * len(displays)),
                      displays)
    missing = set(displays) - {r['modelid'] for r in known}
    need(not missing, 'Таких моделей нет в creature_model_info: %s' % ', '.join(map(str, sorted(missing))))
    faction = _num(data, 'faction', 1, 2000, 'Фракция', 35, int)
    ctype = _num(data, 'type', 1, 10, 'Тип', 7, int)
    rank = _num(data, 'rank', 0, 4, 'Ранг', 0, int)
    uclass = _num(data, 'unitclass', 1, 8, 'Класс', 1, int)
    need(ctype in NPC_TYPES and rank in NPC_RANKS and uclass in NPC_CLASSES, 'Неверный тип, ранг или класс.')
    scale = _num(data, 'scale', 0, 10, 'Размер', 0)
    health = _num(data, 'health', 0.01, 500, 'Здоровье', 1)
    damage = _num(data, 'damage', 0, 100, 'Урон', 1)
    armor = _num(data, 'armor', 0, 100, 'Броня', 1)
    gold_min = _num(data, 'gold_min', 0, 10000000, 'Деньги', 0, int)
    gold_max = max(gold_min, _num(data, 'gold_max', 0, 10000000, 'Деньги', gold_min, int))
    gossip = []
    for g in (data.get('gossip') or [])[:4]:
        text = story_text(g.get('text'), 1000, 'Текст разговора')
        if text:
            gossip.append((text, _num(g, 'emote', 0, 500, 'Жест', 0, int)))
    greet = data.get('greeting') or {}
    greeting = story_text(greet.get('text'), 1000, 'Приветствие квестодателя')
    talks = {EAI_GREET: _talk(data.get('talk') or {}, 'greet', 'Реплика при виде игрока'),
             EAI_AGGRO: _talk(data.get('talk') or {}, 'aggro', 'Реплика при нападении'),
             EAI_DEATH: _talk(data.get('talk') or {}, 'death', 'Реплика при смерти')}
    stand = _num(data, 'stand', 0, 8, 'Поза', 0, int)
    emote_state = _num(data, 'emote_state', 0, 500, 'Занятие', 0, int)
    need(stand in STAND_STATES and emote_state in EMOTE_STATES, 'Неизвестная поза.')
    armed = bool(data.get('armed'))
    equip = [int(e or 0) for e in (data.get('equip') or [0, 0, 0])[:3]]
    equip += [0] * (3 - len(equip))
    if any(equip):
        have = await dbq(f'SELECT entry FROM {W}.item_template WHERE entry IN (%s)' % ','.join(['%s'] * 3), equip)
        need({e for e in equip if e} <= {r['entry'] for r in have}, 'Такого оружия нет в базе предметов.')

    if entry:
        row = await dbq(f'SELECT * FROM {W}.creature_template WHERE Entry = %s', (entry,), one=True)
        need(row, 'НПС #%d нет — возможно, его удалили.' % entry)
        created = False
    else:
        base = int_arg(data.get('base'), 1, NPC_MIN - 1, 'Основа')
        row = await dbq(f'SELECT * FROM {W}.creature_template WHERE Entry = %s', (base,), one=True)
        need(row, 'Существа-основы #%d нет.' % base)
        last = await dbq(f'SELECT MAX(Entry) AS m FROM {W}.creature_template WHERE Entry BETWEEN %s AND %s',
                         (NPC_MIN, NPC_MAX), one=True)
        entry = (last['m'] or NPC_MIN - 1) + 1
        need(entry <= NPC_MAX, 'Свободные номера НПС кончились.')
        created = True
        keep_loot = bool(data.get('loot')) and kind == 'mob'
        # от основы — только внешность и боевые цифры; её скрипты, торговлю, обучение и добычу не берём
        row.update(ScriptName='', TrainerType=0, TrainerSpell=0, TrainerClass=0, TrainerRace=0, TrainerTemplateId=0,
                   VendorTemplateId=0, KillCredit1=0, KillCredit2=0, PetSpellDataId=0, PickpocketLootId=0,
                   StringId1=0, StringId2=0, MovementType=0,
                   LootId=row['LootId'] if keep_loot else 0, SkinningLootId=row['SkinningLootId'] if keep_loot else 0,
                   SpellList=row['SpellList'] if kind == 'mob' else 0)
    ids = npc_ids(entry)
    quests = await dbq(f'''SELECT (SELECT COUNT(*) FROM {W}.creature_questrelation WHERE id = %s)
                                + (SELECT COUNT(*) FROM {W}.creature_involvedrelation WHERE id = %s) AS n''',
                       (entry, entry), one=True)
    flags = (row['NpcFlags'] if not created else 0) & ~0x3
    flags |= (1 if gossip else 0) | (2 if quests['n'] else 0)
    unit = row['UnitFlags'] & ~UNIT_IMMUNE
    if data.get('immune'):
        unit |= UNIT_IMMUNE
    probs = [100 // len(displays)] * len(displays) + [0] * (4 - len(displays))
    probs[0] += 100 - sum(probs)
    row.update(Entry=entry, Name=name, SubName=subname or None, MinLevel=minlevel, MaxLevel=maxlevel,
               Faction=faction, Scale=scale, CreatureType=ctype, Rank=rank, UnitClass=uclass,
               HealthMultiplier=health, DamageMultiplier=damage, ArmorMultiplier=armor,
               NpcFlags=flags, UnitFlags=unit, Civilian=1 if kind == 'npc' else 0,
               MinLootGold=gold_min, MaxLootGold=gold_max,
               GossipMenuId=ids['menu'] if gossip else 0,
               AIName='EventAI' if any(talks.values()) else ('' if row.get('AIName') == 'EventAI' or created else row['AIName']),
               EquipmentTemplateId=ids['equip'] if any(equip) else 0)
    for i in range(4):
        row['DisplayId%d' % (i + 1)] = displays[i] if i < len(displays) else 0
        row['DisplayIdProbability%d' % (i + 1)] = probs[i]
    names = list(row.keys())
    await dbx(f'REPLACE INTO {W}.creature_template (%s) VALUES (%s)' % (
        ', '.join('`%s`' % n for n in names), ', '.join(['%s'] * len(names))), [row[n] for n in names])
    if created and row['LootId']:
        await own_loot(entry, row['LootId'])

    # разговор: окно с текстом, если щёлкнуть по НПС
    await dbx(f'DELETE FROM {W}.gossip_menu WHERE entry = %s', (ids['menu'],))
    await dbx(f'DELETE FROM {W}.npc_text WHERE ID = %s', (ids['text'],))
    if gossip:
        cols, vals = ['ID'], [ids['text']]
        prob = round(1 / len(gossip), 3)
        for i, (text, emote) in enumerate(gossip):
            cols += ['text%d_0' % i, 'text%d_1' % i, 'lang%d' % i, 'prob%d' % i, 'em%d_0' % i, 'em%d_1' % i]
            vals += [text, text, 0, prob, 0, emote]
        await dbx(f'INSERT INTO {W}.npc_text (%s) VALUES (%s)' % (', '.join(cols), ', '.join(['%s'] * len(cols))), vals)
        await dbx(f'INSERT INTO {W}.gossip_menu (entry, text_id, script_id, condition_id) VALUES (%s, %s, 0, 0)',
                  (ids['menu'], ids['text']))
    await dbx(f'DELETE FROM {W}.questgiver_greeting WHERE Entry = %s AND Type = 0', (entry,))
    if greeting:
        await dbx(f'INSERT INTO {W}.questgiver_greeting (Entry, Type, Text, EmoteId, EmoteDelay) VALUES (%s, 0, %s, %s, 0)',
                  (entry, greeting, _num(greet, 'emote', 0, 500, 'Жест', 0, int)))

    # реплики EventAI: при виде игрока, при нападении, при смерти
    await dbx(f'DELETE FROM {W}.creature_ai_scripts WHERE creature_id = %s', (entry,))
    await dbx(f'DELETE FROM {W}.broadcast_text WHERE Id BETWEEN %s AND %s', (ids['bt'], ids['bt'] + 9))
    slot = 0
    for k, talk in talks.items():
        if not talk:
            continue
        bt_ids = []
        for line in talk['lines']:
            await dbx(f'''INSERT INTO {W}.broadcast_text (Id, Text, Text1, ChatTypeID, LanguageID, ConditionID, EmotesID, Flags,
                              SoundEntriesID1, SoundEntriesID2, EmoteID1, EmoteID2, EmoteID3, EmoteDelay1, EmoteDelay2,
                              EmoteDelay3, VerifiedBuild) VALUES (%s, %s, %s, %s, 0, 0, 0, 0, 0, 0, %s, 0, 0, 0, 0, 0, 0)''',
                      (ids['bt'] + slot, line, line, CHAT_YELL if talk['yell'] else CHAT_SAY, talk['emote']))
            bt_ids.append(ids['bt'] + slot)
            slot += 1
        bt_ids += [0] * (3 - len(bt_ids))
        # ev = (событие, флаги, параметры 1–6, пояснение); флаг 1 — повторять
        if k == EAI_GREET:      # EVENT_T_OOC_LOS: 1 — только не враги (для моба — враги), радиус, пауза мин/макс (мс), только игроки
            ev = (10, 1, 1 if kind == 'npc' else 0, talk['range'], talk['cooldown'] * 1000, talk['cooldown'] * 1500, 1, 0,
                  'при виде игрока')
        elif k == EAI_AGGRO:    # EVENT_T_AGGRO
            ev = (4, 1, 0, 0, 0, 0, 0, 0, 'при нападении')
        else:                   # EVENT_T_DEATH
            ev = (6, 0, 0, 0, 0, 0, 0, 0, 'при смерти')
        await dbx(f'''INSERT INTO {W}.creature_ai_scripts (id, creature_id, event_type, event_inverse_phase_mask, event_chance,
                          event_flags, event_param1, event_param2, event_param3, event_param4, event_param5, event_param6,
                          action1_type, action1_param1, action1_param2, action1_param3, action2_type, action2_param1,
                          action2_param2, action2_param3, action3_type, action3_param1, action3_param2, action3_param3, comment)
                      VALUES (%s, %s, %s, 0, 100, %s, %s, %s, %s, %s, %s, %s, 1, %s, %s, %s, 0, 0, 0, 0, 0, 0, 0, 0, %s)''',
                  (entry * 100 + k, entry, ev[0], ev[1], ev[2], ev[3], ev[4], ev[5], ev[6], ev[7],
                   bt_ids[0], bt_ids[1], bt_ids[2], 'панель: %s — %s' % (name, ev[8])))

    # поза, занятие и оружие в руках
    await dbx(f'DELETE FROM {W}.creature_template_addon WHERE entry = %s', (entry,))
    if stand or emote_state or armed:
        await dbx(f'''INSERT INTO {W}.creature_template_addon (entry, mount, stand_state, sheath_state, emote, moveflags, auras)
                      VALUES (%s, 0, %s, %s, %s, 0, NULL)''', (entry, stand, 1 if armed else 0, emote_state))
    await dbx(f'DELETE FROM {W}.creature_equip_template WHERE entry = %s', (ids['equip'],))
    if any(equip):
        await dbx(f'INSERT INTO {W}.creature_equip_template (entry, equipentry1, equipentry2, equipentry3) VALUES (%s, %s, %s, %s)',
                  [ids['equip']] + equip)

    mark_changed('npc', entry)
    audit('npc.create' if created else 'npc.update', '#%d %s' % (entry, name))
    await export_custom_npcs()
    return ok({'entry': entry, 'created': created})


async def h_npc_delete(request):
    data = await body(request)
    entry = int_arg(data.get('entry'), NPC_MIN, NPC_MAX, 'Номер НПС')
    row = await dbq(f'SELECT Name FROM {W}.creature_template WHERE Entry = %s', (entry,), one=True)
    need(row, 'Такого НПС нет.')
    need(data.get('confirm') == row['Name'], 'Для удаления впишите имя НПС точно.')
    ids = npc_ids(entry)
    with panel_db() as conn:
        conn.execute('DELETE FROM quest_loot WHERE loot = ?', (entry,))
    for sql, args in ((f'DELETE FROM {W}.creature WHERE id = %s', (entry,)),
                      (f'DELETE FROM {W}.creature_loot_template WHERE entry = %s', (entry,)),
                      (f'DELETE FROM {W}.creature_questrelation WHERE id = %s', (entry,)),
                      (f'DELETE FROM {W}.creature_involvedrelation WHERE id = %s', (entry,)),
                      (f'DELETE FROM {W}.creature_ai_scripts WHERE creature_id = %s', (entry,)),
                      (f'DELETE FROM {W}.broadcast_text WHERE Id BETWEEN %s AND %s', (ids['bt'], ids['bt'] + 9)),
                      (f'DELETE FROM {W}.gossip_menu WHERE entry = %s', (ids['menu'],)),
                      (f'DELETE FROM {W}.npc_text WHERE ID = %s', (ids['text'],)),
                      (f'DELETE FROM {W}.questgiver_greeting WHERE Entry = %s AND Type = 0', (entry,)),
                      (f'DELETE FROM {W}.creature_template_addon WHERE entry = %s', (entry,)),
                      (f'DELETE FROM {W}.creature_equip_template WHERE entry = %s', (ids['equip'],)),
                      (f'DELETE FROM {W}.creature_template WHERE Entry = %s', (entry,))):
        await dbx(sql, args)
    mark_changed('npc', entry)
    audit('npc.delete', '#%d %s' % (entry, row['Name']))
    await export_custom_npcs()
    return ok({'success': True, 'output': 'НПС удалён из базы вместе с репликами и местами. Из мира он уйдёт после перезапуска.'})


async def h_npc_spawn(request):
    """Поставить НПС: точка с карты или там, где сейчас стоит персонаж."""
    data = await body(request)
    entry = int_arg(data.get('entry'), NPC_MIN, NPC_MAX, 'Номер НПС')
    t = await dbq(f'SELECT Name FROM {W}.creature_template WHERE Entry = %s', (entry,), one=True)
    need(t, 'Такого НПС нет.')
    if data.get('char'):
        name = char_arg(data.get('char'))
        ch = await dbq(f'SELECT name, online FROM {C}.characters WHERE name = %s', (name,), one=True)
        need(ch, 'Персонажа «%s» нет.' % name)
        if ch['online']:
            await soap('saveall', timeout=10)      # позиция в базе — с последнего сохранения; сохраним сейчас
        ch = await dbq(f'''SELECT name, map, position_x AS x, position_y AS y, position_z AS z, orientation AS o
                           FROM {C}.characters WHERE name = %s''', (name,), one=True)
        mapid, x, y, z, o = ch['map'], ch['x'], ch['y'], ch['z'], ch['o']
        where = 'у персонажа %s' % ch['name']
    else:
        mapid = map_arg(data.get('map'))
        x, y = coord_arg(data.get('x'), 'X'), coord_arg(data.get('y'), 'Y')
        z = coord_arg(data.get('z'), 'Высота')
        o = coord_arg(data.get('o') or 0, 'Поворот') % 6.2831
        where = 'карта %d (%.0f, %.0f, %.0f)' % (mapid, x, y, z)
    respawn = _num(data, 'respawn', 5, 604800, 'Возрождение', 120, int)
    wander = _num(data, 'wander', 0, 50, 'Бродит в радиусе', 0)
    last = await dbq(f'SELECT MAX(guid) AS m FROM {W}.creature', one=True)
    guid = (last['m'] or 0) + 1
    need(guid < 1 << 24, 'Номера мест для существ кончились.')
    await dbx(f'''INSERT INTO {W}.creature (guid, id, map, spawnMask, position_x, position_y, position_z, orientation,
                      spawntimesecsmin, spawntimesecsmax, spawndist, MovementType)
                  VALUES (%s, %s, %s, 1, %s, %s, %s, %s, %s, %s, %s, %s)''',
              (guid, entry, mapid, x, y, z, o, respawn, respawn, wander, 1 if wander else 0))
    mark_changed('npc', entry)
    audit('npc.spawn', '#%d %s → %s' % (entry, t['Name'], where))
    await export_custom_npcs()
    return ok({'success': True, 'guid': guid,
               'output': 'НПС поставлен: %s. Появится в мире после перезапуска.' % where})


async def h_npc_despawn(request):
    data = await body(request)
    guid = int_arg(data.get('guid'), 1, 1 << 24, 'Место')
    row = await dbq(f'SELECT id FROM {W}.creature WHERE guid = %s AND id BETWEEN %s AND %s', (guid, NPC_MIN, NPC_MAX), one=True)
    need(row, 'Такого места своего НПС нет.')
    await dbx(f'DELETE FROM {W}.creature WHERE guid = %s', (guid,))
    mark_changed('npc', row['id'])
    audit('npc.despawn', '#%d место %d' % (row['id'], guid))
    await export_custom_npcs()
    return ok({'success': True, 'output': 'Место убрано. В мире НПС исчезнет после перезапуска.'})


# --- свои задания --------------------------------------------------------------
# Задание — строка quest_template с номером от 90000 (в classic-db они кончаются на 9665) плюс
# связи: кто даёт (creature_questrelation или item_template.startquest своего предмета), кто
# принимает (creature_involvedrelation), какую область исследовать (areatrigger_involvedrelation),
# с кого падает нужный предмет (creature_loot_template, отрицательный шанс — только на задании).
# В отличие от НПС, задания ядро умеет перечитать на ходу (reload quest_template и связи), а
# вот значок «!» над НПС — флаг в creature_template, он появляется только после перезапуска.
# Если у готового НПС игры флага не было, ставим его и запоминаем прежнее значение
# (npc_flag_patch), чтобы вернуть, когда своих заданий у этого НПС не останется.

QUEST_MIN = 90000
QUEST_MAX = 199999
QUEST_SQL = DATA / 'custom_quests.sql'
QUEST_KINDS = ('talk', 'deliver', 'kill', 'collect', 'explore')
QUEST_TYPES = (0, 1, 41, 62, 81)        # обычное, групповое, PvP, рейд, подземелье (QuestInfo.dbc)
RACE_MASK = 0xFF                        # 8 рас классики
CLASS_MASK = 0x5DF                      # воин…друид без 6 и 10
QUEST_COLS = {}
TRIGGERS = {}


def quest_ids_sql(n):
    return ','.join(['%s'] * n)


def _load_triggers():
    """AreaTrigger.dbc: id → (карта, x, y, z, радиус). Исследование — только по готовым областям клиента."""
    out = {}
    raw, count, fields, size, _ = _dbc('AreaTrigger.dbc')
    for i in range(count):
        tid, mapid = struct.unpack_from('<II', raw, 20 + i * size)
        x, y, z, radius = struct.unpack_from('<4f', raw, 20 + i * size + 8)
        out[tid] = (mapid, x, y, z, radius)
    return out


async def area_triggers():
    if not TRIGGERS:
        TRIGGERS.update(await asyncio.to_thread(_load_triggers))
    return TRIGGERS


async def quest_cols():
    """Столбцы quest_template со значениями по умолчанию — новая строка собирается из них."""
    if not QUEST_COLS:
        rows = await dbq('''SELECT COLUMN_NAME AS name, COLUMN_DEFAULT AS dflt, DATA_TYPE AS type, IS_NULLABLE AS nul
                            FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = %s AND TABLE_NAME = 'quest_template'
                            ORDER BY ORDINAL_POSITION''', (W,))
        for r in rows:
            d = r['dflt']
            if d is None or d == 'NULL':
                d = None if r['nul'] == 'YES' else ('' if 'text' in r['type'] or 'char' in r['type'] else 0)
            elif r['type'] in ('float', 'double', 'decimal'):
                d = float(d)
            elif 'int' in r['type']:
                d = int(d)
            else:
                d = d.strip("'")
            QUEST_COLS[r['name']] = d
    return dict(QUEST_COLS)


async def quest_list_rows(where='q.entry BETWEEN %s AND %s', args=(QUEST_MIN, QUEST_MAX)):
    return await dbq(f'''SELECT q.entry, q.Title AS title, q.QuestLevel AS level, q.MinLevel AS minlevel, q.SpecialFlags AS special,
                                (SELECT GROUP_CONCAT(t.Name SEPARATOR ', ') FROM {W}.creature_questrelation r
                                   JOIN {W}.creature_template t ON t.Entry = r.id WHERE r.quest = q.entry) AS giver,
                                (SELECT GROUP_CONCAT(t.Name SEPARATOR ', ') FROM {W}.creature_involvedrelation r
                                   JOIN {W}.creature_template t ON t.Entry = r.id WHERE r.quest = q.entry) AS ender,
                                (SELECT GROUP_CONCAT(i.name SEPARATOR ', ') FROM {W}.item_template i WHERE i.startquest = q.entry) AS item_giver
                         FROM {W}.quest_template q WHERE {where} ORDER BY q.entry''', args)


def quest_status(entries, npc_entries=()):
    """pending — правка ещё не применена; restart — нужен перезапуск (флаг «!» у НПС или новый НПС)."""
    started = world_started()
    with panel_db() as conn:
        rows = dict(conn.execute("SELECT id, ts FROM custom_changes WHERE kind = 'quest'").fetchall())
        applied = conn.execute("SELECT ts FROM custom_changes WHERE kind = 'quest_apply' AND id = 0").fetchone()
        patches = {r[0]: r[1] for r in conn.execute('SELECT entry, ts FROM npc_flag_patch').fetchall()}
    applied = max(applied[0] if applied else 0, started or 0)
    npc = change_status('npc', [n for n in npc_entries if n >= NPC_MIN])
    restart = started is None or any(npc.get(n) == 'pending' for n in npc_entries) or \
        any(patches.get(n, 0) > (started or 0) - 1 for n in npc_entries)
    return {e: 'restart' if restart else 'pending' if rows.get(e, 0) > applied - 1 else 'live' for e in entries}


async def h_quest_list(request):
    rows = await quest_list_rows()
    for r in rows:
        npcs = await dbq(f'''SELECT id FROM {W}.creature_questrelation WHERE quest = %s
                             UNION SELECT id FROM {W}.creature_involvedrelation WHERE quest = %s''', (r['entry'], r['entry']))
        r['status'] = quest_status([r['entry']], [n['id'] for n in npcs])[r['entry']]
        r['repeatable'] = bool(r['special'] & 1)
    return ok(rows)


async def h_quest_search(request):
    q = str(request.query.get('q') or '').strip()
    need(len(q) >= 2 or q.isdigit(), 'Введите хотя бы 2 буквы.')
    where, args = ('q.entry = %s', (int(q),)) if q.isdigit() else ('q.Title LIKE %s', ('%' + q + '%',))
    rows = await quest_list_rows(where, args)
    return ok(rows[:40])


async def h_quest_meta(request):
    cd = await char_dbc()
    reps = sorted(({'id': fid, 'name': f['name']} for fid, f in cd['factions'].items()
                   if f['list'] >= 0 and f['name'] and not f['name'].startswith(' ') and fid not in cd['headers']),
                  key=lambda f: f['name'])
    zones = sorted(({'id': a, 'name': n} for a, n in AREAS.items() if a not in AREA_PARENT and n), key=lambda z: z['name'])
    # сколько обычно дают задания игры на каждом уровне — подсказка для награды
    avg = await dbq(f'''SELECT QuestLevel AS lv, ROUND(AVG(RewMoneyMaxLevel) / 0.6) AS xp,
                               ROUND(AVG(CASE WHEN RewOrReqMoney > 0 THEN RewOrReqMoney END)) AS money
                        FROM {W}.quest_template WHERE QuestLevel BETWEEN 1 AND 63 AND entry < %s AND RewMoneyMaxLevel > 0
                        GROUP BY QuestLevel''', (QUEST_MIN,))
    return ok({'factions': reps, 'zones': zones, 'quest_min': QUEST_MIN,
               'typical': {r['lv']: {'xp': int(r['xp'] or 0), 'money': int(r['money'] or 0)} for r in avg}})


async def h_quest_triggers(request):
    """Области исследования рядом с точкой на карте (только они могут засчитать «исследовать место»)."""
    mapid = map_arg(request.query.get('map'))
    x, y = coord_arg(request.query.get('x'), 'X'), coord_arg(request.query.get('y'), 'Y')
    near = []
    for tid, (m, tx, ty, tz, radius) in (await area_triggers()).items():
        if m != mapid:
            continue
        d = ((tx - x) ** 2 + (ty - y) ** 2) ** 0.5
        if d < 1500:
            near.append({'id': tid, 'x': round(tx, 1), 'y': round(ty, 1), 'z': round(tz, 1), 'radius': round(radius, 1),
                         'dist': round(d), **place_name((await asyncio.to_thread(terrain_at, m, tx, ty))[2])})
    near.sort(key=lambda t: t['dist'])
    used = await dbq(f'SELECT id, quest FROM {W}.areatrigger_involvedrelation WHERE id IN (%s)' % quest_ids_sql(len(near[:12])),
                     [t['id'] for t in near[:12]]) if near else []
    tele = await dbq(f'SELECT id FROM {W}.areatrigger_teleport WHERE id IN (%s)' % quest_ids_sql(len(near[:12])),
                     [t['id'] for t in near[:12]]) if near else []
    busy = {u['id'] for u in used}
    port = {t['id'] for t in tele}
    for t in near[:12]:
        t['quests'] = sum(1 for u in used if u['id'] == t['id'])
        t['teleport'] = t['id'] in port         # вход в подземелье: туда исследование не повесить
        t['busy'] = t['id'] in busy
    return ok(near[:12])


async def h_quest(request):
    entry = int_arg(request.query.get('entry'), 1, 16777215, 'Номер задания')
    q = await dbq(f'SELECT * FROM {W}.quest_template WHERE entry = %s', (entry,), one=True)
    need(q, 'Задания #%d нет.' % entry)
    givers = await dbq(f'''SELECT r.id AS entry, t.Name AS name, t.SubName AS subname, t.DisplayId1 AS display
                           FROM {W}.creature_questrelation r JOIN {W}.creature_template t ON t.Entry = r.id WHERE r.quest = %s''', (entry,))
    enders = await dbq(f'''SELECT r.id AS entry, t.Name AS name, t.SubName AS subname, t.DisplayId1 AS display
                           FROM {W}.creature_involvedrelation r JOIN {W}.creature_template t ON t.Entry = r.id WHERE r.quest = %s''', (entry,))
    items = await dbq(f'SELECT entry, name, Quality AS quality, displayid FROM {W}.item_template WHERE startquest = %s', (entry,))
    trig = await dbq(f'SELECT id FROM {W}.areatrigger_involvedrelation WHERE quest = %s', (entry,))
    with panel_db() as conn:
        drops = conn.execute('SELECT loot, item, chance, creature FROM quest_loot WHERE quest = ?', (entry,)).fetchall()
    # предметы и существа по номерам — одним запросом, с иконками
    item_ids = {q[k] for k in q if (k.startswith('ReqItemId') or k.startswith('RewItemId') or k.startswith('RewChoiceItemId')
                                    or k == 'SrcItemId') and q[k]}
    cre_ids = {q['ReqCreatureOrGOId%d' % i] for i in range(1, 5) if q['ReqCreatureOrGOId%d' % i] > 0} | {d[3] for d in drops}
    icons = await item_icons()
    item_map = {}
    if item_ids:
        for i in await dbq(f'SELECT entry, name, Quality AS quality, displayid FROM {W}.item_template WHERE entry IN (%s)'
                           % quest_ids_sql(len(item_ids)), list(item_ids)):
            item_map[i['entry']] = {'id': i['entry'], 'name': i['name'], 'quality': i['quality'], 'icon': icons.get(i['displayid'], '')}
    cre_map = {}
    if cre_ids:
        for c in await dbq(f'SELECT Entry AS entry, Name AS name, DisplayId1 AS display, LootId AS loot FROM {W}.creature_template '
                           f'WHERE Entry IN (%s)' % quest_ids_sql(len(cre_ids)), list(cre_ids)):
            cre_map[c['entry']] = dict(c, thumb=thumb_url(c['display']) if c['display'] else None)
    for g in givers + enders:
        g['thumb'] = thumb_url(g['display']) if g['display'] else None
    out = {'entry': entry, 'title': q['Title'], 'details': story_out(q['Details']), 'objectives': story_out(q['Objectives']),
           'offer_text': story_out(q['OfferRewardText']), 'request_text': story_out(q['RequestItemsText']),
           'end_text': story_out(q['EndText']),
           'objective_texts': [story_out(q['ObjectiveText%d' % i]) for i in range(1, 5)],
           'emotes': {'details': q['DetailsEmote1'], 'incomplete': q['IncompleteEmote'], 'complete': q['CompleteEmote'],
                      'offer': q['OfferRewardEmote1']},
           'level': {'min': q['MinLevel'], 'quest': q['QuestLevel'], 'max': q['MaxLevel']},
           'races': q['RequiredRaces'], 'classes': q['RequiredClasses'], 'type': q['Type'], 'suggested': q['SuggestedPlayers'],
           'repeatable': bool(q['SpecialFlags'] & 1), 'time_limit': q['LimitTime'], 'zone': q['ZoneOrSort'],
           'prev': q['PrevQuestId'], 'next': q['NextQuestInChain'],
           'givers': givers, 'enders': enders,
           'item_givers': [{'id': i['entry'], 'name': i['name'], 'quality': i['quality'], 'icon': icons.get(i['displayid'], '')} for i in items],
           'kill': [{'creature': cre_map.get(q['ReqCreatureOrGOId%d' % i]) or {'entry': q['ReqCreatureOrGOId%d' % i]},
                     'count': q['ReqCreatureOrGOCount%d' % i]} for i in range(1, 5) if q['ReqCreatureOrGOId%d' % i] > 0],
           'collect': [{'item': item_map.get(q['ReqItemId%d' % i]) or {'id': q['ReqItemId%d' % i]}, 'count': q['ReqItemCount%d' % i],
                        'drop': next(({'creature': cre_map.get(d[3]), 'chance': d[2]} for d in drops if d[1] == q['ReqItemId%d' % i]), None)}
                       for i in range(1, 5) if q['ReqItemId%d' % i]],
           'src_item': {'item': item_map.get(q['SrcItemId']), 'count': q['SrcItemCount']} if q['SrcItemId'] else None,
           'trigger': trig[0]['id'] if trig else None,
           'req_money': -q['RewOrReqMoney'] if q['RewOrReqMoney'] < 0 else 0,
           'rep_objective': {'faction': q['RepObjectiveFaction'], 'value': q['RepObjectiveValue']} if q['RepObjectiveFaction'] else None,
           'rewards': {'money': max(0, q['RewOrReqMoney']), 'xp': round(q['RewMoneyMaxLevel'] / 0.6),
                       'items': [{'item': item_map.get(q['RewItemId%d' % i]), 'count': q['RewItemCount%d' % i]}
                                 for i in range(1, 5) if q['RewItemId%d' % i]],
                       'choice': [{'item': item_map.get(q['RewChoiceItemId%d' % i]), 'count': q['RewChoiceItemCount%d' % i]}
                                  for i in range(1, 7) if q['RewChoiceItemId%d' % i]],
                       'rep': [{'faction': q['RewRepFaction%d' % i], 'value': q['RewRepValue%d' % i]}
                               for i in range(1, 6) if q['RewRepFaction%d' % i]],
                       'spell': q['RewSpellCast']}}
    if q['SrcItemId'] and any(c['item'] and c['item']['id'] == q['SrcItemId'] for c in out['collect']):
        out['kind'] = 'deliver'
    elif trig:
        out['kind'] = 'explore'
    elif out['kill']:
        out['kind'] = 'kill'
    elif out['collect']:
        out['kind'] = 'collect'
    else:
        out['kind'] = 'talk'
    npcs = [g['entry'] for g in givers + enders]
    out['status'] = quest_status([entry], npcs)[entry] if entry >= QUEST_MIN else 'live'
    return ok(out)


async def _items_exist(ids, what):
    ids = {i for i in ids if i}
    if ids:
        have = await dbq(f'SELECT entry FROM {W}.item_template WHERE entry IN (%s)' % quest_ids_sql(len(ids)), list(ids))
        miss = ids - {r['entry'] for r in have}
        need(not miss, '%s: таких предметов нет — %s' % (what, ', '.join(map(str, sorted(miss)))))


async def _creatures(ids, what):
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = await dbq(f'SELECT Entry, Name, NpcFlags, LootId FROM {W}.creature_template WHERE Entry IN (%s)'
                     % quest_ids_sql(len(ids)), list(ids))
    found = {r['Entry']: r for r in rows}
    miss = ids - set(found)
    need(not miss, '%s: таких существ нет — %s' % (what, ', '.join(map(str, sorted(miss)))))
    return found


def _pairs(lst, n, key, lo, hi, what):
    out = []
    for x in (lst or [])[:n]:
        ident = int(x.get(key) or 0) if str(x.get(key) or '0').isdigit() else 0
        if not ident:
            continue
        out.append((ident, _num(x, 'count', lo, hi, what, 1, int)))
    return out


async def _questgiver_flag(entries):
    """Значок «!»/«?» над НПС: флаг 2 в NpcFlags. У готовых НПС игры запоминаем, как было."""
    now = int(time.time())
    rows = await _creatures(entries, 'НПС')
    for e, r in rows.items():
        if r['NpcFlags'] & 2:
            continue
        if e < NPC_MIN:
            with panel_db() as conn:
                conn.execute('INSERT OR IGNORE INTO npc_flag_patch(entry, original, ts) VALUES (?,?,?)', (e, r['NpcFlags'], now))
        await dbx(f'UPDATE {W}.creature_template SET NpcFlags = NpcFlags | 2 WHERE Entry = %s', (e,))
        if e >= NPC_MIN:
            mark_changed('npc', e)


async def _restore_flags():
    """Готовым НПС, у которых своих заданий больше нет, вернуть прежние флаги."""
    with panel_db() as conn:
        patches = conn.execute('SELECT entry, original FROM npc_flag_patch').fetchall()
    for entry, original in patches:
        used = await dbq(f'''SELECT (SELECT COUNT(*) FROM {W}.creature_questrelation WHERE id = %s AND quest BETWEEN %s AND %s)
                                  + (SELECT COUNT(*) FROM {W}.creature_involvedrelation WHERE id = %s AND quest BETWEEN %s AND %s) AS n''',
                         (entry, QUEST_MIN, QUEST_MAX, entry, QUEST_MIN, QUEST_MAX), one=True)
        if not used['n']:
            await dbx(f'UPDATE {W}.creature_template SET NpcFlags = %s WHERE Entry = %s', (original, entry))
            with panel_db() as conn:
                conn.execute('DELETE FROM npc_flag_patch WHERE entry = ?', (entry,))


async def _drop_quest_loot(entry):
    with panel_db() as conn:
        rows = conn.execute('SELECT loot, item FROM quest_loot WHERE quest = ?', (entry,)).fetchall()
        conn.execute('DELETE FROM quest_loot WHERE quest = ?', (entry,))
    for loot, item in rows:
        await dbx(f'DELETE FROM {W}.creature_loot_template WHERE entry = %s AND item = %s AND ChanceOrQuestChance < 0',
                  (loot, item))
    return bool(rows)


async def h_quest_save(request):
    data = await body(request)
    entry = data.get('entry')
    entry = int_arg(entry, QUEST_MIN, QUEST_MAX, 'Номер задания') if entry else None
    kind = data.get('kind')
    need(kind in QUEST_KINDS, 'Выберите тип задания.')
    title = text_arg(data.get('title'), 200, 'Название')
    details = story_text(data.get('details'), 4000, 'Описание')
    need(details, 'Напишите, что говорит НПС, выдавая задание.')
    objectives = story_text(data.get('objectives'), 1000, 'Цель')
    need(objectives, 'Напишите коротко цель задания.')
    offer = story_text(data.get('offer_text'), 4000, 'Текст при сдаче')
    need(offer, 'Напишите, что говорит НПС, когда задание сдают.')
    request_text = story_text(data.get('request_text'), 2000, 'Текст, пока задание не выполнено')
    end_text = story_text(data.get('end_text'), 250, 'Строка выполнения')
    obj_texts = [story_text(t, 250, 'Подпись цели') for t in (data.get('objective_texts') or [])[:4]]
    obj_texts += [''] * (4 - len(obj_texts))
    em = data.get('emotes') or {}
    emotes = {k: _num(em, k, 0, 500, 'Жест', 0, int) for k in ('details', 'incomplete', 'complete', 'offer')}
    lv = data.get('level') or {}
    qlevel = _num(lv, 'quest', 1, 63, 'Уровень задания', 1, int)
    minlevel = _num(lv, 'min', 1, 63, 'Брать с уровня', max(1, qlevel - 4), int)
    maxlevel = _num(lv, 'max', 0, 255, 'Брать до уровня', 255, int) or 255
    races = _num(data, 'races', 0, RACE_MASK, 'Расы', 0, int)
    classes = _num(data, 'classes', 0, CLASS_MASK, 'Классы', 0, int)
    qtype = _num(data, 'type', 0, 81, 'Вид', 0, int)
    need(qtype in QUEST_TYPES, 'Неизвестный вид задания.')
    suggested = _num(data, 'suggested', 0, 40, 'Игроков', 0, int)
    limit = _num(data, 'time_limit', 0, 86400, 'Ограничение по времени', 0, int)
    prev = _num(data, 'prev', 0, 16777215, 'Предыдущее задание', 0, int)
    nxt = _num(data, 'next', 0, 16777215, 'Следующее задание', 0, int)
    for qid, what in ((prev, 'Предыдущее задание'), (nxt, 'Следующее задание')):
        if qid:
            need(qid != entry, '%s не может быть самим этим заданием.' % what)
            need(await dbq(f'SELECT entry FROM {W}.quest_template WHERE entry = %s', (qid,), one=True), '%s #%d не найдено.' % (what, qid))

    giver = data.get('giver') or {}
    need(giver.get('type') in ('npc', 'item'), 'Укажите, кто выдаёт задание.')
    giver_id = int_arg(giver.get('entry'), 1, 16777215, 'Кто выдаёт')
    ender_id = int_arg((data.get('ender') or {}).get('entry'), 1, 16777215, 'Кому сдавать')
    npcs = await _creatures([ender_id] + ([giver_id] if giver['type'] == 'npc' else []), 'Квестодатель')
    if giver['type'] == 'item':
        need(giver_id >= CUSTOM_MIN, 'Выдавать задание может только свой предмет (номер от %d).' % CUSTOM_MIN)
        await _items_exist([giver_id], 'Предмет, который выдаёт задание')

    kill = _pairs(data.get('kill'), 4, 'creature', 1, 250, 'Сколько убить') if kind == 'kill' else []
    collect = []
    if kind in ('collect', 'deliver'):
        for c in (data.get('collect') or [])[:4]:
            item = int(c.get('item') or 0)
            if item:
                drop = c.get('drop') or {}
                creature = int(drop.get('creature') or 0)
                chance = _num(drop, 'chance', 1, 100, 'Шанс выпадения', 35) if creature else 0
                collect.append((item, _num(c, 'count', 1, 250, 'Сколько собрать', 1, int), creature, chance))
    need(kind != 'kill' or kill, 'Укажите, кого убить.')
    need(kind != 'collect' or collect, 'Укажите, что собрать.')
    src = data.get('src_item') or {}
    src_item = int(src.get('item') or 0)
    src_count = _num(src, 'count', 1, 20, 'Сколько выдать', 1, int) if src_item else 0
    if kind == 'deliver':
        need(src_item, 'Укажите предмет, который нужно доставить.')
        collect = [(src_item, src_count, 0, 0)]
    trigger = None
    if kind == 'explore':
        trigger = int_arg(data.get('trigger'), 1, 100000, 'Область исследования')
        need(trigger in await area_triggers(), 'Такой области исследования нет в AreaTrigger.dbc.')
        port = await dbq(f'SELECT id FROM {W}.areatrigger_teleport WHERE id = %s', (trigger,), one=True)
        need(not port, 'Эта область — вход в подземелье, исследование туда не повесить. Выберите другую.')
    await _creatures([k[0] for k in kill] + [c[2] for c in collect if c[2]], 'Цель задания')
    rew = data.get('rewards') or {}
    rew_items = _pairs(rew.get('items'), 4, 'item', 1, 1000, 'Количество')
    rew_choice = _pairs(rew.get('choice'), 6, 'item', 1, 1000, 'Количество')
    await _items_exist([c[0] for c in collect] + [i for i, _ in rew_items + rew_choice] + [src_item], 'Предметы задания')
    cd = await char_dbc()
    reps = []
    for r in (rew.get('rep') or [])[:5]:
        fid = int(r.get('faction') or 0)
        if fid:
            need(fid in cd['factions'], 'Фракции #%d нет.' % fid)
            reps.append((fid, _num(r, 'value', -10000, 10000, 'Репутация', 0, int)))
    money = _num(rew, 'money', 0, 100000000, 'Деньги в награду', 0, int)
    req_money = _num(data, 'req_money', 0, 100000000, 'Принести денег', 0, int)
    need(not (money and req_money), 'Задание может либо дать денег, либо потребовать — не то и другое сразу.')
    xp = _num(rew, 'xp', 0, 100000, 'Опыт', 0, int)
    spell = _num(rew, 'spell', 0, 100000, 'Заклинание', 0, int)
    if spell:
        need(spell in (await dbc_data())['spells'], 'Заклинания #%d нет.' % spell)
    rep_obj = data.get('rep_objective') or {}
    rep_fid = int(rep_obj.get('faction') or 0)
    if rep_fid:
        need(rep_fid in cd['factions'], 'Фракции #%d нет.' % rep_fid)
    zone = _num(data, 'zone', -1000, 5000, 'Зона', 0, int)

    created = not entry
    if created:
        last = await dbq(f'SELECT MAX(entry) AS m FROM {W}.quest_template WHERE entry BETWEEN %s AND %s',
                         (QUEST_MIN, QUEST_MAX), one=True)
        entry = (last['m'] or QUEST_MIN - 1) + 1
        need(entry <= QUEST_MAX, 'Свободные номера заданий кончились.')
    else:
        need(await dbq(f'SELECT entry FROM {W}.quest_template WHERE entry = %s', (entry,), one=True),
             'Задания #%d нет — возможно, его удалили.' % entry)
    row = await quest_cols()
    row.update(entry=entry, Method=2, ZoneOrSort=zone, MinLevel=minlevel, MaxLevel=maxlevel, QuestLevel=qlevel, Type=qtype,
               RequiredClasses=classes, RequiredRaces=races, SuggestedPlayers=suggested, LimitTime=limit,
               QuestFlags=8, SpecialFlags=(1 if data.get('repeatable') else 0) | (2 if trigger else 0),
               PrevQuestId=prev, NextQuestInChain=nxt, SrcItemId=src_item, SrcItemCount=src_count,
               Title=title, Details=details, Objectives=objectives, OfferRewardText=offer, RequestItemsText=request_text,
               EndText=end_text, RewOrReqMoney=money or -req_money, RewMoneyMaxLevel=round(xp * 0.6),
               RewSpellCast=spell, RepObjectiveFaction=rep_fid,
               RepObjectiveValue=_num(rep_obj, 'value', -42000, 42000, 'Репутация', 0, int) if rep_fid else 0,
               DetailsEmote1=emotes['details'], IncompleteEmote=emotes['incomplete'], CompleteEmote=emotes['complete'],
               OfferRewardEmote1=emotes['offer'])
    for i in range(4):
        row['ObjectiveText%d' % (i + 1)] = obj_texts[i]
        row['ReqCreatureOrGOId%d' % (i + 1)], row['ReqCreatureOrGOCount%d' % (i + 1)] = kill[i] if i < len(kill) else (0, 0)
        row['ReqItemId%d' % (i + 1)], row['ReqItemCount%d' % (i + 1)] = collect[i][:2] if i < len(collect) else (0, 0)
        row['RewItemId%d' % (i + 1)], row['RewItemCount%d' % (i + 1)] = rew_items[i] if i < len(rew_items) else (0, 0)
    for i in range(6):
        row['RewChoiceItemId%d' % (i + 1)], row['RewChoiceItemCount%d' % (i + 1)] = rew_choice[i] if i < len(rew_choice) else (0, 0)
    for i in range(5):
        row['RewRepFaction%d' % (i + 1)], row['RewRepValue%d' % (i + 1)] = reps[i] if i < len(reps) else (0, 0)
    names = list(row.keys())
    await dbx(f'REPLACE INTO {W}.quest_template (%s) VALUES (%s)' % (
        ', '.join('`%s`' % n for n in names), ', '.join(['%s'] * len(names))), [row[n] for n in names])

    # связи: кто даёт, кто принимает, что исследовать, с кого падает
    await dbx(f'DELETE FROM {W}.creature_questrelation WHERE quest = %s', (entry,))
    await dbx(f'DELETE FROM {W}.creature_involvedrelation WHERE quest = %s', (entry,))
    await dbx(f'DELETE FROM {W}.areatrigger_involvedrelation WHERE quest = %s', (entry,))
    await dbx(f'UPDATE {W}.item_template SET startquest = 0 WHERE startquest = %s AND entry >= %s', (entry, CUSTOM_MIN))
    if giver['type'] == 'npc':
        await dbx(f'INSERT INTO {W}.creature_questrelation (id, quest) VALUES (%s, %s)', (giver_id, entry))
    else:
        await dbx(f'UPDATE {W}.item_template SET startquest = %s WHERE entry = %s', (entry, giver_id))
    await dbx(f'INSERT INTO {W}.creature_involvedrelation (id, quest) VALUES (%s, %s)', (ender_id, entry))
    if trigger:
        await dbx(f'INSERT INTO {W}.areatrigger_involvedrelation (id, quest) VALUES (%s, %s)', (trigger, entry))
    loot_changed = await _drop_quest_loot(entry)
    for item, _count, creature, chance in collect:
        if not creature:
            continue
        cre = (await _creatures([creature], 'С кого падает'))[creature]
        loot = cre['LootId']
        if creature >= NPC_MIN:
            if loot != creature:
                loot = await own_loot(creature, loot)
                mark_changed('npc', creature)
        else:
            need(loot, '«%s» ничего не роняет (нет таблицы добычи) — выберите другое существо или своего моба.' % cre['Name'])
        exists = await dbq(f'SELECT item FROM {W}.creature_loot_template WHERE entry = %s AND item = %s', (loot, item), one=True)
        if exists:
            continue                # такой предмет у него уже падает — не трогаем чужую строку
        await dbx(f'''INSERT INTO {W}.creature_loot_template (entry, item, ChanceOrQuestChance, groupid, mincountOrRef, maxcount,
                          condition_id, comments) VALUES (%s, %s, %s, 0, 1, 1, 0, %s)''',
                  (loot, item, -chance, 'панель: задание %d' % entry))
        with panel_db() as conn:
            conn.execute('INSERT INTO quest_loot(quest, loot, item, chance, creature) VALUES (?,?,?,?,?)',
                         (entry, loot, item, chance, creature))
        loot_changed = True
    await _questgiver_flag([ender_id] + ([giver_id] if giver['type'] == 'npc' else []))
    await _restore_flags()
    with panel_db() as conn:
        conn.execute("REPLACE INTO custom_changes(kind, id, ts) VALUES ('quest', ?, ?)", (entry, int(time.time())))
        if loot_changed:
            conn.execute("REPLACE INTO custom_changes(kind, id, ts) VALUES ('quest_loot', 0, ?)", (int(time.time()),))
    audit('quest.create' if created else 'quest.update', '#%d %s' % (entry, title))
    await export_custom_quests()
    return ok({'entry': entry, 'created': created,
               'status': quest_status([entry], list(npcs) + ([giver_id] if giver['type'] == 'npc' else []))[entry]})


async def h_quest_delete(request):
    data = await body(request)
    entry = int_arg(data.get('entry'), QUEST_MIN, QUEST_MAX, 'Номер задания')
    row = await dbq(f'SELECT Title FROM {W}.quest_template WHERE entry = %s', (entry,), one=True)
    need(row, 'Такого задания нет.')
    need(data.get('confirm') == row['Title'], 'Для удаления впишите название задания точно.')
    for sql in (f'DELETE FROM {W}.creature_questrelation WHERE quest = %s',
                f'DELETE FROM {W}.creature_involvedrelation WHERE quest = %s',
                f'DELETE FROM {W}.areatrigger_involvedrelation WHERE quest = %s',
                f'UPDATE {W}.item_template SET startquest = 0 WHERE startquest = %s',
                f'UPDATE {W}.quest_template SET NextQuestInChain = 0 WHERE NextQuestInChain = %s',
                f'UPDATE {W}.quest_template SET PrevQuestId = 0 WHERE PrevQuestId = %s',
                f'DELETE FROM {W}.quest_template WHERE entry = %s'):
        await dbx(sql, (entry,))
    await _drop_quest_loot(entry)
    await _restore_flags()
    with panel_db() as conn:
        conn.execute("REPLACE INTO custom_changes(kind, id, ts) VALUES ('quest', ?, ?)", (entry, int(time.time())))
    audit('quest.delete', '#%d %s' % (entry, row['Title']))
    await export_custom_quests()
    return ok({'success': True, 'output': 'Задание удалено. Мир забудет его после «Применить» или перезапуска.'})


async def h_quest_apply(request):
    """Перечитать задания и связи на ходу. Каждая команда reload пишет строку всем в игре."""
    cmds = ['reload quest_template', 'reload creature_questrelation', 'reload creature_involvedrelation',
            'reload areatrigger_involvedrelation']
    with panel_db() as conn:
        loot = conn.execute("SELECT ts FROM custom_changes WHERE kind = 'quest_loot' AND id = 0").fetchone()
        applied = conn.execute("SELECT ts FROM custom_changes WHERE kind = 'quest_apply' AND id = 0").fetchone()
    if loot and loot[0] > max(applied[0] if applied else 0, world_started() or 0):
        cmds.append('reload all_loot')
    outputs = []
    for cmd in cmds:
        res = await run_cmd('quest.apply', cmd, cmd)
        outputs.append('%s — %s' % (cmd, 'готово' if res['success'] else 'не вышло'))
        need(res['success'], 'Ядро не выполнило «%s»: %s' % (cmd, res['output'] or '—'))
    with panel_db() as conn:
        conn.execute("REPLACE INTO custom_changes(kind, id, ts) VALUES ('quest_apply', 0, ?)", (int(time.time()),))
    return ok({'success': True, 'output': '\n'.join(outputs)})


async def export_custom_quests():
    lo, hi = QUEST_MIN, QUEST_MAX
    parts = [rows_sql('quest_template', await dbq(f'SELECT * FROM {W}.quest_template WHERE entry BETWEEN %s AND %s ORDER BY entry', (lo, hi)))]
    for t in ('creature_questrelation', 'creature_involvedrelation', 'areatrigger_involvedrelation'):
        parts.append(rows_sql(t, await dbq(f'SELECT * FROM {W}.{t} WHERE quest BETWEEN %s AND %s', (lo, hi))))
    with panel_db() as conn:
        loot = conn.execute('SELECT DISTINCT loot, item FROM quest_loot').fetchall()
        patches = conn.execute('SELECT entry, original FROM npc_flag_patch').fetchall()
    for le, item in loot:
        parts.append(rows_sql('creature_loot_template', await dbq(
            f'SELECT * FROM {W}.creature_loot_template WHERE entry = %s AND item = %s', (le, item))))
    starts = await dbq(f'SELECT entry, startquest FROM {W}.item_template WHERE startquest BETWEEN %s AND %s', (lo, hi))
    parts += ['UPDATE `item_template` SET `startquest` = %d WHERE `entry` = %d;\n' % (s['startquest'], s['entry']) for s in starts]
    parts += ['UPDATE `creature_template` SET `NpcFlags` = `NpcFlags` | 2 WHERE `Entry` = %d;  -- было %d\n' % (e, o)
              for e, o in patches]
    head = ('-- Свои задания WoW-сервера (веб-панель), %s\n'
            '-- Сначала custom_npcs.sql и custom_items.sql, потом этот: mysql -umangos -p %s < custom_quests.sql\n\n' % (
                datetime.now().strftime('%Y-%m-%d %H:%M'), W))
    await asyncio.to_thread(QUEST_SQL.write_text, head + '\n'.join(p for p in parts if p), 'utf-8')


# --- фоновые задачи ----------------------------------------------------------

async def cpu_loop():
    while True:
        try:
            cpu_tick()
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        await asyncio.sleep(10)


async def sample_loop():
    await asyncio.sleep(15)
    while True:
        try:
            row = await asyncio.to_thread(_db_query, f'SELECT COUNT(*) AS n FROM {C}.characters WHERE online = 1',
                                          None, True)
            cg = cgroup_stats()
            world = CPU_STATE['procs'].get('mangosd')
            world_info = proc_info(world['pid']) if world else None
            world_rss = world_info['rss'] if world_info else None
            with panel_db() as conn:
                conn.execute('INSERT OR REPLACE INTO samples(ts, online, cpu, mem_mb, world_mb) VALUES (?,?,?,?,?)',
                             (int(time.time()), row['n'] if row else None,
                              round(CPU_STATE['cg_pct'], 2) if CPU_STATE['cg_pct'] is not None else None,
                              cg['mem'] // 2 ** 20 if cg['mem'] else None,
                              world_rss // 2 ** 20 if world_rss else None))
                conn.execute('DELETE FROM samples WHERE ts < ?', (int(time.time()) - SAMPLE_KEEP_DAYS * 86400,))
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        await asyncio.sleep(SAMPLE_EVERY)


async def on_startup(app):
    global SOAP_LOCK, DBC_LOCK, ICON_LOCK, CHAR_LOCK, TELE_LOCK
    SOAP_LOCK = asyncio.Lock()
    TELE_LOCK = asyncio.Lock()
    DBC_LOCK = asyncio.Lock()
    ICON_LOCK = asyncio.Lock()
    CHAR_LOCK = asyncio.Lock()
    app['tasks'] = [asyncio.create_task(cpu_loop()), asyncio.create_task(sample_loop()),
                    asyncio.create_task(schedule_loop())]


async def on_cleanup(app):
    for task in app.get('tasks', []):
        task.cancel()


def build_app():
    app = web.Application(middlewares=[guard], client_max_size=256 * 1024)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    r = app.router
    r.add_get('/', h_index)
    r.add_static('/static/', STATIC, show_index=False, follow_symlinks=False)
    r.add_get('/api/session', h_session)
    r.add_post('/api/login', h_login)
    r.add_post('/api/logout', h_logout)
    r.add_get('/api/overview', h_overview)
    r.add_get('/api/online', h_online)
    r.add_get('/api/accounts', h_accounts)
    r.add_get('/api/account', h_account)
    r.add_post('/api/account/create', h_account_create)
    r.add_post('/api/account/password', h_account_password)
    r.add_post('/api/account/gmlevel', h_account_gmlevel)
    r.add_post('/api/account/delete', h_account_delete)
    r.add_post('/api/account/lock', h_account_lock)
    r.add_get('/api/characters', h_characters)
    r.add_get('/api/character', h_character)
    r.add_post('/api/character/action', h_character_action)
    r.add_get('/api/character/sessions', h_character_sessions)
    r.add_get('/api/character/talents', h_character_talents)
    r.add_post('/api/character/item/remove', h_item_remove)
    r.add_post('/api/character/item/restore', h_item_restore)
    r.add_get('/api/account/stats', h_account_stats)
    r.add_get('/api/tele', h_tele)
    r.add_get('/api/map/point', h_map_point)
    r.add_get('/api/map/pins', h_map_pins)
    r.add_post('/api/map/tele', h_map_tele)
    r.add_get('/api/npcs', h_npc_list)
    r.add_get('/api/npc', h_npc)
    r.add_get('/api/npc/search', h_npc_search)
    r.add_get('/api/npc/models', h_npc_models)
    r.add_post('/api/npc/save', h_npc_save)
    r.add_post('/api/npc/delete', h_npc_delete)
    r.add_post('/api/npc/spawn', h_npc_spawn)
    r.add_post('/api/npc/despawn', h_npc_despawn)
    r.add_get('/api/quests', h_quest_list)
    r.add_get('/api/quest', h_quest)
    r.add_get('/api/quest/meta', h_quest_meta)
    r.add_get('/api/quest/search', h_quest_search)
    r.add_get('/api/quest/triggers', h_quest_triggers)
    r.add_post('/api/quest/save', h_quest_save)
    r.add_post('/api/quest/delete', h_quest_delete)
    r.add_post('/api/quest/apply', h_quest_apply)
    r.add_get('/api/bans', h_bans)
    r.add_post('/api/ban', h_ban)
    r.add_post('/api/unban', h_unban)
    r.add_get('/api/stats', h_stats)
    r.add_get('/api/stats/factions', h_stats_factions)
    r.add_get('/api/stats/economy', h_stats_economy)
    r.add_get('/api/stats/logins', h_stats_logins)
    r.add_get('/api/guild', h_guild)
    r.add_post('/api/server', h_server)
    r.add_get('/api/config', h_config)
    r.add_get('/api/bots', h_bots)
    r.add_post('/api/bots', h_bots_save)
    r.add_post('/api/config', h_config_save)
    r.add_get('/api/logs', h_logs)
    r.add_post('/api/console', h_console)
    r.add_get('/api/commands', h_commands)
    r.add_get('/api/lookup', h_lookup)
    r.add_get('/api/audit', h_audit)
    r.add_get('/api/tickets', h_tickets)
    r.add_get('/api/system', h_system)
    r.add_get('/api/spells', h_spells)
    r.add_get('/api/items/meta', h_items_meta)
    r.add_get('/api/display', h_display)
    r.add_get('/api/items/looks', h_items_looks)
    r.add_get('/api/world', h_world)
    r.add_post('/api/world', h_world_action)
    r.add_get('/api/items/custom', h_items_custom)
    r.add_get('/api/items/search', h_items_search)
    r.add_get('/api/item', h_item)
    r.add_get('/api/item/sql', h_item_sql)
    r.add_post('/api/item/save', h_item_save)
    r.add_post('/api/item/delete', h_item_delete)
    return app


async def check_setup():
    """python3 panel.py --check: что панель нашла и до чего достучалась. Код выхода 1 — есть ошибки."""
    global SOAP_LOCK
    SOAP_LOCK = asyncio.Lock()
    bad = 0

    def line(good, what, detail='', warn=False):
        nonlocal bad
        bad += not good and not warn
        print('  %-4s %-26s %s' % ('ok' if good else ('warn' if warn else 'FAIL'), what, detail))

    print('Settings: %s' % ENV_FILE)
    line(CONF.exists(), 'mangosd.conf', str(CONF))
    line(DBC.joinpath('AreaTable.dbc').exists(), 'DBC files (dbc/)', str(DBC))
    line(MAPS.is_dir() and any(MAPS.glob('*.map')), 'Map files (maps/)', '%s — needed for the world map teleport' % MAPS, warn=True)
    for key, (label, path) in LOG_FILES.items():
        line(path.exists(), 'Log: ' + key, str(path), warn=True)
    line(GEO_DB.exists(), 'GeoIP database', '%s — optional, shows countries of IPs' % GEO_DB, warn=True)
    line((STATIC / 'wow' / 'maps' / 'World.webp').exists(), 'World map images', 'static/wow/maps — tools/build_assets.py', warn=True)
    line((STATIC / 'fonts' / 'frizqt.ttf').exists(), 'Game fonts', 'static/fonts — tools/build_assets.py', warn=True)
    line(site_info()['music'], 'Game music', 'static/music — tools/build_assets.py', warn=True)
    line(site_info()['bots'], 'Playerbots config', '%s — the Bots page is hidden without it' % BOT_CONFS['ai'], warn=True)
    try:
        DATA.mkdir(parents=True, exist_ok=True)
        line(os.access(DATA, os.W_OK), 'Panel data folder', str(DATA))
    except OSError as e:
        line(False, 'Panel data folder', '%s: %s' % (DATA, e))
    line(os.access(CONF, os.W_OK), 'mangosd.conf writable', 'needed to save settings from the panel', warn=True)

    where = DB.get('unix_socket') or '%s:%s' % (DB.get('host'), DB.get('port'))
    try:
        for db, table in ((R, 'account'), (C, 'characters'), (W, 'creature_template')):
            n = (await asyncio.to_thread(_db_query, f'SELECT COUNT(*) AS n FROM {db}.{table}', None, True))['n']
            line(True, 'Database %s' % db, '%s rows in %s (%s@%s)' % (n, table, DB['user'], where))
    except pymysql.MySQLError as e:
        line(False, 'Database', '%s@%s: %s' % (DB['user'], where, e.args[-1] if e.args else e))
    procs = scan_procs()
    line(bool(procs.get('mangosd')), 'World process (mangosd)', 'pid %s' % procs['mangosd'] if procs.get('mangosd')
         else 'not running — SOAP checks need it', warn=True)
    if procs.get('mangosd'):
        good, text = await soap('server info', timeout=6)
        line(good, 'SOAP %s:%d' % (SOAP_HOST, SOAP_PORT), (text or '').splitlines()[0] if text else 'no answer — check SOAP.Enabled and the account')
    print('Panel will listen on %s:%d and accept %s' % (HOST, PORT, ', '.join(str(n) for n in ALLOWED_PEERS)))
    return bad


def main():
    if '--check' in sys.argv[1:]:
        AREAS.update(load_areas())
        sys.exit(1 if asyncio.run(check_setup()) else 0)
    init_panel_db()
    AREAS.update(load_areas())
    print('Panel: %d areas from AreaTable.dbc, listening on %s:%d, accepting %s' % (
        len(AREAS), HOST, PORT, ', '.join(str(n) for n in ALLOWED_PEERS)), flush=True)
    web.run_app(build_app(), host=HOST, port=PORT, access_log=None, print=None)


if __name__ == '__main__':
    main()
