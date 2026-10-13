'use strict';
/* Панель WoW-сервера. Одностраничник без сборки и внешних библиотек.
   Всё, что пришло с сервера (имена, причины банов, ответы ядра), вставляется
   только через textContent — никакого innerHTML с данными. */

// ============================================================ языки
/* Исходный язык панели — русский: каждая надпись в коде обёрнута в L('…') и сама служит
   ключом перевода. Словарь выбранного языка (static/i18n/<код>.js) подключает boot.js ещё до
   этого файла, поэтому L() работает и в таблицах, которые заполняются при загрузке.
   {0}, {1}… в ключе — места для чисел и имён: L('Входы: {0}', n). Нет перевода — остаётся русский. */

const I18N = window.PANEL_I18N || null;
const LANG = document.documentElement.lang || 'ru';
const LOCALE = (window.PANEL_LANGS || []).reduce((a, x) => (x[0] === LANG ? x[2] : a), 'ru-RU');

function L(key, ...args) {
  let text = I18N && I18N[key];
  if (!text) text = key;
  else if (key[0] === ' ' || key[key.length - 1] === ' ') {
    // пробелы по краям — часть склейки в коде («через » + время), в переводе их держать не нужно
    text = key.match(/^ */)[0] + text.trim() + key.match(/ *$/)[0];
  }
  return args.length ? text.replace(/\{(\d+)\}/g, (m, n) => (args[n] == null ? '' : String(args[n]))) : text;
}

/* Одна русская надпись с разным смыслом: «Защита» — и навык (Defense), и ветка талантов (Protection).
   Lx('talent', 'Защита') ищет в словаре «talent|Защита», а нет такого — обычный перевод. */
function Lx(ctx, key) { return (I18N && I18N[ctx + '|' + key]) || L(key); }

/* Текст, который прислал сервер (ошибки, подписи настроек, записи журнала), переводится тем же
   словарём: сначала строка целиком, потом по образцам с {0} — «Аккаунта {0} нет.» узнаёт и
   «Аккаунта BOB нет.». Ответы самого ядра (английские) остаются как есть. */
let srvPatterns = null;
function Lsrv(text) {
  if (!I18N || typeof text !== 'string' || !text) return text;
  if (I18N[text]) return I18N[text];
  if (!srvPatterns) {
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    srvPatterns = Object.keys(I18N).filter((k) => /\{\d+\}/.test(k)).map((k) => {
      const order = [];
      const re = esc(k).replace(/\\\{(\d+)\\\}/g, (m, n) => { order.push(+n); return '([\\s\\S]+?)'; });
      return [new RegExp('^' + re + '$'), k, order, k.replace(/\{\d+\}/g, '').length];
    });
    // сначала образцы, где больше постоянного текста: «бан {0} на {1}: {2}» раньше, чем «{0} на {1}: {2}»
    srvPatterns.sort((a, b) => b[3] - a[3]);
  }
  return text.split('\n').map((line) => {
    if (!line.trim() || !/[А-Яа-яЁё]/.test(line)) return line;
    if (I18N[line]) return I18N[line];
    for (const [re, k, order] of srvPatterns) {
      const m = line.match(re);
      if (!m) continue;
      const args = [];
      order.forEach((n, i) => { args[n] = Lsrv(m[i + 1]); });
      return L(k, ...args);
    }
    return line;
  }).join('\n');
}

// поля ответов сервера, где приходит его собственный русский текст
const SRV_FIELDS = new Set(['output', 'label', 'hint', 'title', 'race_name', 'class_name', 'gm_name', 'detail',
  'about', 'parent_name', 'event_name']);
/* Названия событий сервер шлёт по-русски (EVENT_META в panel.py). Поле name есть и у персонажей,
   поэтому переводим его только в ответах про события, существа и задания */
function trNames(v, depth = 0) {
  if (!I18N || depth > 6 || v == null || typeof v !== 'object') return v;
  if (Array.isArray(v)) { v.forEach((x) => trNames(x, depth + 1)); return v; }
  for (const k of Object.keys(v)) {
    if (k === 'name' && typeof v[k] === 'string') v[k] = Lsrv(v[k]);
    else if (v[k] && typeof v[k] === 'object') trNames(v[k], depth + 1);
  }
  return v;
}
function translateReply(v, depth = 0) {
  if (!I18N || depth > 8 || v == null || typeof v !== 'object') return v;
  if (Array.isArray(v)) { for (const x of v) translateReply(x, depth + 1); return v; }
  for (const k of Object.keys(v)) {
    if (typeof v[k] === 'string') { if (SRV_FIELDS.has(k)) v[k] = Lsrv(v[k]); } else translateReply(v[k], depth + 1);
  }
  return v;
}

// ============================================================ утилиты

const $ = (sel, root = document) => root.querySelector(sel);
const SVGNS = 'http://www.w3.org/2000/svg';

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function s(tag, attrs, text) {
  const el = document.createElementNS(SVGNS, tag);
  setAttrs(el, attrs);
  if (text != null) el.textContent = String(text);
  return el;
}

function setAttrs(el, attrs) {
  if (!attrs) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
}

const ICONS = {
  overview: 'M3 13h4l3-7 4 12 3-5h4',
  online: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z|M4 21a8 8 0 0 1 16 0',
  accounts: 'M4 5h16v14H4z|M8 10h8|M8 14h5',
  characters: 'M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7z',
  items: 'M14.5 4H20v5.5L10 19.5 4.5 14z|M4 20l3-3|M15 9l-1.5-1.5',
  bans: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z|M5.6 5.6l12.8 12.8',
  stats: 'M4 20V11|M10 20V5|M16 20v-7|M21 20H3',
  server: 'M4 4h16v6H4z|M4 14h16v6H4z|M8 7h.01|M8 17h.01',
  bots: 'M6 9h12v10H6z|M12 5v4|M9.5 13h.01|M14.5 13h.01|M9 16.5h6|M3.5 12.5v4|M20.5 12.5v4',
  logs: 'M6 3h9l4 4v14H6z|M9 11h7|M9 15h7',
  console: 'M4 5h16v14H4z|M7 10l3 2-3 2|M12 15h5',
  audit: 'M12 7v5l3 2|M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  ok: 'M5 12l5 5L20 7',
  warn: 'M12 9v4|M12 16.5v.01|M12 3l9.5 17h-19z',
  x: 'M6 6l12 12|M18 6L6 18',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7|M20 4v7h-7',
  moon: 'M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z',
  logout: 'M15 4h4v16h-4|M10 8l-4 4 4 4|M6 12h10',
  note: 'M9 18V5l11-2v13|M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M17 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  pause: 'M9 5v14|M15 5v14',
  next: 'M5 6l9 6-9 6z|M18 6v12',
  prev: 'M19 6l-9 6 9 6z|M6 6v12',
  play: 'M7 5l12 7-12 7z',
  volume: 'M4 9h4l5-4v14l-5-4H4z|M16.5 9a4 4 0 0 1 0 6|M19 6.5a7.5 7.5 0 0 1 0 11',
  mute: 'M4 9h4l5-4v14l-5-4H4z|M16.5 9.5l5 5|M21.5 9.5l-5 5',
  back: 'M15 6l-6 6 6 6|M9 12h11',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  worldmap: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z|M9 4v14|M15 6v14',
  npcs: 'M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z|M5 21v-1a7 7 0 0 1 14 0v1|M17 3l1.5 1.5L21 2',
  quests: 'M12 3v11|M12 18v.01|M7 21h10|M5 3h14',
  events: 'M4 6h16v14H4z|M4 10h16|M8 3v5|M16 3v5|M8 14h.01|M12 14h.01|M16 14h.01|M8 17h.01|M12 17h.01',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z|M3 12h18|M12 3a14 14 0 0 1 0 18|M12 3a14 14 0 0 0 0 18',
  palette: 'M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4c2.5 0 4.6-2 4.6-4.6C22 6.1 17.5 3 12 3z|M7.5 11.5h.01|M10.5 7.5h.01|M15.5 7.5h.01',
};

function icon(name) {
  const svg = s('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
  for (const d of ICONS[name].split('|')) svg.append(s('path', { d }));
  return svg;
}

const nf = new Intl.NumberFormat(LOCALE);
const fmtN = (n) => (n == null || n === '' ? '—' : nf.format(n));
const fmtPct = (n) => (n == null ? '—' : nf.format(Math.round(n * 10) / 10) + '%');

function fmtMoney(c) {
  if (c == null) return '—';
  c = Math.floor(c);
  const g = Math.floor(c / 10000), sv = Math.floor((c % 10000) / 100), cu = c % 100;
  if (g) return L('{0} з {1} с', nf.format(g), sv);
  if (sv) return L('{0} с {1} м', sv, cu);
  return L('{0} м', cu);
}

function fmtDur(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const d = Math.floor(sec / 86400), hh = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d) return L('{0} д {1} ч', d, hh);
  if (hh) return L('{0} ч {1} мин', hh, m);
  if (m) return L('{0} мин', m);
  return L('{0} с', sec);
}

function fmtBytes(b) {
  if (b == null) return '—';
  const units = [L('Б'), L('КБ'), L('МБ'), L('ГБ'), L('ТБ')];
  let i = 0;
  while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
  return `${nf.format(Math.round(b * (i >= 3 ? 10 : 1)) / (i >= 3 ? 10 : 1))} ${units[i]}`;
}

function toDate(v) {
  if (v == null || v === '' || v === 0) return null;
  if (typeof v === 'number') return new Date(v * 1000);
  const d = new Date(String(v).replace(' ', 'T'));
  return isNaN(d) ? null : d;
}

function fmtDT(v, withYear = true) {
  const d = toDate(v);
  if (!d) return '—';
  return d.toLocaleString(LOCALE, { day: '2-digit', month: '2-digit', year: withYear ? 'numeric' : undefined,
                                     hour: '2-digit', minute: '2-digit' });
}

function fmtD(v) {
  const d = toDate(v);
  return d ? d.toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
}

function ago(v) {
  const d = toDate(v);
  if (!d) return '—';
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return L('только что');
  if (sec < 3600) return L('{0} мин назад', Math.floor(sec / 60));
  if (sec < 86400) return L('{0} ч назад', Math.floor(sec / 3600));
  if (sec < 86400 * 30) return L('{0} д назад', Math.floor(sec / 86400));
  return fmtD(v);
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

const GM = { 0: L('Игрок'), 1: L('Модератор'), 2: L('Гейм-мастер'), 3: L('Администратор') };
const SEC = { 0: L('игрок'), 1: L('модератор'), 2: L('ГМ'), 3: L('админ'), 4: L('консоль') };
const RACES = { 1: L('Человек'), 2: L('Орк'), 3: L('Дворф'), 4: L('Ночной эльф'), 5: L('Нежить'), 6: L('Таурен'), 7: L('Гном'), 8: L('Тролль') };
const CLASSES = { 1: L('Воин'), 2: L('Паладин'), 3: L('Охотник'), 4: L('Разбойник'), 5: L('Жрец'), 7: L('Шаман'), 8: L('Маг'), 9: L('Чернокнижник'), 11: L('Друид') };
const FACTION = { A: L('Альянс'), H: L('Орда') };

// ============================================================ игровые иконки
/* Картинки из клиента игры — с wow.zamimg.com (их держит Wowhead): CSP панели
   пускает картинки только оттуда. Нет картинки или сети — остаётся пустая
   рамка, страница не ломается. Размеры: s 20px, m 28px, l 40px, xl 56px, xxl 84px. */
const ZAM = 'https://wow.zamimg.com/images/wow/icons/';
const RACE_KEY = { 1: 'human', 2: 'orc', 3: 'dwarf', 4: 'nightelf', 5: 'scourge', 6: 'tauren', 7: 'gnome', 8: 'troll' };
const CLASS_KEY = { 1: 'warrior', 2: 'paladin', 3: 'hunter', 4: 'rogue', 5: 'priest', 7: 'shaman', 8: 'mage', 9: 'warlock', 11: 'druid' };
const RACE_FAC = { 1: 'A', 2: 'H', 3: 'A', 4: 'A', 5: 'H', 6: 'H', 7: 'A', 8: 'H' };
const FAC_ICON = { A: 'ui_allianceicon', H: 'ui_hordeicon' };
const raceIcon = (race, gender) => (RACE_KEY[race] ? `race_${RACE_KEY[race]}_${gender ? 'female' : 'male'}` : '');
const classIcon = (cls) => (CLASS_KEY[cls] ? 'classicon_' + CLASS_KEY[cls] : '');
const RANKS = {
  A: [L('Рядовой'), L('Капрал'), L('Сержант'), L('Старший сержант'), L('Старшина'), L('Рыцарь'), L('Рыцарь-лейтенант'), L('Рыцарь-капитан'),
      L('Рыцарь-защитник'), L('Лейтенант-командор'), L('Командор'), L('Маршал'), L('Фельдмаршал'), L('Главнокомандующий')],
  H: [L('Разведчик'), L('Рубака'), Lx('horde', 'Сержант'), Lx('horde', 'Старший сержант'), Lx('horde', 'Старшина'), L('Каменный страж'), L('Кровавый страж'), L('Легионер'),
      L('Центурион'), L('Защитник'), L('Генерал-лейтенант'), L('Генерал'), L('Полководец'), L('Верховный полководец')],
};
const rankIcon = (fac, r) => (r > 0 ? `achievement_pvp_${fac === 'H' ? 'h' : 'a'}_${String(r).padStart(2, '0')}` : '');
const rankName = (fac, r) => (r > 0 ? RANKS[fac === 'H' ? 'H' : 'A'][r - 1] : r < 0 ? L('бесчестье, {0}', -r) : L('нет звания'));
const PROF = {
  171: [L('Алхимия'), 'trade_alchemy'], 164: [L('Кузнечное дело'), 'trade_blacksmithing'], 333: [L('Наложение чар'), 'trade_engraving'],
  202: [L('Инженерное дело'), 'trade_engineering'], 182: [L('Травничество'), 'spell_nature_naturetouchgrow'], 186: [L('Горное дело'), 'trade_mining'],
  393: [L('Снятие шкур'), 'inv_misc_pelt_wolf_01'], 165: [L('Кожевничество'), 'inv_misc_armorkit_17'], 197: [L('Портняжное дело'), 'trade_tailoring'],
  185: [L('Кулинария'), 'inv_misc_food_15'], 129: [L('Первая помощь'), 'spell_holy_sealofsacrifice'], 356: [L('Рыбная ловля'), 'trade_fishing'],
};
const PRIMARY_PROF = new Set([171, 164, 333, 202, 182, 186, 393, 165, 197]);
const SKILL_RU = {
  43: L('Одноручные мечи'), 55: L('Двуручные мечи'), 44: L('Одноручные топоры'), 172: L('Двуручные топоры'), 54: L('Одноручное дробящее'),
  160: L('Двуручное дробящее'), 229: L('Древковое оружие'), 136: L('Посохи'), 173: L('Кинжалы'), 473: L('Кистевое оружие'), 45: L('Луки'),
  46: L('Огнестрельное оружие'), 226: L('Арбалеты'), 176: L('Метательное оружие'), 228: L('Жезлы'), 162: L('Рукопашный бой'), 95: L('Защита'),
  118: L('Бой двумя оружиями'), 633: L('Вскрытие замков'), 40: L('Яды'), 148: L('Верховая езда: лошади'), 149: L('Верховая езда: волки'), 150: L('Верховая езда: тигры'),
  152: L('Верховая езда: бараны'), 533: L('Верховая езда: ящеры'), 553: L('Управление механодолгоногом'), 554: L('Верховая езда: кони нежити'),
  713: L('Верховая езда: кодо'),
};
const SKILL_ICON = {
  43: 'inv_sword_04', 55: 'inv_sword_06', 44: 'inv_axe_01', 172: 'inv_axe_09', 54: 'inv_mace_01', 160: 'inv_hammer_04',
  229: 'inv_spear_06', 136: 'inv_staff_08', 173: 'inv_weapon_shortblade_05', 473: 'inv_gauntlets_04', 45: 'inv_weapon_bow_05',
  46: 'inv_weapon_rifle_01', 226: 'inv_weapon_crossbow_01', 176: 'inv_throwingknife_02', 228: 'inv_wand_01',
  162: 'ability_golemthunderclap', 95: 'inv_shield_06', 118: 'ability_dualwield', 633: 'spell_nature_moonkey', 40: 'trade_brewpoison',
  148: 'ability_mount_ridinghorse', 149: 'ability_mount_whitedirewolf', 150: 'ability_mount_jungletiger', 152: 'ability_mount_mountainram',
  533: 'ability_mount_raptor', 553: 'ability_mount_mechastrider', 554: 'ability_mount_undeadhorse', 713: 'ability_mount_kodo_03',
};
const TALENT_RU = {
  Arms: Lx('talent', 'Оружие'), Fury: Lx('talent', 'Неистовство'), Protection: Lx('talent', 'Защита'), Holy: Lx('talent', 'Свет'), Retribution: Lx('talent', 'Воздаяние'),
  'Beast Mastery': Lx('talent', 'Повелитель зверей'), Marksmanship: Lx('talent', 'Стрельба'), Survival: Lx('talent', 'Выживание'), Assassination: Lx('talent', 'Ликвидация'),
  Combat: Lx('talent', 'Бой'), Subtlety: Lx('talent', 'Скрытность'), Discipline: Lx('talent', 'Послушание'), Shadow: Lx('talent', 'Тьма'), Elemental: Lx('talent', 'Стихии'),
  Enhancement: Lx('talent', 'Совершенствование'), Restoration: Lx('talent', 'Исцеление'), Arcane: Lx('talent', 'Тайная магия'), Fire: Lx('talent', 'Огонь'), Frost: Lx('talent', 'Лёд'),
  Affliction: Lx('talent', 'Колдовство'), Demonology: Lx('talent', 'Демонология'), Destruction: Lx('talent', 'Разрушение'), Balance: Lx('talent', 'Баланс'), 'Feral Combat': Lx('talent', 'Сила зверя'),
};
const REP_RU = {
  'Booty Bay': L('Пиратская Бухта'), Ironforge: L('Стальгорн'), 'Gnomeregan Exiles': L('Изгнанники Гномрегана'),
  'Thorium Brotherhood': L('Братство Тория'), Horde: L('Орда'), Undercity: L('Подгород'), Darnassus: L('Дарнас'), Syndicate: L('Синдикат'),
  Stormwind: L('Штормград'), Orgrimmar: L('Оргриммар'), 'Thunder Bluff': L('Громовой Утёс'), 'Bloodsail Buccaneers': L('Пираты Кровавого Паруса'),
  'Gelkis Clan Centaur': L('Кентавры племени Гелкис'), 'Magram Clan Centaur': L('Кентавры племени Маграм'),
  'Steamwheedle Cartel': L('Картель Хитрая Шестерёнка'), 'Zandalar Tribe': L('Племя Зандалар'), Ravenholdt: L('Чёрный Ворон'),
  Gadgetzan: L('Прибамбасск'), Alliance: L('Альянс'), Ratchet: L('Кабестан'), 'Wildhammer Clan': L('Клан Громового Молота'),
  'The League of Arathor': L('Лига Аратора'), 'The Defilers': L('Осквернители'), 'Argent Dawn': L('Серебряный Рассвет'),
  'Darkspear Trolls': L('Тролли Чёрного Копья'), 'Caer Darrow': L('Каэр Дарроу'), 'Timbermaw Hold': L('Древобрюхи'), Everlook: L('Круговзор'),
  'Wintersaber Trainers': L('Укротители ледопардов'), 'Cenarion Circle': L('Круг Кенария'), 'Shatterspear Trolls': L('Тролли Сломанного Копья'),
  'Ravasaur Trainers': L('Укротители равазавров'), 'Frostwolf Clan': L('Клан Северного Волка'), 'Stormpike Guard': L('Стража Грозовой Вершины'),
  'Hydraxian Waterlords': L('Гидраксианские Повелители Вод'), "Shen'dralar": L("Шен'дралар"), 'Warsong Outriders': L('Всадники Песни Войны'),
  'Silverwing Sentinels': L('Среброкрылые Часовые'), 'Alliance Forces': L('Силы Альянса'), 'Horde Forces': L('Силы Орды'),
  'Darkmoon Faire': L('Ярмарка Новолуния'), 'Brood of Nozdormu': L('Род Ноздорму'),
};
const REP_RANK = [L('Ненависть'), L('Враждебность'), L('Неприязнь'), L('Равнодушие'), L('Дружелюбие'), L('Уважение'), L('Почтение'), L('Превознесение')];
const PET_RU = {
  Wolf: L('Волк'), Cat: L('Кошка'), Spider: L('Паук'), Bear: L('Медведь'), Boar: L('Вепрь'), Crocolisk: L('Кроколиск'), 'Carrion Bird': L('Падальщик'),
  Crab: L('Краб'), Gorilla: L('Горилла'), Raptor: L('Ящер'), Tallstrider: L('Долгоног'), Felhunter: L('Охотник Скверны'), Voidwalker: L('Демон Бездны'),
  Succubus: L('Суккуб'), Doomguard: L('Страж ужаса'), Scorpid: L('Скорпид'), Turtle: L('Черепаха'), Imp: L('Бес'), Bat: L('Летучая мышь'),
  Hyena: L('Гиена'), Owl: L('Сова'), 'Wind Serpent': L('Крылатый змей'), Infernal: L('Инфернал'),
};
const QUALITY = [L('Хлам'), L('Обычные'), L('Необычные'), L('Редкие'), L('Эпические'), L('Легендарные'), L('Артефакты')];

function gicon(name, size = 'm', title, extra) {
  const box = h('span', { class: `gi ${size}${extra ? ' ' + extra : ''}`, title: title || null });
  if (name) {
    const dir = size === 's' ? 'small' : size === 'm' ? 'medium' : 'large';
    const img = h('img', { alt: '', loading: 'lazy', decoding: 'async', src: `${ZAM}${dir}/${String(name).toLowerCase()}.jpg` });
    img.addEventListener('error', () => img.remove());
    box.append(img);
  }
  return box;
}

function charIcons(r) {
  const fac = r.faction || RACE_FAC[r.race];
  return h('span', { class: 'ci' },
    gicon(raceIcon(r.race, r.gender), 's', [r.race_name || RACES[r.race], FACTION[fac]].filter(Boolean).join(' · '), fac ? 'f' + fac : null),
    gicon(classIcon(r.class), 's', r.class_name || CLASSES[r.class]));
}

function facIcon(fac, size = 's') { return fac ? gicon(FAC_ICON[fac], size, FACTION[fac]) : null; }

/* Деньги как в игре: золото, серебро, медь кружками нужного цвета. */
function coins(c) {
  c = Math.max(0, Math.floor(c || 0));
  const g = Math.floor(c / 10000), sv = Math.floor((c % 10000) / 100), cu = c % 100;
  const part = (v, k) => h('span', { class: 'coin' }, nf.format(v), h('i', { class: k }));
  return h('span', { class: 'coins', title: fmtMoney(c) },
    g ? part(g, 'g') : null, g || sv ? part(sv, 's') : null, g ? null : part(cu, 'c'));
}

function countryTag(c, short) {
  if (!c) return h('span', { class: 'cc unk', title: L('страна не определена') }, '??');
  const tag = h('span', { class: 'cc' + (c.code === 'LAN' ? ' lan' : ''), title: c.name }, c.code);
  return short ? tag : h('span', { class: 'cc-wrap' }, tag, h('span', null, c.name));
}

function ipCell(ip, c) {
  if (!ip) return '—';
  return h('span', { class: 'ip-cell' }, countryTag(c, true), h('span', { class: 'mono small' }, ip));
}

/* Столбики с иконками: [{icon, label, sub, v, cls, title}] — расы, классы, профессии, звания. */
function iconBars(rows, opt = {}) {
  if (!rows.length) return h('div', { class: 'empty' }, opt.empty || L('Нет данных'));
  const max = opt.max || Math.max(...rows.map((r) => r.v), 1);
  const total = opt.total != null ? opt.total : rows.reduce((a, r) => a + r.v, 0);
  return h('div', { class: 'ibars' }, rows.map((r) => {
    const fill = h('i', { class: r.cls || null });
    fill.style.width = Math.max(0, Math.min(100, (r.frac != null ? r.frac : r.v / max) * 100)).toFixed(1) + '%';
    return h('div', { class: 'ibar', title: r.title || null },
      r.iconNode || gicon(r.icon, 'm'),
      h('div', { class: 'ib-l' }, h('div', { class: 'ib-name' }, r.label), r.sub ? h('div', { class: 'ib-sub' }, r.sub) : null),
      h('div', { class: 'ib-track' }, fill),
      h('div', { class: 'ib-v' }, r.vText != null ? r.vText : (opt.fmt || fmtN)(r.v),
        opt.share !== false && total ? h('small', null, fmtPct((r.v / total) * 100)) : null));
  }));
}

const WEEKDAYS = [L('Пн'), L('Вт'), L('Ср'), L('Чт'), L('Пт'), L('Сб'), L('Вс')];
/* Тепловая карта «день недели × час»: cells[7][24]; чем ярче клетка, тем больше. */
function heatmap(cells, opt = {}) {
  const max = Math.max(1e-9, ...cells.flat());
  const grid = h('div', { class: 'heat' }, h('span'));
  for (let hr = 0; hr < 24; hr++) grid.append(h('span', { class: 'hx' }, hr % 3 === 0 ? String(hr) : ''));
  cells.forEach((row, d) => {
    grid.append(h('span', { class: 'hy' }, WEEKDAYS[d]));
    row.forEach((v, hr) => {
      const c = h('span', { class: 'hc' + (v > 0 ? '' : ' z') });
      if (v > 0) c.style.setProperty('--a', (0.18 + 0.82 * (v / max)).toFixed(3));
      c.addEventListener('pointermove', (e) => showTip(e, (opt.fmt || fmtN)(v), `${WEEKDAYS[d]}, ${pad2(hr)}:00–${pad2(hr)}:59`, true));
      c.addEventListener('pointerleave', hideTip);
      grid.append(c);
    });
  });
  return h('div', { class: 'heat-wrap' }, grid, opt.note ? h('div', { class: 'muted small heat-note' }, opt.note) : null);
}

const emptyWeek = () => Array.from({ length: 7 }, () => Array(24).fill(0));
const weekCell = (ts) => { const d = new Date(ts * 1000); return [(d.getDay() + 6) % 7, d.getHours()]; };

/* Подвкладки живут в адресе: #/stats/factions/A — обновление страницы их не сбрасывает. */
function hashParts() { return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean); }
function subTab(keys, def, level = 1) { const p = hashParts()[level]; return keys.includes(p) ? p : def; }
function setSubTab(...parts) {
  const page = hashParts()[0] || 'overview';
  history.replaceState(null, '', '#/' + [page, ...parts.filter(Boolean)].join('/'));
}

/* Подсказка над вещью — та же «игровая», что в конструкторе предметов. Полное
   описание предмета грузится при первом наведении и запоминается. */
const itemCache = {};
let itipEl = null, itipFor = null;

function itipPlace(target) {
  const r = target.getBoundingClientRect(), w = itipEl.offsetWidth, hh = itipEl.offsetHeight, pad = 10;
  let x = r.right + pad, y = r.top;
  if (x + w > window.innerWidth - 8) x = r.left - w - pad;
  if (x < 8) x = Math.max(8, Math.min(window.innerWidth - w - 8, r.left));
  if (y + hh > window.innerHeight - 8) y = Math.max(8, window.innerHeight - hh - 8);
  itipEl.style.left = x + 'px';
  itipEl.style.top = y + 'px';
}

function itipShow(target, it) {
  if (!itipEl) { itipEl = h('div', { class: 'itip', hidden: true }); document.body.append(itipEl); }
  itipFor = target;
  const show = (node) => {
    if (itipFor !== target || !target.isConnected) return;
    itipEl.replaceChildren(node);
    itipEl.hidden = false;
    itipPlace(target);
  };
  const full = () => itemTooltip(itemCache[it.entry].item, spellCache, it.icon);
  if (itemCache[it.entry]) { show(full()); return; }
  show(h('div', { class: 'tt-wrap' }, iconImg(it.icon, true), h('div', { class: 'tt' },
    h('div', { class: 'big ttq' + (it.quality || 0) }, it.name), h('div', { class: 'gr small' }, L('загружаю описание…')))));
  api('/api/item?brief=1&entry=' + it.entry).then(async (r) => {
    itemCache[it.entry] = r.data;
    show(full());
    const ids = [1, 2, 3, 4, 5].map((i) => Number(r.data.item['spellid_' + i])).filter(Boolean);
    if (ids.length) { try { await loadSpellInfo(ids); show(full()); } catch (e) { /* без описаний эффектов */ } }
  }).catch(() => {});
}

function itipShowNode(target, node) {
  if (!itipEl) { itipEl = h('div', { class: 'itip', hidden: true }); document.body.append(itipEl); }
  itipFor = target;
  itipEl.replaceChildren(node);
  itipEl.hidden = false;
  itipPlace(target);
}

function itipHide(target) {
  if (target && itipFor !== target) return;
  itipFor = null;
  if (itipEl) itipEl.hidden = true;
}

function bindItemTip(el, it) {
  el.addEventListener('mouseenter', () => itipShow(el, it));
  el.addEventListener('mouseleave', () => itipHide(el));
  el.addEventListener('focus', () => itipShow(el, it));
  el.addEventListener('blur', () => itipHide(el));
  return el;
}

// ============================================================ сеть

async function api(path, data) {
  const opts = data === undefined
    ? { method: 'GET' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Panel': '1' }, body: JSON.stringify(data) };
  let resp;
  try {
    resp = await fetch(path, { ...opts, credentials: 'same-origin', cache: 'no-store' });
  } catch (e) {
    throw new Error(L('Панель не отвечает. Проверьте, что она запущена и адрес открыт с этого компьютера.'));
  }
  let json = null;
  try { json = await resp.json(); } catch (e) { /* не JSON */ }
  if (resp.status === 401 && path !== '/api/login') {
    showLogin(L('Сессия закончилась — войдите снова.'));
    throw new Error(L('Нужно войти заново.'));
  }
  if (!resp.ok || !json || json.ok === false) throw new Error((json && Lsrv(json.error)) || L('Ошибка HTTP {0}', resp.status));
  return translateReply(json);
}

function toast(text, bad = false) {
  const t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, text);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), bad ? 7000 : 3500);
}

// ============================================================ окна и ящики

const overlays = [];

function openOverlay(content, onClosed) {
  const ov = h('div', { class: 'overlay' }, content);
  const close = () => {
    if (!ov.isConnected) return;
    ov.remove();
    itipHide();
    const i = overlays.indexOf(close);
    if (i >= 0) overlays.splice(i, 1);
    if (onClosed) onClosed();
  };
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  document.body.append(ov);
  overlays.push(close);
  return close;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && overlays.length) overlays[overlays.length - 1]();
});

function resultView(res) {
  const good = !!res.success;
  return h('div', { class: 'result ' + (good ? 'ok' : 'bad') },
    icon(good ? 'ok' : 'warn'),
    h('div', null,
      h('b', null, good ? L('Готово') : L('Не выполнено')),
      res.output ? h('pre', { class: 'out' }, res.output) : null));
}

let teleCache = null;
async function teleNames() {
  if (!teleCache) teleCache = (await api('/api/tele')).data;
  return teleCache;
}

function fieldEl(f, inputs) {
  if (f.node) return f.node;                      // готовый узел вместо поля (кнопка, пояснение)
  if (f.type === 'items') return itemsField(inputs);
  if (f.type === 'money') {
    const g = h('input', { class: 'inp', type: 'number', min: 0, value: 0 });
    const sv = h('input', { class: 'inp', type: 'number', min: 0, max: 99, value: 0 });
    const cu = h('input', { class: 'inp', type: 'number', min: 0, max: 99, value: 0 });
    inputs.gold = g; inputs.silver = sv; inputs.copper = cu;
    return h('div', { class: 'fields-3' },
      h('label', { class: 'field' }, h('span', null, L('Золото')), g),
      h('label', { class: 'field' }, h('span', null, L('Серебро')), sv),
      h('label', { class: 'field' }, h('span', null, L('Медь')), cu));
  }
  let input;
  if (f.type === 'select') {
    input = h('select', { class: 'inp' }, f.options.map(([v, l]) => h('option', { value: v }, l)));
    if (f.value != null) input.value = String(f.value);
  } else if (f.type === 'textarea') {
    input = h('textarea', { class: 'inp', placeholder: f.placeholder, maxlength: f.max, value: f.value || '' });
  } else if (f.type === 'checkbox') {
    input = h('input', { type: 'checkbox', checked: !!f.value });
    inputs[f.name] = input;
    return h('label', { class: 'chk' }, input, f.label);
  } else {
    input = h('input', { class: 'inp', type: f.type || 'text', placeholder: f.placeholder, value: f.value ?? '',
                         min: f.min, max: f.max, maxlength: f.maxlength, autocomplete: 'off', spellcheck: 'false' });
    if (f.type === 'tele') {
      input.type = 'text';
      const listId = 'tele-' + Math.random().toString(36).slice(2);
      const dl = h('datalist', { id: listId });
      input.setAttribute('list', listId);
      teleNames().then((names) => dl.append(...names.map((n) => h('option', { value: n })))).catch(() => {});
      inputs[f.name] = input;
      return h('label', { class: 'field' }, h('span', null, f.label), input, dl, f.hint ? h('small', null, f.hint) : null);
    }
  }
  inputs[f.name] = input;
  return h('label', { class: 'field' }, h('span', null, f.label), input, f.hint ? h('small', null, f.hint) : null);
}

function itemsField(inputs) {
  const chosen = [];
  const rows = h('div', { class: 'stack' });
  const results = h('div', { class: 'list' });
  const search = h('input', { class: 'inp', placeholder: L('Название предмета или его ID'), autocomplete: 'off' });
  const add = (it) => {
    if (chosen.length >= 12) { toast(L('В одном письме не больше 12 предметов.'), true); return; }
    const cnt = h('input', { class: 'inp', type: 'number', min: 1, max: 1000, value: 1 });
    cnt.style.width = '80px';
    const rec = { id: it.id, cnt };
    chosen.push(rec);
    const row = h('div', { class: 'row' },
      h('span', { class: `q${it.quality || 0} spacer` }, `${it.name} · #${it.id}`), cnt,
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { chosen.splice(chosen.indexOf(rec), 1); row.remove(); } }, L('убрать')));
    rows.append(row);
    results.replaceChildren();
    search.value = '';
  };
  search.addEventListener('input', debounce(async () => {
    const q = search.value.trim();
    if (q.length < 2) { results.replaceChildren(); return; }
    try {
      const r = await api('/api/lookup?kind=item&q=' + encodeURIComponent(q));
      results.replaceChildren(...r.data.rows.slice(0, 10).map((it) =>
        h('div', { class: 'li click', onclick: () => add(it) },
          h('span', { class: `grow q${it.quality}` }, it.name),
          h('span', { class: 'muted small' }, L('#{0} · ур. предмета {1}', it.id, it.ilvl)))));
      if (!r.data.rows.length) results.append(h('div', { class: 'li muted' }, L('Ничего не найдено')));
    } catch (e) { results.replaceChildren(h('div', { class: 'li muted' }, e.message)); }
  }, 300));
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
  inputs.items = { get value() { return chosen.map((r) => ({ id: r.id, count: +r.cnt.value || 1 })); } };
  return h('div', { class: 'field' }, h('span', null, L('Предметы')), search, results, rows);
}

function collect(inputs) {
  const out = {};
  for (const [k, el] of Object.entries(inputs)) out[k] = el.type === 'checkbox' ? el.checked : el.value;
  return out;
}

/* Универсальное окно действия: поля → кнопка → ответ ядра прямо в окне.
   Ответ показываем всегда: ядро пишет, что именно сделало или почему нет. */
function formModal({ title, text, fields = [], submit = L('Выполнить'), danger = false, wide = false, onSubmit, onDone }) {
  const inputs = {};
  const out = h('div');
  const btn = h('button', { class: 'btn ' + (danger ? 'dng' : 'pri'), type: 'submit' }, submit);
  let close;
  const form = h('form', { class: 'modal' + (wide ? ' wide' : '') },
    h('div', { class: 'modal-h' },
      h('div', null, h('h3', null, title), text ? h('p', null, text) : null),
      h('button', { class: 'btn ghost sm x', type: 'button', 'aria-label': L('Закрыть'), onclick: () => close() }, icon('x'))),
    h('div', { class: 'modal-b' }, h('div', { class: 'form' }, fields.map((f) => fieldEl(f, inputs)), out)),
    h('div', { class: 'modal-f' },
      h('button', { class: 'btn', type: 'button', onclick: () => close() }, L('Закрыть')), btn));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = L('Выполняю…');
    out.replaceChildren();
    try {
      const res = await onSubmit(collect(inputs));
      if (res instanceof Node) out.replaceChildren(res);
      else if (res) out.replaceChildren(resultView(res));
      if (onDone && (!res || res.success !== false)) onDone(res);
    } catch (err) {
      out.replaceChildren(resultView({ success: false, output: err.message }));
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  });
  close = openOverlay(form);
  const first = form.querySelector('input:not([type=checkbox]), textarea, select') || btn;
  setTimeout(() => first.focus(), 30);
  return close;
}

function infoModal(title, node) {
  let close;
  const box = h('div', { class: 'modal' },
    h('div', { class: 'modal-h' }, h('div', null, h('h3', null, title)),
      h('button', { class: 'btn ghost sm x', type: 'button', 'aria-label': L('Закрыть'), onclick: () => close() }, icon('x'))),
    h('div', { class: 'modal-b' }, node),
    h('div', { class: 'modal-f' }, h('button', { class: 'btn pri', type: 'button', onclick: () => close() }, L('Понятно'))));
  close = openOverlay(box);
}

async function cmdAction(action, payload) {
  const r = await api('/api/character/action', { action, ...payload });
  return r.data;
}

// ============================================================ строительные блоки

function card(title, hint, actions, ...body) {
  return h('section', { class: 'card' },
    title ? h('div', { class: 'card-h' },
      h('h3', null, title, hint ? h('span', { class: 'hint' }, '  ' + hint) : null),
      actions ? h('div', { class: 'row' }, actions) : null) : null,
    ...body);
}

/* Карточку сворачивает щелчок по заголовку; что свёрнуто — помнит браузер (по ключу key) */
function foldCard(el, key) {
  const head = el && el.querySelector(':scope > .card-h');
  if (!head) return el;
  const folded = () => new Set(pref.get('fold', '').split(',').filter(Boolean));
  el.classList.add('foldable');
  el.classList.toggle('folded', folded().has(key));
  head.title = L('Свернуть или развернуть');
  head.addEventListener('click', (e) => {
    if (e.target.closest('button, a, input, select, label')) return;
    const f = folded();
    if (el.classList.toggle('folded')) f.add(key); else f.delete(key);
    pref.set('fold', [...f].join(','));
  });
  return el;
}

/* Выбор месяца: щелчок по «Октябрь 2026» — окошко с годом ‹ › и двенадцатью месяцами
   (yearsOnly — только годы). marks(y, m) — подсветить месяцы, где что-то есть. onPick(y, m). */
function monthPicker(anchor, { year, month, yearsOnly, marks }, onPick) {
  document.querySelectorAll('.mpick').forEach((p) => p.remove());
  const now = new Date();
  let y = year;
  const pop = h('div', { class: 'mpick', role: 'dialog' });
  const close = () => {
    pop.remove();
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('keydown', esc, true);
    window.removeEventListener('scroll', onScroll, true);
  };
  const outside = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
  const esc = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } };
  const onScroll = (e) => { if (!pop.contains(e.target)) close(); };
  const arrow = (label, dy) => h('button', { class: 'btn sm', type: 'button', 'aria-label': label, onclick: () => { y += dy; draw(); } }, dy < 0 ? '‹' : '›');
  const cell = (label, on, has, isNow, pick) => h('button', { type: 'button', class: [on ? 'on' : '', has ? 'has' : '', isNow ? 'now' : ''].join(' ').trim() || null,
    onclick: () => { close(); pick(); } }, label);
  const draw = () => {
    if (yearsOnly) {
      const y0 = y - 5;
      fill(pop, h('div', { class: 'mpick-h' }, arrow(L('Раньше'), -12), h('b', null, `${y0} – ${y0 + 11}`), arrow(L('Позже'), 12)),
        h('div', { class: 'mpick-g' }, [...Array(12)].map((_, i) => cell(String(y0 + i), y0 + i === year, false, y0 + i === now.getFullYear(), () => onPick(y0 + i, null)))));
      return;
    }
    fill(pop, h('div', { class: 'mpick-h' }, arrow(L('Прошлый год'), -1), h('b', null, String(y)), arrow(L('Следующий год'), 1)),
      h('div', { class: 'mpick-g' }, [...Array(12)].map((_, m) => cell(new Date(y, m, 1).toLocaleDateString(LOCALE, { month: 'short' }).replace('.', ''),
        y === year && m === month, marks && marks(y, m), y === now.getFullYear() && m === now.getMonth(), () => onPick(y, m)))));
  };
  draw();
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = Math.round(r.bottom + 6) + 'px';
  pop.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left + r.width / 2 - pop.offsetWidth / 2))) + 'px';
  setTimeout(() => {
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', esc, true);
    window.addEventListener('scroll', onScroll, true);
  }, 0);
}
function monthButton(label, open, extra) {
  return h('button', { class: 'mpick-btn' + (extra ? ' ' + extra : ''), type: 'button', title: L('Выбрать месяц и год'),
    onclick: (e) => open(e.currentTarget) }, h('span', null, label), h('span', { class: 'mpick-caret' }, '▾'));
}

function tile(label, value, detail, extra) {
  return h('div', { class: 'tile' + (extra ? ' ' + extra : '') },
    h('div', { class: 'l' }, label), h('div', { class: 'v' }, value), detail ? h('div', { class: 'd' }, detail) : null);
}

function badge(text, kind) { return h('span', { class: 'badge' + (kind ? ' ' + kind : '') }, text); }

function facts(pairs) {
  return h('dl', { class: 'facts' }, pairs.filter(Boolean).map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v ?? '—'))));
}

function meter(frac) {
  const f = Math.max(0, Math.min(1, frac || 0));
  const bar = h('i', { class: f > 0.9 ? 'bad' : f > 0.75 ? 'warn' : null });
  bar.style.width = (f * 100).toFixed(1) + '%';
  return h('div', { class: 'meter', role: 'meter', 'aria-valuenow': Math.round(f * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 }, bar);
}

/* Таблица: cols = [{key, label, cls, sort, render(row)}] */
function table({ cols, rows, onRow, sort, onSort, empty = L('Пусто') }) {
  if (!rows || !rows.length) return h('div', { class: 'empty' }, empty);
  const head = h('tr', null, cols.map((c) => {
    const th = h('th', { class: [c.cls || '', c.sort ? 'sort' : '', sort && sort.key === c.sort ? 'on' : '',
                                 sort && sort.key === c.sort && sort.dir === 'asc' ? 'asc' : ''].join(' ').trim() || null }, c.label);
    if (c.sort && onSort) th.addEventListener('click', () => onSort(c.sort));
    return th;
  }));
  const body = h('tbody', null, rows.map((r) => {
    const tr = h('tr', { class: onRow ? 'click' : null }, cols.map((c) => {
      const v = c.render ? c.render(r) : r[c.key];
      return h('td', { class: c.cls || null }, v == null ? '—' : v);
    }));
    if (onRow) tr.addEventListener('click', (e) => { if (!e.target.closest('button, a, input, select')) onRow(r); });
    return tr;
  }));
  return h('div', { class: 'tbl-wrap' }, h('table', { class: 'data' }, h('thead', null, head), body));
}

function pager(total, limit, offset, go) {
  if (total <= limit) return total ? h('div', { class: 'pager' }, L('Всего: {0}', fmtN(total))) : null;
  const page = Math.floor(offset / limit) + 1, pages = Math.ceil(total / limit);
  return h('div', { class: 'pager' },
    L('{0}–{1} из {2}', fmtN(offset + 1), fmtN(Math.min(total, offset + limit)), fmtN(total)),
    h('button', { class: 'btn sm', disabled: page <= 1, onclick: () => go(offset - limit) }, '←'),
    `${page} / ${pages}`,
    h('button', { class: 'btn sm', disabled: page >= pages, onclick: () => go(offset + limit) }, '→'));
}

function tabs(items, active, onChange) {
  const bar = h('div', { class: 'tabs', role: 'tablist' });
  for (const [key, label] of items) {
    bar.append(h('button', { class: key === active ? 'on' : null, type: 'button', role: 'tab',
                             'aria-selected': key === active ? 'true' : 'false', onclick: () => onChange(key) }, label));
  }
  return bar;
}

function seg(items, active, onChange) {
  return h('div', { class: 'seg', role: 'group' }, items.map(([key, label]) =>
    h('button', { class: key === active ? 'on' : null, type: 'button', 'aria-pressed': key === active ? 'true' : 'false',
                  onclick: () => onChange(key) }, label)));
}

function charCell(r, opts = {}) {
  return h('span', { class: 'name-cell' },
    r.race && r.class ? charIcons(r) : r.faction ? h('i', { class: 'fac ' + r.faction, title: FACTION[r.faction] }) : null,
    opts.link === false ? h('b', null, r.name) : h('a', { href: '#', onclick: (e) => { e.preventDefault(); charDrawer(r.guid); } }, r.name),
    r.online ? badge(L('в игре'), 'ok') : null);
}

function accLink(id, name) {
  if (!id) return name || '—';
  return h('a', { href: '#', onclick: (e) => { e.preventDefault(); accountDrawer(id); } }, name || ('#' + id));
}

function errorCard(e) {
  return h('div', { class: 'alert critical' }, icon('warn'), h('span', null, e.message || String(e)));
}

// ============================================================ графики
/* Правила: одна ось, тонкие метки, столбики не толще 24px со скруглением 4px
   сверху, линия 2px, подсказка при наведении, таблица-дубль для каждого
   графика. Цвета — через классы CSS, чтобы тема менялась без перерисовки. */

const liveCharts = new Set();
window.addEventListener('resize', debounce(() => {
  for (const c of liveCharts) { if (c.el.isConnected) c.draw(); else liveCharts.delete(c); }
}, 150));

function mountChart(el, draw) {
  const c = { el, draw };
  liveCharts.add(c);
  // Не requestAnimationFrame: в свёрнутом окне он не срабатывает вовсе, и графики
  // оставались пустыми. Таймер выполнится сразу после того, как страница собрана.
  setTimeout(draw, 0);
  return c;
}

function nice(max) {
  if (!(max > 0)) return { max: 1, step: 1 };
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  let step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  if (step < 1) step = 1;
  return { max: Math.ceil(max / step) * step, step };
}

const tipEl = () => $('#tip');
function showTip(e, value, label, key) {
  const t = tipEl();
  t.replaceChildren(h('b', null, value), h('div', { class: 'k' }, key ? h('i') : null, label));
  t.hidden = false;
  const pad = 14, w = t.offsetWidth, hh = t.offsetHeight;
  let x = e.clientX + pad, y = e.clientY - hh - pad;
  if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
  if (y < 8) y = e.clientY + pad;
  t.style.left = x + 'px';
  t.style.top = y + 'px';
}
function hideTip() { tipEl().hidden = true; }

function svgPoint(svg, e, W) {
  const r = svg.getBoundingClientRect();
  return (e.clientX - r.left) * (W / r.width);
}

function yAxis(svg, m, W, y, max, step, fmt = fmtN) {
  for (let v = 0; v <= max + 1e-9; v += step) {
    svg.append(s('line', { class: v === 0 ? 'c-base' : 'c-grid', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
    svg.append(s('text', { class: 'c-tick', x: m.l - 7, y: y(v) + 4, 'text-anchor': 'end' }, fmt(v)));
  }
}

function lineChart(el, pts, opt = {}) {
  const fmtV = opt.fmtV || fmtN;
  const fmtT = opt.fmtT || ((t) => fmtDT(t, false));
  return mountChart(el, () => {
    el.replaceChildren();
    const data = (pts || []).filter((p) => p.v != null);
    if (data.length < 2) { el.append(h('div', { class: 'chart-empty' }, opt.empty || L('Пока нет данных'))); return; }
    const W = Math.max(280, el.clientWidth), H = opt.height || 210, m = { l: 40, r: 18, t: 14, b: 26 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const t0 = data[0].t, t1 = data[data.length - 1].t;
    const { max, step } = nice(Math.max(...data.map((p) => p.v)));
    const x = (t) => m.l + (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * iw);
    const y = (v) => m.t + ih - (v / max) * ih;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': opt.label || '' });
    yAxis(svg, m, W, y, max, step, opt.fmtAxis);
    const ticks = Math.max(2, Math.min(6, Math.floor(iw / 110)));
    for (let i = 0; i <= ticks; i++) {
      const t = t0 + ((t1 - t0) * i) / ticks;
      svg.append(s('text', { class: 'c-tick', x: x(t), y: H - 7, 'text-anchor': i === 0 ? 'start' : i === ticks ? 'end' : 'middle' },
                   (opt.fmtTick || fmtT)(t)));
    }
    let d = '', a = '';
    const gap = opt.gap || Infinity;
    let segStart = null, prev = null;
    for (const p of data) {
      const px = x(p.t).toFixed(1), py = y(p.v).toFixed(1);
      if (prev && p.t - prev.t > gap) {
        a += `L${x(prev.t).toFixed(1)},${y(0)}L${x(segStart.t).toFixed(1)},${y(0)}Z`;
        segStart = null;
      }
      if (!segStart) { d += `M${px},${py}`; a += `M${px},${py}`; segStart = p; } else { d += `L${px},${py}`; a += `L${px},${py}`; }
      prev = p;
    }
    a += `L${x(prev.t).toFixed(1)},${y(0)}L${x(segStart.t).toFixed(1)},${y(0)}Z`;
    svg.append(s('path', { class: 'c-area', d: a }), s('path', { class: 'c-line', d }));
    const last = data[data.length - 1];
    svg.append(s('circle', { class: 'c-dot', cx: x(last.t), cy: y(last.v), r: 4 }));
    const cross = s('line', { class: 'c-cross', y1: m.t, y2: m.t + ih, visibility: 'hidden' });
    const hot = s('circle', { class: 'c-dot', r: 5, visibility: 'hidden' });
    const hit = s('rect', { class: 'c-hit', x: m.l, y: m.t, width: iw, height: ih });
    svg.append(cross, hot, hit);
    hit.addEventListener('pointermove', (e) => {
      const t = t0 + ((svgPoint(svg, e, W) - m.l) / iw) * (t1 - t0);
      let lo = 0, hi = data.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (data[mid].t < t) lo = mid; else hi = mid; }
      const p = Math.abs(data[lo].t - t) < Math.abs(data[hi].t - t) ? data[lo] : data[hi];
      cross.setAttribute('x1', x(p.t)); cross.setAttribute('x2', x(p.t)); cross.setAttribute('visibility', 'visible');
      hot.setAttribute('cx', x(p.t)); hot.setAttribute('cy', y(p.v)); hot.setAttribute('visibility', 'visible');
      showTip(e, fmtV(p.v), fmtDT(p.t), true);
    });
    hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); hot.setAttribute('visibility', 'hidden'); hideTip(); });
    el.append(svg);
  });
}

function barTop(x, y, w, hgt, r) {
  r = Math.min(r, w / 2, hgt);
  return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
}

function barRight(x, y, w, hgt, r) {
  r = Math.min(r, hgt / 2, w);
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt - r}Q${x + w},${y + hgt} ${x + w - r},${y + hgt}H${x}Z`;
}

function columnChart(el, data, opt = {}) {
  const fmtV = opt.fmtV || fmtN;
  return mountChart(el, () => {
    el.replaceChildren();
    if (!data || !data.length || !data.some((d) => d.v > 0)) {
      el.append(h('div', { class: 'chart-empty' }, opt.empty || L('За этот период ничего нет'))); return;
    }
    const W = Math.max(280, el.clientWidth), H = opt.height || 200, m = { l: 40, r: 10, t: 18, b: 26 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const { max, step } = nice(Math.max(...data.map((d) => d.v)));
    const y = (v) => m.t + ih - (v / max) * ih;
    const band = iw / data.length;
    const bw = Math.max(1, Math.min(24, band - 2));
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': opt.label || '' });
    yAxis(svg, m, W, y, max, step);
    const every = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(iw / 46))));
    let top = data[0];
    for (const d of data) if (d.v > top.v) top = d;
    data.forEach((d, i) => {
      const cx = m.l + band * i + band / 2;
      if (d.v > 0) {
        const bar = s('path', { class: 'c-bar' + (opt.cls ? ' ' + opt.cls : ''), d: barTop(cx - bw / 2, y(d.v), bw, y(0) - y(d.v), 4) });
        svg.append(bar);
        if (d === top) svg.append(s('text', { class: 'c-val', x: cx, y: y(d.v) - 5, 'text-anchor': 'middle' }, fmtV(d.v)));
      }
      if (opt.labelFilter ? opt.labelFilter(d, i) : i % every === 0) {
        svg.append(s('text', { class: 'c-tick', x: cx, y: H - 7, 'text-anchor': 'middle' }, d.label));
      }
      const hit = s('rect', { class: 'c-hit', x: m.l + band * i, y: m.t, width: band, height: ih + 2 });
      hit.addEventListener('pointermove', (e) => showTip(e, fmtV(d.v), d.tip || d.label, true));
      hit.addEventListener('pointerleave', hideTip);
      svg.append(hit);
    });
    el.append(svg);
  });
}

function hbarChart(el, data, opt = {}) {
  const fmtV = opt.fmtV || fmtN;
  return mountChart(el, () => {
    el.replaceChildren();
    if (!data || !data.length) { el.append(h('div', { class: 'chart-empty' }, L('Нет данных'))); return; }
    const W = Math.max(260, el.clientWidth), row = 28, lw = 116, vw = 46;
    const H = data.length * row + 4, iw = W - lw - vw;
    const max = Math.max(...data.map((d) => d.v)) || 1;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': opt.label || '' });
    svg.append(s('line', { class: 'c-base', x1: lw, x2: lw, y1: 0, y2: H }));
    data.forEach((d, i) => {
      const yy = i * row + 7, bh = 14, bwid = Math.max(d.v > 0 ? 2 : 0, (d.v / max) * iw);
      svg.append(s('text', { class: 'c-lab', x: lw - 8, y: yy + 11, 'text-anchor': 'end' }, d.label));
      if (bwid > 0) svg.append(s('path', { class: 'c-bar' + (d.cls ? ' ' + d.cls : ''), d: barRight(lw, yy, bwid, bh, 4) }));
      svg.append(s('text', { class: 'c-val', x: lw + bwid + 6, y: yy + 11 }, fmtV(d.v)));
      const hit = s('rect', { class: 'c-hit', x: 0, y: i * row, width: W, height: row });
      hit.addEventListener('pointermove', (e) => showTip(e, fmtV(d.v), d.label + (d.share != null ? ` · ${fmtPct(d.share)}` : ''), true));
      hit.addEventListener('pointerleave', hideTip);
      svg.append(hit);
    });
    el.append(svg);
  });
}

function stackBar(el, parts) {
  return mountChart(el, () => {
    el.replaceChildren();
    const total = parts.reduce((a, p) => a + p.v, 0);
    if (!total) { el.append(h('div', { class: 'chart-empty' }, L('Нет данных'))); return; }
    const W = Math.max(260, el.clientWidth), H = 26, gap = 2;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img' });
    const live = parts.filter((p) => p.v > 0);
    const usable = W - gap * (live.length - 1);
    let x = 0;
    live.forEach((p, i) => {
      const w = (p.v / total) * usable;
      const r = 4, first = i === 0, last = i === live.length - 1;
      const d = `M${x + (first ? r : 0)},0H${x + w - (last ? r : 0)}${last ? `Q${x + w},0 ${x + w},${r}V${H - r}Q${x + w},${H} ${x + w - r},${H}` : `V${H}`}` +
                `H${x + (first ? r : 0)}${first ? `Q${x},${H} ${x},${H - r}V${r}Q${x},0 ${x + r},0` : `V0`}Z`;
      const seg = s('path', { class: 'c-bar ' + (p.cls || ''), d });
      seg.addEventListener('pointermove', (e) => showTip(e, fmtN(p.v), `${p.label} · ${fmtPct((p.v / total) * 100)}`, true));
      seg.addEventListener('pointerleave', hideTip);
      svg.append(seg);
      x += w + gap;
    });
    el.append(svg, h('div', { class: 'legend' }, parts.map((p) =>
      h('span', null, h('i', { class: p.cls === 's2' ? 's2' : 's1' }), `${p.label}: ${fmtN(p.v)} (${fmtPct((p.v / total) * 100)})`))));
  });
}

function chartCard(title, hint, build, tableSpec) {
  const box = h('div', { class: 'chart' });
  const holder = h('div', { class: 'tbl-wrap', hidden: true });
  let btn = null;
  if (tableSpec) {
    btn = h('button', { class: 'btn ghost sm tbl-toggle', type: 'button' }, L('Таблица'));
    btn.addEventListener('click', () => {
      holder.hidden = !holder.hidden;
      btn.textContent = holder.hidden ? L('Таблица') : L('Скрыть таблицу');
      if (!holder.hidden && !holder.firstChild) {
        holder.append(table({ cols: tableSpec.head.map((label, i) => ({ label, cls: i ? 'r' : null, render: (r) => r[i] })),
                              rows: tableSpec.rows, empty: L('Нет данных') }));
      }
    });
  }
  const c = card(title, hint, btn, h('div', { class: 'card-b' }, box, holder));
  build(box);
  return c;
}

// ============================================================ каркас и маршруты

const PAGES = {};
const NAV = [
  ['overview', L('Обзор')], ['online', L('Онлайн')], ['accounts', L('Аккаунты')], ['characters', L('Персонажи')], ['worldmap', L('Карта мира')],
  ['items', L('Предметы')], ['npcs', L('Свои НПС')], ['quests', L('Свои задания')], ['events', L('События')],
  ['bans', L('Модерация')], ['stats', L('Статистика')], ['server', L('Сервер')], ['bots', L('Боты')], ['logs', L('Логи')],
  ['console', L('Консоль')], ['audit', L('Журнал')], ['settings', L('Настройки')],
];
let pageTimers = [];
let navOnline = null;
// Название сервера, адрес и ссылка «Все панели» — из .env (PANEL_TITLE, PANEL_ADDRESS, PANEL_HUB); что есть на
// сервере — bots (модуль playerbots), music и art (файлы из клиента и Fan Site Kit), container — от panel.py
const SITE = { title: 'WoW Server', address: '', hub: null, bots: false, music: false, art: false, container: false };
const memLabel = () => (SITE.container ? L('Память контейнера') : L('Память сервера'));
const cpuNote = (n) => (SITE.container ? L('контейнер, {0} ядер', n) : L('{0} ядер', n));

// ============================================================ оформление и музыка
/* Два оформления: «Как в WoW» (по умолчанию — шрифты и музыка из клиента игры, арт из
   официального Fan Site Kit) и «Обычный» — прежний вид панели со светлой и тёмной темой.
   Выбор хранится в браузере (localStorage), ставит его boot.js ещё до отрисовки. */

const pref = {
  get(k, d) { try { const v = localStorage.getItem('wowpanel-' + k); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('wowpanel-' + k, v); } catch (e) { /* приватный режим */ } },
  del(k) { try { localStorage.removeItem('wowpanel-' + k); } catch (e) { /* приватный режим */ } },
};
const PREF_KEYS = ['lang', 'style', 'bg', 'theme', 'music', 'volume', 'muted', 'player'];
const BGS = [['portal', L('Тёмный портал')], ['gryphon', L('Грифон')], ['ironforge', L('Стальгорн')], ['nightelves', L('Ночные эльфы')]];
const MUSIC = [['main', L('Главная тема')], ['stormwind', L('Штормград')], ['elwynn', L('Элвиннский лес')], ['ironforge', L('Стальгорн')],
  ['dunmorogh', L('Дун Морог')], ['darnassus', L('Дарнас')], ['tavern-a', L('Таверна Альянса')], ['orgrimmar', L('Оргриммар')],
  ['barrens', L('Степи')], ['thunderbluff', L('Громовой Утёс')], ['undercity', L('Подгород')], ['tavern-h', L('Таверна Орды')],
  ['mulgore', L('Мулгор')]];
const LEGAL = L('World of Warcraft® и Blizzard Entertainment® — товарные знаки Blizzard Entertainment в США и других странах. '
  + 'Музыка, шрифты и картинки — из клиента игры и официального набора Fan Site Kit, © Blizzard Entertainment. '
  + 'Панель никак не связана с Blizzard Entertainment.');

const styleNow = () => (document.documentElement.getAttribute('data-style') === 'plain' ? 'plain' : 'wow');

function applyTheme() {
  const d = document.documentElement;
  d.setAttribute('data-style', pref.get('style', 'wow') === 'plain' ? 'plain' : 'wow');
  d.setAttribute('data-bg', BGS.some(([k]) => k === pref.get('bg')) ? pref.get('bg') : 'portal');
  const t = pref.get('theme');
  if (t === 'light' || t === 'dark') d.setAttribute('data-theme', t);
}

function redrawCharts() { for (const c of liveCharts) if (c.el.isConnected) c.draw(); }

function setStyle(k) {
  pref.set('style', k);
  document.documentElement.setAttribute('data-style', k);
  redrawCharts();
}

function setBg(k) {
  pref.set('bg', k);
  document.documentElement.setAttribute('data-bg', k);
}

/* Музыка играет по кругу: первой — главная тема из меню входа, дальше вперемешку.
   Браузер не даёт включить звук, пока человек ничего не нажал, поэтому первая мелодия
   начинается с первого клика или клавиши (если музыка не выключена). */
const music = {
  audio: null, order: [], idx: 0, started: false, listeners: new Set(),
  // играть ли с первого клика: плеер не убран и музыку не ставили на паузу
  wanted() { return playerOn() && pref.get('music', 'on') === 'on'; },
  volume() { const v = Number(pref.get('volume', '0.35')); return isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.35; },
  init() {
    if (this.audio) return;
    const a = new Audio();
    a.preload = 'none';
    a.volume = this.volume();
    a.muted = this.muted();
    a.addEventListener('ended', () => this.next());
    a.addEventListener('play', () => this.emit());
    a.addEventListener('pause', () => this.emit());
    a.addEventListener('error', () => { if (this.started) setTimeout(() => this.next(), 1500); });
    this.audio = a;
    const rest = MUSIC.slice(1).map((_, i) => i + 1);
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    this.order = [0, ...rest];
    const kick = (e) => {
      if (e.target && e.target.closest && e.target.closest('[data-music]')) return;
      if (this.wanted() && !this.started) this.play();
    };
    document.addEventListener('pointerdown', kick, true);
    document.addEventListener('keydown', kick, true);
  },
  track() { return MUSIC[this.order[this.idx % this.order.length]] || MUSIC[0]; },
  load() { this.audio.src = `/static/music/${this.track()[0]}.mp3`; },
  play() {
    this.init();
    if (!this.audio.getAttribute('src')) this.load();
    this.started = true;
    this.audio.play().catch(() => { this.started = false; this.emit(); });
    this.emit();
  },
  playing() { return !!(this.audio && !this.audio.paused); },
  toggle() {
    const on = !this.playing();
    pref.set('music', on ? 'on' : 'off');
    if (on) this.play(); else if (this.audio) this.audio.pause();
    this.emit();
  },
  next() { this.step(1); },
  prev() { this.step(-1); },
  step(dir) {
    this.init();
    this.idx = (this.idx + dir + this.order.length) % this.order.length;
    this.load();
    // кнопки «назад/вперёд» включают музыку, даже если она стояла на паузе
    pref.set('music', 'on');
    this.started = true;
    this.audio.play().catch(() => { this.started = false; this.emit(); });
    this.emit();
  },
  muted() { return pref.get('muted', '0') === '1'; },
  toggleMute() {
    const m = !this.muted();
    pref.set('muted', m ? '1' : '0');
    if (this.audio) this.audio.muted = m;
    this.emit();
  },
  pick(n) {
    this.init();
    const at = this.order.indexOf(n);
    this.idx = at >= 0 ? at : 0;
    this.load();
    pref.set('music', 'on');
    this.play();
  },
  setVolume(v) {
    pref.set('volume', String(v));
    if (this.audio) this.audio.volume = v;
    if (v > 0 && this.muted()) this.toggleMute();      // подвинули громкость — значит, звук нужен
  },
  emit() {
    for (const fn of [...this.listeners]) {
      if (fn.el && !fn.el.isConnected) this.listeners.delete(fn); else fn();
    }
  },
  watch(el, fn) { fn.el = el; this.listeners.add(fn); fn(); },
};

/* Плеер внизу меню — компактный: строка с названием мелодии (крестик справа убирает плеер)
   и строка кнопок «назад», «играть/пауза», «вперёд», «звук» с ползунком громкости; что делает
   кнопка — видно по наведению. Убранный плеер не играет музыку; вернуть — в «Настройках». */
const playerOn = () => SITE.music && pref.get('player', 'on') !== 'off';

function setPlayer(on) {
  pref.set('player', on ? 'on' : 'off');
  if (!on) {
    if (music.audio) music.audio.pause();
    music.started = false;      // вернут плеер — музыка снова начнётся с первого клика
  }
  for (const slot of document.querySelectorAll('.mus-slot')) slot.replaceChildren(...(on ? [musicWidget()] : []));
  music.emit();
}

function musicWidget() {
  const b = (ic, label, fn, cls = '') => h('button', { class: 'btn mus-b' + cls, type: 'button', 'data-music': '1', title: label, 'aria-label': label, onclick: fn },
    icon(ic));
  const title = h('span', { class: 'mus-name' });
  const play = b('play', L('Играть'), () => music.toggle(), ' mus-play');
  const mute = b('volume', L('Выключить звук'), () => music.toggleMute());
  const vol = h('input', { type: 'range', class: 'mus-vol', min: 0, max: 1, step: 0.05, 'data-music': '1', 'aria-label': L('Громкость'), title: L('Громкость') });
  vol.addEventListener('input', () => music.setVolume(Number(vol.value)));
  const hide = b('x', L('Убрать плеер — вернуть можно в «Настройках»'), () => {
    setPlayer(false);
    toast(L('Плеер убран, музыка не играет. Вернуть — в «Настройках».'));
  }, ' mus-x');
  const box = h('div', { class: 'mus', 'data-music': '1' },
    h('div', { class: 'mus-head' }, icon('note'), title, hide),
    h('div', { class: 'mus-ctrl' }, b('prev', L('Предыдущая мелодия'), () => music.prev()), play,
      b('next', L('Следующая мелодия'), () => music.next()), mute, vol));
  music.watch(box, () => {
    const on = music.playing(), muted = music.muted();
    play.replaceChildren(icon(on ? 'pause' : 'play'));
    play.title = on ? L('Пауза') : L('Играть');
    play.setAttribute('aria-label', play.title);
    play.classList.toggle('on', on);
    mute.replaceChildren(icon(muted ? 'mute' : 'volume'));
    mute.title = muted ? L('Включить звук') : L('Выключить звук');
    mute.setAttribute('aria-label', mute.title);
    mute.classList.toggle('off', muted);
    vol.value = String(music.volume());
    title.textContent = on ? (muted ? L('{0} — звук выключен', music.track()[1]) : music.track()[1])
      : music.wanted() ? L('Музыка начнётся с первого клика') : L('Музыка на паузе');
    title.title = title.textContent;
  });
  return box;
}

// ============================================================ Настройки
/* Язык, оформление и музыка — всё хранится в этом браузере (localStorage). Та же страница
   открывается окном и с экрана входа. Язык меняется перезагрузкой: словарь подключает boot.js. */

const LANGS = window.PANEL_LANGS || [['ru', 'Русский', 'ru-RU']];

function setLang(code) {
  if (code) pref.set('lang', code); else pref.del('lang');
  location.reload();
}

function settingsView(inModal) {
  const box = h('div', { class: 'settings' + (inModal ? ' in-modal' : ''), 'data-music': '1' });
  const draw = () => {
    const style = styleNow();
    const chosen = pref.get('lang', '');
    const langName = (LANGS.find(([c]) => c === LANG) || [LANG, LANG])[1];
    const langCard = card(L('Язык'), LANG === 'en' ? null : 'Language', null, h('div', { class: 'card-b stack' },
      h('div', { class: 'lang-pick' },
        h('button', { type: 'button', class: 'chip' + (chosen ? '' : ' on'), onclick: () => setLang('') }, icon('globe'), L('Как в браузере')),
        LANGS.map(([code, name]) => h('button', { type: 'button', lang: code, class: 'chip' + (chosen === code ? ' on' : '') + (LANG === code ? ' cur' : ''),
                                                  onclick: () => setLang(code) }, name))),
      h('p', { class: 'muted small' }, L('Сейчас: {0}. Переводы — в файлах static/i18n/<код>.js, их можно поправить.', langName))));

    const lookCard = card(L('Оформление'), null, null, h('div', { class: 'card-b stack' },
      h('div', { class: 'field' }, h('span', null, L('Стиль')),
        seg([['wow', L('Как в World of Warcraft')], ['plain', L('Обычный (прежний)')]], style, (k) => { setStyle(k); draw(); })),
      style === 'wow'
        ? SITE.art && h('div', { class: 'field' }, h('span', null, L('Фон')), h('div', { class: 'bg-pick' }, BGS.map(([k, l]) =>
          h('button', { type: 'button', class: `bg-opt bg-${k}${document.documentElement.getAttribute('data-bg') === k ? ' on' : ''}`,
                        onclick: () => { setBg(k); draw(); } }, h('span', null, l)))))
        : h('div', { class: 'field' }, h('span', null, L('Тема')),
          seg([['light', L('Светлая')], ['dark', L('Тёмная')]], document.documentElement.getAttribute('data-theme')
            || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'), (k) => {
            document.documentElement.setAttribute('data-theme', k); pref.set('theme', k); redrawCharts(); draw(); }))));

    const on = playerOn();
    const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: music.volume(), 'aria-label': L('Громкость') });
    vol.addEventListener('input', () => music.setVolume(Number(vol.value)));
    const tracks = h('div', { class: 'tracks' }, MUSIC.map(([, title], n) => {
      const cur = music.playing() && music.track()[1] === title;
      return h('button', { type: 'button', class: 'chip' + (cur ? ' on' : ''), onclick: () => music.pick(n) }, cur ? '♪ ' + title : title);
    }));
    const musicCard = !SITE.music ? card(L('Музыка из игры'), null, null, h('div', { class: 'card-b stack' },
      h('p', { class: 'muted small' }, L('Музыки на сервере нет. Её можно собрать из своего клиента игры: tools/build_assets.py (см. README).'))))
      : card(L('Музыка из игры'), null, null, h('div', { class: 'card-b stack' },
      h('div', { class: 'field' }, h('span', null, L('Плеер в меню')),
        seg([['on', L('Показывать')], ['off', L('Убрать, музыку не играть')]], on ? 'on' : 'off', (k) => setPlayer(k === 'on'))),
      on ? [
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn' + (music.playing() ? '' : ' pri'), onclick: () => music.toggle() },
            icon(music.playing() ? 'pause' : 'play'), music.playing() ? L('Пауза') : L('Играть')),
          h('button', { type: 'button', class: 'btn', onclick: () => music.toggleMute() },
            icon(music.muted() ? 'mute' : 'volume'), music.muted() ? L('Включить звук') : L('Выключить звук')),
          h('label', { class: 'vol' }, L('Громкость'), vol)),
        h('div', { class: 'field' }, h('span', null, L('Мелодии')), tracks),
      ] : h('p', { class: 'muted small' }, L('Плеер убран, музыка не играет. Выберите «Показывать», чтобы вернуть.'))));

    const resetCard = card(L('Сброс'), null, null, h('div', { class: 'card-b stack' },
      h('p', { class: 'muted small' }, L('Настройки хранятся только в этом браузере. Сброс вернёт язык браузера, стиль «Как в WoW», первый фон и плеер с музыкой.')),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => { PREF_KEYS.forEach((k) => pref.del(k)); location.reload(); } },
        icon('refresh'), L('Сбросить настройки')))));

    box.replaceChildren(
      h('div', { class: inModal ? 'stack' : 'grid g2 settings-grid' }, langCard, lookCard, musicCard, resetCard),
      h('p', { class: 'legal' }, LEGAL));
  };
  music.watch(box, draw);
  return box;
}

function settingsModal() {
  infoModal(L('Настройки'), settingsView(true));
}

function shell() {
  navOnline = h('span', { class: 'count' });
  const nav = h('nav', { class: 'nav', 'aria-label': L('Разделы') }, NAV.filter(([key]) => key !== 'bots' || SITE.bots).map(([key, label]) =>
    h('a', { href: '#/' + key, 'data-page': key }, icon(key), label, key === 'online' ? navOnline : null)));
  // Своя страница-список панелей (PANEL_HUB в .env): «:8089» — тот же адрес, другой порт
  const hub = SITE.hub ? (SITE.hub[0] === ':' ? `${location.protocol}//${location.hostname}${SITE.hub}/` : SITE.hub) : null;
  const side = h('aside', { class: 'side' },
    h('div', { class: 'brand' }, h('b', null, SITE.title), h('span', null, L('WoW 1.12.1 · панель'))),
    nav,
    h('div', { class: 'side-foot' },
      h('div', { class: 'mus-slot' }, playerOn() ? musicWidget() : null),
      h('div', { id: 'side-status' }, SITE.address),
      h('div', { class: 'row' },
        h('button', { class: 'btn sm', type: 'button', onclick: logout }, icon('logout'), L('Выйти'))),
      hub ? h('a', { class: 'btn hub-back', href: hub, title: L('Список всех панелей сервера') },
        icon('back'), L('Все панели')) : null));
  const main = h('main', { class: 'main' },
    h('div', { class: 'top' }, h('div', null, h('h1', { id: 'page-title' }), h('div', { class: 'sub', id: 'page-sub' })),
      h('div', { class: 'tools', id: 'page-tools' })),
    h('div', { id: 'page' }));
  $('#app').replaceChildren(h('div', { class: 'shell' }, side, main));
}

function every(ms, fn) { pageTimers.push(setInterval(fn, ms)); }

async function route() {
  if (!$('.shell')) return;
  pageTimers.forEach(clearInterval);
  pageTimers = [];
  hideTip();
  const m = location.hash.match(/^#\/([a-z]+)/);
  const name = m && PAGES[m[1]] && (m[1] !== 'bots' || SITE.bots) ? m[1] : 'overview';
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.page === name));
  const page = PAGES[name];
  $('#page-title').textContent = page.title;
  $('#page-sub').textContent = page.sub || '';
  $('#page-tools').replaceChildren();
  const el = $('#page');
  el.replaceChildren(h('div', { class: 'empty' }, L('Загружаю…')));
  document.title = page.title + L(' — WoW-панель');
  try {
    await page.render(el);
  } catch (e) {
    el.replaceChildren(errorCard(e));
  }
}

window.addEventListener('hashchange', route);

function setTools(...nodes) { $('#page-tools').replaceChildren(...nodes); }

function refreshBtn(fn) {
  return h('button', { class: 'btn', type: 'button', onclick: fn }, icon('refresh'), L('Обновить'));
}

// ============================================================ вход

function showLogin(message) {
  pageTimers.forEach(clearInterval);
  pageTimers = [];
  while (overlays.length) overlays[overlays.length - 1]();
  const pw = h('input', { class: 'inp', type: 'password', autocomplete: 'current-password', placeholder: L('Пароль панели') });
  pw.style.width = '100%';
  const err = h('div', { class: 'err' }, message || '');
  const btn = h('button', { class: 'btn pri', type: 'submit' }, L('Войти'));
  btn.style.width = '100%';
  btn.style.marginTop = '12px';
  const form = h('form', { class: 'card' },
    h('h1', null, SITE.title),
    h('p', null, L('Панель управления WoW-сервером.')),
    pw, btn, err,
    h('div', { class: 'login-foot' }, h('div', { class: 'mus-slot' }, playerOn() ? musicWidget() : null),
      h('button', { class: 'btn sm ghost', type: 'button', 'data-music': '1', onclick: settingsModal }, icon('settings'), L('Настройки'))),
    h('p', { class: 'legal wow-only' }, LEGAL));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true;
    err.textContent = '';
    try {
      await api('/api/login', { password: pw.value });
      startApp();
    } catch (ex) {
      err.textContent = ex.message;
      pw.select();
    } finally { btn.disabled = false; }
  });
  $('#app').replaceChildren(h('div', { class: 'login' }, form));
  setTimeout(() => pw.focus(), 30);
}

async function logout() {
  try { await api('/api/logout', {}); } catch (e) { /* всё равно выходим */ }
  showLogin();
}

function startApp() {
  shell();
  if (!location.hash) location.hash = '#/overview';
  route();
}

async function boot() {
  document.title = L('{0} — панель', SITE.title);
  const wait = $('#app .boot');
  if (wait) wait.textContent = L('Загрузка панели…');
  applyTheme();
  music.init();
  try {
    const r = await api('/api/session');
    Object.assign(SITE, r.data.site || {});
    document.title = L('{0} — панель', SITE.title);
    if (r.data.authed) startApp(); else showLogin();
  } catch (e) {
    $('#app').replaceChildren(h('div', { class: 'login' }, h('div', { class: 'card' }, h('h1', null, L('Нет связи')), h('p', null, e.message))));
  }
}

// ============================================================ Обзор

function parseCoreUptime(text) {
  if (!text) return null;
  const get = (re) => { const m = text.match(re); return m ? +m[1] : 0; };
  const sec = get(/(\d+)\s*Day/i) * 86400 + get(/(\d+)\s*Hour/i) * 3600 + get(/(\d+)\s*Minute/i) * 60 + get(/(\d+)\s*Second/i);
  return sec || null;
}

function serviceTable(services, reload) {
  return table({
    cols: [
      { label: L('Служба'), render: (r) => h('span', { class: 'name-cell' }, h('i', { class: 'dot ' + (r.running ? 'ok' : 'bad') }), r.label) },
      { label: L('Состояние'), render: (r) => (r.running ? L('работает') : L('не запущена')) },
      { label: L('Время работы'), cls: 'r', render: (r) => (r.running ? fmtDur(r.age) : '—') },
      { label: L('Память'), cls: 'r', render: (r) => fmtBytes(r.rss) },
      { label: 'CPU', cls: 'r', render: (r) => (r.cpu == null ? '—' : fmtPct(r.cpu)) },
      { label: '', cls: 'r', render: (r) => (r.restartable ? h('button', { class: 'btn sm', type: 'button', onclick: () => restartService(r, reload) }, L('Перезапустить')) : null) },
    ],
    rows: services,
  });
}

function restartService(svc, reload) {
  const world = svc.name === 'mangosd';
  formModal({
    title: L('Перезапустить: {0}', svc.label),
    text: world
      ? L('Мир сохранит всех персонажей, предупредит игроков в чате и завершится с кодом перезапуска — systemd или ваш скрипт запуска поднимет его снова.')
      : L('Процесс будет остановлен — systemd или ваш скрипт запуска поднимет службу снова.'),
    fields: world ? [{ name: 'delay', label: L('Через сколько секунд'), type: 'select', value: '60',
                       options: [['10', L('10 секунд')], ['60', L('1 минута')], ['300', L('5 минут')], ['900', L('15 минут')]] }] : [],
    submit: L('Перезапустить'), danger: true,
    onSubmit: async (v) => (await api('/api/server', { action: 'service_restart', service: svc.name, delay: v.delay })).data,
    onDone: () => setTimeout(reload, 6000),
  });
}

PAGES.overview = {
  title: L('Обзор'), sub: L('Состояние сервера сейчас. Обновляется каждые 15 секунд.'),
  async render(el) {
    const load = async () => {
      const d = (await api('/api/overview')).data;
      const c = d.counts;
      if (navOnline) navOnline.textContent = c.online ? c.online : '';
      const up = parseCoreUptime(d.server.uptime) || (d.session && d.session.uptime);
      const memFrac = d.container.mem && d.container.limit ? d.container.mem / d.container.limit : null;
      const diskUsed = d.host.disk_total ? 1 - d.host.disk_free / d.host.disk_total : null;
      $('#side-status') && ($('#side-status').textContent = d.realm ? `${d.realm.name}` : SITE.address);

      const alerts = d.alerts.length ? h('div', { class: 'alerts' }, d.alerts.map((a) =>
        h('div', { class: 'alert ' + a.level }, icon('warn'), h('span', null, Lsrv(a.text))))) : null;

      const tiles = h('div', { class: 'tiles' },
        tile(L('Сейчас в игре'), fmtN(c.online), d.server.max != null ? L('рекорд этой сессии: {0}', d.server.max) : (d.session ? L('рекорд сессии: {0}', d.session.maxplayers) : null), 'hero'),
        tile(L('Аккаунты'), fmtN(c.accounts), c.new_day ? L('+{0} за сутки', c.new_day) : L('без новых за сутки')),
        tile(L('Персонажи'), fmtN(c.chars), SITE.bots ? L('ещё {0} у ботов', fmtN(c.bot_chars)) : null),
        tile(L('Заходили за сутки'), fmtN(c.logins_day), L('разных аккаунтов')),
        tile(L('Мир работает'), up ? fmtDur(up) : '—', d.server.error ? L('SOAP не отвечает') : L('без перезапуска')),
        h('div', { class: 'tile' }, h('div', { class: 'l' }, memLabel()), h('div', { class: 'v' }, fmtBytes(d.container.mem)),
          h('div', { class: 'd' }, L('из {0}', fmtBytes(d.container.limit))), memFrac != null ? meter(memFrac) : null),
        tile(L('Процессор'), fmtPct(d.container.cpu), cpuNote(d.host.ncpu)),
        h('div', { class: 'tile' }, h('div', { class: 'l' }, L('Диск свободен')), h('div', { class: 'v' }, fmtBytes(d.host.disk_free)),
          h('div', { class: 'd' }, L('из {0}', fmtBytes(d.host.disk_total))), diskUsed != null ? meter(diskUsed) : null));

      const hist = d.history.map((p) => ({ t: p.ts, v: p.online }));
      const onlineCard = chartCard(L('Онлайн за сутки'), L('точка раз в 5 минут'), (box) => lineChart(box, hist, {
        label: L('Игроков онлайн за сутки'), gap: 900, fmtTick: (t) => new Date(t * 1000).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' }),
        empty: L('История копится с запуска панели: точка раз в 5 минут.') }),
        { head: [L('Время'), L('Игроков')], rows: d.history.slice(-48).reverse().map((p) => [fmtDT(p.ts), fmtN(p.online)]) });

      const svcCard = card(L('Службы'), null, null, h('div', { class: 'card-b flush' }, serviceTable(d.services, load)));

      const logins = card(L('Последние входы'), null, null, h('div', { class: 'list' }, d.logins.length ? d.logins.map((l) =>
        h('div', { class: 'li' }, h('span', { class: 'grow' }, accLink(l.account_id, l.username)),
          ipCell(l.ip, l.country), badge(l.source === 1 ? L('в мир') : L('вход')),
          h('span', { class: 'muted small' }, ago(l.at)))) : h('div', { class: 'empty' }, L('Входов нет'))));

      const fresh = card(L('Новые аккаунты'), null, null, h('div', { class: 'list' }, d.newest.length ? d.newest.map((a) =>
        h('div', { class: 'li' }, h('span', { class: 'grow' }, accLink(a.id, a.username)),
          h('span', { class: 'muted small' }, ago(a.joindate)))) : h('div', { class: 'empty' }, L('Пока никого'))));

      const r = d.realm || {};
      const realm = card(L('Реалм'), null, h('a', { href: '#/server' }, L('настроить')), h('div', { class: 'card-b' }, facts([
        [L('Название'), r.name], [L('Адрес'), `${r.address}:${r.port}`],
        [L('Вход для игроков'), r.allowedSecurityLevel ? badge(L('закрыт: обслуживание'), 'warn') : badge(L('открыт'), 'ok')],
        [L('Версии клиента'), r.realmbuilds], [L('Ядро'), d.server.version || d.server.error || '—'],
        [L('Банов'), L('{0} аккаунтов, {1} IP', fmtN(c.bans), fmtN(c.ip_bans))], [L('Гильдий'), fmtN(c.guilds)],
        [L('Нагрузка хоста'), d.host.load.map((x) => x.toFixed(2)).join(' · ')],
      ])));

      el.replaceChildren(h('div', { class: 'stack' }, alerts, tiles,
        h('div', { class: 'grid g-main' }, onlineCard, svcCard),
        h('div', { class: 'grid g3' }, logins, fresh, realm)));
    };
    setTools(refreshBtn(() => load().catch((e) => toast(e.message, true))));
    await load();
    every(15000, () => load().catch(() => {}));
  },
};

// ============================================================ Онлайн

function playerActionsMenu(r, reload) {
  return h('div', { class: 'actions' },
    h('button', { class: 'btn sm', type: 'button', onclick: () => messageModal(r.name) }, L('Сообщение')),
    h('button', { class: 'btn sm', type: 'button', onclick: () => teleModal(r.name) }, L('Телепорт')),
    h('button', { class: 'btn sm', type: 'button', title: L('Телепорт по карте'), onclick: () => mapTeleModal(r.name) }, icon('worldmap')),
    h('button', { class: 'btn sm dng', type: 'button', onclick: () => kickModal(r.name, reload) }, L('Кик')));
}

function messageModal(name) {
  formModal({ title: L('Сообщение для {0}', name), text: L('Появится крупным текстом посреди экрана игрока.'),
    fields: [{ name: 'text', label: L('Текст'), type: 'textarea', max: 200 }], submit: L('Отправить'),
    onSubmit: (v) => cmdAction('message', { name, text: v.text }) });
}

function teleModal(name) {
  let close = null;
  const toMap = h('button', { class: 'btn', type: 'button', onclick: () => { if (close) close(); mapTeleModal(name); } },
    icon('worldmap'), L('Выбрать точку на карте мира…'));
  close = formModal({ title: L('Телепорт: {0}', name), text: L('Работает и для тех, кто не в игре: персонаж окажется там при следующем входе.'),
    fields: [{ name: 'location', label: L('Куда'), type: 'tele', placeholder: L('Например: Stormwind, Orgrimmar, Goldshire'), hint: L('Начните вводить — появятся подсказки из 269 точек game_tele.') },
      { node: h('div', { class: 'field' }, h('span', null, L('Или в любую точку')), toMap) }],
    submit: L('Телепортировать'), onSubmit: (v) => cmdAction('tele', { name, location: v.location }) });
}

function kickModal(name, reload) {
  formModal({ title: L('Выкинуть {0} из игры?', name), text: L('Игрок сможет сразу зайти снова — это не бан.'), submit: L('Кикнуть'), danger: true,
    onSubmit: () => cmdAction('kick', { name }), onDone: () => reload && setTimeout(reload, 1500) });
}

PAGES.online = {
  title: L('Онлайн'), sub: L('Кто сейчас в игре. Обновляется каждые 15 секунд.'),
  async render(el) {
    const load = async () => {
      const rows = (await api('/api/online')).data;
      if (navOnline) navOnline.textContent = rows.length || '';
      el.replaceChildren(card(L('В игре: {0}', rows.length), null, null, h('div', { class: 'card-b flush' }, table({
        cols: [
          { label: L('Персонаж'), render: (r) => charCell(r) },
          { label: L('Ур.'), cls: 'r', key: 'level' },
          { label: L('Раса и класс'), render: (r) => `${r.race_name} · ${r.class_name}` },
          { label: L('Где'), key: 'zone_name' },
          { label: L('Гильдия'), render: (r) => r.guild || '—' },
          { label: L('Аккаунт'), render: (r) => h('span', null, accLink(r.account_id, r.username), r.gmlevel ? badge(GM[r.gmlevel], 'acc') : null) },
          { label: 'IP', render: (r) => ipCell(r.ip, r.country) },
          { label: L('Наиграно'), cls: 'r', render: (r) => fmtDur(r.totaltime) },
          { label: '', cls: 'r', render: (r) => playerActionsMenu(r, load) },
        ],
        rows, empty: L('Сейчас в игре никого нет.'),
      }))));
    };
    setTools(
      h('button', { class: 'btn', type: 'button', onclick: () => broadcastModal('announce') }, L('Сообщение всем')),
      refreshBtn(() => load().catch((e) => toast(e.message, true))));
    await load();
    every(15000, () => load().catch(() => {}));
  },
};

function broadcastModal(kind) {
  formModal({ title: kind === 'notify' ? L('Сообщение на экран всем') : L('Объявление в чат всем'),
    fields: [
      { name: 'text', label: L('Текст'), type: 'textarea', max: 250 },
      { name: 'kind', label: L('Как показать'), type: 'select', value: kind, options: [['announce', L('В чат (системное сообщение)')], ['notify', L('Крупно посреди экрана')]] },
    ], submit: L('Отправить'),
    onSubmit: async (v) => (await api('/api/server', { action: v.kind, text: v.text })).data });
}

// ============================================================ Аккаунты

PAGES.accounts = {
  title: L('Аккаунты'), sub: L('Все игровые аккаунты. Нажмите на строку, чтобы открыть карточку.'),
  async render(el) {
    const st = { q: '', filter: '', bots: false, sort: 'id', dir: 'desc', offset: 0, limit: 50 };
    const list = h('div');
    const load = async () => {
      const p = new URLSearchParams({ q: st.q, filter: st.filter, bots: st.bots ? 1 : 0, sort: st.sort, dir: st.dir, offset: st.offset, limit: st.limit });
      const r = await api('/api/accounts?' + p);
      list.replaceChildren(table({
        cols: [
          { label: 'ID', cls: 'r', sort: 'id', key: 'id' },
          { label: L('Логин'), sort: 'username', render: (a) => h('span', { class: 'name-cell' }, h('b', null, a.username),
              a.online ? badge(L('в игре'), 'ok') : null, a.banned ? badge(L('бан'), 'bad') : null,
              a.locked ? badge(L('привязан к IP'), 'warn') : null, a.mutetime * 1000 > Date.now() ? badge(L('немота'), 'warn') : null) },
          { label: L('Права'), sort: 'gmlevel', render: (a) => (a.gmlevel ? badge(GM[a.gmlevel], 'acc') : L('игрок')) },
          { label: L('Перс.'), cls: 'r', sort: 'chars', key: 'chars' },
          { label: L('Регистрация'), sort: 'joindate', render: (a) => fmtD(a.joindate) },
          { label: L('Последний вход'), sort: 'last_login', render: (a) => (a.last_login ? ago(a.last_login) : L('не заходил')) },
          { label: 'IP', render: (a) => ipCell(a.last_ip, a.country) },
        ],
        rows: r.data, onRow: (a) => accountDrawer(a.id), sort: { key: st.sort, dir: st.dir },
        onSort: (k) => { st.dir = st.sort === k && st.dir === 'desc' ? 'asc' : 'desc'; st.sort = k; st.offset = 0; load(); },
        empty: L('Никого не нашлось.'),
      }), pager(r.total, st.limit, st.offset, (o) => { st.offset = Math.max(0, o); load(); }));
    };
    const search = h('input', { class: 'inp search', type: 'search', placeholder: L('Логин или ID'), autocomplete: 'off' });
    search.addEventListener('input', debounce(() => { st.q = search.value.trim(); st.offset = 0; load().catch((e) => toast(e.message, true)); }, 300));
    const filter = h('select', { class: 'inp' }, [['', L('Все')], ['online', L('В игре')], ['gm', L('С правами')], ['banned', L('Забаненные')]].map(([v, l]) => h('option', { value: v }, l)));
    filter.addEventListener('change', () => { st.filter = filter.value; st.offset = 0; load(); });
    const bots = h('input', { type: 'checkbox' });
    bots.addEventListener('change', () => { st.bots = bots.checked; st.offset = 0; load(); });
    setTools(h('button', { class: 'btn pri', type: 'button', onclick: () => createAccountModal(load) }, L('Создать аккаунт')));
    el.replaceChildren(card(null, null, null,
      h('div', { class: 'card-b row' }, search, filter, SITE.bots ? h('label', { class: 'chk' }, bots, L('показать ботов (RNDBOT)')) : null),
      h('div', { class: 'card-b flush' }, list)));
    await load();
  },
};

function passwordResult(res) {
  return h('div', { class: 'result ok' }, icon('ok'), h('div', null,
    h('b', null, L('Готово')),
    h('p', null, L('Логин: '), h('span', { class: 'secret' }, res.username)),
    h('p', null, L('Пароль: '), h('span', { class: 'secret' }, res.password)),
    h('p', { class: 'muted small' }, L('Пароль больше нигде не показывается — передайте его игроку сейчас.'))));
}

function createAccountModal(reload) {
  formModal({ title: L('Новый аккаунт'), text: L('Создаётся через ядро, как при регистрации через бота.'),
    fields: [
      { name: 'username', label: L('Логин'), placeholder: L('Латиница и цифры, до 16 символов'), maxlength: 16 },
      { name: 'password', label: L('Пароль'), placeholder: L('Оставьте пустым — придумаю сам'), maxlength: 16 },
      { name: 'gmlevel', label: L('Права'), type: 'select', value: '0', options: Object.entries(GM) },
    ], submit: L('Создать'),
    onSubmit: async (v) => passwordResult((await api('/api/account/create', v)).data),
    onDone: () => reload && reload() });
}

/* ---------- календарь (сессии персонажа, входы аккаунта) ---------- */

const MONTHS = [L('Январь'), L('Февраль'), L('Март'), L('Апрель'), L('Май'), L('Июнь'), L('Июль'), L('Август'), L('Сентябрь'), L('Октябрь'), L('Ноябрь'), L('Декабрь')];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const dayKey = (ts) => { const d = new Date(ts * 1000); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const keyDate = (k) => new Date(k + 'T12:00:00');
const hm = (ts) => new Date(ts * 1000).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
// «27 сентября 2026, воскресенье»; на других языках — как принято там (Intl)
const dayTitle = (k) => {
  const d = keyDate(k);
  if (LANG !== 'ru') return d.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}, ${['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'][d.getDay()]}`;
};

/* Календарь месяца без длинных списков: дни, когда что-то было, подсвечены — чем
   ярче, тем больше; под календарём — сводка за месяц и подробности выбранного дня.
   days: { 'ГГГГ-ММ-ДД': {v, items} }; fmt(v) — подпись в клетке; summary(ключи месяца)
   и detail(ключ дня) возвращают узлы. */
function calendarBox(days, { fmt, summary, detail, empty }) {
  const keys = Object.keys(days).sort();
  const last = keys.length ? keyDate(keys[keys.length - 1]) : new Date();
  let y = last.getFullYear(), m = last.getMonth();
  let picked = keys.length ? keys[keys.length - 1] : null;
  const months = new Set(keys.map((k) => k.slice(0, 7)));
  const box = h('div', { class: 'cal-wrap' });
  const draw = () => {
    const first = new Date(y, m, 1), lead = (first.getDay() + 6) % 7, n = new Date(y, m + 1, 0).getDate();
    const prefix = `${y}-${pad2(m + 1)}-`;
    const monthKeys = keys.filter((k) => k.startsWith(prefix));
    const max = Math.max(1e-9, ...monthKeys.map((k) => days[k].v));
    const today = dayKey(Date.now() / 1000);
    const grid = h('div', { class: 'cal' }, WEEKDAYS.map((w) => h('span', { class: 'cal-w' }, w)));
    for (let i = 0; i < lead; i++) grid.append(h('span', { class: 'cal-x' }));
    for (let d = 1; d <= n; d++) {
      const k = prefix + pad2(d), rec = days[k];
      const cell = h('button', { type: 'button', class: 'cal-d' + (rec ? ' has' : '') + (k === picked ? ' on' : '') + (k === today ? ' today' : ''),
        disabled: !rec, title: rec ? `${dayTitle(k)}: ${fmt(rec.v)}` : null, onclick: () => { picked = k; draw(); } },
        h('b', null, d), rec ? h('small', null, fmt(rec.v)) : null);
      if (rec) cell.style.setProperty('--a', (0.25 + 0.75 * (rec.v / max)).toFixed(3));
      grid.append(cell);
    }
    const go = (dm) => { m += dm; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } draw(); };
    const nav = h('div', { class: 'cal-nav' },
      h('button', { class: 'btn sm', type: 'button', 'aria-label': L('Предыдущий месяц'), onclick: () => go(-1) }, icon('prev'), L('Назад')),
      monthButton(`${MONTHS[m]} ${y}`, (el) => monthPicker(el, { year: y, month: m, marks: (yy, mm) => months.has(`${yy}-${pad2(mm + 1)}`) },
        (yy, mm) => { y = yy; m = mm; draw(); })),
      h('button', { class: 'btn sm', type: 'button', 'aria-label': L('Следующий месяц'), onclick: () => go(1) }, L('Вперёд'), icon('next')));
    const inMonth = picked && picked.startsWith(prefix) && days[picked];
    box.replaceChildren(
      h('div', { class: 'cal-top' }, h('div', { class: 'cal-left' }, nav, grid),
        h('div', { class: 'cal-right' }, summary(monthKeys),
          inMonth ? h('div', { class: 'cal-day' }, h('h4', null, dayTitle(picked)), detail(picked))
            : h('div', { class: 'muted small cal-hint' }, monthKeys.length ? L('Выберите подсвеченный день — здесь появятся подробности.') : (empty || L('В этом месяце ничего не было.'))))));
  };
  draw();
  return box;
}

/* Сессии → дни календаря: время игры засчитываем дню начала сессии. */
function sessionDays(sessions) {
  const days = {};
  for (const s of sessions) {
    const k = dayKey(s.start);
    (days[k] = days[k] || { v: 0, items: [] }).items.push(s);
    days[k].v += s.secs || 0;
  }
  return days;
}

function sessionRow(s, withName, withDate) {
  return h('div', { class: 'ses' },
    withDate ? h('span', { class: 'ses-day' }, fmtD(s.start)) : null,
    h('span', { class: 'ses-t' }, `${hm(s.start)} – ${s.ongoing ? L('сейчас') : s.end ? hm(s.end) : '?'}`),
    h('b', { class: 'ses-d' }, s.secs != null ? fmtDur(s.secs) : '—'),
    withName ? h('span', { class: 'ses-n' }, s.name) : null,
    s.ip ? ipCell(s.ip, s.country) : h('span', { class: 'muted small' }, L('IP не записан')),
    s.ongoing ? badge(L('играет сейчас'), 'ok') : null,
    s.cut ? badge(L('мир перезапускался — конец примерный'), 'warn') : null);
}

function sessionSummary(list) {
  const secs = list.reduce((a, s) => a + (s.secs || 0), 0);
  const longest = list.reduce((a, s) => Math.max(a, s.secs || 0), 0);
  return h('div', { class: 'cal-sum' },
    tile(L('Дней в игре'), fmtN(new Set(list.map((s) => dayKey(s.start))).size)),
    tile(L('Наиграно'), fmtDur(secs)),
    tile(L('Сессий'), fmtN(list.length), list.length ? L('в среднем {0}', fmtDur(secs / list.length)) : null),
    tile(L('Самая долгая'), longest ? fmtDur(longest) : '—'));
}

/* ---------- карточка аккаунта ---------- */

const ACC_TABS = [['info', L('Сведения')], ['chars', L('Персонажи')], ['logons', L('Входы')], ['calendar', L('Календарь')], ['stats', L('Статистика')]];
const ACC_STATS = [['sum', L('Обзор')], ['chars', L('Персонажи')], ['activity', L('Активность')], ['net', L('IP и страны')], ['items', L('Вещи')]];

function accountInfoView(d, reload, close) {
  const a = d.account;
  const last = d.logons[0];
  const muted = a.mutetime * 1000 > Date.now();
  const banned = d.bans.find((b) => b.active);
  const actions = h('div', { class: 'act-grid' },
    h('button', { class: 'btn', type: 'button', onclick: () => formModal({ title: L('Новый пароль для {0}', a.username),
      fields: [{ name: 'password', label: L('Пароль'), placeholder: L('Оставьте пустым — придумаю сам'), maxlength: 16 }], submit: L('Сменить'),
      onSubmit: async (v) => passwordResult((await api('/api/account/password', { username: a.username, password: v.password })).data) }) }, L('Сменить пароль')),
    h('button', { class: 'btn', type: 'button', onclick: () => formModal({ title: L('Права {0}', a.username), text: L('Уровень 3 даёт все команды в игре, включая выдачу предметов.'),
      fields: [{ name: 'level', label: L('Уровень'), type: 'select', value: String(a.gmlevel), options: Object.entries(GM) }], submit: L('Сохранить'),
      onSubmit: async (v) => (await api('/api/account/gmlevel', { username: a.username, level: v.level })).data, onDone: reload }) }, L('Права ГМ')),
    a.locked
      ? h('button', { class: 'btn', type: 'button', onclick: () => formModal({ title: L('Отвязать от IP?'), submit: L('Отвязать'),
          onSubmit: async () => { await api('/api/account/lock', { id: a.id, lock: false }); return { success: true, output: L('Вход снова разрешён с любого адреса.') }; }, onDone: reload }) }, L('Отвязать от IP'))
      : h('button', { class: 'btn', type: 'button', onclick: () => formModal({ title: L('Привязать к IP'), text: L('Сервер авторизации пустит аккаунт только с этого адреса. Хорошая защита для админских аккаунтов.'),
          fields: [{ name: 'ip', label: L('IP-адрес'), value: last ? last.ip : '', placeholder: L('по умолчанию — последний вход') }], submit: L('Привязать'),
          onSubmit: async (v) => { const r = (await api('/api/account/lock', { id: a.id, lock: true, ip: v.ip })).data; return { success: true, output: L('Привязан к {0}.', r.ip) }; }, onDone: reload }) }, L('Привязать к IP')),
    banned
      ? h('button', { class: 'btn', type: 'button', onclick: () => formModal({ title: L('Снять бан с {0}?', a.username), submit: L('Разбанить'),
          onSubmit: async () => (await api('/api/unban', { type: 'account', target: a.username })).data, onDone: reload }) }, L('Разбанить'))
      : h('button', { class: 'btn dng', type: 'button', onclick: () => banModal('account', a.username, reload) }, L('Забанить')),
    h('button', { class: 'btn dng', type: 'button', onclick: () => formModal({ title: L('Удалить аккаунт {0}?', a.username),
      text: L('Аккаунт и все его персонажи будут удалены через ядро — со всеми вещами, почтой и местом в гильдиях. Отменить нельзя.'),
      fields: [{ name: 'confirm', label: L('Впишите {0}, чтобы подтвердить', a.username) }], submit: L('Удалить навсегда'), danger: true,
      onSubmit: async (v) => (await api('/api/account/delete', { username: a.username, confirm: v.confirm.toUpperCase() })).data,
      onDone: (res) => { if (res && res.success) { close(); route(); } } }) }, L('Удалить')));
  return [
    card(L('Сведения'), null, null, h('div', { class: 'card-b' }, facts([
      [L('Права'), a.gm_name], [L('Регистрация'), fmtDT(a.joindate)],
      [L('Последний вход'), last ? fmtDT(last.at) : L('не заходил')], [L('Последний IP'), last ? ipCell(last.ip, last.country) : '—'],
      [L('Привязка к IP'), a.locked ? a.lockedIp : L('нет')], [L('Неудачных входов подряд'), fmtN(a.failed_logins)],
      [L('Немота до'), muted ? fmtDT(a.mutetime) : L('нет')], [L('Клиент'), [a.locale, a.os, a.platform].filter(Boolean).join(' · ') || '—'],
      [L('Почта'), a.email || '—'],
    ]))),
    card(L('Действия'), null, null, h('div', { class: 'card-b' }, actions)),
    d.bans.length ? card(L('История банов'), null, null, h('div', { class: 'card-b flush' }, banHistoryTable(d.bans))) : null,
  ];
}

function accountLogonsView(d, st) {
  const kinds = [['all', L('Все')], ['world', L('Вход в мир')], ['auth', L('Авторизация')]];
  const box = h('div');
  const draw = () => {
    const rows = d.logons.filter((r) => st.logKind === 'all' || (st.logKind === 'world' ? r.source === 1 : r.source !== 1));
    box.replaceChildren(card(L('Входы: {0}', fmtN(rows.length)), L('новые сверху; список прокручивается внутри'), seg(kinds, st.logKind, (k) => { st.logKind = k; draw(); }),
      h('div', { class: 'card-b flush scroll-box' }, table({
        cols: [{ label: L('Когда'), render: (r) => h('span', null, fmtDT(r.at), h('span', { class: 'muted small' }, '  ' + ago(r.at))) },
               { label: 'IP', render: (r) => h('span', { class: 'mono small' }, r.ip) },
               { label: L('Страна'), render: (r) => countryTag(r.country) },
               { label: L('Куда'), render: (r) => (r.source === 1 ? badge(L('в мир'), 'ok') : badge(L('авторизация'))) }],
        rows, empty: L('Входов не было.') }))));
  };
  draw();
  return [box];
}

function accountCalendarView(s) {
  const days = {};
  const add = (k) => (days[k] = days[k] || { v: 0, logons: [], sessions: [] });
  for (const l of s.logons) add(dayKey(l.at)).logons.push(l);
  for (const x of s.sessions) { const d = add(dayKey(x.start)); d.sessions.push(x); d.v += x.secs || 0; }
  for (const k of Object.keys(days)) if (!days[k].v) days[k].v = days[k].logons.length;   // день без сессий — по числу входов
  return [card(L('Календарь'), L('когда заходил и сколько играл — по журналу входов и Char.log ядра'), null, h('div', { class: 'card-b' },
    calendarBox(days, {
      fmt: (v) => (v >= 60 ? fmtDur(v) : L('{0} вх.', v)),
      summary: (keys) => {
        const ses = keys.flatMap((k) => days[k].sessions), lg = keys.flatMap((k) => days[k].logons);
        return h('div', { class: 'cal-sum' },
          tile(L('Дней с входами'), fmtN(keys.length)), tile(L('Входов'), fmtN(lg.length), L('в мир: {0}', fmtN(lg.filter((l) => l.source === 1).length))),
          tile(L('Наиграно'), fmtDur(ses.reduce((a, x) => a + (x.secs || 0), 0)), L('сессий: {0}', fmtN(ses.length))));
      },
      detail: (k) => h('div', { class: 'stack' },
        days[k].sessions.length ? h('div', null, h('div', { class: 'muted small' }, L('Игра (по персонажам)')), days[k].sessions.map((x) => sessionRow(x, true))) : null,
        h('div', null, h('div', { class: 'muted small' }, L('Входы аккаунта')), days[k].logons.length ? days[k].logons.slice().reverse().map((l) =>
          h('div', { class: 'ses' }, h('span', { class: 'ses-t' }, hm(l.at)), l.source === 1 ? badge(L('в мир'), 'ok') : badge(L('авторизация')), ipCell(l.ip, l.country)))
          : h('div', { class: 'muted small' }, L('нет')))),
      empty: L('В этом месяце аккаунт не заходил.'),
    })))];
}

function monthsBack(n) {
  const out = [], d = new Date();
  d.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push({ key: `${x.getFullYear()}-${pad2(x.getMonth() + 1)}`, label: `${MONTHS[x.getMonth()].slice(0, 3)} ${String(x.getFullYear()).slice(2)}` });
  }
  return out;
}

function accountStatsView(s, st) {
  const sub = h('div', { class: 'subtabs' }, tabs(ACC_STATS, st.statTab, (k) => { st.statTab = k; st.redraw(); }));
  const chars = s.characters;
  const played = chars.reduce((a, c) => a + (c.totaltime || 0), 0);
  const money = chars.reduce((a, c) => a + (c.money || 0), 0);
  const world = s.logons.filter((l) => l.source === 1);
  const views = {
    sum: () => {
      const months = monthsBack(12);
      const lgBy = {}, plBy = {};
      for (const l of world) { const k = dayKey(l.at).slice(0, 7); lgBy[k] = (lgBy[k] || 0) + 1; }
      for (const x of s.sessions) { const k = dayKey(x.start).slice(0, 7); plBy[k] = (plBy[k] || 0) + (x.secs || 0) / 3600; }
      const fav = chars[0];
      const first = s.logons[s.logons.length - 1], last = s.logons[0];
      const ages = Math.floor((Date.now() / 1000 - toDate(s.account.joindate).getTime() / 1000) / 86400);
      return [
        h('div', { class: 'tiles' },
          tile(L('Аккаунту'), L('{0} дн.', fmtN(ages)), L('с {0}', fmtD(s.account.joindate))),
          tile(L('Персонажей'), fmtN(chars.length), fav ? L('больше всех играли за {0}', fav.name) : null),
          tile(L('Наиграно всего'), fmtDur(played), L('всеми персонажами')),
          tile(L('Золото персонажей'), coins(money)),
          tile(L('Входов в мир'), fmtN(world.length), last ? L('последний {0}', ago(last.at)) : L('не заходил')),
          tile(L('Разных IP'), fmtN(new Set(s.logons.map((l) => l.ip)).size), L('стран: {0}', fmtN(new Set(s.logons.map((l) => (l.country || {}).code).filter((c) => c && c !== 'LAN')).size)))),
        h('div', { class: 'grid g2' },
          chartCard(L('Входы в мир по месяцам'), L('за год'), (box) => columnChart(box, months.map((m) => ({ label: m.label, v: lgBy[m.key] || 0 })), { label: L('Входы по месяцам') }),
            { head: [L('Месяц'), L('Входов')], rows: months.map((m) => [m.label, fmtN(lgBy[m.key] || 0)]) }),
          chartCard(L('Игра по месяцам'), L('часов, по Char.log'), (box) => columnChart(box, months.map((m) => ({ label: m.label, v: Math.round((plBy[m.key] || 0) * 10) / 10 })),
            { label: L('Часы игры по месяцам'), fmtV: (v) => L('{0} ч', dec(v)) }),
            { head: [L('Месяц'), L('Часов')], rows: months.map((m) => [m.label, dec(Math.round((plBy[m.key] || 0) * 10) / 10)]) })),
        first ? h('p', { class: 'muted small' }, L('Первый вход в журнале — {0}. Сессии персонажей — по журналу ядра Char.log, он ведётся с {1}.', fmtDT(first.at), s.log_from ? fmtD(s.log_from) : '—')) : null,
      ];
    },
    chars: () => {
      const maxT = Math.max(1, ...chars.map((c) => c.totaltime || 0));
      return [
        card(L('Сколько играли за каждого'), null, null, h('div', { class: 'card-b' }, iconBars(chars.map((c) => ({
          iconNode: gicon(raceIcon(c.race, c.gender), 'm', null, 'f' + c.faction), label: c.name,
          sub: L('{0} ур. · {1} · {2}', c.level, c.race_name, c.class_name), v: c.totaltime || 0, frac: (c.totaltime || 0) / maxT,
          vText: fmtDur(c.totaltime || 0) })), { share: false, empty: L('Персонажей нет.') }))),
        card(L('Персонажи'), null, null, h('div', { class: 'card-b flush' }, table({
          cols: [{ label: L('Персонаж'), render: (c) => charCell(c) }, { label: L('Ур.'), cls: 'r', key: 'level' },
                 { label: L('Звание'), render: (c) => rankCell(c.faction, c.rank) }, { label: L('Убийств'), cls: 'r', render: (c) => fmtN(c.kills) },
                 { label: L('Деньги'), cls: 'r', render: (c) => coins(c.money) }, { label: L('Наиграно'), cls: 'r', render: (c) => fmtDur(c.totaltime) },
                 { label: L('Сессий'), cls: 'r', render: (c) => fmtN(s.sessions.filter((x) => x.guid === c.guid).length) },
                 { label: L('Выход'), render: (c) => (c.online ? badge(L('в игре'), 'ok') : ago(c.logout_time)) }],
          rows: chars, onRow: (c) => charDrawer(c.guid), empty: L('Персонажей нет.') }))),
      ];
    },
    activity: () => {
      const play = emptyWeek(), logins = emptyWeek();
      for (const l of world) { const [w, hr] = weekCell(l.at); logins[w][hr] += 1; }
      // время сессии раскладываем по часам, в которые она шла
      for (const x of s.sessions) {
        if (!x.secs) continue;
        for (let t = x.start; t < x.start + x.secs; t += 3600) {
          const [w, hr] = weekCell(t);
          play[w][hr] += Math.min(3600, x.start + x.secs - t) / 60;
        }
      }
      const secs = s.sessions.map((x) => x.secs || 0);
      const total = secs.reduce((a, b) => a + b, 0);
      return [
        h('div', { class: 'tiles' },
          tile(L('Сессий'), fmtN(s.sessions.length)), tile(L('Наиграно по журналу'), fmtDur(total)),
          tile(L('Средняя сессия'), secs.length ? fmtDur(total / secs.length) : '—'), tile(L('Самая долгая'), secs.length ? fmtDur(Math.max(...secs)) : '—')),
        h('div', { class: 'grid g2' },
          card(L('Когда играет'), L('минут игры по дням недели и часам'), null, h('div', { class: 'card-b' },
            heatmap(play, { fmt: (v) => L('{0} мин', Math.round(v)), note: L('Время — по часам вашего компьютера.') }))),
          card(L('Когда заходит'), L('входы в мир'), null, h('div', { class: 'card-b' }, heatmap(logins)))),
      ];
    },
    net: () => {
      const ips = {};
      for (const l of s.logons) {
        const x = ips[l.ip] = ips[l.ip] || { ip: l.ip, country: l.country, n: 0, first: l.at, last: l.at };
        x.n++; x.first = Math.min(x.first, l.at); x.last = Math.max(x.last, l.at);
      }
      const list = Object.values(ips).sort((a, b) => b.last - a.last);
      const cs = {};
      for (const l of s.logons) { const c = l.country || { code: '??', name: L('не определена') }; (cs[c.code] = cs[c.code] || { ...c, n: 0 }).n++; }
      return [h('div', { class: 'grid g2' },
        card(L('Страны'), null, null, h('div', { class: 'card-b' }, iconBars(Object.values(cs).sort((a, b) => b.n - a.n).map((c) => ({
          iconNode: h('span', { class: 'cc big' + (c.code === 'LAN' ? ' lan' : '') }, c.code), label: c.name, v: c.n })), { empty: L('Входов нет.') }))),
        card(L('Адреса: {0}', list.length), null, null, h('div', { class: 'card-b flush scroll-box' }, table({
          cols: [{ label: 'IP', render: (r) => ipCell(r.ip, r.country) }, { label: L('Входов'), cls: 'r', render: (r) => fmtN(r.n) },
                 { label: L('Первый'), render: (r) => fmtD(r.first) }, { label: L('Последний'), render: (r) => ago(r.last) }],
          rows: list, empty: L('Входов нет.') }))))];
    },
    items: () => {
      const total = s.quality.reduce((a, q) => a + q.n, 0);
      return [h('div', { class: 'grid g2' },
        card(L('Вещи всех персонажей: {0}', fmtN(total)), L('надето, сумки, банк, почта'), null, h('div', { class: 'card-b' }, iconBars(s.quality.map((q) => ({
          iconNode: h('span', { class: 'qdot qd' + q.q }), label: h('span', { class: 'q' + q.q }, QUALITY[q.q] || q.q), v: q.n })), { empty: L('Вещей нет.') }))),
        card(L('Лучшие вещи'), L('редкие и выше'), null, h('div', { class: 'list scroll' }, s.best.length ? s.best.map((it) => {
          const ic = h('span', { class: 'bslot sm sq' + it.quality, tabindex: 0 }, gicon(it.icon, 'l'));
          bindItemTip(ic, { entry: it.entry, icon: it.icon, name: it.name, quality: it.quality });
          return h('div', { class: 'li' }, ic, h('span', { class: 'grow' }, h('span', { class: 'q' + it.quality }, it.name),
            h('div', { class: 'muted small' }, L('ур. предмета {0} · у {1}', it.ilvl, it.owner))));
        }) : h('div', { class: 'empty' }, L('Редких вещей нет.')))))];
    },
  };
  return [sub, ...views[st.statTab]()];
}

async function accountDrawer(id, startTab) {
  const box = h('div', { class: 'drawer acc', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'drawer-b' }, h('div', { class: 'empty' }, L('Загружаю…'))));
  const close = openOverlay(box);
  const st = { tab: startTab || 'info', statTab: 'sum', logKind: 'all', stats: null };
  let d = null;
  const title = h('h2', null, L('Аккаунт')), sub = h('div', { class: 'sub' });
  const head = h('div', { class: 'drawer-h' }, h('div', null, title, sub),
    h('button', { class: 'btn ghost sm x', type: 'button', 'aria-label': L('Закрыть'), onclick: () => close() }, icon('x')));
  const tabBar = h('div', { class: 'ch-tabs' }), body = h('div', { class: 'ch-body' });
  const reload = () => load().catch((e) => toast(e.message, true));
  const needStats = async () => {
    if (!st.stats) st.stats = (await api('/api/account/stats?id=' + encodeURIComponent(id))).data;
    return st.stats;
  };
  st.redraw = async () => {
    itipHide();
    hideTip();
    tabBar.replaceChildren(tabs(ACC_TABS.map(([k, l]) => [k, k === 'chars' ? `${l} · ${d.characters.length}` : k === 'logons' ? `${l} · ${d.logons.length}` : l]),
      st.tab, (k) => { st.tab = k; st.redraw(); }));
    const my = (st.seq = (st.seq || 0) + 1);
    if (st.tab === 'info') body.replaceChildren(...accountInfoView(d, reload, close).filter(Boolean));
    else if (st.tab === 'chars') body.replaceChildren(card(null, null, null, h('div', { class: 'card-b flush' }, table({
      cols: [{ label: L('Имя'), render: (r) => charCell(r) }, { label: L('Ур.'), cls: 'r', key: 'level' },
             { label: L('Раса и класс'), render: (r) => `${r.race_name} · ${r.class_name}` },
             { label: L('Где'), key: 'zone_name' }, { label: L('Гильдия'), render: (r) => r.guild || '—' },
             { label: L('Деньги'), cls: 'r', render: (r) => coins(r.money) },
             { label: L('Наиграно'), cls: 'r', render: (r) => fmtDur(r.totaltime) }],
      rows: d.characters, onRow: (r) => charDrawer(r.guid), empty: L('Персонажей нет.') }))));
    else if (st.tab === 'logons') body.replaceChildren(...accountLogonsView(d, st));
    else {
      body.replaceChildren(h('div', { class: 'empty' }, L('Собираю статистику…')));
      try {
        const s = await needStats();
        if (my !== st.seq) return;
        body.replaceChildren(...(st.tab === 'calendar' ? accountCalendarView(s) : accountStatsView(s, st)).filter(Boolean));
      } catch (e) { if (my === st.seq) body.replaceChildren(errorCard(e)); }
    }
  };
  const load = async () => {
    d = (await api('/api/account?id=' + encodeURIComponent(id))).data;
    st.stats = null;
    const a = d.account;
    const muted = a.mutetime * 1000 > Date.now();
    const banned = d.bans.find((b) => b.active);
    title.textContent = a.username;
    sub.replaceChildren(...[`#${a.id} · ${a.gm_name}`, ' ', banned ? badge(L('забанен'), 'bad') : null, a.locked ? badge(L('привязан к IP'), 'warn') : null,
                            muted ? badge(L('немота'), 'warn') : null, a.is_bot ? badge(L('бот')) : null].filter(Boolean));
    box.replaceChildren(head, tabBar, body);
    await st.redraw();
  };
  try { await load(); } catch (e) {
    box.replaceChildren(h('div', { class: 'drawer-b' }, errorCard(e),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => close() }, L('Закрыть')))));
  }
}

function banHistoryTable(rows) {
  return table({
    cols: [
      { label: L('Аккаунт'), render: (r) => (r.username ? accLink(r.account_id, r.username) : null) },
      { label: L('Когда'), render: (r) => fmtDT(r.banned_at) },
      { label: L('До'), render: (r) => (r.expires_at === r.banned_at ? L('навсегда') : fmtDT(r.expires_at)) },
      { label: L('Кто'), key: 'banned_by' }, { label: L('Причина'), key: 'reason' },
      { label: L('Статус'), render: (r) => (r.active ? badge(L('действует'), 'bad') : badge(r.unbanned_by ? L('снят: {0}', r.unbanned_by) : L('истёк'))) },
    ], rows, empty: L('Банов не было.') });
}

const DURATIONS = [['1h', L('1 час')], ['1d', L('1 день')], ['3d', L('3 дня')], ['7d', L('неделя')], ['30d', L('месяц')], ['-1', L('навсегда')], ['custom', L('свой срок')]];

function banModal(type, target, onDone) {
  const typeName = { account: L('аккаунт'), character: L('персонажа'), ip: 'IP' }[type];
  formModal({ title: L('Забанить {0} {1}', typeName, target || '').trim(),
    text: type === 'character' ? L('Бан персонажа блокирует весь его аккаунт и выкидывает из игры.') : L('Игрок будет выкинут из игры и не сможет войти до конца срока.'),
    fields: [
      target ? null : { name: 'target', label: type === 'ip' ? L('IP-адрес') : type === 'account' ? L('Логин') : L('Имя персонажа') },
      { name: 'duration', label: L('Срок'), type: 'select', value: '1d', options: DURATIONS },
      { name: 'custom', label: L('Свой срок'), placeholder: L('например 12h, 2d6h, 45m'), hint: L('Используется, если выше выбрано «свой срок».') },
      { name: 'reason', label: L('Причина'), placeholder: L('Будет видна в истории банов'), maxlength: 200 },
    ].filter(Boolean), submit: L('Забанить'), danger: true,
    onSubmit: async (v) => (await api('/api/ban', { type, target: target || v.target, reason: v.reason,
                                                    duration: v.duration === 'custom' ? v.custom : v.duration })).data,
    onDone });
}

// ============================================================ Персонажи

PAGES.characters = {
  title: L('Персонажи'), sub: L('Поиск по имени персонажа или логину. Нажмите на строку — откроется карточка.'),
  async render(el) {
    const st = { tab: 'all', q: '', bots: false, cls: '', race: '', online: false, sort: 'level', dir: 'desc', offset: 0, limit: 50 };
    const list = h('div');
    const controls = h('div', { class: 'card-b row' });
    const tabBar = h('div');
    const load = async () => {
      tabBar.replaceChildren(tabs([['all', L('Все')], ['deleted', L('Удалённые')]], st.tab, (k) => { st.tab = k; st.offset = 0; load(); }));
      controls.hidden = st.tab === 'deleted';
      if (st.tab === 'deleted') {
        const r = await api('/api/characters?deleted=1');
        list.replaceChildren(table({
          cols: [
            { label: L('Имя'), render: (c) => h('b', null, c.name) }, { label: L('Ур.'), cls: 'r', key: 'level' },
            { label: L('Раса и класс'), render: (c) => `${c.race_name} · ${c.class_name}` },
            { label: L('Аккаунт'), render: (c) => accLink(c.account_id, c.username) },
            { label: L('Удалён'), render: (c) => fmtDT(c.deleteDate) },
            { label: '', cls: 'r', render: (c) => h('button', { class: 'btn sm', type: 'button', onclick: () => formModal({
                title: L('Восстановить {0}?', c.name), text: L('Персонаж вернётся на свой аккаунт. Если имя уже занято — укажите новое.'),
                fields: [{ name: 'newname', label: L('Новое имя (необязательно)') }], submit: L('Восстановить'),
                onSubmit: (v) => cmdAction('restore', { guid: c.guid, newname: v.newname || undefined }), onDone: load }) }, L('Восстановить')) },
          ], rows: r.data, empty: L('Удалённых персонажей нет. Сервер хранит их, если включено мягкое удаление.') }));
        return;
      }
      const p = new URLSearchParams({ q: st.q, bots: st.bots ? 1 : 0, class: st.cls, race: st.race, online: st.online ? 1 : 0,
                                      sort: st.sort, dir: st.dir, offset: st.offset, limit: st.limit });
      const r = await api('/api/characters?' + p);
      list.replaceChildren(table({
        cols: [
          { label: L('Имя'), sort: 'name', render: (c) => charCell(c) }, { label: L('Ур.'), cls: 'r', sort: 'level', key: 'level' },
          { label: L('Раса и класс'), render: (c) => `${c.race_name} · ${c.class_name}` },
          { label: L('Где'), render: (c) => c.zone_name }, { label: L('Гильдия'), render: (c) => c.guild || '—' },
          { label: L('Золото'), cls: 'r', sort: 'money', render: (c) => fmtMoney(c.money) },
          { label: L('Наиграно'), cls: 'r', sort: 'played', render: (c) => fmtDur(c.totaltime) },
          { label: L('Убийств'), cls: 'r', sort: 'kills', render: (c) => fmtN(c.kills) },
          { label: L('Аккаунт'), render: (c) => accLink(c.account_id, c.username) },
          { label: L('Выход'), sort: 'logout', render: (c) => (c.online ? L('в игре') : ago(c.logout_time)) },
        ],
        rows: r.data, onRow: (c) => charDrawer(c.guid), sort: { key: st.sort, dir: st.dir },
        onSort: (k) => { st.dir = st.sort === k && st.dir === 'desc' ? 'asc' : 'desc'; st.sort = k; st.offset = 0; load(); },
        empty: L('Никого не нашлось.') }), pager(r.total, st.limit, st.offset, (o) => { st.offset = Math.max(0, o); load(); }));
    };
    const search = h('input', { class: 'inp search', type: 'search', placeholder: L('Имя или логин'), autocomplete: 'off' });
    search.addEventListener('input', debounce(() => { st.q = search.value.trim(); st.offset = 0; load().catch((e) => toast(e.message, true)); }, 300));
    const cls = h('select', { class: 'inp' }, h('option', { value: '' }, L('Все классы')), Object.entries(CLASSES).map(([v, l]) => h('option', { value: v }, l)));
    cls.addEventListener('change', () => { st.cls = cls.value; st.offset = 0; load(); });
    const race = h('select', { class: 'inp' }, h('option', { value: '' }, L('Все расы')), Object.entries(RACES).map(([v, l]) => h('option', { value: v }, l)));
    race.addEventListener('change', () => { st.race = race.value; st.offset = 0; load(); });
    const online = h('input', { type: 'checkbox' });
    online.addEventListener('change', () => { st.online = online.checked; st.offset = 0; load(); });
    const bots = h('input', { type: 'checkbox' });
    bots.addEventListener('change', () => { st.bots = bots.checked; st.offset = 0; load(); });
    controls.append(search, cls, race, h('label', { class: 'chk' }, online, L('только в игре')), h('label', { class: 'chk' }, bots, L('боты')));
    el.replaceChildren(card(null, null, null, h('div', { class: 'card-b' }, tabBar), controls, h('div', { class: 'card-b flush' }, list)));
    await load();
  },
};

const RESETS = [['reset_talents', L('Таланты'), L('Все таланты сбросятся, очки вернутся.')],
  ['reset_spells', L('Заклинания'), L('Уберёт из книги всё, кроме изначальных заклинаний.')],
  ['reset_stats', L('Характеристики'), L('Пересчитает характеристики для текущего уровня.')],
  ['reset_honor', L('Честь'), L('Обнулит всю честь и звание.')],
  ['reset_level', L('Уровень до 1'), L('Уровень станет 1, вещи не по уровню могут пропасть.')]];

function simpleAction(title, text, action, name, onDone, danger = false, submit = L('Выполнить')) {
  return () => formModal({ title, text, submit, danger, onSubmit: () => cmdAction(action, { name }), onDone });
}

/* ---------- карточка персонажа ---------- */

// Слоты куклы — в том же порядке, что в окне персонажа в игре. Спина в клиенте
// рисуется той же пустой иконкой, что и грудь.
const DOLL = {
  left: [[0, L('Голова'), 'inventoryslot_head'], [1, L('Шея'), 'inventoryslot_neck'], [2, L('Плечи'), 'inventoryslot_shoulder'],
         [14, L('Спина'), 'inventoryslot_chest'], [4, L('Грудь'), 'inventoryslot_chest'], [3, L('Рубашка'), 'inventoryslot_shirt'],
         [18, L('Гербовая накидка'), 'inventoryslot_tabard'], [8, L('Запястья'), 'inventoryslot_wrists']],
  right: [[9, L('Кисти рук'), 'inventoryslot_hands'], [5, L('Пояс'), 'inventoryslot_waist'], [6, L('Ноги'), 'inventoryslot_legs'],
          [7, L('Ступни'), 'inventoryslot_feet'], [10, L('Палец'), 'inventoryslot_finger'], [11, L('Палец'), 'inventoryslot_finger'],
          [12, L('Аксессуар'), 'inventoryslot_trinket'], [13, L('Аксессуар'), 'inventoryslot_trinket']],
  bottom: [[15, L('Правая рука'), 'inventoryslot_mainhand'], [16, L('Левая рука'), 'inventoryslot_offhand'],
           [17, L('Дальний бой'), 'inventoryslot_ranged']],
};
const CH_TABS = [['gear', L('Снаряжение')], ['inv', L('Инвентарь')], ['talents', L('Таланты')], ['sessions', L('Сессии')],
  ['stats', L('Статистика')], ['actions', L('Действия')]];
const RIDING = new Set([148, 149, 150, 152, 533, 553, 554, 713]);

function equipSlot(it, label, empty, side) {
  const q = it ? it.quality : 0;
  const el = h('button', { type: 'button', class: `slot ${side}${it ? ' sq' + q : ' empty'}`, 'aria-label': `${label}: ${it ? it.name : L('пусто')}` },
    h('span', { class: 'sl-ic' }, gicon(it ? it.icon : empty, 'l'), it && it.count > 1 ? h('b', { class: 'cnt' }, it.count) : null),
    h('span', { class: 'sl-t' },
      h('span', { class: 'sl-n' + (it ? ' q' + q : '') }, it ? it.name : label),
      h('span', { class: 'sl-s' }, it ? [label, it.ilvl ? L('ур. {0}', it.ilvl) : null, it.maxdur ? L('прочность {0}/{1}', it.dur, it.maxdur) : null].filter(Boolean).join(' · ') : L('пусто'))));
  if (it && it.guid) el.addEventListener('click', () => { itipHide(); if (onItemClick) onItemClick(it); });
  return it ? bindItemTip(el, it) : el;
}

function bagSlot(it) {
  if (!it) return h('span', { class: 'bslot empty' });
  const el = h('button', { type: 'button', class: 'bslot sq' + it.quality, 'aria-label': it.name + (it.count > 1 ? ' × ' + it.count : '') },
    gicon(it.icon, 'l'), it.count > 1 ? h('b', { class: 'cnt' }, it.count) : null);
  el.addEventListener('click', () => { itipHide(); if (onItemClick) onItemClick(it); });
  return bindItemTip(el, it);
}

/* Сетка ячеек сумки: items — вещи с номером ячейки от нуля, size — сколько ячеек. */
function bagGrid(items, size, wide) {
  const bySlot = {};
  const extra = [];
  for (const it of items) { if (it.slot < size && !bySlot[it.slot]) bySlot[it.slot] = it; else extra.push(it); }
  const cells = [];
  for (let i = 0; i < size; i++) cells.push(bagSlot(bySlot[i]));
  return h('div', { class: 'bag-grid' + (wide ? ' wide' : '') }, cells, extra.map(bagSlot));
}

function bagCard(head, items, size, wide) {
  return h('div', { class: 'bag' + (wide ? ' wide' : '') },
    h('div', { class: 'bag-h' }, head, h('span', { class: 'muted small' }, `${items.length} / ${size}`)),
    bagGrid(items, size, wide));
}

function bagHead(title, iconName, bagItem) {
  const ic = gicon(iconName, 's');
  const head = [ic, h('span', { class: 'grow' + (bagItem ? ' q' + bagItem.quality : '') }, title)];
  if (bagItem) {
    const btn = h('button', { type: 'button', class: 'bag-ic', 'aria-label': title }, ic);
    bindItemTip(btn, bagItem);
    head[0] = btn;
  }
  return head;
}

// для сетки ячейка считается от нуля, а настоящий номер слота хранится в rawSlot (для «где лежит»)
const shiftSlots = (list, base) => list.map((it) => ({ ...it, slot: it.slot - base, rawSlot: it.slot }));

function invCount(d) {
  const i = d.inv;
  return i.backpack.length + i.bank.length + i.keyring.length + i.other.length
    + [...i.bags, ...i.bank_bags].reduce((a, b) => a + b.items.length, 0);
}

function charHero(d, onClose) {
  const c = d.character;
  const fac = c.faction;
  const name = c.name || c.deleteInfos_Name;
  const chip = (iconName, text, title) => h('span', { class: 'chip2', title: title || null }, iconName ? gicon(iconName, 's') : null, text);
  const where = c.zone_name && c.zone_name !== '—' ? chip('inv_misc_map_01', (c.online ? L('сейчас: ') : L('вышел: ')) + c.zone_name, L('Где находится')) : null;
  return h('div', { class: 'ch-hero ' + (fac || '') },
    h('div', { class: 'ch-ava' },
      gicon(raceIcon(c.race, c.gender), 'xxl', `${c.race_name}, ${c.gender ? L('женщина') : L('мужчина')}`),
      h('span', { class: 'lvl', title: L('Уровень') }, c.level),
      h('span', { class: 'cls' }, gicon(classIcon(c.class), 'l', c.class_name))),
    h('div', { class: 'ch-main' },
      h('h2', null, name, c.online ? badge(L('в игре'), 'ok') : null, c.deleteDate ? badge(L('удалён'), 'bad') : null,
        c.at_login ? badge(L('ждёт действия при входе'), 'warn') : null),
      h('div', { class: 'ch-line' },
        facIcon(fac), h('span', null, L('{0} ур. · {1} · {2} · {3}', c.level, c.race_name, c.class_name, FACTION[fac] || '')),
        c.guild ? h('span', { class: 'ch-guild' }, `<${c.guild}>`, c.guild_rank_name ? h('span', { class: 'muted' }, ' · ' + c.guild_rank_name) : null) : null),
      h('div', { class: 'ch-chips' },
        chip(null, coins(c.money), L('Деньги')),
        chip('inv_misc_pocketwatch_01', fmtDur(c.totaltime), L('Наиграно всего')),
        c.rank > 0 ? chip(rankIcon(fac, c.rank), rankName(fac, c.rank), L('Высшее звание PvP')) : null,
        chip('ability_warrior_rallyingcry', L('{0} убийств', fmtN(c.kills)), L('Почётные убийства')),
        where,
        h('span', { class: 'chip2' }, gicon('inv_misc_note_06', 's'), L('аккаунт '), accLink(c.account_id || c.deleteInfos_Account, c.username)))),
    h('button', { class: 'btn ghost sm x ch-x', type: 'button', 'aria-label': L('Закрыть'), onclick: onClose }, icon('x')));
}

function gearView(d) {
  const c = d.character, g = d.gear;
  const bySlot = {};
  for (const it of d.inv.equipped) bySlot[it.slot] = it;
  const col = (list, side) => h('div', { class: 'doll-col ' + side }, list.map(([s, label, empty]) => equipSlot(bySlot[s], label, empty, side)));
  const statRows = IC.stats.filter(([id]) => g.stats[id]).map(([id, ru]) => [ru, `+${fmtN(g.stats[id])}`]);
  const resRows = IC.resist.filter(([k]) => g.res[k]).map(([k, ru]) => [ru, `+${fmtN(g.res[k])}`]);
  const dl = (rows) => h('dl', { class: 'dm-stats' }, rows.map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v))));
  const looks = [[Lx('look', 'Кожа'), c.skin], [L('Лицо'), c.face], [L('Причёска'), c.hair_style], [L('Цвет волос'), c.hair_color], [L('Черты лица'), c.facial]];
  // Посередине — рисунок расы и класса из официального Fan Site Kit (для каждого сочетания 1.12
  // он есть). Это образ класса, а не точная внешность персонажа: её рисует только клиент игры.
  // Нет картинки — показываем портрет расы.
  const portrait = h('div', { class: 'dm-por' }, gicon(raceIcon(c.race, c.gender), 'xxl'));
  const render = !SITE.art ? portrait : h('img', { class: 'dm-render', alt: `${c.race_name}, ${c.class_name}`, decoding: 'async',
    title: L('Образ расы и класса из Fan Site Kit — общий рисунок, не точная внешность персонажа'),
    src: `/static/wow/renders/${RACE_KEY[c.race]}_${CLASS_KEY[c.class]}.webp` });
  if (render !== portrait) render.addEventListener('error', () => render.replaceWith(portrait));
  const mid = h('div', { class: 'doll-mid ' + (c.faction || '') },
    h('div', { class: 'dm-head' }, facIcon(c.faction, 'm'),
      h('div', null, h('div', { class: 'dm-name' }, c.name || c.deleteInfos_Name),
        h('div', { class: 'muted small' }, L('{0} ур. · {1} · {2}', c.level, c.race_name, c.class_name)))),
    h('div', { class: 'dm-figure' }, render),
    h('div', { class: 'dm-ilvl' }, h('b', null, g.ilvl != null ? String(g.ilvl).replace('.', ',') : '—'), h('span', null, L('средний уровень вещей'))));
  const bottom = DOLL.bottom.map(([s, label, empty]) => equipSlot(bySlot[s], label, empty, 'bottom'));
  bottom.push(equipSlot(d.ammo, L('Боеприпасы'), 'inventoryslot_ammo', 'bottom'));
  return [
    h('div', { class: 'doll' }, col(DOLL.left, 'left'), mid, col(DOLL.right, 'right'), h('div', { class: 'doll-bottom' }, bottom)),
    h('div', { class: 'grid g2 eq' },
      h('div', { class: 'cell' }, card(L('Прибавки от вещей'), L('без учёта самого персонажа и бафов'), null, h('div', { class: 'card-b' },
        dl([[L('Броня'), fmtN(g.armor)], ...statRows]),
        resRows.length ? h('div', { class: 'dm-sub' }, L('Сопротивление')) : null,
        resRows.length ? dl(resRows) : null))),
      h('div', { class: 'cell' }, card(L('Внешность'), L('номер варианта в окне создания персонажа'), null, h('div', { class: 'card-b stack' },
        h('div', { class: 'chips' }, looks.map(([k, v]) => h('span', { class: 'chip static' }, `${k}: ${v + 1}`))),
        h('div', { class: 'row' }, gicon(raceIcon(c.race, c.gender), 'xl'),
          h('span', { class: 'muted small' }, L('{0}, {1}. Рисунок посередине — общий образ расы и класса из Fan Site Kit; '
            + 'объёмную модель с настоящей внешностью рисует только клиент игры.', c.race_name, c.gender ? L('женщина') : L('мужчина')))))))),
  ];
}

function invView(d, reload) {
  const i = d.inv;
  const bags = [bagCard(bagHead(L('Рюкзак'), 'inv_misc_bag_08'), shiftSlots(i.backpack, 23), 16)];
  for (const b of i.bags) bags.push(bagCard(bagHead(b.name, b.icon, b), b.items, b.size || b.items.length));
  const bank = [bagCard(bagHead(L('Банк'), 'inv_misc_bag_10'), shiftSlots(i.bank, 39), 24, true)];
  for (const b of i.bank_bags) bank.push(bagCard(bagHead(b.name, b.icon, b), b.items, b.size || b.items.length));
  const cap = 16 + i.bags.reduce((a, b) => a + (b.size || 0), 0);
  const used = i.backpack.length + i.bags.reduce((a, b) => a + b.items.length, 0);
  const q = Object.entries(d.quality).filter(([, n]) => n).sort((a, b) => b[0] - a[0]);
  return [
    h('div', { class: 'inv-bar' },
      h('button', { class: 'btn pri', type: 'button', onclick: () => addItemModal(d) }, icon('items'), L('Выдать предмет')),
      h('span', { class: 'muted small' }, L('Нажмите на любую вещь — её можно убрать у персонажа или выдать ещё такую же.'))),
    h('div', { class: 'inv-sum' },
      h('span', null, h('b', null, `${used} / ${cap}`), L(' мест в сумках занято')),
      h('span', { class: 'muted' }, L('в банке {0}', i.bank.length + i.bank_bags.reduce((a, b) => a + b.items.length, 0))),
      h('span', { class: 'chips' }, q.map(([k, n]) => h('span', { class: 'chip static q' + k, title: QUALITY[k] }, `${QUALITY[k] || k}: ${n}`)))),
    h('section', { class: 'inv-sec' }, h('h4', null, L('Сумки')), h('div', { class: 'bags' }, bags)),
    h('section', { class: 'inv-sec' }, h('h4', null, L('Банк')), h('div', { class: 'bags' }, bank)),
    i.keyring.length ? h('section', { class: 'inv-sec' }, h('h4', null, L('Связка ключей')),
      h('div', { class: 'bags' }, bagCard(bagHead(L('Ключи'), 'inv_misc_key_03'), shiftSlots(i.keyring, 81), 16))) : null,
    i.other.length ? h('section', { class: 'inv-sec' }, h('h4', null, L('Без сумки')),
      h('p', { class: 'muted small' }, L('Вещи лежат в сумке, которой у персонажа больше нет. Так бывает после ручной правки базы.')),
      h('div', { class: 'bags' }, bagCard(bagHead(L('Прочее'), 'inv_misc_questionmark'), i.other.map((it, n) => ({ ...it, slot: n })), i.other.length, true))) : null,
    trashCard(d, reload),
  ].filter(Boolean);
}

function xpBar(xp, next, rest) {
  const frac = Math.min(1, xp / next);
  const fill = h('i');
  fill.style.width = (frac * 100).toFixed(1) + '%';
  const bar = h('div', { class: 'xpbar', role: 'meter', 'aria-valuenow': xp, 'aria-valuemax': next }, fill);
  if (rest > 0) {
    const r = h('u', { title: L('бонус отдыха') });
    r.style.left = (frac * 100).toFixed(1) + '%';
    r.style.width = (Math.min(1 - frac, rest / next) * 100).toFixed(1) + '%';
    bar.append(r);
  }
  bar.append(h('span', null, L('{0} / {1} опыта · {2}', fmtN(xp), fmtN(next), fmtPct(frac * 100))));
  return bar;
}

function skillRows(list) {
  return list.map((s) => ({
    icon: PROF[s.id] ? PROF[s.id][1] : SKILL_ICON[s.id] || (s.icon !== 'temp' ? s.icon : ''), label: PROF[s.id] ? PROF[s.id][0] : SKILL_RU[s.id] || s.name,
    title: s.name, v: s.value, frac: s.max ? s.value / s.max : 0, vText: `${s.value} / ${s.max}`,
  }));
}

function repList(reps) {
  if (!reps.length) return h('div', { class: 'empty' }, L('Персонаж ещё ни с кем не знаком.'));
  const order = ['Alliance', 'Horde', 'Steamwheedle Cartel', 'Alliance Forces', 'Horde Forces', ''];
  const rank = (g) => { const i = order.indexOf(g); return i < 0 ? order.length : i; };
  reps = [...reps].sort((a, b) => rank(a.group) - rank(b.group) || b.value - a.value);
  const groups = new Map();
  for (const r of reps) {
    const g = r.group ? (REP_RU[r.group] || r.group) : L('Прочие');
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }
  const out = h('div', { class: 'reps' });
  for (const [g, list] of groups) {
    out.append(h('div', { class: 'rep-g' }, g));
    for (const r of list) {
      const top = r.rank === 7;   // превознесение — выше некуда, полоса полная, как в игре
      const fill = h('i', { class: 'rr' + r.rank });
      fill.style.width = (top ? 100 : (r.cur / r.span) * 100).toFixed(1) + '%';
      out.append(h('div', { class: 'rep', title: `${r.name}: ${fmtN(r.value)}` },
        h('span', { class: 'rep-n' }, REP_RU[r.name] || r.name, r.war ? badge(L('война'), 'bad') : null),
        h('span', { class: 'rep-r rt' + r.rank }, REP_RANK[r.rank]),
        h('span', { class: 'rep-bar' }, fill, h('span', null, top ? L('максимум') : `${fmtN(r.cur)} / ${fmtN(r.span)}`))));
    }
  }
  return out;
}

function charStatsView(d, goSessions) {
  const c = d.character, fac = c.faction;
  const tal = d.talents;
  const spent = tal.reduce((a, t) => a + t.points, 0);
  const topT = Math.max(0, ...tal.map((t) => t.points));
  const profs = d.skills.filter((s) => PROF[s.id])
    .sort((a, b) => (PRIMARY_PROF.has(b.id) - PRIMARY_PROF.has(a.id)) || b.value - a.value);
  const weapons = d.skills.filter((s) => (s.cat === 6 || s.id === 633 || s.id === 40) && !PROF[s.id]).sort((a, b) => b.value - a.value);
  const riding = d.skills.filter((s) => RIDING.has(s.id));
  const q = d.quests;
  const explored = c.explore_total ? L('{0} из {1} ({2})', fmtN(c.explored), fmtN(c.explore_total), fmtPct((c.explored / c.explore_total) * 100)) : fmtN(c.explored);
  const typeName = (p) => (p.type === 1 ? L('питомец охотника') : L('демон'));
  const petState = (p) => (p.slot === 0 ? L('с хозяином') : p.slot > 0 && p.slot < 100 ? L('в стойле') : L('отозван'));

  return [
    h('div', { class: 'grid g2 eq' },
      h('div', { class: 'cell' }, card(L('Прогресс'), null, null, h('div', { class: 'card-b stack' },
        h('div', { class: 'big-line' }, h('b', null, c.level), h('span', null, c.level >= 60 ? L('уровень — максимальный') : L('уровень'))),
        c.xp_next && c.level < 60 ? xpBar(c.xp, c.xp_next, c.rest_bonus) : null,
        facts([
          [L('Наиграно всего'), fmtDur(c.totaltime)], [L('На этом уровне'), fmtDur(c.leveltime)],
          [L('Бонус отдыха'), c.rest_bonus > 0 ? L('{0} опыта', fmtN(Math.round(c.rest_bonus))) : L('нет')],
          [L('Последний выход'), c.online ? L('сейчас в игре') : fmtDT(c.logout_time)],
          [L('Заданий выполнено'), fmtN(q.done)], [L('Заданий в журнале'), fmtN(q.active)],
        ])))),
      h('div', { class: 'cell' }, card('PvP', L('честь старой системы 1.12'), null, h('div', { class: 'card-b stack' },
        h('div', { class: 'rank-big' }, gicon(c.rank > 0 ? rankIcon(fac, c.rank) : FAC_ICON[fac], 'xl'),
          h('div', null, h('b', null, rankName(fac, c.rank)),
            h('div', { class: 'muted small' }, c.rank > 0 ? L('Высшее звание за всё время: {0} из 14', c.rank) : L('Звания ещё не было')))),
        facts([
          [L('Почётных убийств'), fmtN(c.kills)], [L('Бесчестных убийств'), fmtN(c.dishonor)],
          [L('Место за прошлую неделю'), c.standing ? fmtN(c.standing) : '—'], [L('Очки рейтинга'), fmtN(Math.round(c.rating || 0))],
        ]))))),
    card(L('Таланты'), tal.length ? tal.map((t) => t.points).join(' / ') : null, null, h('div', { class: 'card-b stack' },
      tal.length ? h('div', { class: 'talents' }, tal.map((t) => h('div', { class: 'tal' + (t.points && t.points === topT ? ' top' : ''), title: t.name },
        gicon(t.icon, 'l'), h('div', { class: 'tal-t' }, h('div', { class: 'tal-n' }, TALENT_RU[t.name] || t.name), h('div', { class: 'muted small' }, t.name)),
        h('b', null, t.points)))) : h('div', { class: 'empty' }, L('Нет данных о талантах.')),
      h('div', { class: 'muted small' }, c.level >= 10 ? L('Потрачено {0} из {1} очков талантов.', spent, c.level - 9) : L('Таланты открываются с 10 уровня.')))),
    h('div', { class: 'grid g2 eq' },
      h('div', { class: 'cell' }, card(L('Профессии'), null, null, h('div', { class: 'card-b' },
        iconBars(skillRows(profs), { share: false, max: 300, empty: L('Профессий нет.') })))),
      h('div', { class: 'cell' }, card(L('Оружие и защита'), null, null, h('div', { class: 'card-b' },
        iconBars(skillRows([...weapons, ...riding]), { share: false, max: 300, empty: L('Навыков нет.') }))))),
    h('div', { class: 'grid g2' },
      card(L('Репутация'), L('{0} фракций', d.reputation.length), null, h('div', { class: 'card-b' }, repList(d.reputation))),
      h('div', { class: 'stack' },
        card(L('Мир'), null, null, h('div', { class: 'card-b' }, facts([
          [L('Открыто районов'), explored], [L('Знает точек полёта'), fmtN(c.taxi)],
          [L('Изученных заклинаний'), fmtN(d.spells)], [L('Писем в ящике'), `${fmtN(d.mail.n)}${d.mail.money ? ' · ' + fmtMoney(d.mail.money) : ''}`],
          [L('Вещей всего'), fmtN(Object.values(d.quality).reduce((a, n) => a + n, 0))], ['GUID', c.guid],
        ]))),
        d.pets.length ? card(L('Питомцы'), null, null, h('div', { class: 'list' }, d.pets.map((p) =>
          h('div', { class: 'li' }, gicon(p.icon, 'm'), h('span', { class: 'grow' }, h('b', null, p.name),
            h('span', { class: 'muted small' }, L(' · {0} · {1} ур.', PET_RU[p.family] || p.family || typeName(p), p.level))),
            badge(petState(p), p.slot === 0 ? 'ok' : null))))) : null,
        card(L('Последние сессии'), L('именно этого персонажа — по журналу ядра Char.log'),
          goSessions ? h('button', { class: 'btn sm', type: 'button', onclick: goSessions }, icon('stats'), L('Календарь')) : null,
          h('div', { class: 'card-b' }, d.sessions.length ? d.sessions.map((x) => sessionRow(x, false, true))
            : h('div', { class: 'empty' }, L('В журнале ядра входов этого персонажа нет.')))))),
  ];
}

function actionsView(d, reload, close) {
  const c = d.character;
  const name = c.name || c.deleteInfos_Name;
  const btn = (label, onclick, danger) => h('button', { class: 'btn' + (danger ? ' dng' : ''), type: 'button', onclick }, label);
  const group = (title, hint, ...btns) => h('section', { class: 'act-sec' }, h('h4', null, title, hint ? h('span', null, '  ' + hint) : null),
    h('div', { class: 'act-grid' }, btns));
  return h('div', { class: 'card' }, h('div', { class: 'card-b stack' },
    group(L('Общение'), null,
      btn(L('Сообщение на экран'), () => messageModal(name)),
      btn(L('Письмо'), () => formModal({ title: L('Письмо для {0}', name), text: L('Придёт в игровой почтовый ящик.'),
        fields: [{ name: 'subject', label: L('Тема'), maxlength: 60 }, { name: 'text', label: L('Текст'), type: 'textarea', max: 500 }], submit: L('Отправить'),
        onSubmit: (v) => cmdAction('mail', { name, subject: v.subject, text: v.text }) }))),
    group(L('Подарки'), L('приходят письмом'),
      btn(L('Деньги'), () => formModal({ title: L('Деньги для {0}', name), text: L('Придут письмом с вложением.'),
        fields: [{ type: 'money' }, { name: 'subject', label: L('Тема'), value: L('Подарок'), maxlength: 60 }, { name: 'text', label: L('Текст'), value: L('От администрации сервера'), type: 'textarea', max: 500 }],
        submit: L('Отправить'), onSubmit: (v) => cmdAction('money', { name, ...v }), onDone: reload })),
      btn(L('Предметы'), () => formModal({ title: L('Предметы для {0}', name), text: L('Придут письмом. До 12 предметов за раз.'), wide: true,
        fields: [{ type: 'items' }, { name: 'subject', label: L('Тема'), value: L('Подарок'), maxlength: 60 }, { name: 'text', label: L('Текст'), value: L('От администрации сервера'), type: 'textarea', max: 500 }],
        submit: L('Отправить'), onSubmit: (v) => cmdAction('items', { name, ...v }) }))),
    group(L('Персонаж'), null,
      btn(L('Уровень'), () => formModal({ title: L('Уровень {0}', name),
        fields: [{ name: 'level', label: L('Новый уровень'), type: 'number', min: 1, max: 60, value: c.level }], submit: L('Установить'),
        onSubmit: (v) => cmdAction('level', { name, level: v.level }), onDone: reload })),
      btn(L('Телепорт'), () => teleModal(name)),
      btn(L('Телепорт по карте'), () => mapTeleModal(name)),
      btn(L('Сменить имя'), simpleAction(L('Переименовать {0}?', name), L('При следующем входе игрок увидит окно выбора нового имени.'), 'rename', name, reload)),
      btn(L('Воскресить'), simpleAction(L('Воскресить {0}?', name), null, 'revive', name, reload)),
      btn(L('Починить вещи'), simpleAction(L('Починить вещи {0}?', name), L('Работает, пока персонаж в игре.'), 'repair', name)),
      btn(L('Сбросы…'), () => formModal({ title: L('Сброс для {0}', name),
        fields: [{ name: 'what', label: L('Что сбросить'), type: 'select', value: 'reset_talents', options: RESETS.map(([k, l, t]) => [k, `${l} — ${t}`]) }],
        submit: L('Сбросить'), danger: true, onSubmit: (v) => cmdAction(v.what, { name }), onDone: reload }))),
    group(L('Сведения от ядра'), null,
      btn(L('Справка ядра'), simpleAction(L('Справка по {0}', name), L('Ответ ядра: аккаунт, IP, время в игре, где находится.'), 'pinfo', name, null, false, L('Показать'))),
      btn(L('Репутация'), simpleAction(L('Репутация {0}', name), null, 'reputation', name, null, false, L('Показать')))),
    group(L('Наказания'), null,
      btn(L('Немота'), () => formModal({ title: L('Немота для {0}', name), text: L('Блокирует чат всему аккаунту на заданное время.'),
        fields: [{ name: 'minutes', label: L('Минут'), type: 'number', min: 1, max: 525600, value: 60 }], submit: L('Включить'),
        onSubmit: (v) => cmdAction('mute', { name, minutes: v.minutes }) })),
      btn(L('Снять немоту'), simpleAction(L('Снять немоту с {0}?', name), null, 'unmute', name)),
      btn(L('Кик'), () => kickModal(name, reload), true),
      btn(L('Бан'), () => banModal('character', name, reload), true)),
    group(L('Опасно'), L('не отменить'),
      btn(L('Удалить навсегда'), () => formModal({ title: L('Удалить {0} навсегда?', name),
        text: L('Персонаж будет стёрт окончательно, минуя корзину удалённых. Вещи, почта, место в гильдии — всё пропадёт.'),
        fields: [{ name: 'confirm', label: L('Впишите {0}, чтобы подтвердить', name) }], submit: L('Удалить навсегда'), danger: true,
        onSubmit: (v) => cmdAction('erase', { name, confirm: v.confirm }), onDone: (res) => { if (res && res.success) { close(); route(); } } }), true))));
}

/* ---------- вещи: окно действий, таланты, сессии ---------- */

// Клик по вещи в кукле или сумке открывает окно действий; обработчик ставит открытая карточка.
let onItemClick = null;

function itemPlace(d, it) {
  if (it.bag === 0) {
    const s = it.rawSlot != null ? it.rawSlot : it.slot;
    const eq = [...DOLL.left, ...DOLL.right, ...DOLL.bottom].find(([n]) => n === s);
    if (eq) return L('надето: {0}', eq[1].toLowerCase());
    if (s >= 23 && s < 39) return L('рюкзак, ячейка {0}', s - 22);
    if (s >= 39 && s < 63) return L('банк, ячейка {0}', s - 38);
    if (s >= 19 && s < 23) return L('сумка в слоте сумок');
    if (s >= 63 && s < 69) return L('сумка в банке');
    if (s >= 81 && s < 97) return L('связка ключей, ячейка {0}', s - 80);
    return L('ячейка {0}', s);
  }
  const bag = [...d.inv.bags, ...d.inv.bank_bags].find((b) => b.guid === it.bag);
  return bag ? L('сумка «{0}», ячейка {1}', bag.name, it.slot + 1) : L('сумка #{0}, ячейка {1}', it.bag, it.slot + 1);
}

function itemActionModal(d, it, reload) {
  const c = d.character, name = c.name;
  const tt = h('div', { class: 'tt-holder' });
  const show = () => tt.replaceChildren(itemCache[it.entry] ? itemTooltip(itemCache[it.entry].item, spellCache, it.icon)
    : h('div', { class: 'tt-wrap' }, iconImg(it.icon, true), h('div', { class: 'tt' }, h('div', { class: 'big ttq' + it.quality }, it.name))));
  show();
  if (!itemCache[it.entry]) api('/api/item?brief=1&entry=' + it.entry).then(async (r) => {
    itemCache[it.entry] = r.data;
    show();
    const ids = [1, 2, 3, 4, 5].map((i) => Number(r.data.item['spellid_' + i])).filter(Boolean);
    if (ids.length) { try { await loadSpellInfo(ids); show(); } catch (e) { /* без описаний */ } }
  }).catch(() => {});
  const kick = h('input', { type: 'checkbox' });
  const out = h('div');
  const bagInside = [...d.inv.bags, ...d.inv.bank_bags].find((b) => b.guid === it.guid);
  const removeBtn = h('button', { class: 'btn dng', type: 'button' }, L('Убрать у персонажа'));
  const moreBtn = h('button', { class: 'btn', type: 'button' }, L('Выдать ещё такую же'));
  let close;
  removeBtn.addEventListener('click', async () => {
    removeBtn.disabled = true;
    out.replaceChildren(h('div', { class: 'muted small' }, c.online && kick.checked ? L('Выкидываю из игры и жду сохранения…') : L('Убираю…')));
    try {
      const r = (await api('/api/character/item/remove', { guid: c.guid, item: it.guid, kick: kick.checked })).data;
      out.replaceChildren(resultView(r));
      setTimeout(() => { close(); reload(); }, 1400);
    } catch (e) { out.replaceChildren(resultView({ success: false, output: e.message })); removeBtn.disabled = false; }
  });
  moreBtn.addEventListener('click', () => { close(); addItemModal(d, it); });
  const box = h('div', { class: 'modal wide' },
    h('div', { class: 'modal-h' }, h('div', null, h('h3', null, it.name), h('p', null, `${name} · ${itemPlace(d, it)}`)),
      h('button', { class: 'btn ghost sm x', type: 'button', 'aria-label': L('Закрыть'), onclick: () => close() }, icon('x'))),
    h('div', { class: 'modal-b stack' }, tt,
      facts([[L('Количество'), fmtN(it.count)], [L('Уровень предмета'), it.ilvl || '—'], [L('Номер предмета'), it.entry], [L('Номер этой вещи'), it.guid],
             it.maxdur ? [L('Прочность'), `${it.dur} / ${it.maxdur}`] : null]),
      bagInside && bagInside.items.length ? h('div', { class: 'alert warning' }, icon('warn'), h('span', null, L('В этой сумке лежат вещи ({0}) — сначала уберите их.', bagInside.items.length))) : null,
      c.online ? h('label', { class: 'chk' }, kick, L('Персонаж в игре — выкинуть его из игры, чтобы убрать вещь (он сможет сразу зайти снова)')) : null,
      h('p', { class: 'muted small' }, L('Убранная вещь попадает в «Убранные вещи» внизу вкладки «Инвентарь» — её можно вернуть на то же место, пока ячейка свободна. ')
        + L('Убирать можно только у персонажа не в игре: в игре его вещи живут в памяти мира, и сервер перезаписал бы базу.')),
      out),
    h('div', { class: 'modal-f' }, h('button', { class: 'btn', type: 'button', onclick: () => close() }, L('Закрыть')), moreBtn, removeBtn));
  close = openOverlay(box);
}

/* Выдать предмет: ядро кладёт его в почту — так работает и для игрока в игре
   (консольная .additem требует выделенного персонажа и из панели не срабатывает). */
function addItemModal(d, it) {
  const name = d.character.name;
  formModal({ title: L('Выдать предмет: {0}', name), wide: true,
    text: L('Предмет придёт письмом во внутриигровую почту — сразу, даже если персонаж сейчас в игре. Положить вещь прямо в сумки ядро из панели не умеет.'),
    fields: [{ type: 'items' }, { name: 'subject', label: L('Тема'), value: L('Подарок'), maxlength: 60 },
             { name: 'text', label: L('Текст'), value: L('От администрации сервера'), type: 'textarea', max: 500 }],
    submit: L('Отправить'), onSubmit: (v) => cmdAction('items', { name, ...v }) });
  if (it) {
    // подставляем выбранную вещь в поиск — останется нажать на неё в списке
    setTimeout(() => {
      const inp = document.querySelector('.overlay:last-child .field input.inp');
      if (inp) { inp.value = String(it.entry); inp.dispatchEvent(new Event('input')); }
    }, 60);
  }
}

function trashCard(d, reload) {
  if (!d.trash.length) return null;
  return card(L('Убранные вещи'), L('вернуть можно, пока персонаж не в игре и ячейка свободна'), null, h('div', { class: 'list' }, d.trash.map((t) =>
    h('div', { class: 'li' }, h('span', { class: 'grow' }, h('b', null, t.name), h('span', { class: 'muted small' }, L('  · вещь #{0} · убрана {1}', t.item_guid, ago(t.ts)))),
      h('button', { class: 'btn sm', type: 'button', onclick: async (e) => {
        e.target.disabled = true;
        try { const r = (await api('/api/character/item/restore', { id: t.id })).data; toast(r.output); reload(); }
        catch (err) { toast(err.message, true); e.target.disabled = false; }
      } }, L('Вернуть'))))));
}

/* Таланты — деревья как в окне талантов игры: 7 рядов × 4 столбца на ветку.
   Серый — не изучен, зелёная рамка — изучен частично, золотая — полностью. */
async function talentsView(guid, cache) {
  if (!cache.talents) cache.talents = (await api('/api/character/talents?guid=' + guid)).data;
  const t = cache.talents;
  if (!t.tabs.length) return [h('div', { class: 'empty' }, L('У этого класса нет талантов.'))];
  const top = Math.max(0, ...t.tabs.map((x) => x.points));
  const byId = {};
  for (const tab of t.tabs) for (const x of tab.talents) byId[x.id] = x;
  const tip = (x) => {
    const tt = h('div', { class: 'tt' },
      h('div', { class: 'big' }, x.name), h('div', { class: 'gr small' }, L('Ранг {0}/{1}', x.rank, x.max)),
      x.dep && byId[x.dep] ? h('div', { class: x.rank || byId[x.dep].rank >= (x.dep_rank || 0) + 1 ? 'gr small' : 'r small' },
        L('Требует {0} ранг таланта «{1}»', x.dep_rank + 1, byId[x.dep].name)) : null,
      x.desc ? h('div', { class: 'y' }, x.desc) : null,
      x.next ? h('div', { class: 'small' }, h('div', { class: 'gr' }, x.rank ? L('Следующий ранг:') : L('Первый ранг:')), h('div', null, x.next)) : null);
    return h('div', { class: 'tt-wrap' }, iconImg(x.icon, true), tt);
  };
  return [
    h('div', { class: 'tal-sum' },
      h('b', null, t.tabs.map((x) => x.points).join(' / ')),
      h('span', { class: 'muted' }, t.level >= 10 ? L('потрачено {0} из {1} очков', t.spent, t.available) : L('таланты открываются с 10 уровня'))),
    h('div', { class: 'trees' }, t.tabs.map((tab) => {
      const grid = h('div', { class: 'tgrid' });
      for (const x of tab.talents) {
        const cell = h('button', { type: 'button', class: 'tcell' + (x.rank === x.max ? ' max' : x.rank ? ' part' : ' none'),
          'aria-label': L('{0}: {1} из {2}', x.name, x.rank, x.max) }, gicon(x.icon, 'l'), h('b', null, `${x.rank}/${x.max}`));
        cell.style.gridRow = String(x.row + 1);
        cell.style.gridColumn = String(x.col + 1);
        cell.addEventListener('mouseenter', () => itipShowNode(cell, tip(x)));
        cell.addEventListener('focus', () => itipShowNode(cell, tip(x)));
        cell.addEventListener('mouseleave', () => itipHide(cell));
        cell.addEventListener('blur', () => itipHide(cell));
        grid.append(cell);
      }
      return h('div', { class: 'tree' + (tab.points && tab.points === top ? ' top' : '') },
        h('div', { class: 'tree-h' }, gicon(tab.icon, 'm'), h('div', null, h('b', null, TALENT_RU[tab.name] || tab.name),
          h('div', { class: 'muted small' }, tab.name)), h('span', { class: 'tree-pts' }, tab.points)),
        grid);
    })),
    h('p', { class: 'muted small' }, L('Наведите на талант — подсказка как в игре: что даёт текущий ранг и что даст следующий. Названия и описания — из файлов клиента (английские).')),
  ];
}

async function sessionsView(guid, cache) {
  if (!cache.sessions) cache.sessions = (await api('/api/character/sessions?guid=' + guid)).data;
  const s = cache.sessions;
  const days = sessionDays(s.sessions);
  const all = s.sessions;
  const total = all.reduce((a, x) => a + (x.secs || 0), 0);
  return [
    h('div', { class: 'tiles' },
      tile(L('Сессий в журнале'), fmtN(all.length), s.log_from ? L('журнал ядра ведётся с {0}', fmtD(s.log_from)) : null),
      tile(L('Наиграно по журналу'), fmtDur(total)),
      tile(L('Создан'), s.created ? fmtD(s.created) : '—'),
      tile(L('Последний вход'), all.length ? fmtDT(all[all.length - 1].start) : '—', all.length && all[all.length - 1].ongoing ? L('играет сейчас') : null)),
    card(L('Когда играл'), L('выберите день — покажу каждую сессию: вход, выход, сколько длилась, с какого IP'), null, h('div', { class: 'card-b' },
      calendarBox(days, {
        fmt: (v) => (v ? fmtDur(v) : '—'),
        summary: (keys) => sessionSummary(keys.flatMap((k) => days[k].items)),
        detail: (k) => h('div', null, days[k].items.map((x) => sessionRow(x, false))),
        empty: L('В этом месяце персонаж не заходил.'),
      }))),
  ];
}

async function charDrawer(guid, startTab) {
  const box = h('div', { class: 'drawer ch', role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'drawer-b' }, h('div', { class: 'empty' }, L('Загружаю…'))));
  const close = openOverlay(box);
  let tab = startTab || 'gear';
  let d = null;
  const tabBar = h('div', { class: 'ch-tabs' });
  const body = h('div', { class: 'ch-body' });
  const reload = () => load().catch((e) => toast(e.message, true));
  const cache = {};
  const views = { gear: () => gearView(d), inv: () => invView(d, reload), talents: () => talentsView(guid, cache),
                  sessions: () => sessionsView(guid, cache), stats: () => charStatsView(d, () => { tab = 'sessions'; drawTab(); }),
                  actions: () => [actionsView(d, reload, close)] };
  let seq = 0;
  // Таланты и сессии грузятся при первом открытии вкладки и запоминаются до перезагрузки карточки
  const drawTab = async () => {
    itipHide();
    const keys = d.character.deleteDate ? CH_TABS.filter(([k]) => k !== 'actions') : CH_TABS;
    if (!keys.some(([k]) => k === tab)) tab = 'gear';
    tabBar.replaceChildren(tabs(keys.map(([k, l]) => [k, k === 'inv' ? `${l} · ${invCount(d)}` : l]), tab, (k) => { tab = k; drawTab(); }));
    const my = ++seq;
    const res = views[tab]();
    if (res instanceof Promise) {
      body.replaceChildren(h('div', { class: 'empty' }, L('Загружаю…')));
      try { const nodes = await res; if (my === seq) body.replaceChildren(...nodes.filter(Boolean)); }
      catch (e) { if (my === seq) body.replaceChildren(errorCard(e)); }
    } else body.replaceChildren(...res.filter(Boolean));
  };
  const load = async () => {
    d = (await api('/api/character?guid=' + guid)).data;
    for (const k of Object.keys(cache)) delete cache[k];
    onItemClick = (it) => itemActionModal(d, it, reload);
    box.replaceChildren(charHero(d, () => close()), tabBar, body);
    drawTab();
  };
  try { await load(); } catch (e) {
    box.replaceChildren(h('div', { class: 'drawer-b' }, errorCard(e),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => close() }, L('Закрыть')))));
  }
}

// ============================================================ Модерация

PAGES.bans = {
  title: L('Модерация'), sub: L('Баны, немота, привязки к IP и подозрительные входы.'),
  async render(el) {
    const load = async () => {
      const d = (await api('/api/bans')).data;
      const unban = (type, target) => () => formModal({ title: L('Снять бан с {0}?', target), submit: L('Разбанить'),
        onSubmit: async () => (await api('/api/unban', { type, target })).data, onDone: load });
      el.replaceChildren(h('div', { class: 'stack' },
        h('div', { class: 'row' },
          h('button', { class: 'btn dng', type: 'button', onclick: () => banModal('account', null, load) }, L('Забанить аккаунт')),
          h('button', { class: 'btn dng', type: 'button', onclick: () => banModal('character', null, load) }, L('Забанить персонажа')),
          h('button', { class: 'btn dng', type: 'button', onclick: () => banModal('ip', null, load) }, L('Забанить IP'))),
        h('div', { class: 'grid g2' },
          card(L('Забаненные аккаунты: {0}', d.active.length), null, null, h('div', { class: 'card-b flush' }, table({
            cols: [
              { label: L('Аккаунт'), render: (r) => accLink(r.account_id, r.username) },
              { label: L('До'), render: (r) => (r.expires_at === r.banned_at ? L('навсегда') : fmtDT(r.expires_at)) },
              { label: L('Причина'), key: 'reason' }, { label: L('Кто'), key: 'banned_by' },
              { label: '', cls: 'r', render: (r) => h('button', { class: 'btn sm', type: 'button', onclick: unban('account', r.username) }, L('Снять')) },
            ], rows: d.active, empty: L('Забаненных нет.') }))),
          card(L('Забаненные IP: {0}', d.ips.length), L('сюда же попадают адреса после 5 неверных паролей'), null, h('div', { class: 'card-b flush' }, table({
            cols: [
              { label: 'IP', render: (r) => h('span', { class: 'mono' }, r.ip) },
              { label: L('До'), render: (r) => (r.expires_at === r.banned_at ? L('навсегда') : fmtDT(r.expires_at)) },
              { label: L('Причина'), key: 'reason' }, { label: L('Кто'), key: 'banned_by' },
              { label: '', cls: 'r', render: (r) => h('button', { class: 'btn sm', type: 'button', onclick: unban('ip', r.ip) }, L('Снять')) },
            ], rows: d.ips, empty: L('Забаненных адресов нет.') })))),
        h('div', { class: 'grid g3' },
          card(L('Немота'), null, null, h('div', { class: 'card-b flush' }, table({
            cols: [{ label: L('Аккаунт'), render: (r) => accLink(r.id, r.username) }, { label: L('До'), render: (r) => fmtDT(r.mutetime) }],
            rows: d.muted, empty: L('Ни у кого нет немоты.') }))),
          card(L('Привязаны к IP'), null, null, h('div', { class: 'card-b flush' }, table({
            cols: [{ label: L('Аккаунт'), render: (r) => accLink(r.id, r.username) }, { label: 'IP', render: (r) => h('span', { class: 'mono' }, r.lockedIp) }],
            rows: d.locked, empty: L('Привязанных нет.') }))),
          card(L('Неверные пароли подряд'), null, null, h('div', { class: 'card-b flush' }, table({
            cols: [{ label: L('Аккаунт'), render: (r) => accLink(r.id, r.username) }, { label: L('Попыток'), cls: 'r', key: 'failed_logins' }],
            rows: d.failed, empty: L('Подозрительных нет.') })))),
        card(L('История банов'), L('последние 60'), null, h('div', { class: 'card-b flush' }, banHistoryTable(d.history)))));
    };
    setTools(refreshBtn(() => load().catch((e) => toast(e.message, true))));
    await load();
  },
};

// ============================================================ Статистика

function dayRange(days) {
  const out = [];
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({ key, label: `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`, t: d });
  }
  return out;
}

const STAT_TABS = [['overview', L('Обзор')], ['factions', L('Фракции')], ['chars', L('Персонажи')], ['top', L('Лучшие')],
  ['economy', L('Экономика')], ['guilds', L('Гильдии')], ['logins', L('Входы и страны')], ['stability', L('Стабильность')]];
const FAC_TABS = [['both', L('Сравнение')], ['A', L('Альянс')], ['H', L('Орда')]];
const FAC_RACES = { A: [1, 3, 4, 7], H: [2, 5, 6, 8] };
const DAY_SEG = [[7, L('7 дней')], [30, L('30 дней')], [90, L('90 дней')], [365, L('год')]];
const TOP_KINDS = [['level', L('По уровню')], ['money', L('По золоту')], ['kills', L('По убийствам')], ['played', L('По времени в игре')]];
const TOP_VALUE = {
  level: [L('Уровень'), (r) => fmtN(r.level)], money: [L('Золото'), (r) => coins(r.money)],
  kills: [L('Почётных убийств'), (r) => fmtN(r.kills)], played: [L('Наиграно'), (r) => fmtDur(r.totaltime)],
};
const dec = (v) => nf.format(Number(v));
const goneAcc = (id) => h('span', { class: 'muted', title: L('аккаунта больше нет в базе') }, L('#{0} (удалён)', id));
const place = (n) => h('span', { class: 'place' + (n <= 3 ? ' p' + n : '') }, n);
const rankCell = (fac, r) => (r > 0 ? h('span', { class: 'rank-cell' }, gicon(rankIcon(fac, r), 's'), rankName(fac, r)) : '—');

/* «Альянс против Орды»: гербы, числа и общая полоса. */
function vsBlock(a, b, unit, subA, subB) {
  const total = a + b;
  const ia = h('i', { class: 'a' }), ib = h('i', { class: 'h' });
  ia.style.width = total ? ((a / total) * 100).toFixed(2) + '%' : '0';
  ib.style.width = total ? ((b / total) * 100).toFixed(2) + '%' : '0';
  const side = (fac, v, sub) => h('div', { class: 'vs-side ' + fac }, gicon(FAC_ICON[fac], 'xl'),
    h('div', null, h('b', null, fmtN(v)), h('span', null, `${FACTION[fac]} · ${unit}`), sub ? h('span', null, sub) : null));
  return h('div', { class: 'vs' }, side('A', a, subA),
    h('div', { class: 'vs-mid' }, h('div', { class: 'vs-bar' }, ia, ib),
      h('div', { class: 'lbl' }, h('span', null, total ? fmtPct((a / total) * 100) : '—'), h('span', null, total ? fmtPct((b / total) * 100) : '—'))),
    side('H', b, subB));
}

function raceCards(list, fac) {
  const by = Object.fromEntries(list.map((r) => [r.id, r]));
  const sum = list.reduce((a, r) => a + r.n, 0);
  return h('div', { class: 'races' }, FAC_RACES[fac].map((id) => {
    const r = by[id] || { n: 0, male: 0, female: 0, avg_level: 0 };
    const m = h('i', { class: 'm' }), f = h('i', { class: 'f' });
    m.style.width = r.n ? ((r.male / r.n) * 100).toFixed(1) + '%' : '0';
    f.style.width = r.n ? ((r.female / r.n) * 100).toFixed(1) + '%' : '0';
    return h('div', { class: 'race' + (r.n ? '' : ' none') },
      h('div', { class: 'pair' }, gicon(raceIcon(id, 0), 'l', RACES[id] + L(', мужчины')), gicon(raceIcon(id, 1), 'l', RACES[id] + L(', женщины'))),
      h('div', { class: 'race-t' }, h('div', { class: 'nm' }, RACES[id]),
        h('div', null, h('b', null, fmtN(r.n)), sum ? h('span', { class: 'muted small' }, '  ' + fmtPct((r.n / sum) * 100)) : null)),
      h('div', { class: 'split', title: L('мужчин {0}, женщин {1}', r.male, r.female) }, m, f),
      h('div', { class: 'leg' }, h('span', null, L('муж. {0}', fmtN(r.male))),
        h('span', null, r.n ? L('ср. ур. {0}', dec(r.avg_level)) : L('нет')), h('span', null, L('жен. {0}', fmtN(r.female)))));
  }));
}

const classRows = (S, cls) => S.classes.map((c) => ({ icon: classIcon(c.id), label: c.name, sub: L('средний уровень {0}', dec(c.avg_level)), v: c.n, cls }));
const profRows = (S) => S.professions.map((p) => ({
  icon: (PROF[p.id] || [])[1], label: (PROF[p.id] || [String(p.id)])[0], v: p.n,
  sub: L('навык в среднем {0}, лучший {1}', p.avg, p.max), cls: PRIMARY_PROF.has(p.id) ? null : 'acc' }));
const rankRows = (S, fac) => S.ranks.map((r) => ({ icon: rankIcon(fac, r.rank), label: rankName(fac, r.rank), sub: L('звание {0}', r.rank), v: r.n }));

function leaderboard(tops, st) {
  const box = h('div');
  const draw = () => {
    const rows = tops[st.top] || [];
    box.replaceChildren(tabs(TOP_KINDS, st.top, (k) => { st.top = k; draw(); }), table({
      cols: [
        { label: '#', render: (r) => place(rows.indexOf(r) + 1) },
        { label: L('Персонаж'), render: (r) => charCell(r) },
        { label: L('Ур.'), cls: 'r', key: 'level' },
        { label: L('Звание'), render: (r) => rankCell(r.faction, r.rank) },
        { label: L('Аккаунт'), render: (r) => h('span', { class: 'muted' }, r.username) },
        { label: TOP_VALUE[st.top][0], cls: 'r', render: TOP_VALUE[st.top][1] },
      ], rows, onRow: (r) => charDrawer(r.guid), empty: L('Пока некого показать.') }));
  };
  draw();
  return box;
}

function guildTable(rows) {
  return table({
    cols: [
      { label: L('Гильдия'), render: (g) => h('span', { class: 'name-cell' }, facIcon(g.faction), h('b', null, g.name)) },
      { label: L('Глава'), render: (g) => (g.leader ? charCell({ guid: g.leader_guid, name: g.leader, race: g.race, class: g.class, gender: g.gender }) : '—') },
      { label: L('Участников'), cls: 'r', key: 'members' },
      { label: L('В игре'), cls: 'r', render: (g) => (g.online ? badge(g.online, 'ok') : '0') },
      { label: L('Ср. уровень'), cls: 'r', render: (g) => (g.avg_level != null ? dec(g.avg_level) : '—') },
      { label: L('Создана'), render: (g) => fmtD(g.createdate) },
    ], rows, onRow: (g) => guildModal(g.guildid), empty: L('Гильдий нет.') });
}

function bracketChart(title, S, cls) {
  const data = S.brackets.map((b) => ({ label: b.label, v: b.n, tip: L('{0} уровень', b.label) }));
  return chartCard(title, L('персонажей по уровням'), (box) => columnChart(box, data, { label: title, cls }),
    { head: [L('Уровни'), L('Персонажей')], rows: data.map((x) => [x.label, fmtN(x.v)]) });
}

function factionCompare(d) {
  const A = d.A, H = d.H;
  const rows = [
    [L('Персонажей'), A.chars, H.chars], [L('В игре сейчас'), A.online, H.online],
    [L('Средний уровень'), A.avg_level, H.avg_level, dec], [L('60-го уровня'), A.level60, H.level60],
    [L('Золота всего'), A.money, H.money, coins], [L('Золота в среднем'), A.avg_money, H.avg_money, coins],
    [L('Наиграно всего'), A.played, H.played, fmtDur], [L('Почётных убийств'), A.kills, H.kills],
    [L('Гильдий'), A.guilds.length, H.guilds.length], [L('Высшее звание'), A.best_rank, H.best_rank, 'rank'],
  ];
  const cell = (r, i, fac) => {
    if (r[3] === 'rank') return rankCell(fac, r[i]);
    return h('span', { class: r[i] > r[i === 1 ? 2 : 1] ? 'win' : null }, (r[3] || fmtN)(r[i]));
  };
  const head = (fac) => h('span', { class: 'th-ic' }, gicon(FAC_ICON[fac], 's'), FACTION[fac]);
  return [
    card(null, null, null, h('div', { class: 'card-b' }, vsBlock(A.chars, H.chars, L('персонажей'), L('в игре: {0}', fmtN(A.online)), L('в игре: {0}', fmtN(H.online))))),
    card(L('Кто сильнее'), L('жирным — где фракция впереди'), null, h('div', { class: 'card-b flush' }, table({
      cols: [{ label: L('Показатель'), render: (r) => r[0] }, { label: head('A'), cls: 'r', render: (r) => cell(r, 1, 'A') },
             { label: head('H'), cls: 'r', render: (r) => cell(r, 2, 'H') }], rows }))),
    h('div', { class: 'grid g2' },
      card(L('Расы Альянса'), null, null, h('div', { class: 'card-b' }, raceCards(A.races, 'A'))),
      card(L('Расы Орды'), null, null, h('div', { class: 'card-b' }, raceCards(H.races, 'H')))),
    h('div', { class: 'grid g2' },
      card(L('Классы Альянса'), null, null, h('div', { class: 'card-b' }, iconBars(classRows(A)))),
      card(L('Классы Орды'), null, null, h('div', { class: 'card-b' }, iconBars(classRows(H, 's2'))))),
    h('div', { class: 'grid g2' }, bracketChart(L('Уровни Альянса'), A), bracketChart(L('Уровни Орды'), H, 's2')),
  ];
}

function factionView(d, fac, st) {
  const S = d[fac], all = d.all;
  const cls = fac === 'H' ? 's2' : null;
  const zones = S.zones.map((z) => ({ label: z.name, v: z.n, share: S.chars ? (z.n / S.chars) * 100 : 0, cls }));
  return [
    h('div', { class: 'fac-hero ' + fac }, gicon(FAC_ICON[fac], 'xl'),
      h('div', null, h('h2', null, FACTION[fac]),
        h('div', { class: 'sub' }, L('{0} персонажей{1} · мужчин {2}, женщин {3} · в игре сейчас {4} · гильдий {5}', fmtN(S.chars), all.chars ? L(' · {0} от всех', fmtPct((S.chars / all.chars) * 100)) : '', fmtN(S.male), fmtN(S.female), fmtN(S.online), fmtN(S.guilds.length))))),
    h('div', { class: 'tiles' },
      tile(L('Средний уровень'), S.chars ? dec(S.avg_level) : '—'), tile(L('60-го уровня'), fmtN(S.level60)),
      tile(L('Золота всего'), coins(S.money)), tile(L('В среднем'), coins(S.avg_money), L('на персонажа')),
      tile(L('Наиграно всего'), fmtDur(S.played)), tile(L('Почётных убийств'), fmtN(S.kills), S.dishonor ? L('бесчестных: {0}', fmtN(S.dishonor)) : null)),
    h('div', { class: 'grid g2' },
      card(L('Расы'), L('мужчины и женщины'), null, h('div', { class: 'card-b' }, raceCards(S.races, fac))),
      card(L('Классы'), null, null, h('div', { class: 'card-b' }, iconBars(classRows(S, cls), { empty: L('Персонажей нет.') })))),
    h('div', { class: 'grid g2' },
      bracketChart(L('Уровни'), S, cls),
      card(L('Профессии'), L('сколько персонажей владеет'), null, h('div', { class: 'card-b' }, iconBars(profRows(S), { share: false, empty: L('Профессий ни у кого нет.') })))),
    h('div', { class: 'grid g2' },
      card(L('Звания PvP'), L('высшее за всё время'), null, h('div', { class: 'card-b' }, iconBars(rankRows(S, fac), { empty: L('Званий ни у кого нет.') }))),
      chartCard(L('Где сейчас'), L('зоны, где персонажи вышли из игры'), (box) => hbarChart(box, zones, { label: L('Зоны') }),
        { head: [L('Зона'), L('Персонажей')], rows: zones.map((z) => [z.label, fmtN(z.v)]) })),
    card(L('Лучшие игроки фракции'), null, null, h('div', { class: 'card-b' }, leaderboard(S.tops, st))),
    card(L('Гильдии: {0}', S.guilds.length), null, null, h('div', { class: 'card-b flush' }, guildTable(S.guilds))),
  ];
}

function classRaceMatrix(mtx) {
  const races = [...FAC_RACES.A, ...FAC_RACES.H];
  const classes = Object.keys(CLASSES).map(Number);
  const val = (r, c) => (mtx[r] || {})[c] || 0;
  const max = Math.max(1, ...races.flatMap((r) => classes.map((c) => val(r, c))));
  const head = h('tr', null, h('th', null, L('Класс')),
    races.map((r) => h('th', { class: 'c' }, gicon(raceIcon(r, 0), 's', RACES[r], 'f' + RACE_FAC[r]))), h('th', { class: 'r' }, L('Всего')));
  const rows = classes.map((c) => {
    let sum = 0;
    const cells = races.map((r) => {
      const v = val(r, c);
      sum += v;
      const td = h('td', { class: 'c hm' + (v ? '' : ' z'), title: `${RACES[r]} · ${CLASSES[c]}: ${v}` }, v ? fmtN(v) : '·');
      if (v) td.style.setProperty('--a', (0.12 + 0.88 * (v / max)).toFixed(3));
      return td;
    });
    return h('tr', null, h('td', null, h('span', { class: 'name-cell' }, gicon(classIcon(c), 's'), CLASSES[c])), cells, h('td', { class: 'r' }, h('b', null, fmtN(sum))));
  });
  return h('div', { class: 'tbl-wrap' }, h('table', { class: 'data matrix' }, h('thead', null, head), h('tbody', null, rows)));
}

function heatOnline(history) {
  const sum = emptyWeek(), cnt = emptyWeek();
  for (const p of history) {
    const [w, hr] = weekCell(p.ts);
    sum[w][hr] += p.online || 0;
    cnt[w][hr] += 1;
  }
  return sum.map((row, i) => row.map((v, j) => (cnt[i][j] ? v / cnt[i][j] : 0)));
}

function statTools(st, draw) {
  const out = [];
  if (['overview', 'logins', 'stability'].includes(st.tab)) {
    const segs = st.tab === 'logins' ? [...DAY_SEG, [3650, L('всё время')]] : DAY_SEG;
    if (st.tab !== 'logins' && st.days > 365) st.days = 365;
    out.push(seg(segs, st.days, (k) => { st.days = k; draw(); }));
  }
  if (st.tab === 'logins') {
    if (!st.qInput) {
      st.qInput = h('input', { class: 'inp search', type: 'search', placeholder: L('Логин или IP'), autocomplete: 'off' });
      st.qInput.addEventListener('input', debounce(() => { st.q = st.qInput.value.trim(); st.logOffset = 0; draw(true); }, 350));
    }
    out.push(st.qInput);
  }
  if (SITE.bots && !['logins', 'stability'].includes(st.tab)) {
    out.push(h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: st.bots, onchange: (e) => { st.bots = e.target.checked; draw(); } }),
      L('считать ботов (персонажи плейерботов)')));
  }
  return out;
}

const STAT_VIEWS = {
  async overview(st, get, draw) {
    const d = await get(`/api/stats?days=${st.days}&bots=${st.bots ? 1 : 0}`);
    const e = d.economy;
    const days = dayRange(Math.min(d.days, 120));
    const regMap = Object.fromEntries(d.registrations.map((r) => [r.d, r.n]));
    const logMap = Object.fromEntries(d.logins.map((r) => [r.d, r.uniq]));
    const regs = days.map((x) => ({ label: x.label, v: regMap[x.key] || 0, tip: x.t.toLocaleDateString(LOCALE) }));
    const logs = days.map((x) => ({ label: x.label, v: logMap[x.key] || 0, tip: x.t.toLocaleDateString(LOCALE) }));
    const lvMap = Object.fromEntries(d.levels.map((r) => [r.level, r.n]));
    const levels = Array.from({ length: 60 }, (_, i) => ({ label: String(i + 1), v: lvMap[i + 1] || 0, tip: L('{0} уровень', i + 1) }));
    const alliance = d.races.filter((r) => r.faction === 'A').reduce((a, r) => a + r.n, 0);
    const horde = d.races.filter((r) => r.faction === 'H').reduce((a, r) => a + r.n, 0);
    const hist = d.history.map((p) => ({ t: p.ts, v: p.online }));
    const peak = d.history.reduce((m, p) => Math.max(m, p.online || 0), 0);
    // Охват берём по самим точкам: пока истории меньше двух суток, подписи-даты повторялись бы.
    const span = d.history.length ? d.history[d.history.length - 1].ts - d.history[0].ts : 0;
    const tickFmt = (t) => {
      const dt = new Date(t * 1000);
      if (span <= 36 * 3600) return dt.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
      if (span <= 6 * 86400) return dt.toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit' }) + ' ' + L('{0} ч', pad2(dt.getHours()));
      return dt.toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit' });
    };
    const more = h('button', { class: 'btn sm', type: 'button', onclick: () => { st.tab = 'factions'; st.fac = 'both'; setSubTab('factions'); draw(); } }, L('Подробнее'));
    return [
      h('div', { class: 'tiles' },
        tile(L('Персонажей'), fmtN(e.chars), st.bots ? L('вместе с ботами') : L('без ботов')),
        tile(L('Аккаунтов'), fmtN(d.accounts.n), L('заходили за неделю: {0}', fmtN(d.accounts.active7))),
        tile(L('Средний уровень'), e.chars ? dec(Math.round(e.avg_level * 10) / 10) : '—'),
        tile(L('Золота у всех'), coins(e.money), e.chars ? h('span', null, L('в среднем '), coins(e.avg_money)) : null),
        tile(L('Наиграно всего'), fmtDur(e.played)),
        tile(L('Рекорд онлайна'), fmtN(peak), L('за {0} дн., по точкам раз в 5 минут', d.days))),
      h('div', { class: 'grid g2' },
        chartCard(L('Игроков онлайн'), null, (box) => lineChart(box, hist, { label: L('Игроков онлайн'), gap: 900, fmtTick: tickFmt,
          empty: L('История копится с запуска панели: точка раз в 5 минут.') }),
          { head: [L('Время'), L('Игроков')], rows: d.history.slice(-200).reverse().map((p) => [fmtDT(p.ts), fmtN(p.online)]) }),
        card(L('Когда играют'), L('в среднем онлайн по дням недели и часам'), null, h('div', { class: 'card-b' },
          heatmap(heatOnline(d.history), { fmt: (v) => (Math.round(v * 10) / 10).toString().replace('.', ','),
            note: L('Время — по часам вашего компьютера. Чем ярче клетка, тем больше игроков обычно в это время.') })))),
      card(L('Альянс и Орда'), null, more, h('div', { class: 'card-b' }, vsBlock(alliance, horde, L('персонажей')))),
      h('div', { class: 'grid g2' },
        chartCard(L('Регистрации'), L('аккаунтов в день'), (box) => columnChart(box, regs, { label: L('Регистрации по дням') }),
          { head: [L('День'), L('Аккаунтов')], rows: regs.filter((r) => r.v).reverse().map((r) => [r.tip, fmtN(r.v)]) }),
        chartCard(L('Заходили в мир'), L('разных аккаунтов в день'), (box) => columnChart(box, logs, { label: L('Входы в мир по дням') }),
          { head: [L('День'), L('Аккаунтов')], rows: logs.filter((r) => r.v).reverse().map((r) => [r.tip, fmtN(r.v)]) })),
      chartCard(L('Уровни'), L('сколько персонажей на каждом уровне'), (box) => columnChart(box, levels, { label: L('Распределение по уровням'), labelFilter: (x, i) => i === 0 || (i + 1) % 10 === 0 }),
        { head: [L('Уровень'), L('Персонажей')], rows: levels.filter((l) => l.v).map((l) => [l.label, fmtN(l.v)]) }),
    ];
  },

  async factions(st, get, draw) {
    const d = await get(`/api/stats/factions?bots=${st.bots ? 1 : 0}`);
    const sub = h('div', { class: 'subtabs' }, tabs(FAC_TABS.map(([k, l]) => [k, k === 'both' ? l : h('span', { class: 'tab-ic' }, gicon(FAC_ICON[k], 's'), l)]),
      st.fac, (k) => { st.fac = k; setSubTab('factions', k === 'both' ? '' : k); draw(); }));
    return [sub, ...(st.fac === 'both' ? factionCompare(d) : factionView(d, st.fac, st))];
  },

  async chars(st, get) {
    const d = await get(`/api/stats/factions?bots=${st.bots ? 1 : 0}`);
    const S = d.all;
    const raceRows = S.races.map((r) => ({ iconNode: gicon(raceIcon(r.id, 0), 'm', null, 'f' + r.faction), label: r.name,
      sub: L('{0} · муж. {1}, жен. {2}', FACTION[r.faction], r.male, r.female), v: r.n, cls: r.faction === 'H' ? 's2' : null }));
    const levels = S.levels.map((v, i) => ({ label: String(i + 1), v, tip: L('{0} уровень', i + 1) }));
    const zones = S.zones.map((z) => ({ label: z.name, v: z.n, share: S.chars ? (z.n / S.chars) * 100 : 0 }));
    return [
      h('div', { class: 'tiles' },
        tile(L('Персонажей'), fmtN(S.chars), st.bots ? L('вместе с ботами') : L('без ботов')),
        tile(L('Мужчин'), fmtN(S.male), S.chars ? fmtPct((S.male / S.chars) * 100) : null),
        tile(L('Женщин'), fmtN(S.female), S.chars ? fmtPct((S.female / S.chars) * 100) : null),
        tile(L('Средний уровень'), S.chars ? dec(S.avg_level) : '—'),
        tile(L('60-го уровня'), fmtN(S.level60)),
        tile(L('Сейчас в игре'), fmtN(S.online))),
      h('div', { class: 'grid g2' },
        card(L('Классы'), null, null, h('div', { class: 'card-b' }, iconBars(classRows(S), { empty: L('Персонажей нет.') }))),
        card(L('Расы'), null, null, h('div', { class: 'card-b' }, iconBars(raceRows, { empty: L('Персонажей нет.') })))),
      card(L('Класс и раса'), L('сколько персонажей в каждом сочетании'), null, h('div', { class: 'card-b flush' }, classRaceMatrix(S.matrix || {}))),
      h('div', { class: 'grid g2' },
        card(L('Профессии'), L('сколько персонажей владеет'), null, h('div', { class: 'card-b' }, iconBars(profRows(S), { share: false, empty: L('Профессий ни у кого нет.') }))),
        chartCard(L('Уровни'), L('по одному'), (box) => columnChart(box, levels, { label: L('Уровни'), labelFilter: (x, i) => i === 0 || (i + 1) % 10 === 0 }),
          { head: [L('Уровень'), L('Персонажей')], rows: levels.filter((l) => l.v).map((l) => [l.label, fmtN(l.v)]) })),
      chartCard(L('Где сейчас'), L('зоны, где персонажи вышли из игры'), (box) => hbarChart(box, zones, { label: L('Зоны') }),
        { head: [L('Зона'), L('Персонажей')], rows: zones.map((z) => [z.label, fmtN(z.v)]) }),
    ];
  },

  async top(st, get) {
    const d = await get(`/api/stats/factions?bots=${st.bots ? 1 : 0}`);
    const wrap = h('div', { class: 'stack' });
    const facTabs = [['all', L('Все')], ...['A', 'H'].map((k) => [k, h('span', { class: 'tab-ic' }, gicon(FAC_ICON[k], 's'), FACTION[k])])];
    const paint = () => {
      const S = st.topFac === 'all' ? d.all : d[st.topFac];
      wrap.replaceChildren(
        h('div', { class: 'subtabs' }, tabs(facTabs, st.topFac, (k) => { st.topFac = k; paint(); })),
        card(null, null, null, h('div', { class: 'card-b' }, leaderboard(S.tops, st))));
    };
    paint();
    return [wrap];
  },

  async economy(st, get) {
    const d = await get(`/api/stats/economy?bots=${st.bots ? 1 : 0}`);
    const epic = d.quality.filter((q) => q.q >= 4).reduce((a, q) => a + q.n, 0);
    const avgBr = d.brackets.map((b) => ({ label: b.label, v: b.n ? b.money / b.n / 10000 : 0, tip: L('{0} уровень · {1} перс.', b.label, fmtN(b.n)) }));
    const qRows = d.quality.map((q) => ({ iconNode: h('span', { class: 'qdot qd' + q.q }), label: h('span', { class: 'q' + q.q }, QUALITY[q.q] || q.q), v: q.n }));
    return [
      h('div', { class: 'tiles' },
        tile(L('Золота у всех'), coins(d.money), L('{0} персонажей', fmtN(d.chars))),
        tile(L('В среднем'), coins(d.avg), L('на персонажа')),
        tile(L('Медиана'), coins(d.median), L('у половины меньше')),
        tile(L('У десяти богатейших'), fmtPct(d.top10_share), L('доля всего золота')),
        tile(L('Вещей у персонажей'), fmtN(d.items), L('надето, в сумках, банке и почте')),
        tile(L('Эпических и выше'), fmtN(epic))),
      h('div', { class: 'grid g2' },
        chartCard(L('Золото по уровням'), L('в среднем на персонажа, золотых'), (box) => columnChart(box, avgBr, { label: L('Золото по уровням'), fmtV: (v) => fmtMoney(v * 10000) }),
          { head: [L('Уровни'), L('В среднем'), L('Персонажей')], rows: d.brackets.map((b) => [b.label, fmtMoney(b.n ? b.money / b.n : 0), fmtN(b.n)]) }),
        card(L('Вещи по качеству'), null, null, h('div', { class: 'card-b' }, iconBars(qRows, { empty: L('Вещей нет.') })))),
      h('div', { class: 'grid g2' },
        card(L('Самые богатые'), null, null, h('div', { class: 'card-b flush' }, table({
          cols: [{ label: '#', render: (r) => place(d.richest.indexOf(r) + 1) }, { label: L('Персонаж'), render: (r) => charCell(r) },
                 { label: L('Ур.'), cls: 'r', key: 'level' }, { label: L('Деньги'), cls: 'r', render: (r) => coins(r.money) }],
          rows: d.richest, onRow: (r) => charDrawer(r.guid), empty: L('Ни у кого нет денег.') }))),
        card(L('Эпические и легендарные вещи'), L('у кого есть'), null, h('div', { class: 'list scroll' }, d.best.length ? d.best.map((it) => {
          const ic = h('span', { class: 'bslot sm sq' + it.quality, tabindex: 0 }, gicon(it.icon, 'l'));
          bindItemTip(ic, { entry: it.entry, icon: it.icon, name: it.name, quality: it.quality });
          return h('div', { class: 'li' }, ic, h('span', { class: 'grow' }, h('span', { class: 'q' + it.quality }, it.name),
            h('div', { class: 'muted small' }, L('ур. предмета {0} · {1}', it.ilvl, it.owners === 1 ? it.names : L('{0} перс.: {1}{2}', fmtN(it.owners), it.names, it.owners > 4 ? '…' : '')))),
            it.n > 1 ? badge('×' + it.n) : null);
        }) : h('div', { class: 'empty' }, L('Эпических вещей ни у кого нет.'))))),
    ];
  },

  async guilds(st, get) {
    const d = await get(`/api/stats/factions?bots=${st.bots ? 1 : 0}`);
    const G = d.all.guilds;
    const members = G.reduce((a, g) => a + g.members, 0);
    return [
      h('div', { class: 'tiles' },
        tile(L('Гильдий'), fmtN(G.length), st.bots ? L('вместе с гильдиями ботов') : L('где глава — живой игрок')),
        tile(L('Альянса'), fmtN(d.A.guilds.length)), tile(L('Орды'), fmtN(d.H.guilds.length)),
        tile(L('Участников'), fmtN(members)), tile(L('Сейчас в игре'), fmtN(G.reduce((a, g) => a + g.online, 0)))),
      card(L('Гильдии: {0}', G.length), L('нажмите на строку — откроется состав'), null, h('div', { class: 'card-b flush' }, guildTable(G))),
    ];
  },

  async logins(st, get, draw) {
    const d = await get(`/api/stats/logins?days=${st.days}&q=${encodeURIComponent(st.q || '')}`);
    const world = d.rows.filter((r) => r.source === 1);
    const real = d.countries.filter((c) => c.code !== 'LAN' && c.code !== '??');
    const heat = emptyWeek();
    for (const r of world) { const [w, hr] = weekCell(r.at); heat[w][hr] += 1; }
    const countryRows = d.countries.map((c) => ({ iconNode: h('span', { class: 'cc big' + (c.code === 'LAN' ? ' lan' : '') }, c.code),
      label: c.name, sub: L('{0} акк. · {1} IP', fmtN(c.accounts), fmtN(c.ips)), v: c.n }));
    const journal = h('div');
    const LIMIT = 50;
    st.logOffset = st.logOffset || 0;
    const drawJournal = () => {
      const rows = d.rows.slice(st.logOffset, st.logOffset + LIMIT);
      journal.replaceChildren(table({
        cols: [
          { label: L('Когда'), render: (r) => h('span', null, fmtDT(r.at), h('span', { class: 'muted small' }, '  ' + ago(r.at))) },
          { label: L('Аккаунт'), render: (r) => (r.username ? accLink(r.account_id, r.username) : goneAcc(r.account_id)) },
          { label: 'IP', render: (r) => h('span', { class: 'mono small' }, r.ip) },
          { label: L('Страна'), render: (r) => countryTag(r.country) },
          { label: L('Куда'), render: (r) => (r.source === 1 ? badge(L('в мир'), 'ok') : badge(L('авторизация'))) },
        ], rows, empty: L('Входов за этот период нет.') }),
      pager(d.rows.length, LIMIT, st.logOffset, (o) => { st.logOffset = Math.max(0, o); drawJournal(); }));
    };
    drawJournal();
    return [
      h('div', { class: 'tiles' },
        tile(L('Входов в мир'), fmtN(world.length), L('за {0}', d.days >= 3650 ? L('всё время') : d.days + L(' дн.'))),
        tile(L('Авторизаций'), fmtN(d.rows.length - world.length), L('ввод логина и пароля')),
        tile(L('Аккаунтов'), fmtN(d.accounts)), tile(L('Разных IP'), fmtN(d.ips.length)),
        tile(L('Стран'), fmtN(real.length), d.countries.some((c) => c.code === 'LAN') ? L('и локальная сеть') : null)),
      d.truncated ? h('div', { class: 'alert warning' }, icon('warn'), h('span', null, L('Показаны последние 5000 входов — сузьте период или поиск.'))) : null,
      h('div', { class: 'grid g2' },
        card(L('Страны'), L('по базе GeoLite2 на сервере'), null, h('div', { class: 'card-b' }, iconBars(countryRows, { empty: L('Входов нет.') }))),
        card(L('Когда заходят'), L('входы в мир по дням недели и часам'), null, h('div', { class: 'card-b' },
          heatmap(heat, { note: L('Время — по часам вашего компьютера.') })))),
      h('div', { class: 'grid g2' },
        card(L('Один IP — несколько аккаунтов'), L('бывает в одной семье, бывает твинки'), null, h('div', { class: 'card-b flush' }, table({
          cols: [{ label: 'IP', render: (r) => ipCell(r.ip, r.country) },
                 { label: L('Аккаунты'), render: (r) => h('span', { class: 'acc-list' }, r.accounts.map((a) => (a.gone ? goneAcc(a.id) : accLink(a.id, a.username)))) },
                 { label: L('Входов'), cls: 'r', render: (r) => fmtN(r.n) }],
          rows: d.shared, empty: L('Такого нет: у каждого адреса один аккаунт.') }))),
        card(L('Аккаунты из разных стран'), L('возможен VPN или чужой вход'), null, h('div', { class: 'card-b flush' }, table({
          cols: [{ label: L('Аккаунт'), render: (r) => (r.gone ? goneAcc(r.id) : accLink(r.id, r.username)) },
                 { label: L('Страны'), render: (r) => h('span', { class: 'acc-list' }, r.countries.map((c) => h('span', { class: 'cc' }, c))) },
                 { label: 'IP', cls: 'r', render: (r) => fmtN(r.ips) }, { label: L('Входов'), cls: 'r', render: (r) => fmtN(r.n) }],
          rows: d.travellers, empty: L('Все заходят из одной страны.') })))),
      card(L('Журнал входов'), L('новые сверху'), null, h('div', { class: 'card-b flush' }, journal)),
    ];
  },

  async stability(st, get) {
    const d = await get(`/api/stats?days=${st.days}&bots=0`);
    const since = Date.now() / 1000 - d.days * 86400;
    const inPeriod = d.sessions.filter((s) => s.starttime >= since);
    const past = inPeriod.slice(1);
    const avg = past.length ? past.reduce((a, s) => a + s.uptime, 0) / past.length : null;
    const longest = inPeriod.reduce((m, s) => Math.max(m, s.uptime), 0);
    const short = past.filter((s) => s.uptime < 1800).length;
    const mem = d.history.map((p) => ({ t: p.ts, v: p.mem_mb }));
    const cpu = d.history.map((p) => ({ t: p.ts, v: p.cpu }));
    const tick = (t) => new Date(t * 1000).toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit' });
    return [
      h('div', { class: 'tiles' },
        tile(L('Перезапусков'), fmtN(d.restarts), L('за {0} дн.', d.days)),
        tile(L('Текущая сессия'), d.sessions[0] ? fmtDur(d.sessions[0].uptime) : '—', d.sessions[0] ? L('с ') + fmtDT(d.sessions[0].starttime) : null),
        tile(L('Средняя сессия'), avg != null ? fmtDur(avg) : '—', L('без текущей')),
        tile(L('Самая долгая'), longest ? fmtDur(longest) : '—'),
        tile(L('Короткие сессии'), fmtN(short), L('меньше 30 минут — признак падений'))),
      h('div', { class: 'grid g2' },
        chartCard(memLabel(), L('МБ'), (box) => lineChart(box, mem, { label: L('{0}, МБ', memLabel()), gap: 900, fmtTick: tick, fmtV: (v) => L('{0} МБ', fmtN(v)),
          empty: L('История копится с запуска панели.') }),
          { head: [L('Время'), L('МБ')], rows: d.history.slice(-200).reverse().map((p) => [fmtDT(p.ts), fmtN(p.mem_mb)]) }),
        chartCard(L('Процессор'), L('% одного ядра'), (box) => lineChart(box, cpu, { label: L('Процессор'), gap: 900, fmtTick: tick, fmtV: (v) => fmtPct(v),
          empty: L('История копится с запуска панели.') }),
          { head: [L('Время'), '%'], rows: d.history.slice(-200).reverse().map((p) => [fmtDT(p.ts), fmtPct(p.cpu)]) })),
      card(L('Сессии мира'), L('короткие подряд — признак падений'), null, h('div', { class: 'card-b flush' }, table({
        cols: [{ label: L('Запуск'), render: (r) => fmtDT(r.starttime) },
               { label: L('Проработал'), cls: 'r', render: (r) => fmtDur(r.uptime) },
               { label: L('Макс. онлайн'), cls: 'r', key: 'maxplayers' },
               { label: '', render: (r) => (d.sessions.indexOf(r) === 0 ? badge(L('текущая'), 'ok') : r.uptime < 1800 ? badge(L('короткая'), 'warn') : '') }],
        rows: d.sessions.slice(0, 40), empty: L('Нет данных о сессиях.') }))),
    ];
  },
};

PAGES.stats = {
  title: L('Статистика'), sub: L('Игроки и фракции, экономика, входы со странами, стабильность мира.'),
  async render(el) {
    const st = { tab: subTab(STAT_TABS.map((t) => t[0]), 'overview'), fac: subTab(['A', 'H'], 'both', 2),
                 days: 30, bots: false, top: 'level', topFac: 'all', q: '', seq: 0, cache: {} };
    const bar = h('div'), tools = h('div', { class: 'row stat-tools' }), body = h('div', { class: 'stack' });
    const get = async (url) => {
      if (!st.cache[url]) st.cache[url] = (await api(url)).data;
      return st.cache[url];
    };
    // keepTools — перерисовать только содержимое: иначе поле поиска теряет фокус на каждой букве
    const draw = async (keepTools) => {
      const my = ++st.seq;
      hideTip();
      itipHide();
      bar.replaceChildren(tabs(STAT_TABS, st.tab, (k) => {
        st.tab = k;
        setSubTab(k === 'overview' ? '' : k, k === 'factions' && st.fac !== 'both' ? st.fac : '');
        draw();
      }));
      if (keepTools !== true) tools.replaceChildren(...statTools(st, draw));
      body.classList.add('loading');
      try {
        const nodes = await STAT_VIEWS[st.tab](st, get, draw);
        if (my !== st.seq) return;
        body.replaceChildren(...[].concat(nodes).filter(Boolean));
      } catch (e) {
        if (my === st.seq) body.replaceChildren(errorCard(e));
      } finally {
        if (my === st.seq) body.classList.remove('loading');
      }
    };
    setTools(refreshBtn(() => { st.cache = {}; draw(); }));
    el.replaceChildren(h('div', { class: 'stack' }, bar, tools, body));
    await draw();
  },
};

async function guildModal(id) {
  const box = h('div', { class: 'modal wide' });
  const close = openOverlay(box);
  try {
    const d = (await api('/api/guild?id=' + id)).data;
    box.append(
      h('div', { class: 'modal-h' }, h('div', null, h('h3', null, d.guild.name), h('p', null, d.guild.motd || d.guild.info || '')),
        h('button', { class: 'btn ghost sm x', type: 'button', onclick: () => close() }, icon('x'))),
      h('div', { class: 'modal-b' }, table({
        cols: [{ label: L('Имя'), render: (r) => charCell(r) }, { label: L('Ур.'), cls: 'r', key: 'level' },
               { label: L('Класс'), key: 'class_name' }, { label: L('Звание'), render: (r) => r.rname || r.rank },
               { label: L('Заходил'), render: (r) => (r.online ? L('в игре') : ago(r.logout_time)) }],
        rows: d.members, empty: L('Пусто.') })));
  } catch (e) { box.append(h('div', { class: 'modal-b' }, errorCard(e))); }
}

// ============================================================ Сервер

const SERVER_TABS = [['restart', L('Перезапуск')], ['access', L('Доступ')], ['messages', L('Сообщения игрокам')], ['realm', L('Реалм')],
  ['services', L('Службы')], ['config', L('Настройки mangosd.conf')]];

/* Вкладки, которые строятся из данных /api/overview и /api/world и перерисовываются
   после каждого действия. Остальные строятся один раз при открытии вкладки — чтобы
   обновления не стирали набранный текст. */
const SERVER_LIVE = new Set(['restart', 'access', 'services']);

const SERVER_VIEWS = {
  restart: (box, ov, w, reload) => paintRestart(box, ov, w, reload),
  access: (box, ov, w, reload) => paintAccess(box, ov, w, reload),
  messages: (box) => box.replaceChildren(messagesView()),
  realm: (box, ov, w, reload) => box.replaceChildren(realmView(ov, reload)),
  services: (box, ov, w, reload) => box.replaceChildren(servicesView(ov, reload)),
  config: (box) => {
    box.replaceChildren(h('div', { class: 'empty' }, L('Загружаю настройки…')));
    renderConfig(box).catch((e) => box.replaceChildren(errorCard(e)));
  },
};

PAGES.server = {
  title: L('Сервер'), sub: L('Сверху — состояние мира и таймер перезапуска, ниже — всё остальное по вкладкам.'),
  async render(el) {
    let tab = subTab(SERVER_TABS.map((t) => t[0]), 'restart');
    const worldBox = h('div'), bar = h('div'), body = h('div', { class: 'stack' });
    let ov = null, w = null;
    const fetchState = async () => {
      const [a, b] = await Promise.all([api('/api/overview'), api('/api/world')]);
      ov = a.data;
      w = b.data;
    };
    const drawTab = () => {
      bar.replaceChildren(tabs(SERVER_TABS, tab, (k) => { tab = k; setSubTab(k === 'restart' ? '' : k); drawTab(); }));
      SERVER_VIEWS[tab](body, ov, w, again);
    };
    // «Игровой мир» и живые вкладки строятся из одних данных и после каждого действия перерисовываются вместе.
    const refresh = async () => {
      await fetchState();
      paintWorld(worldBox, ov, w, again);
      if (SERVER_LIVE.has(tab)) SERVER_VIEWS[tab](body, ov, w, again);
    };
    const again = () => refresh().catch((e) => toast(e.message, true));
    await fetchState();
    paintWorld(worldBox, ov, w, again);
    drawTab();
    setTools(refreshBtn(again));
    el.replaceChildren(h('div', { class: 'stack' }, worldBox, bar, body));
  },
};

function messagesView() {
  const annText = h('textarea', { class: 'inp', placeholder: L('Текст объявления'), maxlength: 250 });
  const send = (kind) => async () => {
    try {
      const r = (await api('/api/server', { action: kind, text: annText.value })).data;
      toast(r.success ? L('Отправлено.') : r.output, !r.success);
      if (r.success) annText.value = '';
    } catch (e) { toast(e.message, true); }
  };
  const annCard = card(L('Объявление'), L('увидят все, кто в игре'), null, h('div', { class: 'card-b cbody' },
    annText,
    h('div', { class: 'row' }, h('button', { class: 'btn pri', type: 'button', onclick: send('announce') }, L('В чат')),
      h('button', { class: 'btn', type: 'button', onclick: send('notify') }, L('Крупно на экран'))),
    h('small', { class: 'muted' }, L('«В чат» — строкой в чате у всех. «Крупно на экран» — надписью посреди экрана.'))));
  annCard.classList.add('fill');

  const motd = h('input', { class: 'inp', maxlength: 250, placeholder: L('Приветствие') });
  const persist = h('input', { type: 'checkbox', checked: true });
  const motdCard = card(L('Приветствие при входе'), L('игрок видит его в чате сразу после входа'), null, h('div', { class: 'card-b cbody' },
    h('div', { class: 'row inline-inp' }, motd, h('button', { class: 'btn pri', type: 'button', onclick: async () => {
      try { const r = (await api('/api/server', { action: 'motd', text: motd.value, persist: persist.checked })).data; toast(r.output || L('Готово.'), !r.success); }
      catch (e) { toast(e.message, true); } } }, L('Сохранить'))),
    h('label', { class: 'chk' }, persist, L('записать в mangosd.conf, чтобы пережило перезапуск')),
    h('small', { class: 'muted' }, L('Сейчас в поле — значение Motd из mangosd.conf.'))));
  // Текущее приветствие берём из конфига, не дожидаясь его: вкладка открывается сразу.
  api('/api/config').then((r) => {
    const it = r.data.groups.flatMap((g) => g.items).find((x) => x.key === 'Motd');
    if (it && !motd.value) motd.value = it.value;
  }).catch(() => {});
  return h('div', { class: 'grid g2 eq' }, h('div', { class: 'cell' }, annCard), h('div', { class: 'cell' }, motdCard));
}

function realmView(ov, reload) {
  const r = ov.realm || {};
  const realmName = h('input', { class: 'inp', maxlength: 32, value: r.name || '' });
  const nameCard = card(L('Название'), null, null, h('div', { class: 'card-b cbody' },
    h('div', { class: 'field' }, h('span', null, L('Название в списке миров')),
      h('div', { class: 'row inline-inp' }, realmName, h('button', { class: 'btn pri', type: 'button', onclick: async () => {
        try { const res = (await api('/api/server', { action: 'realm_name', name: realmName.value })).data; toast(res.output); reload(); }
        catch (e) { toast(e.message, true); } } }, L('Сохранить'))),
      h('small', null, L('Так сервер называется у игроков в списке миров. Новое имя появится примерно через 20 секунд.')))));
  const infoCard = card(L('Как реалм видят игроки'), L('из таблицы realmlist'), null, h('div', { class: 'card-b' }, facts([
    [L('Адрес для клиента'), r.address ? `${r.address}:${r.port}` : '—'], [L('Номер реалма'), r.id],
    [L('Вход для игроков'), r.allowedSecurityLevel ? badge(L('только администраторы'), 'warn') : badge(L('открыт для всех'), 'ok')],
    [L('Версии клиента'), r.realmbuilds || '—'], [L('Населённость'), r.population != null ? dec(Math.round(r.population * 100) / 100) : '—'],
    [L('Ядро'), (ov.server && (ov.server.version || ov.server.error)) || '—'],
  ])));
  return h('div', { class: 'grid g2 eq' }, h('div', { class: 'cell' }, nameCard), h('div', { class: 'cell' }, infoCard));
}

function servicesView(ov, reload) {
  const memFrac = ov.container.mem && ov.container.limit ? ov.container.mem / ov.container.limit : null;
  const diskUsed = ov.host.disk_total ? 1 - ov.host.disk_free / ov.host.disk_total : null;
  return h('div', { class: 'stack' },
    h('div', { class: 'tiles' },
      h('div', { class: 'tile' }, h('div', { class: 'l' }, memLabel()), h('div', { class: 'v' }, fmtBytes(ov.container.mem)),
        h('div', { class: 'd' }, L('из {0}', fmtBytes(ov.container.limit))), memFrac != null ? meter(memFrac) : null),
      tile(L('Процессор'), fmtPct(ov.container.cpu), cpuNote(ov.host.ncpu)),
      h('div', { class: 'tile' }, h('div', { class: 'l' }, L('Диск свободен')), h('div', { class: 'v' }, fmtBytes(ov.host.disk_free)),
        h('div', { class: 'd' }, L('из {0}', fmtBytes(ov.host.disk_total))), diskUsed != null ? meter(diskUsed) : null),
      tile(L('Нагрузка хоста'), ov.host.load.map((x) => x.toFixed(2)).join(' · '), L('за 1, 5 и 15 минут'))),
    card(L('Службы'), null, null, h('div', { class: 'card-b flush' }, serviceTable(ov.services, reload))));
}

// Подписи в винительном падеже: «через 1 минуту».
const DELAYS = [['10', L('10 секунд')], ['60', L('1 минуту')], ['300', L('5 минут')], ['900', L('15 минут')], ['1800', L('30 минут')]];
const delayLabel = (v) => ((DELAYS.find(([k]) => k === String(v)) || [0, v + L(' с')])[1]);
const pad2 = (n) => String(n).padStart(2, '0');
const toLocalInput = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const clock = (sec) => {
  sec = Math.max(0, Math.round(sec));
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  return (hh ? hh + ':' + pad2(mm) : String(mm)) + ':' + pad2(ss);
};

function btnEl(label, cls, onclick, disabled) {
  return h('button', { class: 'btn' + (cls ? ' ' + cls : ''), type: 'button', onclick, disabled: !!disabled }, label);
}

// Окно подтверждения; payload собирается в момент нажатия — так берётся текущий отсчёт.
function askAction({ title, text, submit, danger, url = '/api/server', payload, reload, wait = 800 }) {
  return () => formModal({ title, text: typeof text === 'function' ? text() : text, submit, danger,
    onSubmit: async () => (await api(url, payload())).data, onDone: () => setTimeout(reload, wait) });
}

/* Сверху: состояние мира, сводка и таймер перезапуска. Таймер тикает в браузере
   от оставшихся секунд, которые прислал сервер, — часы компьютера не важны. */
function paintWorld(box, ov, w, reload) {
  clearInterval(box._tick);
  clearTimeout(box._poll);
  const realm = ov.realm || {};
  const online = ov.counts ? ov.counts.online : null;
  const cd = w.countdown;
  const next = w.schedule[0];
  const state = !w.running ? (cd ? badge(L('перезапускается'), 'warn') : badge(L('не запущен'), 'bad'))
    : cd ? badge(L('идёт отсчёт перезапуска'), 'warn') : badge(L('работает'), 'ok');
  // Пока идёт перезапуск, опрашиваем сервер и перерисовываем только эту карточку —
  // иначе каждые 10 секунд стиралось бы то, что набирают в карточках ниже. Как только
  // мир поднялся или отсчёт исчез — обновляем всю страницу.
  const poll = async () => {
    if (!box.isConnected) return;
    try {
      const [o2, w2] = await Promise.all([api('/api/overview'), api('/api/world')]);
      if (w2.data.running !== w.running || !!w2.data.countdown !== !!cd) reload();
      else paintWorld(box, o2.data, w2.data, reload);
    } catch (e) { box._poll = setTimeout(poll, 15000); }
  };

  let timer = null;
  if (cd || !w.running) {
    const big = h('div', { class: 'cd-time' });
    const note = h('div', { class: 'cd-note' });
    const endAt = Date.now() + (cd ? cd.left : 0) * 1000;
    const paint = () => {
      const left = (endAt - Date.now()) / 1000;
      if (!w.running) {
        big.textContent = cd ? L('Мир перезапускается…') : L('Мир сейчас не запущен');
        note.textContent = L('Если мир запущен под systemd, он поднимется сам, обычно за 15–60 секунд. Если дольше — загляните в «Логи».');
      } else if (left > 0) {
        big.textContent = (cd.kind === 'idle' ? L('Не раньше чем через ') : L('Перезапуск через ')) + clock(left);
        note.textContent = (cd.kind === 'idle' ? L('Перезапуск, когда никого не будет: после отсчёта мир дождётся, пока все выйдут. ')
          : L('Игроки видят отсчёт в чате. ')) + (cd.source === 'по расписанию' ? L('Запущен по расписанию.') : L('Запущен из панели.'));
      } else {
        big.textContent = cd.kind === 'idle' && online ? L('Ждёт, пока все выйдут') : L('Мир перезапускается…');
        note.textContent = cd.kind === 'idle' && online ? L('Сейчас в игре: {0}. Как только никого не останется, мир перезапустится.', online)
          : L('Если мир запущен под systemd, он поднимется сам, обычно за 15–60 секунд.');
        clearInterval(box._tick);
        box._poll = setTimeout(poll, cd.kind === 'idle' && online ? 30000 : 10000);
      }
    };
    paint();
    if (w.running && cd && cd.left > 0) box._tick = setInterval(() => { if (box.isConnected) paint(); else clearInterval(box._tick); }, 1000);
    if (!w.running) box._poll = setTimeout(poll, 10000);
    timer = h('div', { class: 'cd' }, h('div', { class: 'cd-text' }, big, note),
      w.running && cd ? btnEl(L('Отменить отсчёт'), '', askAction({ title: L('Отменить отсчёт?'), submit: L('Отменить отсчёт'), reload,
        text: L('Отсчёт остановится, мир продолжит работать.'), payload: () => ({ action: 'cancel' }) })) : null);
  } else {
    // Отсчёта нет — заглядываем раз в 30 секунд и сразу после начала перезапуска по
    // расписанию: так таймер появится сам, без обновления страницы.
    const soon = next ? (next.at - next.delay - 15) * 1000 - Date.now() + 3000 : Infinity;
    box._poll = setTimeout(poll, Math.max(3000, Math.min(30000, soon)));
  }

  box.replaceChildren(card(L('Игровой мир'), null, state,
    h('div', { class: 'card-b stack' },
      facts([
        [L('В игре сейчас'), online == null ? '—' : fmtN(online)],
        [L('Работает без перезапуска'), w.running && w.age != null ? fmtDur(w.age) : '—'],
        [L('Перезапуск по расписанию'), next ? fmtDT(next.at) : L('не запланирован')],
        [L('Название в списке миров'), realm.name || '—'],
        [L('Вход в игру'), realm.allowedSecurityLevel ? badge(L('только администраторы'), 'warn') : badge(L('открыт для всех'), 'ok')],
      ]),
      timer)));
}

/* Вкладка «Перезапуск»: слева — сейчас и «когда никого не будет», справа — в выбранный день и время. */
function paintRestart(box, ov, w, reload) {
  const online = ov.counts ? ov.counts.online : 0;
  const off = !w.running;
  const delay = h('select', { class: 'inp', 'aria-label': L('Через сколько') }, DELAYS.map(([v, l]) => h('option', { value: v }, L('через ') + l)));
  delay.value = online ? '300' : '60';
  const dl = () => delayLabel(delay.value);

  const when = h('input', { class: 'inp', type: 'datetime-local', 'aria-label': L('День и время') });
  const next = new Date(Date.now() + 3600e3);
  next.setMinutes(0, 0, 0);
  when.value = toLocalInput(next);
  const warn = h('select', { class: 'inp', 'aria-label': L('Предупредить за') }, DELAYS.map(([v]) => h('option', { value: v }, L('отсчёт ') + fmtDur(+v))));
  warn.value = '300';
  const add = btnEl(L('Запланировать'), 'pri', async () => {
    const at = Math.floor(new Date(when.value).getTime() / 1000);
    if (!at) { toast(L('Укажите день и время.'), true); return; }
    try {
      await api('/api/world', { action: 'schedule', at, delay: warn.value });
      toast(L('Запланировано.'));
      reload();
    } catch (e) { toast(e.message, true); }
  });
  const list = w.schedule.length ? table({
    cols: [
      { label: L('Когда'), render: (r) => h('span', null, h('b', null, fmtDT(r.at)), h('span', { class: 'muted small' }, '  ' + untilText(r.at))) },
      { label: L('Отсчёт'), render: (r) => fmtDur(r.delay) },
      { label: '', cls: 'r', render: (r) => h('button', { class: 'btn sm', type: 'button', onclick: async () => {
        try { await api('/api/world', { action: 'unschedule', id: r.id }); reload(); } catch (e) { toast(e.message, true); } } }, L('Отменить')) },
    ], rows: w.schedule }) : h('p', { class: 'muted small' }, L('Перезапусков по расписанию нет.'));

  const now = card(L('Перезапуск мира'), L('игроки увидят отсчёт в чате'), null, h('div', { class: 'card-b cbody' },
    off ? h('div', { class: 'alert warning' }, icon('warn'), h('span', null, L('Мир сейчас не запущен — кнопки заработают, когда он запустится.'))) : null,
    h('div', { class: 'row inline-inp' }, delay,
      btnEl(L('Перезапустить'), 'dng', askAction({ title: L('Перезапустить мир?'), submit: L('Перезапустить'), danger: true, reload,
        text: () => L('Мир перезапустится через {0}, игроки увидят отсчёт в чате. Персонажи сохранятся, мир поднимется сам примерно через 15 секунд после выключения.', dl()),
        payload: () => ({ action: 'restart', delay: delay.value }) }), off),
      btnEl(L('Когда никого не будет'), '', askAction({ title: L('Перезапуск, когда никого не будет'), submit: L('Запланировать'), reload,
        text: () => L('Мир перезапустится не раньше чем через {0}. Если к этому времени кто-то в игре, он дождётся, пока все выйдут. Игрокам этот отсчёт не показывается.', dl()),
        payload: () => ({ action: 'idlerestart', delay: delay.value }) }), off),
      btnEl(L('Отменить отсчёт'), w.countdown ? 'pri' : '', askAction({ title: L('Отменить отсчёт?'), submit: L('Отменить отсчёт'), reload,
        text: L('Остановит идущий отсчёт перезапуска, мир продолжит работать.'), payload: () => ({ action: 'cancel' }) }), off)),
    h('ul', { class: 'hints' },
      h('li', null, h('b', null, L('Перезапустить')), L(' — мир сохранит персонажей, выключится и сам поднимется примерно через 15 секунд.')),
      h('li', null, h('b', null, L('Когда никого не будет')), L(' — после отсчёта мир ждёт, пока в игре никого не останется.')),
      h('li', null, L('Пока идёт отсчёт, вверху страницы виден таймер.'))),
    h('section', { class: 'wsec' }, h('h4', null, L('Ещё')),
      h('div', { class: 'row' },
        btnEl(L('Сохранить всех персонажей'), '', askAction({ title: L('Сохранить всех персонажей сейчас?'), submit: L('Сохранить'), reload, wait: 0,
          payload: () => ({ action: 'saveall' }) }), off),
        btnEl(L('Убрать старые трупы'), '', askAction({ title: L('Убрать старые трупы?'), text: L('Запускает проверку истёкших трупов в мире.'), submit: L('Убрать'), reload, wait: 0,
          payload: () => ({ action: 'corpses' }) }), off)))));

  const plan = card(L('По расписанию'), L('в выбранный день и время'), null, h('div', { class: 'card-b cbody' },
    h('div', { class: 'row inline-inp' }, when, warn, add),
    h('small', { class: 'muted' }, L('Мир перезапустится ровно в указанное время, отсчёт в чате начнётся заранее. Время — по часам вашего компьютера.')),
    h('section', { class: 'wsec' }, h('h4', null, L('Запланировано')), list)));

  box.replaceChildren(h('div', { class: 'grid g2 eq' }, h('div', { class: 'cell' }, now), h('div', { class: 'cell' }, plan)));
}

/* Вкладка «Доступ»: режим обслуживания и лимит игроков — две одинаковые карточки. */
function paintAccess(box, ov, w, reload) {
  const closed = !!(ov.realm || {}).allowedSecurityLevel;
  const plimit = h('input', { class: 'inp', type: 'number', min: -3, max: 10000, placeholder: L('напр. 50') });
  const maint = card(L('Режим обслуживания'), null, null, h('div', { class: 'card-b cbody' },
    h('div', { class: 'row' }, closed ? badge(L('включён: входят только администраторы'), 'warn') : badge(L('выключен: вход открыт для всех'), 'ok'),
      btnEl(closed ? L('Выключить') : L('Включить'), closed ? 'pri' : 'dng', askAction({
        title: closed ? L('Открыть вход для игроков?') : L('Закрыть вход для игроков?'), submit: closed ? L('Открыть') : L('Закрыть'), danger: !closed, reload,
        text: closed ? L('Снова смогут входить все.') : L('Мир продолжит работать, но войти смогут только администраторы (уровень 3). Кто уже в игре — останется.'),
        payload: () => ({ action: 'maintenance', on: !closed }) }))),
    h('p', { class: 'muted small' }, L('Мир работает, но пускает только администраторов — например, чтобы самому проверить что-то до игроков. ')
      + L('Кто уже в игре, того не выкинет. Изменение вступает в силу примерно через 20 секунд.'))));
  const limit = card(L('Лимит игроков'), L('сколько пускать одновременно'), null, h('div', { class: 'card-b cbody' },
    h('div', { class: 'row inline-inp' }, plimit,
      btnEl(L('Применить'), '', async () => {
        try { const r = (await api('/api/server', { action: 'plimit', value: plimit.value })).data; toast(r.output || L('Готово.'), !r.success); } catch (e) { toast(e.message, true); }
      }, !w.running)),
    h('p', { class: 'muted small' }, L('Действует до следующего перезапуска мира. Постоянный лимит — во вкладке «Настройки mangosd.conf», параметр PlayerLimit. ')
      + L('Особые значения: 0 — без ограничения, −1 — только модераторы и выше, −2 — ГМ и выше, −3 — только администраторы.'))));
  box.replaceChildren(h('div', { class: 'grid g2 eq' }, h('div', { class: 'cell' }, maint), h('div', { class: 'cell' }, limit)));
}

function untilText(ts) {
  const sec = ts - Date.now() / 1000;
  if (sec <= 0) return L('сейчас');
  return L('через ') + fmtDur(sec);
}

async function renderConfig(box, onValues) {
  const d = (await api('/api/config')).data;
  if (onValues) onValues(Object.fromEntries(d.groups.flatMap((g) => g.items).map((it) => [it.key, it.value])));
  const changed = {};
  const saveBtn = h('button', { class: 'btn', type: 'button', disabled: true }, L('Сохранить'));
  const applyBtn = h('button', { class: 'btn pri', type: 'button', disabled: true }, L('Сохранить и применить'));
  const count = h('span', { class: 'muted small' });
  const refresh = () => {
    const n = Object.keys(changed).length;
    saveBtn.disabled = applyBtn.disabled = !n;
    count.textContent = n ? L('изменено: {0}', n) : '';
  };
  const groups = d.groups.map((g) => h('div', { class: 'card-b' }, h('h4', { class: 'muted small' }, g.title.toUpperCase()), table({
    cols: [
      { label: L('Параметр'), render: (it) => h('div', null, h('div', null, it.label), h('div', { class: 'mono small muted' }, it.key)) },
      { label: L('Значение'), render: (it) => {
        let input;
        if (it.kind === 'bool') {
          input = h('select', { class: 'inp' }, h('option', { value: '0' }, L('выключено')), h('option', { value: '1' }, L('включено')));
          input.value = it.value === '1' ? '1' : '0';
        } else {
          input = h('input', { class: 'inp', value: it.value, type: it.kind === 'text' ? 'text' : 'text', inputmode: it.kind === 'text' ? null : 'decimal' });
          input.style.width = it.kind === 'text' ? '100%' : '110px';
        }
        const orig = input.value;
        input.addEventListener('input', () => {
          if (input.value !== orig) changed[it.key] = input.value; else delete changed[it.key];
          input.classList.toggle('changed', input.value !== orig);
          refresh();
        });
        input.addEventListener('change', () => input.dispatchEvent(new Event('input')));
        return input;
      } },
      { label: L('Когда подействует'), render: (it) => (it.reload ? badge(L('сразу после «применить»')) : badge(L('после перезапуска мира'), 'warn')) },
    ], rows: g.items })));
  const save = (apply) => async () => {
    try {
      const r = (await api('/api/config', { changes: changed, apply })).data;
      if (r.need_restart.length) {
        offerRestart({ title: L('Настройки сохранены'), text: [r.output,
          L('Эти параметры вступят в силу только после перезапуска мира: {0}. Перезапустить сейчас?', r.need_restart.join(', '))] });
      } else {
        infoModal(L('Настройки сохранены'), resultView({ success: true, output: r.output }));
      }
      await renderConfig(box);
    } catch (e) { toast(e.message, true); }
  };
  saveBtn.addEventListener('click', save(false));
  applyBtn.addEventListener('click', save(true));
  box.replaceChildren(card(L('Настройки mangosd.conf'), L('перед каждой записью файл копируется в папку backups рядом с ним'),
    h('div', { class: 'row' }, count, saveBtn, applyBtn), ...groups,
    d.backups.length ? h('div', { class: 'card-b muted small' }, L('Последние копии: '), d.backups.slice(0, 5).join(', ')) : null));
}

/* Окно «перезапустить мир?» — после сохранения настроек, которые ядро читает
   только при запуске. Перезапуск идёт обычным отсчётом, таймер виден на вкладке «Сервер». */
function offerRestart({ title, text, online = 0, onClose }) {
  const delay = h('select', { class: 'inp', 'aria-label': L('Через сколько') }, DELAYS.map(([v, l]) => h('option', { value: v }, L('через ') + l)));
  delay.value = online ? '300' : '60';
  const out = h('div');
  let close;
  const finish = () => { close(); if (onClose) onClose(); };
  const later = h('button', { class: 'btn', type: 'button', onclick: () => finish() }, L('Позже'));
  const idle = h('button', { class: 'btn', type: 'button' }, L('Когда никого не будет'));
  const now = h('button', { class: 'btn dng', type: 'button' }, L('Перезапустить'));
  const lock = (on) => { for (const b of [later, idle, now]) b.disabled = on; };
  const run = (action) => async () => {
    lock(true);
    try {
      const r = (await api('/api/server', { action, delay: delay.value })).data;
      out.replaceChildren(resultView(r));
      if (r.success) setTimeout(finish, 1800); else lock(false);
    } catch (e) { out.replaceChildren(resultView({ success: false, output: e.message })); lock(false); }
  };
  idle.addEventListener('click', run('idlerestart'));
  now.addEventListener('click', run('restart'));
  const box = h('div', { class: 'modal' },
    h('div', { class: 'modal-h' }, h('div', null, h('h3', null, title), [].concat(text).map((t) => h('p', null, t))),
      h('button', { class: 'btn ghost sm x', type: 'button', 'aria-label': L('Закрыть'), onclick: () => finish() }, icon('x'))),
    h('div', { class: 'modal-b stack' },
      h('div', { class: 'row inline-inp' }, h('span', { class: 'muted small' }, L('Перезапустить мир')), delay),
      online ? h('div', { class: 'alert warning' }, icon('warn'), h('span', null, L('Сейчас в игре: {0}. Игроки увидят отсчёт в чате, персонажи сохранятся.', online))) : null,
      h('small', { class: 'muted' }, L('«Когда никого не будет» — мир перезапустится после отсчёта, но только когда в игре никого нет. Таймер виден на вкладке «Сервер».')),
      out),
    h('div', { class: 'modal-f' }, later, idle, now));
  close = openOverlay(box);
}

// ============================================================ Боты

const BOT_PRESETS = [[L('Немного'), 10, 20], [L('Средне'), 40, 80], [L('Много'), 150, 250]];

PAGES.bots = {
  title: L('Боты'), sub: L('Боты-игроки и бот аукциона. Настройки действуют после перезапуска мира — панель предложит его сама.'),
  async render(el) {
    const d = (await api('/api/bots')).data;
    const t = d.totals;
    const cfg = Object.fromEntries(d.groups.flatMap((g) => g.items).map((it) => [it.key, it]));
    const on = (k) => cfg[k] && String(cfg[k].value) === '1';
    const changed = {};
    const inputs = {};

    // --- панель сохранения: появляется, когда что-то изменено
    const count = h('span', { class: 'grow' });
    const saveBtn = h('button', { class: 'btn pri', type: 'button' }, L('Сохранить'));
    const resetBtn = h('button', { class: 'btn', type: 'button', onclick: () => route() }, L('Отменить изменения'));
    const bar = h('div', { class: 'savebar', hidden: true }, icon('warn'), count, resetBtn, saveBtn);
    const paintBar = () => {
      const n = Object.keys(changed).length;
      bar.hidden = !n;
      count.textContent = L('Изменено параметров: {0}. Они подействуют после перезапуска мира.', n);
    };
    const track = (it, value, mark) => {
      if (String(value) !== String(it.value)) changed[it.key] = value; else delete changed[it.key];
      mark(String(value) !== String(it.value));
      paintBar();
    };

    const field = (it) => {
      const def = it.default ? h('span', { class: 'def' }, L(' · значение по умолчанию')) : null;
      if (it.value == null) return h('div', { class: 'bfield' }, h('span', { class: 'muted small' }, L('{0}: нет в файле настроек', it.label)));
      if (it.kind === 'bool') {
        const box = h('input', { type: 'checkbox', checked: String(it.value) === '1' });
        const lbl = h('label', { class: 'chk' }, box, it.label);
        box.addEventListener('change', () => track(it, box.checked ? '1' : '0', (c) => lbl.classList.toggle('on-change', c)));
        inputs[it.key] = box;
        return h('div', { class: 'bfield' }, lbl, it.hint || def ? h('small', null, it.hint || '', def) : null);
      }
      const inp = h('input', { class: 'inp', type: 'number', min: it.min, max: it.max, step: it.kind === 'float' ? '0.05' : '1', value: it.value });
      inp.addEventListener('input', () => track(it, inp.value, (c) => inp.classList.toggle('changed', c)));
      inputs[it.key] = inp;
      return h('label', { class: 'bfield' }, h('span', { class: 'lbl' }, it.label), inp, it.hint || def ? h('small', null, it.hint || '', def) : null);
    };
    const setVal = (key, v) => { const inp = inputs[key]; if (!inp) return; inp.value = v; inp.dispatchEvent(new Event('input')); };

    // --- карточки настроек
    const grp = (id) => d.groups.find((g) => g.id === id);
    const items = (id) => grp(id).items;
    const byKey = (id, key) => items(id).find((it) => it.key === key);
    const mainItems = items('main');
    const memNote = d.mem && d.mem.limit
      ? L('Сейчас занято {0} из {1} памяти.', fmtBytes(d.mem.mem), fmtBytes(d.mem.limit)) : '';
    const mainCard = card(L('Главное'), L('включить ботов и сколько их будет'), null, h('div', { class: 'card-b cbody' },
      field(byKey('main', 'AiPlayerbot.Enabled')),
      field(byKey('main', 'AiPlayerbot.RandomBotAutologin')),
      h('section', { class: 'wsec' }, h('h4', null, L('Сколько ботов в игре')),
        h('div', { class: 'fields-2' }, field(byKey('main', 'AiPlayerbot.MinRandomBots')), field(byKey('main', 'AiPlayerbot.MaxRandomBots'))),
        h('div', { class: 'presets' }, h('span', { class: 'muted small' }, L('Быстро:')), BOT_PRESETS.map(([label, lo, hi]) =>
          h('button', { class: 'btn sm', type: 'button', onclick: () => { setVal('AiPlayerbot.MinRandomBots', lo); setVal('AiPlayerbot.MaxRandomBots', hi); } },
            `${label}: ${lo}–${hi}`))),
        h('small', { class: 'muted' }, L('Создано {0} персонажей-ботов — больше этого числа в игре не будет. ', fmtN(t.chars))
          + L('Каждый бот нагружает мир почти как живой игрок. ') + memNote + L(' Начните с малого и посмотрите на «Обзор».'))),
      h('section', { class: 'wsec' }, h('h4', null, L('Уровни ботов')),
        h('div', { class: 'fields-2' }, field(byKey('main', 'AiPlayerbot.RandomBotMinLevel')), field(byKey('main', 'AiPlayerbot.RandomBotMaxLevel')))),
      h('section', { class: 'wsec' }, h('h4', null, L('Как заходят в игру')),
        mainItems.filter((it) => ['AiPlayerbot.RandomBotLoginAtStartup', 'AiPlayerbot.RandomBotsMaxLoginsPerInterval', 'AiPlayerbot.botActiveAlone'].includes(it.key)).map(field))));
    const simpleCard = (id, hint) => card(grp(id).title, hint, null, h('div', { class: 'card-b cbody' }, items(id).map(field)));

    const pending = d.pending ? h('div', { class: 'alert warning' }, icon('warn'),
      h('span', { class: 'grow' }, L('Настройки ботов сохранены, но ещё не действуют: мир запущен раньше, чем их сохранили. Перезапустите мир.')),
      h('button', { class: 'btn sm', type: 'button', onclick: () => offerRestart({ title: L('Перезапустить мир?'),
        text: L('После перезапуска боты заработают по новым настройкам.'), online: d.players_online, onClose: () => route() }) }, L('Перезапустить мир…'))) : null;

    // --- сводка
    const summary = card(L('Боты сейчас'), null, on('AiPlayerbot.Enabled') ? badge(L('включены'), 'ok') : badge(L('выключены'), 'bad'),
      h('div', { class: 'card-b' }, facts([
        [L('Ботов в игре сейчас'), fmtN(t.online)],
        [L('Живых игроков в игре'), fmtN(d.players_online)],
        [L('Создано персонажей-ботов'), L('{0} на {1} аккаунтах', fmtN(t.chars), fmtN(t.accounts))],
        [L('Уровни созданных ботов'), t.chars ? L('{0}–{1}, в среднем {2}', t.minlvl, t.maxlvl, t.avglvl) : '—'],
        [L('Фракции'), L('Альянс {0} · Орда {1}', fmtN(d.factions.A[0]), fmtN(d.factions.H[0]))],
        [L('В игру заходят'), on('AiPlayerbot.Enabled') && on('AiPlayerbot.RandomBotAutologin')
          ? L('{0}–{1} ботов', cfg['AiPlayerbot.MinRandomBots'].value, cfg['AiPlayerbot.MaxRandomBots'].value) : L('никто')],
        [L('Бот аукциона'), on('AhBot.Enabled') ? badge(L('включён'), 'ok') : badge(L('выключен'))],
        [memLabel(), d.mem && d.mem.limit ? L('{0} из {1}', fmtBytes(d.mem.mem), fmtBytes(d.mem.limit)) : '—'],
      ])));

    // --- статистика
    const levels = card(L('Уровни ботов'), null, null, h('div', { class: 'card-b flush' }, table({
      cols: [{ label: L('Уровни'), render: (r) => `${r.from}–${r.to}` }, { label: L('Всего'), cls: 'r', render: (r) => fmtN(r.n) },
             { label: L('В игре'), cls: 'r', render: (r) => fmtN(r.online) }],
      rows: d.levels, empty: L('Ботов ещё нет.') })));
    const classes = card(L('Классы ботов'), null, null, h('div', { class: 'card-b flush' }, table({
      cols: [{ label: L('Класс'), key: 'name' }, { label: L('Всего'), cls: 'r', render: (r) => fmtN(r.n) },
             { label: L('В игре'), cls: 'r', render: (r) => fmtN(r.online) }],
      rows: d.classes, empty: L('Ботов ещё нет.') })));
    const onlineCard = card(L('Боты в игре: {0}', fmtN(t.online)), d.online.length < t.online ? L('показаны первые 100') : null, null,
      h('div', { class: 'card-b flush' }, table({
        cols: [{ label: L('Имя'), render: (r) => charCell(r) }, { label: L('Ур.'), cls: 'r', key: 'level' },
               { label: L('Класс'), key: 'class_name' }, { label: L('Раса'), key: 'race_name' }, { label: L('Где'), key: 'zone_name' }],
        rows: d.online, empty: on('AiPlayerbot.Enabled') ? L('Сейчас ботов в игре нет — они заходят постепенно после запуска мира.')
          : L('Боты выключены. Включите их в карточке «Главное» и перезапустите мир.') })));

    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      try {
        const r = (await api('/api/bots', { changes: changed })).data;
        offerRestart({ title: L('Настройки ботов сохранены'), text: [r.output, L('Перезапустить мир сейчас?')],
          online: d.players_online, onClose: () => route() });
      } catch (e) { toast(e.message, true); saveBtn.disabled = false; }
    });

    el.replaceChildren(h('div', { class: 'stack' },
      pending,
      summary,
      h('div', { class: 'grid g2 eq' }, h('div', { class: 'cell' }, mainCard), h('div', { class: 'cell' }, simpleCard('behavior', L('что делают в мире')))),
      h('div', { class: 'grid g2 eq' }, h('div', { class: 'cell' }, simpleCard('gear', L('во что одеты'))),
        h('div', { class: 'cell' }, simpleCard('guilds', null), simpleCard('ahbot', 'ahbot.conf'))),
      h('div', { class: 'grid g2 eq' }, h('div', { class: 'cell' }, levels), h('div', { class: 'cell' }, classes)),
      onlineCard,
      bar));
  },
};

// ============================================================ Логи

PAGES.logs = {
  title: L('Логи'), sub: L('Хвост журналов служб и ядра. Ошибки подсвечены.'),
  async render(el) {
    const st = { file: '', lines: 300, q: '', auto: false };
    const box = h('div', { class: 'logbox' });
    const info = h('span', { class: 'muted small' });
    const fileSel = h('select', { class: 'inp' });
    const load = async () => {
      const d = (await api(`/api/logs?file=${st.file}&lines=${st.lines}&q=${encodeURIComponent(st.q)}`)).data;
      if (!fileSel.options.length) {
        for (const f of d.files) fileSel.append(h('option', { value: f.key, disabled: !f.exists }, Lsrv(f.label) + (f.exists ? '' : L(' (нет файла)'))));
        st.file = d.file;
        fileSel.value = st.file;
      }
      info.textContent = d.missing ? L('файла нет') : L('{0} · {1} · показано строк: {2}', d.path, fmtBytes(d.size), d.lines.length);
      const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
      box.replaceChildren(...d.lines.map((line) => {
        const cls = /error|ошибк|ВНИМАНИЕ|crash|segfault|assert|fatal|упал/i.test(line) ? 'e' : /warn|предупр/i.test(line) ? 'w' : null;
        return h('div', { class: cls }, line || ' ');
      }));
      if (!d.lines.length) box.append(h('div', { class: 'muted' }, st.q ? L('Совпадений нет.') : L('Лог пуст.')));
      if (atBottom || !st.scrolled) { box.scrollTop = box.scrollHeight; st.scrolled = true; }
    };
    fileSel.addEventListener('change', () => { st.file = fileSel.value; st.scrolled = false; load(); });
    const lines = h('select', { class: 'inp' }, [100, 300, 1000, 3000].map((n) => h('option', { value: n }, L('{0} строк', n))));
    lines.value = '300';
    lines.addEventListener('change', () => { st.lines = +lines.value; load(); });
    const q = h('input', { class: 'inp search', type: 'search', placeholder: L('Фильтр по тексту') });
    q.addEventListener('input', debounce(() => { st.q = q.value.trim(); st.scrolled = false; load(); }, 350));
    const auto = h('input', { type: 'checkbox' });
    let timer = null;
    auto.addEventListener('change', () => {
      if (timer) { clearInterval(timer); pageTimers = pageTimers.filter((t) => t !== timer); timer = null; }
      if (auto.checked) { timer = setInterval(() => load().catch(() => {}), 5000); pageTimers.push(timer); }
    });
    setTools(refreshBtn(() => load().catch((e) => toast(e.message, true))));
    el.replaceChildren(h('div', { class: 'stack' },
      h('div', { class: 'row' }, fileSel, lines, q, h('label', { class: 'chk' }, auto, L('обновлять каждые 5 с')), h('span', { class: 'spacer' }), info), box));
    await load();
  },
};

// ============================================================ Консоль

const consoleLog = [];
let cmdHistory = [];
try { cmdHistory = JSON.parse(localStorage.getItem('wowpanel-history') || '[]'); } catch (e) { cmdHistory = []; }

PAGES.console = {
  title: L('Консоль'), sub: L('Любая команда ядра — так же, как в screen-консоли, но с ответом. Точку в начале писать не нужно.'),
  async render(el) {
    const out = h('div', { class: 'console-out', 'aria-live': 'polite' });
    const input = h('input', { class: 'inp', placeholder: L('например: server info'), autocomplete: 'off', spellcheck: 'false' });
    let hi = cmdHistory.length;
    const paint = () => {
      out.replaceChildren(...(consoleLog.length ? consoleLog.flatMap((r) => [
        h('div', { class: 'cmd' }, `> ${r.cmd}`), h('div', { class: 'res' + (r.success ? '' : ' bad') }, r.output || (r.success ? L('(пустой ответ)') : L('ошибка'))),
      ]) : [h('div', { class: 'muted' }, L('Здесь будут ответы ядра. Справа — справочник всех команд с синтаксисом.'))]));
      out.scrollTop = out.scrollHeight;
    };
    const run = async (cmd) => {
      cmd = cmd.trim().replace(/^\./, '');
      if (!cmd) return;
      cmdHistory = cmdHistory.filter((c) => c !== cmd).concat(cmd).slice(-100);
      try { localStorage.setItem('wowpanel-history', JSON.stringify(cmdHistory)); } catch (e) { /* ничего */ }
      hi = cmdHistory.length;
      const rec = { cmd, success: true, output: '…' };
      consoleLog.push(rec);
      paint();
      try {
        const r = (await api('/api/console', { command: cmd })).data;
        rec.success = r.success; rec.output = r.output;
      } catch (e) { rec.success = false; rec.output = e.message; }
      if (consoleLog.length > 200) consoleLog.splice(0, consoleLog.length - 200);
      paint();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); const v = input.value; input.value = ''; run(v); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (hi > 0) { hi--; input.value = cmdHistory[hi]; } }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (hi < cmdHistory.length - 1) { hi++; input.value = cmdHistory[hi]; } else { hi = cmdHistory.length; input.value = ''; } }
    });
    const quick = ['server info', 'account onlinelist', 'saveall', 'server motd', 'instance stats', 'event list', 'server plimit'];

    const refList = h('div', { class: 'ref-list' });
    const refQ = h('input', { class: 'inp', type: 'search', placeholder: L('Поиск команды: ban, send, tele…') });
    refQ.style.width = '100%';
    const loadRef = async () => {
      const rows = (await api('/api/commands?q=' + encodeURIComponent(refQ.value.trim()))).data;
      refList.replaceChildren(...rows.slice(0, 300).map((r) => h('div', { class: 'ref-item', onclick: () => { input.value = r.name + ' '; input.focus(); } },
        h('b', null, r.name), ' ', badge(SEC[r.security] || r.security), h('p', null, (r.help || '').replace(/\r/g, '').split('\n').slice(0, 4).join('\n')))));
      if (!rows.length) refList.append(h('div', { class: 'empty' }, L('Ничего не найдено.')));
    };
    refQ.addEventListener('input', debounce(() => loadRef().catch(() => {}), 300));

    const lkKind = h('select', { class: 'inp' }, [['item', L('Предмет')], ['creature', L('Существо')], ['quest', L('Задание')], ['spell', L('Заклинание')], ['tele', L('Точка телепорта')], ['area', L('Зона')], ['object', L('Объект')]]
      .map(([v, l]) => h('option', { value: v }, l)));
    const lkQ = h('input', { class: 'inp', type: 'search', placeholder: L('Название') });
    const lkRes = h('div', { class: 'ref-list' });
    const lookup = async () => {
      const q = lkQ.value.trim();
      if (q.length < 2) return;
      lkRes.replaceChildren(h('div', { class: 'empty' }, L('Ищу…')));
      try {
        const d = (await api(`/api/lookup?kind=${lkKind.value}&q=${encodeURIComponent(q)}`)).data;
        lkRes.replaceChildren(...d.rows.map((r) => h('div', { class: 'ref-item', title: L('Вставить ID в консоль'),
          onclick: () => { input.value = (input.value ? input.value.trimEnd() + ' ' : '') + r.id; input.focus(); } },
          h('b', { class: r.quality != null ? 'q' + r.quality : null }, r.name), h('p', null, `ID ${r.id}${r.ilvl ? L(' · уровень предмета ') + r.ilvl : ''}`))));
        if (!d.rows.length) lkRes.append(h('div', { class: 'empty' }, d.raw || L('Ничего не найдено.')));
      } catch (e) { lkRes.replaceChildren(errorCard(e)); }
    };
    lkQ.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); lookup(); } });

    let side = 'ref';
    const sideBox = h('div');
    const drawSide = () => sideBox.replaceChildren(
      h('div', { class: 'card-b' }, tabs([['ref', L('Справочник команд')], ['lookup', L('Поиск ID')]], side, (k) => { side = k; drawSide(); }),
        side === 'ref' ? refQ : h('div', { class: 'row' }, lkKind, lkQ, h('button', { class: 'btn', type: 'button', onclick: lookup }, L('Найти')))),
      side === 'ref' ? refList : lkRes);
    drawSide();

    el.replaceChildren(h('div', { class: 'grid g-main' },
      card(null, null, null, h('div', { class: 'card-b' }, out,
        h('div', { class: 'console-in' }, input, h('button', { class: 'btn pri', type: 'button', onclick: () => { const v = input.value; input.value = ''; run(v); } }, L('Выполнить'))),
        h('div', { class: 'row' }, quick.map((q) => h('button', { class: 'btn sm', type: 'button', onclick: () => run(q) }, q)))
      )),
      card(null, null, null, sideBox)));
    el.querySelector('.console-in + .row').style.marginTop = '10px';
    paint();
    input.focus();
    await loadRef();
  },
};

// ============================================================ Предметы (конструктор)
/* Самодельные предметы — строки item_template с номерами от 90000. Форма правит
   один объект со всеми колонками; подсказка справа перерисовывается при любом
   изменении — так, как предмет выглядит в игре (английский клиент). */

const IC = {
  quality: [[0, L('Серое — хлам')], [1, L('Белое — обычное')], [2, L('Зелёное — необычное')], [3, L('Синее — редкое')],
            [4, L('Фиолетовое — эпическое')], [5, L('Оранжевое — легендарное')], [6, L('Артефакт')]],
  classes: [[2, L('Оружие')], [4, L('Броня и украшения')], [0, L('Расходуемое')], [1, L('Сумка')], [6, L('Боеприпасы')], [11, L('Колчан')],
            [5, L('Реагент')], [7, L('Хозтовары')], [9, L('Рецепт')], [12, L('Предмет задания')], [13, L('Ключ')], [15, L('Разное')]],
  sub: {
    0: [[0, L('Расходуемое')], [1, L('Зелье')], [2, L('Эликсир')], [3, L('Настой')], [4, L('Свиток')], [5, L('Еда и питьё')], [6, L('Улучшение предмета')], [7, L('Бинты')], [8, L('Прочее')]],
    1: [[0, L('Сумка')], [1, L('Для осколков души')], [2, L('Для трав')], [3, L('Для зачарования')], [4, L('Для инженерии')]],
    2: [[7, L('Одноручный меч')], [8, L('Двуручный меч')], [0, L('Одноручный топор')], [1, L('Двуручный топор')], [4, L('Одноручная булава')],
        [5, L('Двуручная булава')], [15, L('Кинжал')], [13, L('Кистевое')], [6, L('Древковое')], [10, L('Посох')], [2, L('Лук')], [18, L('Арбалет')],
        [3, L('Ружьё')], [16, L('Метательное')], [19, L('Жезл')], [20, L('Удочка')], [14, L('Прочее')]],
    4: [[1, L('Ткань')], [2, L('Кожа')], [3, L('Кольчуга')], [4, L('Латы')], [6, L('Щит')], [0, L('Украшения и прочее')], [7, L('Манускрипт')], [8, L('Идол')], [9, L('Тотем')]],
    5: [[0, L('Реагент')]], 6: [[2, L('Стрелы')], [3, L('Пули')]], 7: [[0, L('Хозтовары')], [1, L('Детали')], [2, L('Взрывчатка')], [3, L('Устройства')]],
    9: [[0, L('Книга')], [1, L('Кожевничество')], [2, L('Портняжное дело')], [3, L('Инженерное дело')], [4, L('Кузнечное дело')], [5, L('Кулинария')],
        [6, L('Алхимия')], [7, L('Первая помощь')], [8, L('Наложение чар')], [9, L('Рыбная ловля')]],
    11: [[2, L('Колчан')], [3, L('Подсумок')]], 12: [[0, L('Предмет задания')]], 13: [[0, L('Ключ')], [1, L('Отмычка')]],
    15: [[0, L('Хлам')], [1, L('Реагент')], [2, L('Питомец')], [3, L('Праздничное')], [4, L('Другое')], [5, L('Ездовое животное')]],
  },
  slot: {0: L('Не надевается'), 1: L('Голова'), 2: L('Шея'), 3: L('Плечи'), 4: L('Рубашка'), 5: L('Грудь'), 6: L('Пояс'), 7: L('Ноги'), 8: L('Ступни'),
         9: L('Запястья'), 10: L('Кисти рук'), 11: L('Палец'), 12: L('Аксессуар'), 13: L('Одноручное'), 14: L('Щит (левая рука)'), 15: L('Лук, арбалет'),
         16: L('Спина'), 17: L('Двуручное'), 18: L('Сумка'), 19: L('Гербовая накидка'), 20: L('Грудь (мантия)'), 21: L('Только правая рука'),
         22: L('Только левая рука'), 23: L('Держится в левой руке'), 24: L('Боеприпасы'), 25: L('Метательное'), 26: L('Ружьё, жезл'), 27: L('Колчан'), 28: L('Реликвия')},
  slotEn: {1: 'Head', 2: 'Neck', 3: 'Shoulder', 4: 'Shirt', 5: 'Chest', 6: 'Waist', 7: 'Legs', 8: 'Feet', 9: 'Wrist', 10: 'Hands',
           11: 'Finger', 12: 'Trinket', 13: 'One-Hand', 14: 'Off Hand', 15: 'Ranged', 16: 'Back', 17: 'Two-Hand', 18: 'Bag',
           19: 'Tabard', 20: 'Chest', 21: 'Main Hand', 22: 'Off Hand', 23: 'Held In Off-hand', 24: 'Projectile', 25: 'Thrown',
           26: 'Ranged', 27: 'Quiver', 28: 'Relic'},
  subEn: {2: {0: 'Axe', 1: 'Axe', 2: 'Bow', 3: 'Gun', 4: 'Mace', 5: 'Mace', 6: 'Polearm', 7: 'Sword', 8: 'Sword', 10: 'Staff',
              13: 'Fist Weapon', 14: 'Miscellaneous', 15: 'Dagger', 16: 'Thrown', 18: 'Crossbow', 19: 'Wand', 20: 'Fishing Pole'},
          4: {1: 'Cloth', 2: 'Leather', 3: 'Mail', 4: 'Plate', 6: 'Shield', 7: 'Libram', 8: 'Idol', 9: 'Totem'},
          6: {2: 'Arrow', 3: 'Bullet'}},
  stats: [[0, L('Мана'), 'Mana'], [1, L('Здоровье'), 'Health'], [3, L('Ловкость'), 'Agility'], [4, L('Сила'), 'Strength'],
          [5, L('Интеллект'), 'Intellect'], [6, L('Дух'), 'Spirit'], [7, L('Выносливость'), 'Stamina']],
  school: [[0, L('Физический'), ''], [1, L('Свет'), 'Holy'], [2, L('Огонь'), 'Fire'], [3, L('Природа'), 'Nature'], [4, L('Лёд'), 'Frost'],
           [5, L('Тьма'), 'Shadow'], [6, L('Тайная магия'), 'Arcane']],
  trigger: [[1, L('При надевании'), 'Equip:'], [0, L('Использование'), 'Use:'], [2, L('Шанс при ударе'), 'Chance on hit:'],
            [5, L('Использование без задержки'), 'Use:'], [4, L('Камень души'), 'Use:']],
  bonding: [[0, L('Не привязывается'), ''], [1, L('При поднятии'), 'Binds when picked up'], [2, L('При надевании'), 'Binds when equipped'],
            [3, L('При использовании'), 'Binds when used'], [4, L('Предмет задания'), 'Quest Item']],
  material: [[0, L('Нет')], [1, L('Металл')], [2, L('Дерево')], [3, L('Жидкость')], [4, L('Ювелирное')], [5, L('Кольчуга')], [6, L('Латы')], [7, L('Ткань')], [8, L('Кожа')], [-1, L('Расходуемое')]],
  sheath: [[0, L('Нет')], [1, L('Двуручное — за спиной')], [2, L('Посох — за спиной')], [3, L('Одноручное — на поясе')], [4, L('Щит — на спине')], [5, L('Жезл')], [6, L('Левая рука')], [7, L('Кистевое оружие')]],
  ammo: [[0, L('Не нужны')], [2, L('Стрелы')], [3, L('Пули')]],
  classMask: [[1, L('Воин'), 'Warrior'], [2, L('Паладин'), 'Paladin'], [4, L('Охотник'), 'Hunter'], [8, L('Разбойник'), 'Rogue'], [16, L('Жрец'), 'Priest'],
              [64, L('Шаман'), 'Shaman'], [128, L('Маг'), 'Mage'], [256, L('Чернокнижник'), 'Warlock'], [1024, L('Друид'), 'Druid']],
  raceMask: [[1, L('Человек'), 'Human'], [2, L('Орк'), 'Orc'], [4, L('Дворф'), 'Dwarf'], [8, L('Ночной эльф'), 'Night Elf'], [16, L('Нежить'), 'Undead'],
             [32, L('Таурен'), 'Tauren'], [64, L('Гном'), 'Gnome'], [128, L('Тролль'), 'Troll']],
  flags: [[0x2, L('Сотворённый: исчезает, если долго не заходить')], [0x4, L('Можно открыть: внутри добыча')], [0x20, L('Нельзя уничтожить')],
          [0x80, L('Без отката после надевания')], [0x800, L('Выпадает каждому в группе')], [0x8000, L('Нельзя распылить')],
          [0x10000, L('Срок идёт в реальном времени')]],
  resist: [['holy_res', L('Свет'), 'Holy'], ['fire_res', L('Огонь'), 'Fire'], ['nature_res', L('Природа'), 'Nature'],
           ['frost_res', L('Лёд'), 'Frost'], ['shadow_res', L('Тьма'), 'Shadow'], ['arcane_res', L('Тайная магия'), 'Arcane']],
  presets: [[L('Сила атаки'), 'Attack Power'], [L('Сила атаки дальнего боя'), 'Attack Power Ranged'], [L('Сила заклинаний'), 'Increase Spell Dam'],
            [L('Лечение'), 'Increase Healing'], [L('Крит'), 'Increased Critical'], [L('Крит заклинаний'), 'Increased Critical Spell'],
            [L('Меткость'), 'Increased Hit Chance'], [L('Меткость заклинаний'), 'Increased Spell Hit'], [L('Уклонение'), 'Increased Dodge'],
            [L('Парирование'), 'Increased Parry'], [L('Блок'), 'Increased Block'], [L('Защита'), 'Increased Defense'],
            [L('Мана раз в 5 сек'), 'Increased Mana Regen'], [L('Урон огнём'), 'Increase Fire Dam'], [L('Урон льдом'), 'Increase Frost Dam'],
            [L('Урон тьмой'), 'Increase Shadow Dam'], [L('Урон тайной магией'), 'Increase Arcane Dam'], [L('Урон природой'), 'Increase Nature Dam'],
            [L('Урон светом'), 'Increase Holy Dam']],
};
const ALL_CLASSES = IC.classMask.reduce((a, [v]) => a | v, 0);
const ALL_RACES = IC.raceMask.reduce((a, [v]) => a | v, 0);

// Как чаще всего оформлены предметы этого подтипа в classic-db: [слот, ножны, материал].
const NATURAL = {
  2: {0: [13, 3, 1], 1: [17, 1, 1], 2: [15, 0, 2], 3: [26, 0, 1], 4: [13, 3, 1], 5: [17, 1, 1], 6: [17, 2, 2], 7: [13, 3, 1],
      8: [17, 1, 1], 10: [17, 2, 2], 13: [13, 7, 1], 14: [13, 0, 1], 15: [13, 3, 1], 16: [25, 0, 1], 18: [26, 0, 2],
      19: [26, 0, 2], 20: [17, 1, 2]},
  4: {0: [11, 0, 4], 1: [5, 0, 7], 2: [5, 0, 8], 3: [5, 0, 5], 4: [5, 0, 6], 6: [14, 4, 1], 7: [28, 0, 4], 8: [28, 0, 4], 9: [28, 0, 4]},
};

/* Смена типа или подтипа: подтип — первый из нового списка (номера подтипов у
   разных типов значат разное: 7 у оружия — меч, у брони — манускрипт), слот,
   ножны и материал — как у похожих предметов. Слот брони сохраняем, если он
   подходит: шлем из ткани не должен стать нагрудником при смене на кожу. */
function applyNatural(f, classChanged) {
  const cls = Number(f.class);
  if (classChanged) f.subclass = (IC.sub[cls] || [[0]])[0][0];
  const sub = Number(f.subclass);
  const nat = (NATURAL[cls] || {})[sub];
  const allowed = slotChoices(cls, sub);
  const keepSlot = cls === 4 && sub >= 1 && sub <= 4 && allowed.includes(Number(f.InventoryType));
  if (nat) {
    if (!keepSlot) f.InventoryType = nat[0];
    f.sheath = nat[1];
    f.Material = nat[2];
  } else if (!allowed.includes(Number(f.InventoryType))) {
    f.InventoryType = allowed[0];
  }
}

function slotChoices(cls, sub) {
  if (cls === 2) return [13, 21, 22, 17, 15, 26, 25, 0];
  if (cls === 4) {
    if (sub === 6) return [14];
    if (sub >= 7) return [28];
    if (sub === 0) return [2, 11, 12, 23, 16, 4, 19, 0];
    return [1, 3, 5, 20, 6, 7, 8, 9, 10, 16];
  }
  if (cls === 1) return [18];
  if (cls === 11) return [27];
  if (cls === 6) return [24];
  return [0];
}

function iconImg(icon, big) {
  const box = h('span', { class: 'wicon' + (big ? ' big' : '') });
  if (icon) {
    const img = h('img', { alt: '', loading: 'lazy', src: `https://wow.zamimg.com/images/wow/icons/${big ? 'large' : 'medium'}/${icon.toLowerCase()}.jpg` });
    img.addEventListener('error', () => img.remove());
    box.append(img);
    box.title = icon;
  }
  return box;
}

function coinsEn(c) {
  c = Math.max(0, Math.floor(c || 0));
  const g = Math.floor(c / 10000), s2 = Math.floor((c % 10000) / 100), cu = c % 100;
  return [g ? `${g}g` : '', s2 ? `${s2}s` : '', cu || (!g && !s2) ? `${cu}c` : ''].filter(Boolean).join(' ');
}

/* Подсказка предмета — как её рисует клиент 1.12. */
function itemTooltip(f, spellCache, icon) {
  const n = (k) => Number(f[k]) || 0;
  const tt = h('div', { class: 'tt' });
  const line = (text, cls) => tt.append(h('div', { class: cls || null }, text));
  const pair = (l, r, cls) => tt.append(h('div', { class: 'tt-row' + (cls ? ' ' + cls : '') }, h('span', null, l), h('span', null, r || '')));
  line(f.name || L('Без названия'), 'big ttq' + n('Quality'));
  const bond = IC.bonding.find(([v]) => v === n('bonding'));
  if (bond && bond[2]) line(bond[2]);
  if (n('maxcount') === 1) line('Unique');
  if (n('startquest')) line('This Item Begins a Quest');
  const cls = n('class'), sub = n('subclass'), slot = n('InventoryType');
  const right = (IC.subEn[cls] || {})[sub] || '';
  if (slot || right) pair(IC.slotEn[slot] || '', right);
  if (cls === 1 || cls === 11) { if (n('ContainerSlots')) line(`${n('ContainerSlots')} Slot ${cls === 11 ? 'Quiver' : 'Bag'}`); }
  if (cls === 2) {
    let dps = 0;
    const speed = n('delay') / 1000;
    for (let i = 1; i <= 5; i++) {
      const lo = n('dmg_min' + i), hi = n('dmg_max' + i);
      if (!lo && !hi) continue;
      const school = IC.school.find(([v]) => v === n('dmg_type' + i));
      const txt = `${Math.round(lo)} - ${Math.round(hi)}${school && school[2] ? ' ' + school[2] : ''} Damage`;
      if (i === 1) pair(txt, speed ? `Speed ${speed.toFixed(2)}` : '');
      else line('+ ' + txt);
      if (speed) dps += (lo + hi) / 2 / speed;
    }
    if (dps) line(`(${dps.toFixed(1)} damage per second)`);
  }
  if (n('armor')) line(`${n('armor')} Armor`);
  if (n('block')) line(`${n('block')} Block`);
  for (let i = 1; i <= 10; i++) {
    const v = n('stat_value' + i);
    if (!v) continue;
    const st = IC.stats.find(([t]) => t === n('stat_type' + i));
    line(`${v > 0 ? '+' : ''}${v} ${st ? st[2] : 'Stat'}`, v < 0 ? 'r' : null);
  }
  for (const [key, , en] of IC.resist) if (n(key)) line(`+${n(key)} ${en} Resistance`);
  if (n('MaxDurability')) line(`Durability ${n('MaxDurability')} / ${n('MaxDurability')}`);
  const ac = n('AllowableClass'), ar = n('AllowableRace');
  if (ac > 0 && (ac & ALL_CLASSES) !== ALL_CLASSES) line('Classes: ' + IC.classMask.filter(([v]) => ac & v).map((x) => x[2]).join(', '));
  if (ar > 0 && (ar & ALL_RACES) !== ALL_RACES) line('Races: ' + IC.raceMask.filter(([v]) => ar & v).map((x) => x[2]).join(', '));
  if (n('RequiredLevel') > 1) line(`Requires Level ${n('RequiredLevel')}`);
  if (n('requiredhonorrank')) line(`Requires rank ${n('requiredhonorrank')}`);
  for (let i = 1; i <= 5; i++) {
    const sid = n('spellid_' + i);
    if (!sid) continue;
    const trg = IC.trigger.find(([v]) => v === n('spelltrigger_' + i));
    const info = spellCache[sid];
    line(`${trg ? trg[2] : 'Use:'} ${info ? (info.desc || info.name) : L('заклинание ') + sid + '…'}`, 'g');
  }
  if (f.description) line(`"${f.description}"`, 'y');
  if (n('SellPrice')) line('Sell Price: ' + coinsEn(n('SellPrice')), 'gr small');
  return h('div', { class: 'tt-wrap' }, iconImg(icon, true), tt);
}

let itemMeta = null;
const spellCache = {};

async function ensureItemMeta() {
  if (!itemMeta) itemMeta = (await api('/api/items/meta')).data;
  return itemMeta;
}

async function loadSpellInfo(ids) {
  const missing = [...new Set(ids.filter((i) => i && !spellCache[i]))];
  if (!missing.length) return;
  const rows = (await api('/api/spells?ids=' + missing.join(','))).data;
  for (const r of rows) spellCache[r.id] = r;
}

function blankItem(meta) {
  const f = {};
  for (const c of meta.cols) f[c.name] = c.default;
  Object.assign(f, { name: L('Новый предмет'), class: 4, subclass: 1, InventoryType: 5, Quality: 2, ItemLevel: 10,
                     RequiredLevel: 5, MaxDurability: 50, bonding: 2, stackable: 1, Material: 7, displayid: 0, delay: 1000 });
  return f;
}

/* ---------- поля формы: каждое пишет прямо в st.f и зовёт st.changed() ---------- */

function fField(label, input, hint) {
  return h('label', { class: 'field' }, h('span', null, label), input, hint ? h('small', null, hint) : null);
}

function fNum(st, key, opts = {}) {
  const col = st.meta.byName[key] || {};
  const input = h('input', { class: 'inp', type: 'number', step: col.kind === 'float' ? 'any' : '1',
                             min: opts.min ?? col.min, max: opts.max ?? col.max, value: st.f[key] ?? 0 });
  input.addEventListener('input', () => { st.f[key] = input.value === '' ? 0 : Number(input.value); st.changed(); });
  return input;
}

function fText(st, key, placeholder) {
  const col = st.meta.byName[key] || {};
  const input = h('input', { class: 'inp', type: 'text', maxlength: col.max, value: st.f[key] ?? '', placeholder });
  input.addEventListener('input', () => { st.f[key] = input.value; st.changed(); });
  return input;
}

function fSel(st, key, options, onChange) {
  const sel = h('select', { class: 'inp' }, options.map(([v, l]) => h('option', { value: v }, l)));
  const cur = Number(st.f[key]);
  if (!options.some(([v]) => v === cur)) sel.append(h('option', { value: cur }, L('{0} (своё значение)', cur)));
  sel.value = String(cur);
  sel.addEventListener('change', () => { st.f[key] = Number(sel.value); if (onChange) onChange(); st.changed(); });
  return sel;
}

function fMoney(st, key) {
  const c = Number(st.f[key]) || 0;
  const g = h('input', { class: 'inp', type: 'number', min: 0, value: Math.floor(c / 10000) });
  const s2 = h('input', { class: 'inp', type: 'number', min: 0, max: 99, value: Math.floor((c % 10000) / 100) });
  const cu = h('input', { class: 'inp', type: 'number', min: 0, max: 99, value: c % 100 });
  const upd = () => { st.f[key] = (+g.value || 0) * 10000 + (+s2.value || 0) * 100 + (+cu.value || 0); st.changed(); };
  [g, s2, cu].forEach((i) => i.addEventListener('input', upd));
  return h('div', { class: 'money' }, g, h('span', null, L('з')), s2, h('span', null, L('с')), cu, h('span', null, L('м')));
}

function fMask(st, key, list, all) {
  const box = h('div', { class: 'checks' });
  const allBox = h('input', { type: 'checkbox' });
  const boxes = list.map(([v, label]) => {
    const cb = h('input', { type: 'checkbox' });
    box.append(h('label', { class: 'chk' }, cb, label));
    return [v, cb];
  });
  const paint = () => {
    const val = Number(st.f[key]);
    const everyone = val === -1 || (val & all) === all;
    allBox.checked = everyone;
    for (const [v, cb] of boxes) cb.checked = everyone || !!(val & v);
  };
  allBox.addEventListener('change', () => { st.f[key] = allBox.checked ? -1 : 0; paint(); st.changed(); });
  for (const [, cb] of boxes) cb.addEventListener('change', () => {
    const mask = boxes.reduce((a, [v, c]) => (c.checked ? a | v : a), 0);
    st.f[key] = mask === all ? -1 : mask;
    paint(); st.changed();
  });
  paint();
  return h('div', null, h('label', { class: 'chk strong' }, allBox, L('Все')), box);
}

function fFlags(st, key, list) {
  const box = h('div', { class: 'checks wide' });
  const num = h('span', { class: 'muted small' });
  const paint = () => { num.textContent = L('значение поля {0}: {1}', key, st.f[key]); };
  for (const [bit, label] of list) {
    const cb = h('input', { type: 'checkbox', checked: !!(Number(st.f[key]) & bit) });
    cb.addEventListener('change', () => { st.f[key] = cb.checked ? (Number(st.f[key]) | bit) : (Number(st.f[key]) & ~bit); paint(); st.changed(); });
    box.append(h('label', { class: 'chk' }, cb, label));
  }
  paint();
  return h('div', null, box, num);
}

/* ---------- выбор заклинания-эффекта ---------- */

function spellPicker(preset, onPick) {
  const q = h('input', { class: 'inp', type: 'search', placeholder: L('Название или описание по-английски, либо ID'), value: preset ? preset[1] : '' });
  q.style.width = '100%';
  const res = h('div', { class: 'list pick-list' });
  const count = h('div', { class: 'muted small' });
  let prefix = !!preset;
  const run = async () => {
    const term = q.value.trim();
    if (term.length < 2 && !/^\d+$/.test(term)) { res.replaceChildren(); count.textContent = ''; return; }
    res.replaceChildren(h('div', { class: 'empty' }, L('Ищу…')));
    try {
      const r = await api(`/api/spells?q=${encodeURIComponent(term)}${prefix ? '&prefix=1' : ''}`);
      count.textContent = r.total > r.data.length ? L('показано {0} из {1}', r.data.length, r.total) : L('найдено: {0}', r.total);
      res.replaceChildren(...r.data.map((sp) => h('div', { class: 'li click', onclick: () => { spellCache[sp.id] = sp; onPick(sp); close(); } },
        h('div', { class: 'grow' }, h('b', null, sp.name), sp.rank ? h('span', { class: 'muted small' }, ' · ' + sp.rank) : null,
          h('div', { class: 'small g-text' }, sp.desc || L('— без описания —'))),
        h('span', { class: 'muted small mono' }, '#' + sp.id), sp.passive ? badge(L('пассивное'), 'ok') : null)));
      if (!r.data.length) res.append(h('div', { class: 'empty' }, L('Ничего не нашлось.')));
    } catch (e) { res.replaceChildren(errorCard(e)); }
  };
  q.addEventListener('input', debounce(() => { prefix = false; run(); }, 350));
  const chips = h('div', { class: 'chips' }, IC.presets.map((p) =>
    h('button', { class: 'chip', type: 'button', onclick: () => { q.value = p[1]; prefix = true; run(); } }, p[0])));
  let close;
  const box = h('div', { class: 'modal wide' },
    h('div', { class: 'modal-h' }, h('div', null, h('h3', null, L('Выбор эффекта')),
      h('p', null, L('Сила атаки, крит, меткость и прочее в классике даются заклинанием «При надевании». Выберите нужную силу эффекта из списка.'))),
      h('button', { class: 'btn ghost sm x', type: 'button', onclick: () => close() }, icon('x'))),
    h('div', { class: 'modal-b stack' }, chips, q, count, res));
  close = openOverlay(box);
  setTimeout(() => q.focus(), 30);
  if (preset) run();
}

/* ---------- выбор внешнего вида ---------- */

function lookPicker(st, onDone) {
  const q = h('input', { class: 'inp', type: 'search', placeholder: L('Название предмета, чей вид берём (по-английски)') });
  q.style.width = '100%';
  const alsoType = h('input', { type: 'checkbox', checked: true });
  const res = h('div', { class: 'list pick-list' });
  q.addEventListener('input', debounce(async () => {
    const term = q.value.trim();
    if (term.length < 2) { res.replaceChildren(); return; }
    try {
      const rows = (await api('/api/items/search?q=' + encodeURIComponent(term))).data;
      res.replaceChildren(...rows.map((it) => h('div', { class: 'li click', onclick: () => {
        st.f.displayid = it.displayid;
        if (alsoType.checked) { st.f.class = it.class; st.f.subclass = it.subclass; st.f.InventoryType = it.slot; }
        st.icon = it.icon;
        close(); onDone();
      } }, iconImg(it.icon), h('span', { class: `grow q${it.quality}` }, it.name),
        h('span', { class: 'muted small' }, L('{0} · вид {1}', IC.slot[it.slot] || '', it.displayid)))));
      if (!rows.length) res.append(h('div', { class: 'empty' }, L('Ничего не нашлось.')));
    } catch (e) { res.replaceChildren(errorCard(e)); }
  }, 300));
  let close;
  const box = h('div', { class: 'modal wide' },
    h('div', { class: 'modal-h' }, h('div', null, h('h3', null, L('Внешний вид')),
      h('p', null, L('Своих моделей клиент не знает, поэтому вид берётся у существующего предмета: модель и иконка будут как у него.'))),
      h('button', { class: 'btn ghost sm x', type: 'button', onclick: () => close() }, icon('x'))),
    h('div', { class: 'modal-b stack' }, q, h('label', { class: 'chk' }, alsoType, L('Заодно взять тип и слот этого предмета')), res));
  close = openOverlay(box);
  setTimeout(() => q.focus(), 30);
}

/* ---------- галерея видов: все модели этого типа, подтипа и слота ---------- */

function lookGallery(st, onDone) {
  const cls = Number(st.f.class), sub = Number(st.f.subclass), slot = Number(st.f.InventoryType);
  const subName = ((IC.sub[cls] || []).find(([v]) => v === sub) || [0, ''])[1];
  const clsName = (IC.classes.find(([v]) => v === cls) || [0, ''])[1];
  const onlySlot = h('input', { type: 'checkbox', checked: true });
  const q = h('input', { class: 'inp', type: 'search', placeholder: L('Фильтр по названию (по-английски)') });
  q.style.flex = '1 1 260px';
  const grid = h('div', { class: 'look-grid' });
  const caption = h('div', { class: 'look-caption muted' }, L('Наведите на иконку — появится предмет с этим видом. Нажмите — вид выбран. Бледные в конце — виды служебных предметов разработчиков.'));
  const count = h('span', { class: 'muted small' });
  let rows = [];
  let close;
  const paint = () => {
    const term = q.value.trim().toLowerCase();
    const shown = term ? rows.filter((r) => r.name.toLowerCase().includes(term)) : rows;
    count.textContent = L('видов: {0}', shown.length);
    grid.replaceChildren(...shown.map((r) => {
      const tile = h('button', { class: 'look-tile' + (r.displayid === Number(st.f.displayid) ? ' on' : '') + (r.dev ? ' dev' : ''),
                                 type: 'button', title: L('{0} · вид {1}', r.name, r.displayid), 'aria-label': r.name }, iconImg(r.icon, true));
      // replaceChildren превращает null в текст «null», поэтому всё в одном span через h()
      const show = () => caption.replaceChildren(h('span', null, h('b', { class: 'q' + r.quality }, r.name),
        L(' · вид {0} · уровень {1}{2}', r.displayid, r.ilvl, r.n > 1 ? L(' · такой вид у {0} предметов', r.n) : ''),
        r.dev ? L(' · только у служебных предметов разработчиков') : null));
      tile.addEventListener('mouseenter', show);
      tile.addEventListener('focus', show);
      tile.addEventListener('click', () => { st.f.displayid = r.displayid; st.icon = r.icon; close(); onDone(); });
      return tile;
    }));
    if (!shown.length) grid.append(h('div', { class: 'empty' }, L('Ни одного предмета с таким видом.')));
  };
  const load = async () => {
    grid.replaceChildren(h('div', { class: 'empty' }, L('Загружаю…')));
    try {
      rows = (await api(`/api/items/looks?class=${cls}&subclass=${sub}${onlySlot.checked ? '&slot=' + slot : ''}`)).data;
      paint();
    } catch (e) { grid.replaceChildren(errorCard(e)); }
  };
  q.addEventListener('input', debounce(paint, 150));
  onlySlot.addEventListener('change', load);
  const box = h('div', { class: 'modal xwide' },
    h('div', { class: 'modal-h' }, h('div', null, h('h3', null, L('Внешний вид')),
      h('p', null, L('{0} · {1} · {2}. Все виды, которые есть у предметов этого типа в игре.', clsName, subName, IC.slot[slot] || ''))),
      h('button', { class: 'btn ghost sm x', type: 'button', 'aria-label': L('Закрыть'), onclick: () => close() }, icon('x'))),
    h('div', { class: 'modal-b stack' },
      h('div', { class: 'row' }, q, h('label', { class: 'chk' }, onlySlot, L('только слот «{0}»', IC.slot[slot] || '')), h('span', { class: 'spacer' }), count),
      caption, grid));
  close = openOverlay(box);
  load();
}

/* ---------- вкладки редактора ---------- */

function tabMain(st) {
  const rerender = () => st.redraw();
  const cls = Number(st.f.class);
  const subOpts = IC.sub[cls] || [[0, '—']];

  const slots = slotChoices(cls, Number(st.f.subclass)).map((v) => [v, IC.slot[v]]);
  const lookInfo = h('span', { class: 'muted small' }, st.icon ? L('иконка {0}', st.icon) : (Number(st.f.displayid) ? L('иконка не найдена') : L('вид не выбран')));
  const lookIcon = h('span', null, iconImg(st.icon));
  const displayIn = fNum(st, 'displayid');
  displayIn.addEventListener('input', debounce(async () => {
    const id = Number(displayIn.value) || 0;
    try {
      st.icon = id ? (await api('/api/display?id=' + id)).data.icon : '';
      lookInfo.textContent = st.icon ? L('иконка {0}', st.icon) : (id ? L('такого вида нет') : L('вид не выбран'));
    } catch (e) { st.icon = ''; lookInfo.textContent = e.message; }
    lookIcon.replaceChildren(iconImg(st.icon));
    st.changed();
  }, 400));
  return h('div', { class: 'form' },
    fField(L('Название'), fText(st, 'name'), L('Так предмет будет называться в игре. Кириллица работает, если она есть в клиенте.')),
    fField(L('Описание'), fText(st, 'description', L('Жёлтая строка в кавычках внизу подсказки'))),
    h('div', { class: 'fields-2' },
      fField(L('Качество'), fSel(st, 'Quality', IC.quality)),
      fField(L('Привязка'), fSel(st, 'bonding', IC.bonding))),
    h('div', { class: 'fields-3' },
      fField(L('Тип'), fSel(st, 'class', IC.classes, () => { applyNatural(st.f, true); rerender(); })),
      fField(L('Подтип'), fSel(st, 'subclass', subOpts, () => { applyNatural(st.f, false); rerender(); })),
      fField(L('Слот'), fSel(st, 'InventoryType', slots))),
    fField(L('Внешний вид'), h('div', { class: 'row inline-inp' }, lookIcon, displayIn,
      h('button', { class: 'btn pri', type: 'button', onclick: () => lookGallery(st, rerender) }, L('Показать все виды…')),
      h('button', { class: 'btn', type: 'button', onclick: () => lookPicker(st, rerender) }, L('Взять у предмета…')), lookInfo),
      L('Номер модели из ItemDisplayInfo.dbc. Проще всего взять у похожего предмета.')),
    h('div', { class: 'fields-3' },
      fField(L('Уровень предмета'), fNum(st, 'ItemLevel')),
      fField(L('Требуемый уровень'), fNum(st, 'RequiredLevel')),
      fField(L('Прочность'), fNum(st, 'MaxDurability'), L('0 — не ломается'))),
    h('div', { class: 'fields-3' },
      fField(L('Уникальный'), fNum(st, 'maxcount'), L('1 — можно иметь только один')),
      fField(L('В стопке'), fNum(st, 'stackable'), L('сколько штук в одной ячейке')),
      fField(L('Материал'), fSel(st, 'Material', IC.material))),
    h('div', { class: 'fields-2' },
      fField(L('Цена у торговца'), fMoney(st, 'BuyPrice')),
      fField(L('Цена продажи торговцу'), fMoney(st, 'SellPrice'))),
    cls === 2 ? fField(L('Как носится'), fSel(st, 'sheath', IC.sheath), L('где висит оружие, когда убрано')) : null);
}

function tabStats(st) {
  const rows = [];
  for (let i = 1; i <= 10; i++) {
    rows.push(h('div', { class: 'stat-row' },
      fSel(st, 'stat_type' + i, IC.stats.map(([v, ru]) => [v, ru])), fNum(st, 'stat_value' + i)));
  }
  return h('div', { class: 'form' },
    h('p', { class: 'muted small' }, L('В классике у предмета бывает только семь характеристик. Значение 0 — строки нет. Минус тоже можно: «-5 Spirit».')),
    h('div', { class: 'stat-grid' }, rows),
    h('h4', { class: 'muted small' }, L('ЗАЩИТА')),
    h('div', { class: 'fields-2' }, fField(L('Броня'), fNum(st, 'armor')), fField(L('Блок щитом'), fNum(st, 'block'))),
    h('h4', { class: 'muted small' }, L('СОПРОТИВЛЕНИЯ')),
    h('div', { class: 'fields-3' }, IC.resist.map(([key, ru]) => fField(ru, fNum(st, key)))));
}

function tabWeapon(st) {
  const rows = [];
  for (let i = 1; i <= 5; i++) {
    rows.push(h('div', { class: 'dmg-row' },
      fField(i === 1 ? L('Урон от') : L('Доп. урон от'), fNum(st, 'dmg_min' + i)),
      fField(L('до'), fNum(st, 'dmg_max' + i)),
      fField(L('Тип урона'), fSel(st, 'dmg_type' + i, IC.school.map(([v, ru]) => [v, ru])))));
  }
  const dps = h('b');
  const calc = () => {
    const sp = Number(st.f.delay) / 1000;
    let d = 0;
    for (let i = 1; i <= 5; i++) d += sp ? ((Number(st.f['dmg_min' + i]) || 0) + (Number(st.f['dmg_max' + i]) || 0)) / 2 / sp : 0;
    dps.textContent = d ? d.toFixed(1) : '—';
  };
  st.onchange.push(calc);
  calc();
  return h('div', { class: 'form' },
    Number(st.f.class) !== 2 ? h('div', { class: 'alert warning' }, icon('warn'), h('span', null, L('Урон и скорость работают только у оружия (тип «Оружие»).'))) : null,
    h('div', { class: 'fields-3' },
      fField(L('Скорость, мс'), fNum(st, 'delay'), L('2600 = 2.60 сек между ударами')),
      fField(L('Урон в секунду'), h('div', { class: 'inp static' }, dps)),
      fField(L('Боеприпасы'), fSel(st, 'ammo_type', IC.ammo))),
    rows,
    fField(L('Дальность (для луков и ружей)'), fNum(st, 'RangedModRange')));
}

function tabEffects(st) {
  const slots = [];
  for (let i = 1; i <= 5; i++) {
    const desc = h('div', { class: 'small g-text' });
    const paintDesc = () => {
      const sid = Number(st.f['spellid_' + i]);
      const info = spellCache[sid];
      desc.textContent = sid ? (info ? `${info.name}: ${info.desc || L('без описания')}` : L('загружаю описание…')) : L('эффекта нет');
    };
    st.onchange.push(paintDesc);
    paintDesc();
    const idIn = fNum(st, 'spellid_' + i);
    const pick = (preset) => spellPicker(preset, (sp) => {
      st.f['spellid_' + i] = sp.id;
      if (sp.passive) st.f['spelltrigger_' + i] = 1;
      else if (Number(st.f['spelltrigger_' + i]) === 1) st.f['spelltrigger_' + i] = 0;
      st.redraw();
    });
    slots.push(h('div', { class: 'spell-slot' },
      h('div', { class: 'row' }, h('b', null, L('Эффект {0}', i)), h('span', { class: 'spacer' }),
        h('button', { class: 'btn sm', type: 'button', onclick: () => pick(null) }, L('Найти…')),
        Number(st.f['spellid_' + i]) ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => {
          st.f['spellid_' + i] = 0; st.f['spelltrigger_' + i] = 0; st.f['spellppmRate_' + i] = 0; st.redraw(); } }, L('убрать')) : null),
      h('div', { class: 'fields-3' },
        fField(L('Заклинание (ID)'), idIn),
        fField(L('Когда срабатывает'), fSel(st, 'spelltrigger_' + i, IC.trigger.map(([v, ru]) => [v, ru]))),
        fField(L('Срабатываний в минуту'), fNum(st, 'spellppmRate_' + i), L('только для «шанс при ударе»'))),
      h('div', { class: 'fields-3' },
        fField(L('Заряды'), fNum(st, 'spellcharges_' + i), L('0 — бесконечно; минус — предмет исчезает')),
        fField(L('Откат, мс'), fNum(st, 'spellcooldown_' + i), L('-1 — как у заклинания')),
        fField(L('Общий откат категории, мс'), fNum(st, 'spellcategorycooldown_' + i))),
      desc));
  }
  return h('div', { class: 'form' },
    h('div', { class: 'field' }, h('span', null, L('Быстро добавить эффект в первый свободный слот')),
      h('div', { class: 'chips' }, IC.presets.map((p) => h('button', { class: 'chip', type: 'button', onclick: () => {
        let i = 1;
        while (i <= 5 && Number(st.f['spellid_' + i])) i++;
        if (i > 5) { toast(L('Все пять слотов эффектов заняты.'), true); return; }
        spellPicker(p, (sp) => { st.f['spellid_' + i] = sp.id; st.f['spelltrigger_' + i] = sp.passive ? 1 : 0; st.redraw(); });
      } }, p[0])))),
    slots);
}

function tabReqs(st) {
  return h('div', { class: 'form' },
    fField(L('Каким классам можно'), fMask(st, 'AllowableClass', IC.classMask, ALL_CLASSES)),
    fField(L('Каким расам можно'), fMask(st, 'AllowableRace', IC.raceMask, ALL_RACES)),
    h('div', { class: 'fields-3' },
      fField(L('Навык (ID)'), fNum(st, 'RequiredSkill')), fField(L('Уровень навыка'), fNum(st, 'RequiredSkillRank')),
      fField(L('Нужно знать заклинание (ID)'), fNum(st, 'requiredspell'))),
    h('div', { class: 'fields-3' },
      fField(L('Звание PvP'), fNum(st, 'requiredhonorrank'), L('0 — не нужно')),
      fField(L('Фракция (ID)'), fNum(st, 'RequiredReputationFaction')),
      fField(L('Отношение с фракцией'), fNum(st, 'RequiredReputationRank'), L('4 дружелюбие … 7 превознесение'))),
    h('div', { class: 'fields-2' },
      fField(L('Только в зоне (ID)'), fNum(st, 'area')), fField(L('Только на карте (ID)'), fNum(st, 'Map'))));
}

function tabOther(st) {
  return h('div', { class: 'form' },
    fField(L('Особые свойства'), fFlags(st, 'Flags', IC.flags)),
    h('div', { class: 'fields-3' },
      fField(L('Ячеек в сумке'), fNum(st, 'ContainerSlots'), L('для сумок и колчанов')),
      fField(L('Что можно класть (BagFamily)'), fNum(st, 'BagFamily'), L('1 стрелы, 2 пули, 4 осколки…')),
      fField(L('Срок жизни, сек'), fNum(st, 'Duration'), L('0 — вечный'))),
    h('div', { class: 'fields-3' },
      fField(L('Начинает задание (ID)'), fNum(st, 'startquest')), fField(L('Комплект (itemset)'), fNum(st, 'itemset')),
      fField(L('Случайные свойства'), fNum(st, 'RandomProperty'), L('«…of the Bear» и т. п.'))),
    h('div', { class: 'fields-3' },
      fField(L('Замок (lockid)'), fNum(st, 'lockid')), fField(L('Текст страницы'), fNum(st, 'PageText')),
      fField(L('Распыление (DisenchantID)'), fNum(st, 'DisenchantID'))),
    h('div', { class: 'fields-3' },
      fField(L('Денег внутри от, медь'), fNum(st, 'minMoneyLoot')), fField(L('до'), fNum(st, 'maxMoneyLoot')),
      fField(L('Корм питомца'), fNum(st, 'FoodType'), L('1 мясо, 2 рыба, 3 сыр…'))),
    fField(L('Скрипт ядра (ScriptName)'), fText(st, 'ScriptName'), L('Обычно пусто. Неизвестное имя ядро отклонит.')));
}

function tabAll(st) {
  const rows = st.meta.cols.filter((c) => c.name !== 'entry').map((c) => [c.name,
    c.kind === 'text' ? fText(st, c.name) : fNum(st, c.name), c.type]);
  return h('div', { class: 'form' },
    h('p', { class: 'muted small' }, L('Все {0} полей item_template как есть. Правка здесь и на других вкладках — одно и то же.', rows.length)),
    h('div', { class: 'all-fields' }, rows.map(([name, input, type]) =>
      h('label', { class: 'af' }, h('span', { class: 'mono small' }, name), input, h('small', { class: 'muted' }, type)))));
}

const ITEM_TABS = [['main', L('Основное'), tabMain], ['stats', L('Характеристики'), tabStats], ['weapon', L('Оружие'), tabWeapon],
  ['effects', L('Эффекты'), tabEffects], ['reqs', L('Требования'), tabReqs], ['other', L('Прочее'), tabOther], ['all', L('Все поля'), tabAll]];

/* ---------- страница ---------- */

PAGES.items = {
  title: L('Предметы'), sub: L('Свои предметы с любыми характеристиками. Номера с 90000, оригинальные предметы не меняются.'),
  async render(el) {
    const meta = await ensureItemMeta();
    meta.byName = meta.byName || Object.fromEntries(meta.cols.map((c) => [c.name, c]));
    const listBox = h('div', { class: 'list' });
    const editor = h('div');
    let current = null;

    const loadList = async () => {
      const r = await api('/api/items/custom');
      listBox.replaceChildren(...(r.data.length ? r.data.map((it) => h('div', {
        class: 'li click' + (current && current.entry === it.entry ? ' on' : ''),
        onclick: () => openItem(it.entry) },
        iconImg(it.icon), h('div', { class: 'grow' }, h('div', { class: 'q' + it.quality }, it.name),
          h('div', { class: 'muted small' }, `#${it.entry} · ${IC.slot[it.slot] || ''}${it.instances ? L(' · у игроков: ') + it.instances : ''}`))))
        : [h('div', { class: 'empty' }, L('Своих предметов пока нет. Нажмите «Новый предмет».'))]));
    };

    const openItem = async (entry, asCopy) => {
      const d = (await api('/api/item?entry=' + entry)).data;
      for (const sp of d.spells) spellCache[sp.id] = sp;
      const f = { ...d.item };
      delete f.entry;
      if (!d.custom || asCopy) {
        startEditor({ entry: null, base: entry, f: { ...f, name: d.custom ? f.name + L(' (копия)') : f.name }, icon: d.icon, baseName: d.item.name });
      } else {
        startEditor({ entry, base: null, f, icon: d.icon, loaded: d.loaded, instances: d.instances });
      }
    };

    const startEditor = (init) => {
      current = init;
      const st = { ...init, meta, tab: 'main', dirty: false, onchange: [] };
      const preview = h('div');
      const tabBody = h('div');
      const tabBar = h('div');
      const saveBtn = h('button', { class: 'btn pri', type: 'button' }, st.entry ? L('Сохранить') : L('Создать предмет'));
      const dirtyMark = h('span', { class: 'muted small' });
      const drawPreview = debounce(async () => {
        const ids = [1, 2, 3, 4, 5].map((i) => Number(st.f['spellid_' + i])).filter(Boolean);
        try { await loadSpellInfo(ids); } catch (e) { /* описание просто не подтянется */ }
        preview.replaceChildren(itemTooltip(st.f, spellCache, st.icon));
        st.onchange.forEach((fn) => fn());
      }, 120);
      st.changed = () => { st.dirty = true; dirtyMark.textContent = L('есть несохранённые изменения'); drawPreview(); };
      st.redraw = () => { drawTab(); st.changed(); };
      const drawTab = () => {
        st.onchange = [];
        tabBar.replaceChildren(tabs(ITEM_TABS.map(([k, l]) => [k, l]), st.tab, (k) => { st.tab = k; drawTab(); }));
        tabBody.replaceChildren(ITEM_TABS.find((t) => t[0] === st.tab)[2](st));
      };

      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        try {
          const r = (await api('/api/item/save', { entry: st.entry, base: st.base, fields: st.f })).data;
          st.dirty = false;
          dirtyMark.textContent = '';
          await loadList();
          await openItem(r.entry);
          infoModal(r.created ? L('Предмет создан: #{0}', r.entry) : L('Изменения сохранены'), afterSaveNote(r));
        } catch (e) { toast(e.message, true); } finally { saveBtn.disabled = false; }
      });

      const title = st.entry ? `${st.f.name} · #${st.entry}` : (st.base ? L('Новый предмет на основе чужого') : L('Новый предмет'));
      const status = st.entry ? (st.loaded === true ? badge(L('в игре доступен'), 'ok')
        : st.loaded === false ? badge(L('ждёт перезапуска мира'), 'warn') : badge(L('мир не ответил'))) : badge(L('ещё не сохранён'));
      const actions = h('div', { class: 'row' }, saveBtn,
        st.entry ? h('button', { class: 'btn', type: 'button', onclick: () => openItem(st.entry, true) }, L('Сделать копию')) : null,
        st.entry ? h('button', { class: 'btn', type: 'button', onclick: () => giveItemModal(st.entry, st.f.name, st.loaded) }, L('Выдать персонажу')) : null,
        st.entry ? h('button', { class: 'btn', type: 'button', onclick: async () => {
          try { infoModal(L('SQL предмета'), h('pre', { class: 'out sql' }, (await api('/api/item/sql?entry=' + st.entry)).data.sql)); } catch (e) { toast(e.message, true); } } }, 'SQL') : null,
        st.entry ? h('button', { class: 'btn dng', type: 'button', onclick: () => deleteItemModal(st.entry, st.f.name, st.instances, async () => {
          current = null; await loadList(); showWelcome(); }) }, L('Удалить')) : null,
        dirtyMark);

      editor.replaceChildren(card(title, null, status,
        h('div', { class: 'card-b stack' },
          st.base ? h('div', { class: 'alert warning' }, icon('warn'),
            h('span', null, L('Основа — «{0}» #{1}. Сохранится как новый предмет с номером от 90000; оригинал не меняется.', st.baseName, st.base))) : null,
          st.entry && st.loaded === false ? restartNote() : null,
          actions,
          h('div', { class: 'ie-body' },
            h('div', { class: 'ie-form' }, tabBar, tabBody),
            h('div', { class: 'ie-preview' }, h('div', { class: 'muted small' }, L('Так предмет выглядит в игре')), preview)))));
      drawTab();
      drawPreview();
      loadList();
    };

    const showWelcome = () => {
      editor.replaceChildren(card(L('Как это работает'), null, null, h('div', { class: 'card-b stack' },
        h('ol', { class: 'steps-list' },
          h('li', null, L('Нажмите «Новый предмет» или найдите любой существующий и возьмите его за основу — так проще всего получить нужный тип и внешний вид.')),
          h('li', null, L('Задайте название, качество, характеристики, урон, броню и эффекты. Подсказка справа сразу показывает, как это будет выглядеть в игре.')),
          h('li', null, L('Сохраните. Предмет запишется в базу с номером от 90000.')),
          h('li', null, L('Перезапустите мир: предметы он читает только при запуске. После этого предмет можно выдать любому персонажу — письмом.'))),
        h('p', { class: 'muted small' }, L('Если меняете предмет, который игроки уже видели, им нужно удалить папку WDB в клиенте — иначе подсказка останется старой.')))));
    };

    const search = h('input', { class: 'inp', type: 'search', placeholder: L('Найти любой предмет, чтобы взять за основу') });
    search.style.width = '100%';
    const found = h('div', { class: 'list' });
    search.addEventListener('input', debounce(async () => {
      const term = search.value.trim();
      if (term.length < 2) { found.replaceChildren(); return; }
      try {
        const rows = (await api('/api/items/search?q=' + encodeURIComponent(term))).data;
        found.replaceChildren(...rows.slice(0, 25).map((it) => h('div', { class: 'li click', onclick: () => openItem(it.entry) },
          iconImg(it.icon), h('div', { class: 'grow' }, h('div', { class: 'q' + it.quality }, it.name),
            h('div', { class: 'muted small' }, L('#{0} · {1} · ур. {2}', it.entry, IC.slot[it.slot] || '', it.ilvl))))));
        if (!rows.length) found.append(h('div', { class: 'empty' }, L('Ничего не нашлось.')));
      } catch (e) { found.replaceChildren(errorCard(e)); }
    }, 300));

    setTools(h('button', { class: 'btn pri', type: 'button', onclick: () => startEditor({ entry: null, base: null, f: blankItem(meta), icon: '' }) }, L('Новый предмет')));
    el.replaceChildren(h('div', { class: 'items-grid' },
      h('div', { class: 'stack' },
        card(L('Мои предметы'), null, null, h('div', { class: 'card-b flush' }, listBox)),
        card(L('Взять за основу'), null, null, h('div', { class: 'card-b' }, search), h('div', { class: 'card-b flush' }, found))),
      editor));
    showWelcome();
    await loadList();
  },
};

function restartNote() {
  return h('div', { class: 'alert warning' }, icon('warn'), h('div', null,
    h('span', null, L('Предмет записан в базу, но работающий мир его ещё не знает: предметы читаются только при запуске. Выдать его можно после перезапуска.')),
    h('div', { class: 'row restart-row' },
      h('button', { class: 'btn sm', type: 'button', onclick: () => formModal({ title: L('Перезапуск, когда никого не будет'),
        text: L('Мир перезапустится сам, как только на сервере не останется игроков.'), submit: L('Запланировать'),
        onSubmit: async () => (await api('/api/server', { action: 'idlerestart', delay: 60 })).data }) }, L('Когда никого не будет')),
      h('button', { class: 'btn sm dng', type: 'button', onclick: () => formModal({ title: L('Перезапустить мир через минуту?'),
        text: L('Игроки увидят предупреждение, персонажи сохранятся.'), submit: L('Перезапустить'), danger: true,
        onSubmit: async () => (await api('/api/server', { action: 'restart', delay: 60 })).data }) }, L('Через минуту')))));
}

function afterSaveNote(r) {
  return h('div', { class: 'stack' },
    resultView({ success: true, output: r.created ? L('Записан в базу под номером {0}.', r.entry) : L('Изменения записаны в базу.') }),
    r.loaded ? h('p', null, L('Мир уже знает этот предмет.')) : restartNote(),
    h('p', { class: 'muted small' }, L('Копия всех своих предметов обновлена в WebPanel/data/custom_items.sql. Если игроки уже видели прежний вариант предмета, им нужно удалить папку WDB в клиенте.')));
}

function giveItemModal(entry, name, loaded) {
  formModal({ title: L('Выдать «{0}»', name),
    text: loaded === false ? L('Внимание: мир ещё не знает этот предмет — сначала перезапустите мир, иначе ядро откажет.') : L('Предмет придёт письмом в игровой почтовый ящик.'),
    fields: [{ name: 'char', label: L('Имя персонажа') }, { name: 'count', label: L('Сколько штук'), type: 'number', min: 1, max: 1000, value: 1 },
             { name: 'subject', label: L('Тема письма'), value: L('Подарок'), maxlength: 60 }],
    submit: L('Отправить'),
    onSubmit: async (v) => cmdAction('items', { name: v.char.trim(), subject: v.subject, text: L('От администрации сервера'),
                                                items: [{ id: entry, count: Number(v.count) || 1 }] }) });
}

function deleteItemModal(entry, name, instances, onDone) {
  formModal({ title: L('Удалить «{0}»?', name),
    text: instances ? L('У персонажей сейчас {0} таких вещей. После перезапуска мира ядро удалит их из сумок — предмета больше не будет.', instances)
                    : L('Предмет исчезнет из базы. Отменить нельзя, но его SQL-копия останется в журнале custom_items.sql до следующего сохранения.'),
    fields: [{ name: 'confirm', label: L('Впишите название точно') }], submit: L('Удалить'), danger: true,
    onSubmit: async (v) => (await api('/api/item/delete', { entry, confirm: v.confirm })).data,
    onDone: (res) => { if (res && res.success) { while (overlays.length) overlays[overlays.length - 1](); onDone(); } } });
}

// ============================================================ Карта мира

/* replaceChildren(…, null) вставил бы текст «null» — пустые части выкидываем */
function fill(el, ...kids) { el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false && k !== '')); return el; }

/* Карты — из своего клиента игры (tools/build_maps.py): мир → материк → зона, 1002×668, как окно
   карты в игре. Координаты WoW: X растёт на север, Y — на запад; у карты в maps.json границы
   bounds = [Y у левого края, Y у правого, X у верхнего, X у нижнего]. Высоту точки считает сервер. */
let mapsData = null;
let areaNames = {};
async function mapsManifest() {
  if (!mapsData) {
    const [r, a] = await Promise.all([fetch('/static/wow/maps/maps.json', { cache: 'force-cache' }),
      fetch('/static/wow/maps/areas.json', { cache: 'force-cache' }).catch(() => null)]);
    if (!r.ok) throw new Error(L('Нет картинок карт: соберите их на ПК — python tools/build_maps.py.'));
    mapsData = await r.json();
    if (a && a.ok) areaNames = await a.json();
  }
  return mapsData;
}
// Названия зон: на сервере AreaTable.dbc английская, русские берём из клиента (areas.json)
const areaTitle = (id, fallback) => (areaNames[id] ? areaNames[id][LANG === 'ru' ? 1 : 0] : fallback) || '';
const placeTitle = (p, fallback) => {
  const zone = areaTitle(p.zone, p.zone_name) || fallback || '';
  const area = areaTitle(p.area, p.area_name);
  return area && area !== zone ? `${zone} · ${area}` : zone;
};
const mapTitle = (m) => (m.names ? (LANG === 'ru' ? m.names.ru : m.names.en) || m.names.en : m.file);
const toWorld = (b, fx, fy) => ({ y: b[0] - fx * (b[0] - b[1]), x: b[2] - fy * (b[2] - b[3]) });
const toFrac = (b, x, y) => ({ fx: (b[0] - y) / (b[0] - b[1]), fy: (b[2] - x) / (b[2] - b[3]) });
const inFrac = (f) => f.fx >= 0 && f.fx <= 1 && f.fy >= 0 && f.fy <= 1;
const MAP_CONT = { 0: L('Восточные королевства'), 1: L('Калимдор') };

function placeAt(el, fx, fy) {
  el.style.left = (fx * 100).toFixed(3) + '%';
  el.style.top = (fy * 100).toFixed(3) + '%';
  return el;
}

function zoneAt(m, mapid, x, y) {
  // самая маленькая зона, в чьи границы попала точка: города лежат внутри своих зон
  let best = null;
  for (const z of m.zones) {
    if (z.map !== mapid || !inFrac(toFrac(z.bounds, x, y))) continue;
    const area = Math.abs((z.bounds[0] - z.bounds[1]) * (z.bounds[2] - z.bounds[3]));
    if (!best || area < best.area) best = { z, area };
  }
  return best && best.z;
}

/* Просмотр карты с выбором точки. opts: { char — имя персонажа (его метка и стартовая зона),
   start — {map, x, y} открыть сразу эту точку, pickLabel и onPick(point) — кнопка под выбранной
   точкой, extra(point) — свои узлы в карточке точки, marks — свои метки [{map, x, y, cls, title}],
   open — {map, zoneArea, x, y} открыть зону (или {map} — материк), readonly и note — только смотреть }.
   Колёсико приближает к курсору, карту можно тянуть мышью или пальцем, два пальца — масштаб.
   Уровни сменяются сами, как в игре: приблизили зону под курсором почти во весь экран — открывается
   её карта, отдалили карту зоны до конца — снова материк, где эта зона во весь экран. Города
   (Штормград в Элвиннском лесу) — уровень ниже своей зоны.
   «Вид сверху» — как на wow.tools: материк из мини-карт игры, плитки 256×256 с пирамидой уровней
   (tools/build_minimap.py), приблизить можно до отдельных деревьев. Карта зоны, приближенная до
   конца, сама переходит в вид сверху. */
function worldMapView(opts = {}) {
  const st = { view: 'world', cont: null, zone: null, point: null, pins: {}, char: opts.char || null,
    mode: pref.get('wm-mode', 'art'), top: null, aspect: [1002, 668] };
  // масштаб, сдвиг картинки в окне (px), её размер при масштабе 1 и какая её точка (доли) в центре окна
  const tf = { s: 1, x: 0, y: 0, w: 0, h: 0, cx: 0.5, cy: 0.5 };
  const crumbs = h('div', { class: 'wm-crumbs' });
  const zoneSel = h('select', { class: 'inp', 'aria-label': L('Зона') });
  const img = h('img', { class: 'wm-img', alt: '', draggable: 'false' });
  const layer = h('div', { class: 'wm-layer' });
  const tilesEl = h('div', { class: 'wm-tiles' });
  const canvas = h('div', { class: 'wm-canvas' }, img, tilesEl, layer);
  const zin = h('button', { class: 'btn sm', type: 'button', title: L('Крупнее'), 'aria-label': L('Крупнее') }, '+');
  const zout = h('button', { class: 'btn sm', type: 'button', title: L('Мельче'), 'aria-label': L('Мельче') }, '−');
  const zfit = h('button', { class: 'btn sm', type: 'button', title: L('Вся карта'), 'aria-label': L('Вся карта') }, '⤢');
  const view = h('div', { class: 'wm-view', tabindex: 0 }, canvas, h('div', { class: 'wm-zoom' }, zin, zout, zfit));
  const coords = h('span', { class: 'mono small muted wm-coords' });
  const info = h('div', { class: 'wm-info stack' });
  const modeBox = h('span', { class: 'wm-mode' });
  let mark = null;
  let man = null;
  let mini = null;
  let lastSwitch = 0;
  let anim = 0;

  // ---- масштаб и сдвиг: картинка лежит в окне целиком при масштабе 1, дальше её размер растёт
  const vw = () => view.clientWidth;
  const vh = () => view.clientHeight;
  const fitBase = () => {
    const [iw, ih] = st.aspect;
    const k = Math.min(vw() / iw, vh() / ih);
    if (k > 0) { tf.w = iw * k; tf.h = ih * k; }
  };
  function applyTf() {
    if (!tf.w) fitBase();
    const cw = tf.w * tf.s, ch = tf.h * tf.s, W = vw(), H = vh();
    tf.x = cw <= W ? (W - cw) / 2 : Math.min(0, Math.max(W - cw, tf.x));
    tf.y = ch <= H ? (H - ch) / 2 : Math.min(0, Math.max(H - ch, tf.y));
    canvas.style.left = tf.x + 'px';
    canvas.style.top = tf.y + 'px';
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    if (cw) { tf.cx = (W / 2 - tf.x) / cw; tf.cy = (H / 2 - tf.y) / ch; }
    zout.disabled = st.view === 'world' && tf.s <= 1.001;
    zfit.disabled = tf.s <= 1.001;
    if (st.view === 'top' && !tileRaf) tileRaf = requestAnimationFrame(() => { tileRaf = 0; drawTiles(); });
  }
  const fracAt = (px, py) => ({ fx: (px - tf.x) / (tf.w * tf.s), fy: (py - tf.y) / (tf.h * tf.s) });
  const at = (e) => { const r = view.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function zoomAt(px, py, s) {
    const f = fracAt(px, py);
    tf.s = Math.max(1, Math.min(Math.max(capAt(px, py), tf.s), s));
    tf.x = px - f.fx * tf.w * tf.s;
    tf.y = py - f.fy * tf.h * tf.s;
    applyTf();
  }
  function zoomAnim(px, py, s, then) {
    cancelAnimationFrame(anim);
    const s0 = tf.s, s1 = Math.max(1, Math.min(Math.max(capAt(px, py), tf.s), s)), f = fracAt(px, py), t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / 220), k = 1 - (1 - p) ** 3;
      tf.s = s0 * (s1 / s0) ** k;
      tf.x = px - f.fx * tf.w * tf.s;
      tf.y = py - f.fy * tf.h * tf.s;
      applyTf();
      if (p < 1) anim = requestAnimationFrame(step); else if (then) then();
    };
    anim = requestAnimationFrame(step);
  }

  // ---- уровни: материк → зоны → города в зонах
  const rectIn = (pb, b) => { const a = toFrac(pb, b[2], b[0]), c = toFrac(pb, b[3], b[1]); return [a.fx, a.fy, c.fx, c.fy]; };
  const zoneSize = (z) => Math.abs((z.bounds[0] - z.bounds[1]) * (z.bounds[2] - z.bounds[3]));
  // столица — уровень ниже своей зоны (область столицы → область зоны). По рамкам карт не угадать:
  // рамка Степей «вмещает» и Дуротар, и Мулгор
  const CITY_IN = { 1519: 12, 1537: 1, 1657: 141, 1637: 14, 1638: 215, 1497: 85 };
  const parentOf = (z) => (CITY_IN[z.area] ? man.zones.find((p) => p.map === z.map && p.area === CITY_IN[z.area]) || null : null);
  const curBounds = () => (st.view === 'zone' ? st.zone.bounds : st.cont.bounds);
  const kids = () => (st.view === 'world' || st.view === 'top' ? [] : man.zones.filter((z) => z.map === st.cont.map && parentOf(z) === (st.view === 'zone' ? st.zone : null)));
  // зона уровнем ниже под точкой: из тех, в чью рамку она попала, — ближайшая к центру рамки
  function kidAt(f) {
    let best = null;
    for (const z of kids()) {
      const r = rectIn(curBounds(), z.bounds);
      if (f.fx < r[0] || f.fx > r[2] || f.fy < r[1] || f.fy > r[3]) continue;
      const d = Math.hypot((f.fx - (r[0] + r[2]) / 2) / (r[2] - r[0]), (f.fy - (r[1] + r[3]) / 2) / (r[3] - r[1]));
      if (!best || d < best.d) best = { z, r, d };
    }
    return best;
  }
  const contAt = (f) => man.continents.find((c) => f.fx >= c.hit[0] && f.fx <= c.hit[2] && f.fy >= c.hit[1] && f.fy <= c.hit[3]);
  // приблизить можно до ×6 (карту зоны — до ×4), а над зоной уровнем ниже — пока она не встанет во весь экран
  function capAt(px, py) {
    // мини-карта игры — 256 точек на 533 ярда, подробнее данных нет: дальше ×2,5 видны только квадраты сжатия
    if (st.view === 'top') return (2.5 * st.aspect[0]) / tf.w;
    const hit = st.view === 'world' ? null : kidAt(fracAt(px, py));
    return Math.max(st.view === 'world' ? 2.5 : st.view === 'zone' ? 4 : 6, hit ? 1.15 / (hit.r[2] - hit.r[0]) : 0);
  }
  // новый уровень: окно выше для вида сверху, размер картинки по её сторонам; at — сдвиг {s, x, y},
  // зона {zone} во весь экран или мировая точка {X, Y, ypp, px, py}, которая встанет под (px, py)
  function setLevel(at) {
    lastSwitch = Date.now();
    cancelAnimationFrame(anim);
    view.classList.toggle('top', st.view === 'top');
    fitBase();
    const t = resolve(at);
    tf.s = Math.max(1, t ? t.s : 1);
    tf.x = t ? t.x : 0;
    tf.y = t ? t.y : 0;
    applyTf();
    canvas.classList.remove('fade');
    canvas.getBoundingClientRect();
    canvas.classList.add('fade');
  }
  // зона под курсором встала почти во весь экран — открыть её карту; точка под курсором остаётся на месте
  function goDown(px, py) {
    if (st.view === 'world' || Date.now() - lastSwitch < 450) return;
    const f = fracAt(px, py), hit = kidAt(f);
    if (!hit || tf.s * (hit.r[2] - hit.r[0]) < 0.9) return;
    const r = hit.r, s = tf.s * (r[2] - r[0]);
    const fz = { fx: (f.fx - r[0]) / (r[2] - r[0]), fy: (f.fy - r[1]) / (r[3] - r[1]) };
    showZone(hit.z, null, { s, x: px - fz.fx * tf.w * Math.max(1, s), y: py - fz.fy * tf.h * Math.max(1, s) });
  }
  // карту отдалили до конца — уровень выше, эта зона там во весь экран
  function goUp(px, py) {
    if (Date.now() - lastSwitch < 450) return;
    if (st.view === 'cont' || st.view === 'top') { showWorld(); return; }
    if (st.view !== 'zone') return;
    const z = st.zone, p = parentOf(z);
    const r = rectIn(p ? p.bounds : st.cont.bounds, z.bounds);
    const f = fracAt(px, py);
    const pf = { fx: r[0] + f.fx * (r[2] - r[0]), fy: r[1] + f.fy * (r[3] - r[1]) };
    const s = tf.s / (r[2] - r[0]);
    const t = { s, x: px - pf.fx * tf.w * s, y: py - pf.fy * tf.h * s };
    if (p) showZone(p, null, t); else showCont(st.cont, t);
  }

  const hint = (text) => fill(info, h('p', { class: 'muted small' }, text));
  // выбранная точка на той же карте (материке), что открыта сейчас
  const hasPoint = () => !!(st.point && bounds() && st.point.map === mapId());
  const bounds = () => (st.view === 'zone' ? st.zone.bounds : st.view === 'cont' ? st.cont.bounds : st.view === 'top' ? st.top.bounds : null);
  const mapId = () => (st.view === 'zone' ? st.zone.map : st.view === 'cont' ? st.cont.map : st.view === 'top' ? st.top.map : null);
  // мировая точка под (px, py) и сколько ярдов в точке экрана — чтобы другой вид открылся на том же месте
  function worldAt(px, py) {
    const b = bounds(), f = fracAt(px, py);
    return { Y: b[0] - f.fx * (b[0] - b[1]), X: b[2] - f.fy * (b[2] - b[3]), ypp: (b[0] - b[1]) / (tf.w * tf.s), px, py };
  }
  function resolve(at) {
    if (!at || at.s != null) return at;
    const b = bounds();
    if (at.zone) {
      const r = rectIn(b, at.zone.bounds);
      const s = 0.95 * Math.min(vw() / ((r[2] - r[0]) * tf.w), vh() / ((r[3] - r[1]) * tf.h));
      return { s, x: vw() / 2 - ((r[0] + r[2]) / 2) * tf.w * s, y: vh() / 2 - ((r[1] + r[3]) / 2) * tf.h * s };
    }
    const s = (b[0] - b[1]) / (tf.w * at.ypp);
    return { s, x: at.px - ((b[0] - at.Y) / (b[0] - b[1])) * tf.w * s, y: at.py - ((b[2] - at.X) / (b[2] - b[3])) * tf.h * s };
  }

  // ---- вид сверху: квадрат местности (c, r) мини-карты — 533⅓ ярда, его северо-западный угол в мире
  // X = (32 − r)·533⅓, Y = (32 − c)·533⅓. Плитка уровня z — 2^(top − z) квадратов по стороне.
  const tileEls = new Map();
  let tileRaf = 0;
  function topMap(mapid) {
    const m = mini.maps[mapid], T = mini.yards, [c0, r0, c1, r1] = m.box;
    if (!m.have) m.have = new Set(Object.entries(m.tiles).flatMap(([z, list]) => list.map((k) => `${z}/${k}`)));
    return { map: Number(mapid), m, box: m.box, bounds: [(32 - c0) * T, (32 - c1) * T, (32 - r0) * T, (32 - r1) * T],
      aspect: [(c1 - c0) * mini.tile, (r1 - r0) * mini.tile] };
  }
  function drawTiles() {
    if (st.view !== 'top') {
      if (tileEls.size) { fill(tilesEl); tileEls.clear(); }
      return;
    }
    const { m, box, map } = st.top, [c0, r0, c1, r1] = box, nc = c1 - c0, nr = r1 - r0, top = mini.top;
    // уровень, где точка плитки не крупнее точки экрана; под ним — грубый, пока грузятся подробные
    const sp = (tf.w * tf.s) / (nc * mini.tile);
    const zc = Math.max(0, Math.min(top, Math.ceil(top + Math.log2(sp) - 0.25)));
    const a = fracAt(0, 0), b = fracAt(vw(), vh());
    const need = new Set();
    for (const z of new Set([Math.max(0, zc - 3), zc])) {
      const k = 2 ** (top - z);
      for (let tx = Math.floor((c0 + a.fx * nc) / k); tx <= Math.floor((c0 + b.fx * nc) / k); tx++) {
        for (let ty = Math.floor((r0 + a.fy * nr) / k); ty <= Math.floor((r0 + b.fy * nr) / k); ty++) {
          const key = `${z}/${tx}_${ty}`;
          if (!m.have.has(key)) continue;
          need.add(key);
          if (tileEls.has(key)) continue;
          const el = h('img', { class: 'wm-tile', alt: '', draggable: 'false' });
          el.onload = () => el.classList.add('on');
          el.style.zIndex = String(z);
          el.style.left = (((tx * k - c0) / nc) * 100).toFixed(4) + '%';
          el.style.top = (((ty * k - r0) / nr) * 100).toFixed(4) + '%';
          el.style.width = `calc(${((k / nc) * 100).toFixed(4)}% + 1px)`;      // +1px — без щелей между плитками
          el.style.height = `calc(${((k / nr) * 100).toFixed(4)}% + 1px)`;
          el.src = `/static/wow/minimap/${map}/${key}.webp`;
          tileEls.set(key, el);
          tilesEl.append(el);
        }
      }
    }
    for (const [key, el] of tileEls) if (!need.has(key)) { el.remove(); tileEls.delete(key); }
  }
  function drawMode() {
    fill(modeBox, mini ? seg([['art', L('Карта игры')], ['top', L('Вид сверху')]], st.mode, setMode) : null);
  }
  // сменить вид на том же месте: из карты игры — вид сверху того же материка, обратно — зона в центре окна
  function setMode(k) {
    if (k === st.mode) return;
    st.mode = k;
    pref.set('wm-mode', k);
    drawMode();
    if (st.view === 'world') return;
    const w = worldAt(vw() / 2, vh() / 2);
    if (k === 'top') { showTop(st.cont, w); return; }
    const z = w.ypp < 12 && zoneAt(man, st.top.map, w.X, w.Y);
    if (z) showZone(z, null, w); else showCont(st.cont, w);
  }

  function drawCrumbs() {
    const link = (label, fn) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); fn(); } }, label);
    const parts = [st.view === 'world' ? h('b', null, L('Мир')) : link(L('Мир'), showWorld)];
    if (st.cont) parts.push(' › ', st.view === 'cont' ? h('b', null, mapTitle(st.cont)) : link(mapTitle(st.cont), () => showCont(st.cont)));
    if (st.view === 'zone') {
      const p = parentOf(st.zone);
      if (p) parts.push(' › ', link(mapTitle(p), () => showZone(p)));
      parts.push(' › ', h('b', null, mapTitle(st.zone)));
    }
    if (st.view === 'top') {
      parts[parts.length - 1] = h('b', null, mapTitle(st.cont));
      const other = man.continents.find((c) => c.map !== st.cont.map);
      if (other) parts.push(h('span', { class: 'muted' }, ' · '), link(mapTitle(other), () => showTop(other)));
    }
    fill(crumbs, ...parts);
    zoneSel.value = st.view === 'zone' ? String(st.zone.id) : '';
  }

  async function loadPins(mapid) {
    if (!st.pins[mapid]) {
      const q = new URLSearchParams({ map: mapid });
      if (st.char) q.set('char', st.char);
      st.pins[mapid] = (await api('/api/map/pins?' + q)).data;
    }
    return st.pins[mapid];
  }

  function drawPins(p) {
    const b = bounds();
    if (!b) return;
    const add = (cls, x, y, title) => {
      const f = toFrac(b, x, y);
      if (inFrac(f)) layer.append(placeAt(h('i', { class: 'wm-pin ' + cls, title }), f.fx, f.fy));
    };
    if (st.view === 'zone') for (const t of p.tele) add('tele', t.x, t.y, L('Точка телепорта: {0}', t.name));
    for (const o of p.online) add('pl ' + (o.faction || ''), o.x, o.y, `${o.name} · ${o.level} · ${o.race_name} ${o.class_name}`);
    if (p.char && p.char.map === mapId()) add('me', p.char.x, p.char.y, L('{0} сейчас здесь', p.char.name));
    for (const m of opts.marks || []) if (m.map === mapId()) add('ev ' + (m.cls || ''), m.x, m.y, m.title);
  }

  async function render(file) {
    fill(layer);
    mark = null;
    img.hidden = !file;
    const src = `/static/wow/maps/${file}.webp`;
    if (file && !img.src.endsWith(src)) {
      img.classList.add('loading');
      img.onload = img.onerror = () => img.classList.remove('loading');
      img.src = src;
    }
    drawTiles();
    drawCrumbs();
    layer.classList.toggle('pick', (st.view === 'zone' || st.view === 'top') && !opts.readonly);
    if (mapId() != null) {
      try { drawPins(await loadPins(mapId())); } catch (e) { toast(e.message, true); }
    }
    // выбранная точка остаётся на любой карте, где она видна: сменили вид или уровень — метка и карточка на месте
    if (hasPoint()) {
      const f = toFrac(bounds(), st.point.x, st.point.y);
      if (inFrac(f)) { mark = h('i', { class: 'wm-mark' }); layer.append(placeAt(mark, f.fx, f.fy)); }
    }
  }

  function hitBox(r, label, onclick) {
    const box = h('div', { class: 'wm-hit', onclick: (e) => { e.stopPropagation(); onclick(); } }, h('span', null, label));
    placeAt(box, r[0], r[1]);
    box.style.width = ((r[2] - r[0]) * 100).toFixed(3) + '%';
    box.style.height = ((r[3] - r[1]) * 100).toFixed(3) + '%';
    return box;
  }

  function showWorld() {
    Object.assign(st, { view: 'world', cont: null, zone: null, aspect: [1002, 668] });
    setLevel(null);
    render(man.world.file);
    for (const c of man.continents) layer.append(hitBox(c.hit, mapTitle(c), () => showCont(c)));
    hint(L('Выберите материк — щёлкните по нему или приблизьте колёсиком. Можно сразу выбрать зону из списка над картой.'));
  }

  async function showCont(c, t) {
    if (st.mode === 'top' && mini) { await showTop(c, t && t.s == null ? t : null); return; }
    Object.assign(st, { view: 'cont', cont: c, zone: null, aspect: [1002, 668] });
    setLevel(t);
    await render(c.file);
    // большие зоны — под маленькими (города внутри зон), иначе до города не дотянуться
    const zones = man.zones.filter((zz) => zz.map === c.map).sort((a, b) => zoneSize(b) - zoneSize(a));
    const pins = [...layer.children];
    for (const z of zones) layer.append(hitBox(rectIn(c.bounds, z.bounds), mapTitle(z), () => showZone(z)));
    layer.append(...pins);
    if (!hasPoint()) hint(L('Выберите зону: щёлкните по ней или приблизьте колёсиком — её карта откроется сама.'));
  }

  async function showZone(z, point, t) {
    const cont = man.continents.find((c) => c.map === z.map) || null;
    if (st.mode === 'top' && mini && cont) {
      await showTop(cont, point ? { zone: z } : t && t.s == null ? t : { zone: z });
      if (point) pick(point.x, point.y, point.z);
      return;
    }
    Object.assign(st, { view: 'zone', zone: z, cont, aspect: [1002, 668] });
    setLevel(t);
    await render(z.file);
    if (point) pick(point.x, point.y, point.z);
    else if (!hasPoint()) hint(opts.note || L('Щёлкните по месту на карте — панель найдёт высоту земли в этой точке.'));
  }

  async function showTop(c, at) {
    const top = topMap(c.map);
    Object.assign(st, { view: 'top', cont: c, zone: null, top, aspect: top.aspect });
    setLevel(at);
    await render(null);
    if (!hasPoint()) hint(opts.note || L('Вид сверху — мини-карты игры. Колёсиком можно приблизить до отдельных деревьев; щёлкните по месту — панель найдёт высоту земли.'));
  }

  async function pick(x, y, zManual) {
    const f = toFrac(bounds(), x, y);
    if (!mark) mark = h('i', { class: 'wm-mark' });
    layer.append(placeAt(mark, f.fx, f.fy));
    fill(info, h('p', { class: 'muted small' }, L('Ищу высоту…')));
    try {
      const p = (await api(`/api/map/point?map=${mapId()}&x=${x.toFixed(2)}&y=${y.toFixed(2)}`)).data;
      if (zManual != null && zManual !== '' && Number.isFinite(Number(zManual))) {
        p.z = Math.round(Number(zManual) * 100) / 100;
        p.source = 'manual';
      }
      st.point = p;
      const src = p.source === 'npc' ? L('на уровне НПС «{0}» ({1} м от точки)', p.near.name, Math.round(p.near.dist))
        : p.source === 'water' ? L('на поверхности воды') : p.source === 'ground' ? L('по высоте земли')
          : p.source === 'manual' ? L('введена вручную') : null;
      const pz = st.view === 'zone' ? st.zone : zoneAt(man, p.map, p.x, p.y);
      const zf = pz && toFrac(pz.bounds, p.x, p.y);
      fill(info,
        h('div', null, h('b', null, placeTitle(p, pz ? mapTitle(pz) : MAP_CONT[p.map]))),
        facts([[L('Карта'), MAP_CONT[p.map]], ['X · Y · Z', `${p.x} · ${p.y} · ${p.z == null ? '—' : p.z}`],
               [L('В зоне, %'), zf ? `${(zf.fx * 100).toFixed(1)}, ${(zf.fy * 100).toFixed(1)}` : '—'], [L('Высота'), src || '—'],
               p.near && p.source !== 'npc' ? [L('Ближайший НПС'), L('{0} — {1} м', p.near.name, Math.round(p.near.dist))] : null]),
        p.z == null ? h('p', { class: 'warn-text small' }, L('Здесь нет земли: здание, пещера или край карты. Щёлкните рядом или поближе к НПС.')) : null,
        opts.extra ? opts.extra(p) : null,
        opts.onPick ? h('button', { class: 'btn pri', type: 'button', disabled: p.z == null, onclick: () => opts.onPick(p) }, opts.pickLabel || L('Выбрать эту точку')) : null);
    } catch (e) {
      fill(info, h('p', { class: 'warn-text small' }, e.message));
    }
  }

  // ---- мышь, пальцы, клавиши
  view.addEventListener('wheel', (e) => {
    if (!man) return;
    e.preventDefault();
    const [px, py] = at(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 300 : e.deltaY;
    const k = Math.exp(-Math.max(-250, Math.min(250, dy)) * 0.0016);
    if (k < 1) {
      if (tf.s <= 1.001) goUp(px, py); else zoomAt(px, py, tf.s * k);
      return;
    }
    if (st.view === 'world') {
      const c = contAt(fracAt(px, py));
      if (c && tf.s * k >= 1.5 && Date.now() - lastSwitch > 450) { showCont(c); return; }
    }
    if (st.view === 'zone' && mini && tf.s >= capAt(px, py) - 0.01 && !kidAt(fracAt(px, py))) {
      if (Date.now() - lastSwitch > 450) { st.mode = 'top'; pref.set('wm-mode', 'top'); drawMode(); showTop(st.cont, worldAt(px, py)); }
      return;
    }
    zoomAt(px, py, tf.s * k);
    goDown(px, py);
  }, { passive: false });

  // тянуть — сдвиг; щелчок после сдвига не считается щелчком по карте
  const ptrs = new Map();
  let drag = null;
  let pinch = null;
  let moved = false;
  view.addEventListener('pointerdown', (e) => {
    if ((e.pointerType === 'mouse' && e.button !== 0) || e.target.closest('.wm-zoom')) return;
    ptrs.set(e.pointerId, at(e));
    moved = false;
    cancelAnimationFrame(anim);
    drag = ptrs.size === 1 ? { p: at(e), x: tf.x, y: tf.y } : null;
    pinch = null;
  });
  view.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const p = at(e);
    ptrs.set(e.pointerId, p);
    if (ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (pinch && d > 0 && pinch.d > 0) {
        tf.x += m[0] - pinch.m[0];
        tf.y += m[1] - pinch.m[1];
        if (d < pinch.d && tf.s <= 1.001) goUp(m[0], m[1]);
        else zoomAt(m[0], m[1], tf.s * d / pinch.d);
        if (d > pinch.d) goDown(m[0], m[1]);
      }
      pinch = { d, m };
      moved = true;
      return;
    }
    if (!drag) return;
    const dx = p[0] - drag.p[0], dy = p[1] - drag.p[1];
    if (!moved && Math.hypot(dx, dy) < 5) return;
    if (!moved) { moved = true; view.setPointerCapture(e.pointerId); view.classList.add('drag'); }
    tf.x = drag.x + dx;
    tf.y = drag.y + dy;
    applyTf();
  });
  const release = (e) => {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (!ptrs.size) { drag = null; view.classList.remove('drag'); }
  };
  view.addEventListener('pointerup', release);
  view.addEventListener('pointercancel', release);
  view.addEventListener('click', (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
  view.addEventListener('dblclick', (e) => {
    if (!man || e.target.closest('.wm-zoom') || Date.now() - lastSwitch < 500) return;
    const [px, py] = at(e);
    zoomAnim(px, py, tf.s * 2, () => goDown(px, py));
  });
  zin.addEventListener('click', () => {
    const px = vw() / 2, py = vh() / 2;
    zoomAnim(px, py, tf.s * 1.6, () => goDown(px, py));
  });
  zout.addEventListener('click', () => {
    const px = vw() / 2, py = vh() / 2;
    if (tf.s <= 1.001) goUp(px, py); else zoomAnim(px, py, tf.s / 1.6);
  });
  zfit.addEventListener('click', () => zoomAnim(vw() / 2, vh() / 2, 1));
  view.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: [80, 0], ArrowRight: [-80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80] }[e.key];
    if (e.key === '+' || e.key === '=') zin.click();
    else if (e.key === '-' || e.key === '_') zout.click();
    else if (step) { tf.x += step[0]; tf.y += step[1]; applyTf(); } else return;
    e.preventDefault();
  });
  // окно поменяло размер — та же точка остаётся в центре
  new ResizeObserver(() => {
    if (!vw()) return;
    const { cx, cy } = tf;
    fitBase();
    tf.x = vw() / 2 - cx * tf.w * tf.s;
    tf.y = vh() / 2 - cy * tf.h * tf.s;
    applyTf();
  }).observe(view);

  layer.addEventListener('click', (e) => {
    if ((st.view !== 'zone' && st.view !== 'top') || opts.readonly || e.detail > 1) return;
    const r = canvas.getBoundingClientRect();
    const w = toWorld(bounds(), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    pick(w.x, w.y);
  });
  layer.addEventListener('mousemove', (e) => {
    const b = bounds();
    if (!b) { coords.textContent = ''; return; }
    const r = canvas.getBoundingClientRect();
    const w = toWorld(b, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    coords.textContent = `X ${w.x.toFixed(0)} · Y ${w.y.toFixed(0)}`;
  });
  zoneSel.addEventListener('change', () => {
    const z = man && man.zones.find((zz) => String(zz.id) === zoneSel.value);
    if (z) showZone(z);
  });

  // Координаты вручную: мировые (как .gps в игре) или проценты в зоне (как на карте игры и в аддонах)
  const cf = { mode: 'world', map: 1, x: '', y: '', z: '', zone: '', px: '', py: '' };
  const coordBox = h('div', { class: 'stack tight' });
  const goCoord = () => {
    if (!man) return;
    if (cf.mode === 'world') {
      const x = Number(cf.x), y = Number(cf.y);
      if (cf.x === '' || cf.y === '' || !Number.isFinite(x) || !Number.isFinite(y)) { toast(L('Впишите X и Y.'), true); return; }
      const z = zoneAt(man, Number(cf.map), x, y);
      if (!z) { toast(L('Эта точка не попадает ни в одну зону: {0}.', MAP_CONT[cf.map]), true); return; }
      showZone(z, { x, y, z: cf.z });
      return;
    }
    const z = man.zones.find((zz) => zz.id === Number(cf.zone || (st.zone && st.zone.id)));
    const px = Number(cf.px), py = Number(cf.py);
    if (!z || cf.px === '' || cf.py === '' || !(px >= 0 && px <= 100 && py >= 0 && py <= 100)) {
      toast(L('Выберите зону и впишите проценты от 0 до 100.'), true); return;
    }
    const w = toWorld(z.bounds, px / 100, py / 100);
    showZone(z, { x: w.x, y: w.y });
  };
  const drawCoord = () => {
    if (!cf.zone && st.zone) cf.zone = st.zone.id;
    const zones = man ? [...man.zones].sort((a, b) => mapTitle(a).localeCompare(mapTitle(b), LOCALE)).map((z) => [z.id, mapTitle(z)]) : [];
    const num = (key, ph) => bindInput(cf, key, { type: 'number', step: 'any', placeholder: ph });
    fill(coordBox,
      seg([['world', L('Мировые X, Y, Z')], ['zone', L('В зоне, %')]], cf.mode, (k) => { cf.mode = k; drawCoord(); }),
      cf.mode === 'world'
        ? h('div', { class: 'wm-coord-row' }, fld(L('Материк'), bindSelect(cf, 'map', [[0, MAP_CONT[0]], [1, MAP_CONT[1]]])),
          fld('X', num('x')), fld('Y', num('y')), fld(L('Z — необязательно'), num('z', L('найдёт сама'))))
        : h('div', { class: 'wm-coord-row' }, fld(L('Зона'), bindSelect(cf, 'zone', [['', L('Зона…')], ...zones])),
          fld(L('Слева, %'), num('px', '61.0')), fld(L('Сверху, %'), num('py', '38.2'))),
      h('div', { class: 'row' }, h('button', { class: 'btn pri', type: 'button', onclick: goCoord }, L('Показать на карте')),
        h('span', { class: 'muted small grow' }, cf.mode === 'world'
          ? L('Как в ответе команды .gps в игре. Z пусто — высоту найдёт панель; вписанная Z будет точно такой.')
          : L('Проценты от левого и верхнего края карты зоны — так показывают координаты карта игры и аддоны.'))));
  };
  const coordPanel = h('details', { class: 'wm-enter' }, h('summary', null, L('Ввести координаты вручную')), coordBox);
  coordPanel.addEventListener('toggle', () => { if (coordPanel.open) drawCoord(); });

  const el = h('div', { class: 'wm' },
    h('div', { class: 'wm-main' },
      h('div', { class: 'wm-tools' }, crumbs, h('span', { class: 'spacer' }), coords, modeBox, zoneSel),
      coordPanel,
      view,
      h('div', { class: 'wm-help muted small' }, L('Колёсико — приблизить к курсору, тянуть мышью — сдвинуть, двойной щелчок — крупнее. Приблизили зону — откроется её карта, а приблизили её до конца — вид сверху; отдалили до конца — снова материк.'))),
    h('aside', { class: 'wm-side' }, info));

  const ctl = {
    el,
    point: () => st.point,
    // сменить персонажа: его метка, и карта переходит в зону, где он стоит
    async setChar(name) {
      st.char = name || null;
      st.pins = {};
      if (!man) return;
      if (name) {
        for (const mapid of [0, 1]) {
          const p = await loadPins(mapid);
          const z = p.char && p.char.map === mapid && zoneAt(man, mapid, p.char.x, p.char.y);
          if (z) { await showZone(z); return; }
        }
      }
      ctl.refresh();
    },
    refresh() {
      st.pins = {};
      if (st.view === 'zone') { const p = st.point; render(st.zone.file).then(() => { if (p && p.map === st.zone.map) pick(p.x, p.y); }); }
      else if (st.view === 'top') { const p = st.point; render(null).then(() => { if (p && p.map === st.top.map) pick(p.x, p.y); }); }
      else if (st.view === 'cont') showCont(st.cont);
    },
  };

  mapsManifest().then(async (m) => {
    man = m;
    mini = await minimapManifest();
    if (!mini) st.mode = 'art';
    drawMode();
    const groups = man.continents.map((c) => h('optgroup', { label: mapTitle(c) },
      man.zones.filter((z) => z.map === c.map).sort((a, b) => mapTitle(a).localeCompare(mapTitle(b), LOCALE))
        .map((z) => h('option', { value: z.id }, mapTitle(z)))));
    fill(zoneSel, h('option', { value: '' }, L('Зона…')), ...groups);
    if (opts.start) {
      const z = zoneAt(man, opts.start.map, opts.start.x, opts.start.y);
      if (z) { await showZone(z, opts.start); return; }
    }
    if (opts.open) {
      const o = opts.open;
      const z = o.zoneArea != null && (man.zones.find((zz) => zz.map === o.map && zz.area === o.zoneArea)
        || (o.x != null && zoneAt(man, o.map, o.x, o.y)));
      if (z) { await showZone(z); return; }
      const c = man.continents.find((cc) => cc.map === o.map);
      if (c) { await showCont(c); hint(opts.note || ''); return; }
    }
    if (st.char) await ctl.setChar(st.char);
    if (!st.zone) showWorld();
  }).catch((e) => fill(info, h('p', { class: 'warn-text' }, e.message)));
  return ctl;
}

/* Плитки вида сверху (tools/build_minimap.py) — их может и не быть: тогда только карта игры */
let miniData;
async function minimapManifest() {
  if (miniData === undefined) {
    try {
      const r = await fetch('/static/wow/minimap/minimap.json', { cache: 'force-cache' });
      miniData = r.ok ? await r.json() : null;
    } catch (e) { miniData = null; }
  }
  return miniData;
}

/* Окно с картой: телепорт персонажа или выбор места (например, для НПС). */
function mapModal({ title, sub, char, start, pickLabel, onPick, extra }) {
  let close;
  const view = worldMapView({ char, start, pickLabel, extra, onPick: (p) => onPick(p, close, view) });
  const box = h('div', { class: 'drawer wm-drawer' },
    h('div', { class: 'drawer-h' }, h('div', { class: 'grow' }, h('h2', null, title), sub ? h('div', { class: 'sub' }, sub) : null),
      h('button', { class: 'btn ghost sm x', type: 'button', 'aria-label': L('Закрыть'), onclick: () => close() }, icon('x'))),
    h('div', { class: 'drawer-b' }, view.el));
  close = openOverlay(box);
  return close;
}

async function mapTeleport(name, p) {
  const r = await api('/api/map/tele', { name, map: p.map, x: p.x, y: p.y, z: p.z });
  toast(r.data.success ? L('{0} перенесён: {1}', name, placeTitle(p, MAP_CONT[p.map])) : (r.data.output || L('Не выполнено')), !r.data.success);
  return r.data;
}

function mapTeleModal(name) {
  const out = h('div');
  mapModal({ title: L('Телепорт по карте: {0}', name),
    sub: L('Мир → материк → зона → щёлкните по месту. Если персонаж в игре, все в игре увидят строку «DB table game_tele reloaded».'),
    char: name, pickLabel: L('Телепортировать сюда'), extra: () => out,
    onPick: async (p, close, view) => {
      fill(out, h('p', { class: 'muted small' }, L('Выполняю…')));
      try {
        const res = await mapTeleport(name, p);
        fill(out, resultView(res));
        if (res.success) view.refresh();
      } catch (e) { fill(out, resultView({ success: false, output: e.message })); }
    } });
}

/* Поле «персонаж» с подсказками из базы */
function charInput(placeholder) {
  const listId = 'chars-' + Math.random().toString(36).slice(2);
  const dl = h('datalist', { id: listId });
  const inp = h('input', { class: 'inp', placeholder: placeholder || L('Имя персонажа'), autocomplete: 'off', spellcheck: 'false', list: listId });
  inp.addEventListener('input', debounce(async () => {
    const q = inp.value.trim();
    if (q.length < 2) return;
    try {
      const r = await api('/api/characters?' + new URLSearchParams({ q, bots: 1, limit: 10 }));
      fill(dl, ...r.data.map((c) => h('option', { value: c.name }, `${c.level} · ${c.race_name} ${c.class_name}${c.online ? ' · ' + L('в игре') : ''}`)));
    } catch (e) { /* подсказки не обязательны */ }
  }, 250));
  return { inp, dl };
}

PAGES.worldmap = {
  title: L('Карта мира'), sub: L('Телепорт персонажа в любую точку: мир → материк → зона → место на карте.'),
  async render(el) {
    const { inp, dl } = charInput();
    const out = h('div');
    const view = worldMapView({
      pickLabel: L('Телепортировать сюда'),
      extra: () => out,
      onPick: async (p) => {
        const name = inp.value.trim();
        if (!name) { toast(L('Сначала впишите имя персонажа.'), true); inp.focus(); return; }
        fill(out, h('p', { class: 'muted small' }, L('Выполняю…')));
        try {
          const res = await mapTeleport(name, p);
          fill(out, resultView(res));
          if (res.success) view.refresh();
        } catch (e) { fill(out, resultView({ success: false, output: e.message })); }
      } });
    inp.addEventListener('change', () => { fill(out); view.setChar(inp.value.trim()); });
    fill(el, card(null, null, null, h('div', { class: 'card-b stack' },
      h('div', { class: 'row wm-who' }, h('label', { class: 'field' }, h('span', null, L('Кого переносим')), inp, dl),
        h('p', { class: 'muted small grow' }, L('Не в игре — точка запишется в базу, персонаж появится там при входе. В игре — ядро перенесёт его сразу.'))),
      view.el)));
  },
};

// ============================================================ Свои НПС и задания: общие детали

const NPC_FACTIONS = [[35, L('Дружелюбен ко всем')], [12, L('Альянс — Штормград')], [55, L('Альянс — Стальгорн')], [80, L('Альянс — Дарнас')],
  [29, L('Орда — Оргриммар')], [104, L('Орда — Громовой Утёс')], [68, L('Орда — Подгород')], [120, L('Нейтрал — Пиратская Бухта')],
  [7, L('Зверь: нападает, если тронуть')], [14, L('Враг всем')]];
const NPC_TYPES = [[7, L('Гуманоид')], [1, L('Зверь')], [2, L('Дракон')], [3, L('Демон')], [4, L('Элементаль')], [5, L('Великан')],
  [6, L('Нежить')], [8, L('Зверёк')], [9, L('Механизм')], [10, L('Не указан')]];
const NPC_RANKS = [[0, L('Обычный')], [1, L('Элитный')], [2, L('Редкий элитный')], [3, L('Босс')], [4, L('Редкий')]];
const NPC_CLASSES = [[1, L('Воин')], [2, L('Паладин')], [4, L('Разбойник')], [8, L('Маг')]];
const NPC_STANDS = [[0, L('Стоит')], [1, L('Сидит')], [3, L('Спит')], [8, L('На коленях')]];
const NPC_STATES = [[0, L('Ничего не делает')], [10, L('Танцует')], [69, L('Работает руками')], [173, L('Работает с оружием')], [64, L('Оглушён')]];
const EMOTES = [[0, L('без жеста')], [1, L('говорит')], [2, L('кланяется')], [3, L('машет рукой')], [4, L('радуется')], [5, L('восклицает')],
  [6, L('спрашивает')], [11, L('смеётся')], [18, L('плачет')], [21, L('аплодирует')], [24, L('смущается')], [25, L('указывает')], [66, L('отдаёт честь')]];
const FACING = [[0, L('на север')], [1.5708, L('на запад')], [3.1416, L('на юг')], [4.7124, L('на восток')]];

/* Поля формы, сразу связанные с объектом состояния: правка поля → obj[key] → onChange() */
function bindInput(obj, key, attrs = {}, onChange) {
  const el = h('input', { class: 'inp', autocomplete: 'off', ...attrs, value: obj[key] ?? '' });
  el.addEventListener('input', () => {
    obj[key] = attrs.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
    if (onChange) onChange();
  });
  return el;
}
function bindArea(obj, key, attrs = {}, onChange) {
  const el = h('textarea', { class: 'inp', ...attrs });
  el.value = obj[key] || '';
  el.addEventListener('input', () => { obj[key] = el.value; if (onChange) onChange(); });
  return el;
}
function bindSelect(obj, key, options, onChange, num = true) {
  const el = h('select', { class: 'inp' }, options.map(([v, l]) => h('option', { value: v }, l)));
  el.value = String(obj[key] ?? options[0][0]);
  el.addEventListener('change', () => { obj[key] = num ? Number(el.value) : el.value; if (onChange) onChange(); });
  return el;
}
function bindCheck(obj, key, label, onChange) {
  const el = h('input', { type: 'checkbox', checked: !!obj[key] });
  el.addEventListener('change', () => { obj[key] = el.checked; if (onChange) onChange(); });
  return h('label', { class: 'chk' }, el, label);
}
const fld = (label, el, hint) => h('label', { class: 'field' }, h('span', null, label), el, hint ? h('small', null, hint) : null);

/* Как клиент подставит $N, $C, $R, $G и $B в тексте НПС — для предпросмотра */
function wowText(t) {
  return String(t || '').replace(/\$[Bb]/g, '\n').replace(/\$[Nn]/g, L('Путник')).replace(/\$[Cc]/g, L('воин'))
    .replace(/\$[Rr]/g, L('человек')).replace(/\$[Gg]([^:;]*):([^;]*);/g, '$1');
}

function npcThumb(url, size = 'm') {
  const box = h('span', { class: 'npc-thumb ' + size });
  if (url) {
    const img = h('img', { alt: '', loading: 'lazy', decoding: 'async', src: url });
    img.addEventListener('error', () => img.remove());
    box.append(img);
  }
  return box;
}

function statusBadge(st) {
  if (st === 'live') return badge(L('в мире'), 'ok');
  if (st === 'restart') return badge(L('ждёт перезапуска мира'), 'warn');
  if (st === 'pending') return badge(L('ждёт применения'), 'warn');
  return badge(L('новое'), null);
}

/* Поиск существа: картинка, имя, <подпись>, уровень, сколько раз стоит в мире */
function npcPicker(onPick, { placeholder, create } = {}) {
  const q = h('input', { class: 'inp', type: 'search', placeholder: placeholder || L('Имя существа или его номер'), autocomplete: 'off' });
  const res = h('div', { class: 'list pick-list' });
  q.addEventListener('input', debounce(async () => {
    const term = q.value.trim();
    if (term.length < 2 && !/^\d+$/.test(term)) { fill(res); return; }
    try {
      const rows = (await api('/api/npc/search?q=' + encodeURIComponent(term))).data;
      fill(res, ...rows.map((n) => h('div', { class: 'li click', onclick: () => { fill(res); q.value = ''; onPick(n); } },
        npcThumb(n.thumb, 's'), h('span', { class: 'grow' }, h('b', null, n.name), n.subname ? h('span', { class: 'muted' }, ` <${n.subname}>`) : null),
        n.custom ? badge(L('свой'), 'acc') : null,
        h('span', { class: 'muted small nowrap' }, L('ур. {0} · №{1} · в мире: {2}', n.minlevel === n.maxlevel ? n.minlevel : `${n.minlevel}–${n.maxlevel}`, n.entry, n.spawns)))));
      if (!rows.length) res.append(h('div', { class: 'li muted' }, L('Ничего не нашлось.')));
    } catch (e) { fill(res, h('div', { class: 'li muted' }, e.message)); }
  }, 300));
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
  return h('div', { class: 'stack tight' }, h('div', { class: 'row' }, q,
    create ? h('button', { class: 'btn', type: 'button', onclick: () => npcEditor(null, { onSaved: (n) => onPick(n) }) }, L('Создать своего НПС…')) : null), res);
}

function npcCardSmall(n, onClear) {
  if (!n || !n.entry) return h('div', { class: 'muted small' }, L('Не выбран.'));
  return h('div', { class: 'npc-pick' }, npcThumb(n.thumb, 's'),
    h('span', { class: 'grow' }, h('b', null, n.name || '#' + n.entry), n.subname ? h('span', { class: 'muted' }, ` <${n.subname}>`) : null,
      h('span', { class: 'muted small' }, ' · №' + n.entry)),
    onClear ? h('button', { class: 'btn sm ghost', type: 'button', onclick: onClear }, L('сменить')) : null);
}

/* Поиск предмета с иконкой и подсказкой как в игре */
function itemPicker(onPick, { placeholder, customOnly } = {}) {
  const q = h('input', { class: 'inp', type: 'search', placeholder: placeholder || L('Название предмета или его номер'), autocomplete: 'off' });
  const res = h('div', { class: 'list pick-list' });
  q.addEventListener('input', debounce(async () => {
    const term = q.value.trim();
    if (term.length < 2 && !/^\d+$/.test(term)) { fill(res); return; }
    try {
      let rows = (await api('/api/items/search?q=' + encodeURIComponent(term))).data;
      if (customOnly) rows = rows.filter((it) => it.entry >= 90000);
      fill(res, ...rows.slice(0, 30).map((it) => bindItemTip(h('div', { class: 'li click', tabindex: 0, onclick: () => {
        itipHide(); fill(res); q.value = '';
        onPick({ id: it.entry, name: it.name, quality: it.quality, icon: it.icon });
      } }, iconImg(it.icon), h('span', { class: `grow q${it.quality}` }, it.name), h('span', { class: 'muted small' }, '№' + it.entry)),
      { entry: it.entry, name: it.name, quality: it.quality, icon: it.icon })));
      if (!res.childElementCount) res.append(h('div', { class: 'li muted' }, customOnly ? L('Своих предметов с таким названием нет.') : L('Ничего не нашлось.')));
    } catch (e) { fill(res, h('div', { class: 'li muted' }, e.message)); }
  }, 300));
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
  return h('div', { class: 'stack tight' }, q, res);
}

function itemChip(it, extra, onRemove) {
  if (!it || !it.id) return null;
  const el = h('div', { class: 'item-chip', tabindex: 0 }, iconImg(it.icon), h('span', { class: `grow q${it.quality || 1}` }, it.name || '#' + it.id),
    extra || null, onRemove ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { itipHide(); onRemove(); } }, '×') : null);
  return bindItemTip(el, { entry: it.id, name: it.name, quality: it.quality, icon: it.icon });
}

/* back — карточка, из которой сюда перешли: { label, closeAll } (она открыта под этой) */
function drawerBox(title, sub, onClose, back) {
  const head = h('div', { class: 'drawer-h' },
    back ? h('button', { class: 'btn sm drawer-back', type: 'button', title: L('Назад: {0}', back.label), onclick: () => onClose() },
      icon('back'), h('span', null, back.label)) : null,
    h('div', { class: 'grow' }, h('h2', null, title), sub ? h('div', { class: 'sub' }, sub) : null),
    h('button', { class: 'btn ghost sm x', type: 'button', 'aria-label': back ? L('Закрыть всё') : L('Закрыть'), title: back ? L('Закрыть всё') : null,
      onclick: () => { if (back) back.closeAll(); onClose(); } }, icon('x')));
  return head;
}

// ============================================================ Свои НПС

/* Выбор внешности: найти существо игры по имени или полистать модели по типу */
function npcLookView(onPick) {
  let mode = 'search';
  const body = h('div', { class: 'stack' });
  const gal = { type: '', q: '', offset: 0 };
  const draw = () => {
    if (mode === 'search') {
      fill(body, h('p', { class: 'muted small' }, L('Своих моделей клиент не знает — внешность берём у существа игры. От него же возьмутся сила, здоровье и (для моба) добыча; имя, речь и остальное зададите сами.')),
        npcPicker((n) => onPick({ entry: n.entry, display: n.display, thumb: n.thumb, name: n.name }), { placeholder: L('Например: Marshal, Thrall, Wolf, Kobold') }));
      return;
    }
    const grid = h('div', { class: 'look-grid' });
    const more = h('button', { class: 'btn', type: 'button' }, L('Показать ещё'));
    const load = async (append) => {
      const p = new URLSearchParams({ type: gal.type, q: gal.q, offset: gal.offset });
      const r = (await api('/api/npc/models?' + p)).data;
      const tiles = r.rows.map((m) => h('button', { class: 'look', type: 'button', title: `${m.name} · ${L('модель {0}', m.display)}`,
        onclick: () => onPick({ entry: m.entry, display: m.display, thumb: m.thumb, name: m.name }) }, npcThumb(m.thumb, 'l'), h('span', null, m.name)));
      if (append) grid.append(...tiles); else fill(grid, ...tiles);
      more.hidden = !r.more;
    };
    more.onclick = () => { gal.offset += 60; load(true).catch((e) => toast(e.message, true)); };
    const typeSel = bindSelect(gal, 'type', [['', L('Все типы')], ...NPC_TYPES], () => { gal.offset = 0; load().catch((e) => toast(e.message, true)); }, false);
    const name = h('input', { class: 'inp', type: 'search', placeholder: L('Имя содержит…'), value: gal.q });
    name.addEventListener('input', debounce(() => { gal.q = name.value.trim(); gal.offset = 0; load().catch((e) => toast(e.message, true)); }, 350));
    fill(body, h('div', { class: 'row' }, typeSel, name), grid, more);
    load().catch((e) => fill(grid, errorCard(e)));
  };
  const bar = h('div');
  const drawBar = () => fill(bar, seg([['search', L('Найти существо')], ['gallery', L('Галерея моделей')]], mode, (k) => { mode = k; drawBar(); draw(); }));
  drawBar();
  draw();
  return h('div', { class: 'stack' }, bar, body);
}

function lookModal(onPick) {
  let close;
  const box = h('div', { class: 'modal xwide' },
    h('div', { class: 'modal-h' }, h('div', null, h('h3', null, L('Внешность'))),
      h('button', { class: 'btn ghost sm x', type: 'button', onclick: () => close() }, icon('x'))),
    h('div', { class: 'modal-b' }, npcLookView((p) => { close(); onPick(p); })));
  close = openOverlay(box);
}

function talkBlock(f, key, title, hint, opts = {}) {
  f.talk[key] = f.talk[key] || { lines: [], yell: false, emote: 0, range: 10, cooldown: 60 };
  const t = f.talk[key];
  while (t.lines.length < 3) t.lines.push('');
  return h('div', { class: 'talk-block stack tight' }, h('b', null, title), hint ? h('p', { class: 'muted small' }, hint) : null,
    t.lines.map((_, i) => bindInput(t.lines, i, { maxlength: 250, placeholder: i ? L('Другой вариант (необязательно)') : L('Что он скажет') })),
    h('div', { class: 'row' }, bindCheck(t, 'yell', L('Кричит (слышно дальше)')), fld(L('Жест'), bindSelect(t, 'emote', EMOTES)),
      opts.range ? fld(L('Заметит за, ярдов'), bindInput(t, 'range', { type: 'number', min: 3, max: 40 })) : null,
      opts.range ? fld(L('Не чаще раза в, сек'), bindInput(t, 'cooldown', { type: 'number', min: 10, max: 3600 })) : null));
}

async function npcEditor(entry, opts = {}) {
  const box = h('div', { class: 'drawer npc-ed', role: 'dialog', 'aria-modal': 'true' });
  const close = openOverlay(box);
  await mapsManifest().catch(() => null);      // названия зон для «Где стоит»
  const reopen = (e) => { close(); npcEditor(e, opts); };

  if (!entry) {
    fill(box, drawerBox(L('Новый НПС'), L('Шаг 1 из 2: как он будет выглядеть'), () => close()),
      h('div', { class: 'drawer-b' }, npcLookView(async (p) => {
        try {
          const b = (await api('/api/npc?entry=' + p.entry)).data;
          render({ ...b, entry: null, base: p.entry, base_name: p.name, name: '', subname: '', displays: [p.display], thumbs: [p.thumb],
                   gossip: [], greeting: { text: '', emote: 0 }, talk: {}, spawns: [], quests: [], status: 'new', loot: b.kind === 'mob',
                   immune: b.kind !== 'mob', gold_min: b.kind === 'mob' ? b.gold_min : 0, gold_max: b.kind === 'mob' ? b.gold_max : 0 });
        } catch (e) { toast(e.message, true); }
      })));
  } else {
    fill(box, h('div', { class: 'drawer-b' }, h('div', { class: 'empty' }, L('Загружаю…'))));
    try { render((await api('/api/npc?entry=' + entry)).data); } catch (e) { fill(box, h('div', { class: 'drawer-b' }, errorCard(e))); }
  }

  function render(d) {
    const f = {
      name: d.name, subname: d.subname, kind: d.kind, minlevel: d.minlevel, maxlevel: d.maxlevel, displays: [...d.displays],
      thumbs: [...(d.thumbs || [])], scale: d.scale || 1, faction: d.faction, immune: d.immune, type: d.type, rank: d.rank,
      unitclass: d.unitclass, health: d.health, damage: d.damage, armor: d.armor, gold_min: d.gold_min, gold_max: d.gold_max, loot: d.loot,
      gossip: d.gossip.map((g) => ({ ...g })), greeting: { ...d.greeting }, talk: {}, stand: d.stand || 0, emote_state: d.emote_state || 0,
      armed: d.armed, equip: [...(d.equip || [0, 0, 0])], equip_items: { ...(d.equip_items || {}) },
    };
    for (const [k, slot] of [['greet', 1], ['aggro', 2], ['death', 3]]) {
      const t = d.talk[slot];
      if (t) f.talk[k] = { lines: [...t.lines], yell: t.yell, emote: t.emote, range: t.range || 10, cooldown: t.cooldown || 60 };
    }
    if (!f.gossip.length) f.gossip.push({ text: '', emote: 0 });

    const preview = h('div', { class: 'npc-preview' });
    const drawPreview = () => {
      const lv = f.minlevel === f.maxlevel ? f.minlevel : `${f.minlevel}–${f.maxlevel}`;
      const hostile = [7, 14].includes(Number(f.faction));
      const g = f.gossip.find((x) => x.text.trim());
      fill(preview, 
        h('div', { class: 'plate' + (hostile ? ' hostile' : '') }, h('b', null, f.name || L('Имя')), f.subname ? h('div', null, `<${f.subname}>`) : null,
          h('small', null, L('Уровень {0}', lv) + (f.rank ? ' · ' + (NPC_RANKS.find(([v]) => v === Number(f.rank)) || [0, ''])[1] : ''))),
        h('div', { class: 'scroll' }, h('div', { class: 'scroll-h' }, npcThumb(f.thumbs[0], 's'), f.name || L('Имя')),
          h('div', { class: 'scroll-t' }, g ? wowText(g.text) : h('span', { class: 'muted' }, L('Без текста разговора окно не откроется — НПС просто повернётся к игроку.')))));
    };

    const looks = h('div', { class: 'row' });
    const drawLooks = () => fill(looks, ...f.displays.map((disp, i) => h('div', { class: 'look sel' }, npcThumb(f.thumbs[i], 'l'),
      h('span', null, L('модель {0}', disp)), f.displays.length > 1 ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => {
        f.displays.splice(i, 1); f.thumbs.splice(i, 1); drawLooks(); drawPreview(); } }, L('убрать')) : null)),
      f.displays.length < 4 ? h('button', { class: 'btn', type: 'button', title: L('Если моделей несколько, каждый раз при появлении берётся случайная.'),
        onclick: () => lookModal((p) => { f.displays.push(p.display); f.thumbs.push(p.thumb); drawLooks(); drawPreview(); }) }, L('+ вариант внешности')) : null,
      h('button', { class: 'btn', type: 'button', onclick: () => lookModal((p) => { f.displays = [p.display]; f.thumbs = [p.thumb]; drawLooks(); drawPreview(); }) }, L('Сменить внешность')));
    drawLooks();

    const equipBox = h('div', { class: 'stack tight' });
    const drawEquip = () => fill(equipBox, ...[L('Правая рука'), L('Левая рука'), L('Дальний бой')].map((label, i) => {
      const it = f.equip_items[f.equip[i]];
      return h('div', { class: 'equip-row' }, h('span', { class: 'muted small' }, label),
        f.equip[i] ? itemChip(it || { id: f.equip[i] }, null, () => { f.equip[i] = 0; drawEquip(); })
          : itemPicker((p) => { f.equip[i] = p.id; f.equip_items[p.id] = p; drawEquip(); }, { placeholder: L('Оружие или щит — по названию') }));
    }));
    drawEquip();

    const gossipBox = h('div', { class: 'stack tight' });
    const drawGossip = () => fill(gossipBox, ...f.gossip.map((g, i) => h('div', { class: 'gossip-row' },
      bindArea(g, 'text', { rows: 3, maxlength: 1000, placeholder: i ? L('Другой вариант — игра выберет случайно') : L('Здравствуй, $N! Чем могу помочь?') }, drawPreview),
      h('div', { class: 'row' }, fld(L('Жест'), bindSelect(g, 'emote', EMOTES)),
        f.gossip.length > 1 ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { f.gossip.splice(i, 1); drawGossip(); drawPreview(); } }, L('убрать вариант')) : null))),
      f.gossip.length < 4 ? h('button', { class: 'btn sm', type: 'button', onclick: () => { f.gossip.push({ text: '', emote: 0 }); drawGossip(); } }, L('+ вариант')) : null);
    drawGossip();

    const kindBox = h('div');
    const fightBox = h('div', { class: 'stack' });
    const drawKind = () => {
      fill(kindBox, seg([['npc', L('НПС — мирный житель')], ['mob', L('Моб — с ним можно сражаться')]], f.kind, (k) => {
        f.kind = k;
        if (k === 'mob') { if ([35, 12, 29, 55, 80, 104, 68].includes(Number(f.faction))) f.faction = 14; f.immune = false; }
        else if ([7, 14].includes(Number(f.faction))) { f.faction = 35; f.immune = true; }
        renderForm();
      }));
      fill(fightBox, 
        h('div', { class: 'fields-3' }, fld(L('Здоровье ×'), bindInput(f, 'health', { type: 'number', min: 0.01, max: 500, step: 0.1 })),
          fld(L('Урон ×'), bindInput(f, 'damage', { type: 'number', min: 0, max: 100, step: 0.1 })),
          fld(L('Броня ×'), bindInput(f, 'armor', { type: 'number', min: 0, max: 100, step: 0.1 }))),
        f.kind === 'mob' ? h('div', { class: 'fields-2' }, fld(L('Денег с трупа: от, меди'), bindInput(f, 'gold_min', { type: 'number', min: 0 })),
          fld(L('до, меди'), bindInput(f, 'gold_max', { type: 'number', min: 0 }))) : null,
        f.kind === 'mob' && !d.entry ? bindCheck(f, 'loot', L('Добыча — как у «{0}»', d.base_name || d.name)) : null);
    };

    const form = h('div', { class: 'stack' });
    const renderForm = () => {
      drawKind();
      fill(form, 
        card(L('Кто это'), null, null, h('div', { class: 'card-b stack' }, kindBox,
          h('div', { class: 'fields-2' }, fld(L('Имя'), bindInput(f, 'name', { maxlength: 100 }, drawPreview)),
            fld(L('Подпись под именем'), bindInput(f, 'subname', { maxlength: 100, placeholder: L('Например: Летописец') }, drawPreview), L('В игре видна в угловых скобках.'))),
          h('div', { class: 'fields-3' }, fld(L('Уровень от'), bindInput(f, 'minlevel', { type: 'number', min: 1, max: 63 }, drawPreview)),
            fld(L('до'), bindInput(f, 'maxlevel', { type: 'number', min: 1, max: 63 }, drawPreview)), fld(L('Ранг'), bindSelect(f, 'rank', NPC_RANKS, drawPreview))),
          h('div', { class: 'fields-3' }, fld(L('Отношение к игрокам'), bindSelect(f, 'faction',
            NPC_FACTIONS.some(([v]) => v === Number(f.faction)) ? NPC_FACTIONS : [...NPC_FACTIONS, [f.faction, L('Фракция №{0}', f.faction)]], drawPreview)),
            fld(L('Тип'), bindSelect(f, 'type', NPC_TYPES)), fld(L('Класс (здоровье и мана)'), bindSelect(f, 'unitclass', NPC_CLASSES))),
          bindCheck(f, 'immune', L('Неуязвим: атаковать его нельзя')))),
        card(L('Внешность'), null, null, h('div', { class: 'card-b stack' }, looks,
          h('div', { class: 'fields-3' }, fld(L('Размер'), bindInput(f, 'scale', { type: 'number', min: 0.1, max: 10, step: 0.1 }), L('1 — обычный.')),
            fld(L('Поза'), bindSelect(f, 'stand', NPC_STANDS)), fld(L('Занятие'), bindSelect(f, 'emote_state', NPC_STATES))),
          bindCheck(f, 'armed', L('Оружие в руках, а не в ножнах')), h('b', null, L('Снаряжение')), equipBox)),
        card(L('Что говорит'), L('$N — имя игрока, $C — класс, $R — раса, $G он:она; — по полу'), null, h('div', { class: 'card-b stack' },
          h('b', null, L('Когда игрок щёлкнет по нему')), h('p', { class: 'muted small' }, L('Откроется окно разговора с этим текстом. Если вариантов несколько, игра выберет случайно.')), gossipBox,
          h('b', null, L('Если у него будут задания')), fld(L('Приветствие над списком заданий'), bindArea(f.greeting, 'text', { rows: 2, maxlength: 1000 }), L('Необязательно: без него игра покажет текст разговора.')),
          talkBlock(f, 'greet', L('Когда видит игрока рядом'), L('Скажет в чат, когда игрок подойдёт. Пауза не даёт ему болтать без остановки.'), { range: true }),
          f.kind === 'mob' ? talkBlock(f, 'aggro', L('Когда на него нападают')) : null,
          f.kind === 'mob' ? talkBlock(f, 'death', L('Когда умирает')) : null)),
        card(L('Сила'), f.kind === 'mob' ? null : L('нужно, только если его можно атаковать'), null, h('div', { class: 'card-b' }, fightBox)));
      drawPreview();
    };
    renderForm();

    const out = h('div');
    const save = async () => {
      const talk = {};
      for (const [k, t] of Object.entries(f.talk)) if (t.lines.some((x) => x.trim())) talk[k] = { ...t, lines: t.lines.filter((x) => x.trim()) };
      const payload = { ...f, talk, gossip: f.gossip.filter((g) => g.text.trim()), equip: f.equip, entry: d.entry || undefined, base: d.base };
      delete payload.thumbs; delete payload.equip_items;
      saveBtn.disabled = true;
      try {
        const r = (await api('/api/npc/save', payload)).data;
        toast(r.created ? L('НПС создан: №{0}. Теперь поставьте его в мир.', r.entry) : L('Сохранено.'));
        if (opts.onSaved) opts.onSaved({ entry: r.entry, name: f.name, subname: f.subname, thumb: f.thumbs[0], display: f.displays[0] });
        if (opts.onSaved && opts.closeOnSave) close(); else reopen(r.entry);
      } catch (e) { fill(out, resultView({ success: false, output: e.message })); }
      finally { saveBtn.disabled = false; }
    };
    const saveBtn = h('button', { class: 'btn pri', type: 'button', onclick: save }, d.entry ? L('Сохранить') : L('Создать НПС'));

    const side = h('div', { class: 'stack npc-side' }, preview,
      d.entry ? npcSpawnsCard(d, () => reopen(d.entry)) : h('div', { class: 'card' }, h('div', { class: 'card-b muted small' }, L('После создания здесь появится «Где стоит»: поставить НПС на карте или рядом с персонажем.'))),
      d.entry ? npcQuestsCard(d) : null);
    fill(box, 
      drawerBox(d.entry ? `${d.name} · №${d.entry}` : L('Новый НПС'),
        d.entry ? L('Изменения появятся в мире после перезапуска.') : L('Шаг 2 из 2: имя, характер, речь. Основа — «{0}» (№{1}).', d.base_name || '', d.base), () => close()),
      h('div', { class: 'drawer-b' }, h('div', { class: 'npc-grid' }, form, side), out,
        h('div', { class: 'row' }, d.entry ? statusBadge(d.status) : null, h('span', { class: 'spacer' }),
          d.entry && d.entry >= 90000 ? h('button', { class: 'btn dng', type: 'button', onclick: () => formModal({ title: L('Удалить «{0}»?', d.name),
            text: L('НПС исчезнет вместе с речью, местами в мире и связями с заданиями. Задания останутся без квестодателя.'),
            fields: [{ name: 'confirm', label: L('Впишите имя НПС, чтобы подтвердить') }], submit: L('Удалить'), danger: true,
            onSubmit: (v) => api('/api/npc/delete', { entry: d.entry, confirm: v.confirm }).then((r) => r.data),
            onDone: (res) => { if (res && res.success) { close(); if (opts.onSaved) opts.onSaved(null); route(); } } }) }, L('Удалить')) : null,
          saveBtn)));
  }
}

function npcSpawnsCard(d, reload) {
  const place = (p, extra) => api('/api/npc/spawn', { entry: d.entry, ...p, ...extra }).then((r) => { toast(r.data.output); reload(); return r.data; });
  const spawnOpts = { o: 0, respawn: d.kind === 'mob' ? 300 : 60, wander: d.kind === 'mob' ? 5 : 0 };
  const optsRow = () => h('div', { class: 'stack tight' },
    h('div', { class: 'fields-3' }, fld(L('Смотрит'), bindSelect(spawnOpts, 'o', FACING)),
      fld(L('Возрождение, сек'), bindInput(spawnOpts, 'respawn', { type: 'number', min: 5 })),
      fld(L('Бродит в радиусе, ярдов'), bindInput(spawnOpts, 'wander', { type: 'number', min: 0, max: 50 }))));
  const onMap = () => mapModal({ title: L('Где поставить «{0}»', d.name), sub: L('Щёлкните по месту — высоту земли панель найдёт сама.'),
    pickLabel: L('Поставить сюда'), extra: () => optsRow(),
    onPick: async (p, close) => { try { await place({ map: p.map, x: p.x, y: p.y, z: p.z }, spawnOpts); close(); } catch (e) { toast(e.message, true); } } });
  const atChar = () => {
    const { inp, dl } = charInput();
    let close;
    const out = h('div');
    const box = h('div', { class: 'modal' }, h('div', { class: 'modal-h' }, h('div', null, h('h3', null, L('Поставить у персонажа')),
      h('p', null, L('НПС встанет точно там, где стоит персонаж, и будет смотреть туда же — так удобно ставить в домах и пещерах.'))),
      h('button', { class: 'btn ghost sm x', type: 'button', onclick: () => close() }, icon('x'))),
      h('div', { class: 'modal-b stack' }, fld(L('Персонаж'), inp), dl, optsRow(), out),
      h('div', { class: 'modal-f' }, h('button', { class: 'btn', type: 'button', onclick: () => close() }, L('Закрыть')),
        h('button', { class: 'btn pri', type: 'button', onclick: async () => {
          try { await place({ char: inp.value.trim() }, { respawn: spawnOpts.respawn, wander: spawnOpts.wander }); close(); }
          catch (e) { fill(out, resultView({ success: false, output: e.message })); }
        } }, L('Поставить'))));
    close = openOverlay(box);
  };
  return card(L('Где стоит'), d.spawns.length ? L('{0} мест', d.spawns.length) : null, null, h('div', { class: 'card-b stack' },
    d.spawns.length ? h('div', { class: 'list' }, d.spawns.map((s) => h('div', { class: 'li' },
      h('span', { class: 'grow' }, h('b', null, placeTitle(s, MAP_CONT[s.map] || L('карта {0}', s.map))),
        h('div', { class: 'muted small mono' }, `${s.x}, ${s.y}, ${s.z}`)),
      [0, 1].includes(s.map) ? h('button', { class: 'btn sm ghost', type: 'button', title: L('Показать на карте'),
        onclick: () => mapModal({ title: d.name, start: { map: s.map, x: s.x, y: s.y }, onPick: null }) }, icon('worldmap')) : null,
      h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => {
        try { const r = await api('/api/npc/despawn', { guid: s.guid }); toast(r.data.output); reload(); } catch (e) { toast(e.message, true); }
      } }, L('убрать'))))) : h('p', { class: 'muted small' }, L('Пока нигде не стоит.')),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: onMap }, icon('worldmap'), L('На карте')),
      h('button', { class: 'btn', type: 'button', onclick: atChar }, L('У персонажа')))));
}

function npcQuestsCard(d) {
  return card(L('Задания'), null, null, h('div', { class: 'card-b stack' },
    d.quests.length ? h('div', { class: 'list' }, d.quests.map((q) => h('div', { class: 'li click', onclick: () => questEditor(q.entry) },
      h('span', { class: 'grow' }, q.title), q.gives ? badge(L('даёт'), 'acc') : null, q.takes ? badge(L('принимает'), null) : null)))
      : h('p', { class: 'muted small' }, L('Заданий у него нет.')),
    h('button', { class: 'btn', type: 'button', onclick: () => questEditor(null, { giver: { entry: d.entry, name: d.name, subname: d.subname, thumb: (d.thumbs || [])[0] } }) },
      L('Новое задание у этого НПС'))));
}

function restartHint(list, what) {
  const waiting = list.filter((r) => r.status !== 'live').length;
  if (!waiting) return null;
  return h('div', { class: 'result bad' }, icon('warn'), h('div', null,
    h('b', null, L('{0}: {1} ждут перезапуска мира', what, waiting)),
    h('p', { class: 'small' }, L('Новых и изменённых существ ядро читает только при запуске. Перезапуск — в разделе «Сервер»: можно «когда никого не будет».')),
    h('a', { class: 'btn sm', href: '#/server' }, L('К перезапуску'))));
}

PAGES.npcs = {
  title: L('Свои НПС'), sub: L('Свои НПС и мобы: внешность, речь, где стоят. Новые появляются в мире после перезапуска.'),
  async render(el) {
    const load = async () => {
      const rows = (await api('/api/npcs')).data;
      fill(el, restartHint(rows, L('НПС')) || '', rows.length ? h('div', { class: 'npc-cards' }, rows.map((n) => h('button', { class: 'npc-card', type: 'button', onclick: () => npcEditor(n.entry, { onSaved: load }) },
        npcThumb(n.thumb, 'l'), h('div', { class: 'grow' }, h('b', null, n.name), n.subname ? h('div', { class: 'muted small' }, `<${n.subname}>`) : null,
          h('div', { class: 'small' }, L('ур. {0}', n.minlevel === n.maxlevel ? n.minlevel : `${n.minlevel}–${n.maxlevel}`), ' · ',
            n.civilian ? L('НПС') : L('моб'), ' · ', L('мест: {0}', n.spawns), n.quests ? ' · ' + L('заданий: {0}', n.quests) : ''),
          statusBadge(n.status)))))
        : card(null, null, null, h('div', { class: 'card-b stack' }, h('p', null, L('Своих НПС пока нет.')),
          h('p', { class: 'muted small' }, L('Создайте жителя, который будет стоять в нужном месте и говорить, когда к нему обращаются, или моба, с которым можно сразиться. Его можно сделать квестодателем в разделе «Свои задания».')))));
    };
    setTools(h('button', { class: 'btn pri', type: 'button', onclick: () => npcEditor(null, { onSaved: load }) }, L('Создать НПС')),
      refreshBtn(() => load().catch((e) => toast(e.message, true))));
    await load();
  },
};

// ============================================================ Свои задания

const QUEST_KINDS = [
  ['talk', L('Поговорить'), L('Сходить к другому НПС (или вернуться к этому) и поговорить. Самое простое задание — например, «представься маршалу».')],
  ['deliver', L('Доставить предмет'), L('НПС отдаёт предмет — письмо, посылку — и его надо отнести другому НПС.')],
  ['kill', L('Убить'), L('Убить столько-то существ одного или нескольких видов (до 4).')],
  ['collect', L('Собрать'), L('Принести предметы (до 4). Можно сделать так, чтобы они падали с выбранных существ только на этом задании.')],
  ['explore', L('Исследовать место'), L('Дойти до места на карте. Засчитывается только в готовых «областях» клиента — панель покажет, какие есть рядом.')],
];
const QUEST_TYPES = [[0, L('Обычное')], [1, L('Групповое')], [41, L('PvP')], [62, L('Рейд')], [81, L('Подземелье')]];
const RACE_BITS = [[1, L('Человек')], [4, L('Дворф')], [8, L('Ночной эльф')], [64, L('Гном')], [2, L('Орк')], [16, L('Нежить')], [32, L('Таурен')], [128, L('Тролль')]];
const CLASS_BITS = [[1, L('Воин')], [2, L('Паладин')], [4, L('Охотник')], [8, L('Разбойник')], [16, L('Жрец')], [64, L('Шаман')], [128, L('Маг')], [256, L('Чернокнижник')], [1024, L('Друид')]];
let questMeta = null;

function maskChips(obj, key, bits, presets) {
  const box = h('div', { class: 'chips' });
  const draw = () => {
    const v = Number(obj[key]) || 0;
    fill(box, ...presets.map(([mask, label]) => h('button', { class: 'chip' + (v === mask ? ' on' : ''), type: 'button',
      onclick: () => { obj[key] = mask; draw(); } }, label)),
    ...bits.map(([bit, label]) => h('button', { class: 'chip' + (v & bit ? ' on' : ''), type: 'button',
      onclick: () => { obj[key] = (v & bit) ? v & ~bit : v | bit; draw(); } }, label)));
  };
  draw();
  return box;
}

function moneyInputs(obj, key) {
  const v = Number(obj[key]) || 0;
  const parts = { g: Math.floor(v / 10000), s: Math.floor((v % 10000) / 100), c: v % 100 };
  const upd = () => { obj[key] = (Number(parts.g) || 0) * 10000 + (Number(parts.s) || 0) * 100 + (Number(parts.c) || 0); };
  return h('div', { class: 'fields-3' }, fld(L('Золото'), bindInput(parts, 'g', { type: 'number', min: 0 }, upd)),
    fld(L('Серебро'), bindInput(parts, 's', { type: 'number', min: 0, max: 99 }, upd)), fld(L('Медь'), bindInput(parts, 'c', { type: 'number', min: 0, max: 99 }, upd)));
}

function questSearchField(obj, key, label, hint) {
  const view = h('div');
  const draw = () => {
    if (obj[key]) {
      fill(view, h('div', { class: 'row' }, h('span', { class: 'grow' }, `№${obj[key]}`, obj[key + '_title'] ? ' · ' + obj[key + '_title'] : ''),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { obj[key] = 0; obj[key + '_title'] = ''; draw(); } }, L('убрать'))));
      return;
    }
    const q = h('input', { class: 'inp', type: 'search', placeholder: L('Название или номер задания'), autocomplete: 'off' });
    const res = h('div', { class: 'list pick-list' });
    q.addEventListener('input', debounce(async () => {
      const t = q.value.trim();
      if (t.length < 2 && !/^\d+$/.test(t)) { fill(res); return; }
      try {
        const rows = (await api('/api/quest/search?q=' + encodeURIComponent(t))).data;
        fill(res, ...rows.map((r) => h('div', { class: 'li click', onclick: () => { obj[key] = r.entry; obj[key + '_title'] = r.title; draw(); } },
          h('span', { class: 'grow' }, r.title), h('span', { class: 'muted small' }, L('ур. {0} · №{1}', r.level, r.entry)))));
      } catch (e) { fill(res, h('div', { class: 'li muted' }, e.message)); }
    }, 300));
    fill(view, q, res);
  };
  draw();
  return fld(label, view, hint);
}

function npcSlot(obj, key, label, hint) {
  const box = h('div');
  const draw = () => fill(box, obj[key] && obj[key].entry ? npcCardSmall(obj[key], () => { obj[key] = null; draw(); })
    : npcPicker((n) => { obj[key] = n; draw(); }, { create: true }));
  draw();
  return fld(label, box, hint);
}

/* Окно задания как в игре — для предпросмотра */
function questPreview(f) {
  const listRow = (it, count) => itemChip(it, count > 1 ? h('span', { class: 'muted' }, '×' + count) : null);
  const goals = [];
  if (f.kind === 'kill') for (const k of f.kill) if (k.creature) goals.push(`${k.text || k.creature.name || '#' + k.creature.entry}: 0/${k.count}`);
  if (f.kind === 'collect') for (const c of f.collect) if (c.item) goals.push(`${c.item.name}: 0/${c.count}`);
  if (f.kind === 'deliver' && f.src_item.item) goals.push(`${f.src_item.item.name}: 1/${f.src_item.count || 1}`);
  const r = f.rewards;
  return h('div', { class: 'quest-scroll' },
    h('h3', null, f.title || L('Название задания')),
    h('div', { class: 'qtext' }, wowText(f.details) || h('span', { class: 'muted' }, L('Описание: что говорит НПС, выдавая задание.'))),
    h('h4', null, L('Задачи')), h('div', { class: 'qtext' }, wowText(f.objectives) || '…'),
    goals.length ? h('ul', null, goals.map((g) => h('li', null, g))) : null,
    h('h4', null, L('Награда')),
    r.choice.filter((x) => x.item).length ? h('div', null, h('div', { class: 'small' }, L('Вы сможете выбрать одну из наград:')),
      h('div', { class: 'reward-grid' }, r.choice.filter((x) => x.item).map((x) => listRow(x.item, x.count)))) : null,
    r.items.filter((x) => x.item).length ? h('div', null, h('div', { class: 'small' }, L('Вы получите:')),
      h('div', { class: 'reward-grid' }, r.items.filter((x) => x.item).map((x) => listRow(x.item, x.count)))) : null,
    h('div', { class: 'row small' }, r.money ? coins(r.money) : null, r.xp ? h('span', null, L('{0} опыта', fmtN(r.xp))) : null,
      r.rep.filter((x) => x.faction).map((x) => h('span', null, `${(questMeta && (questMeta.factions.find((ff) => ff.id === Number(x.faction)) || {}).name) || '#' + x.faction} ${x.value > 0 ? '+' : ''}${x.value}`))));
}

function triggerPicker(f, onChange) {
  const box = h('div', { class: 'stack tight' });
  const draw = (list) => {
    fill(box, 
      f.trigger ? h('div', { class: 'row' }, badge(L('область №{0}', f.trigger), 'acc'), f.trigger_place ? h('span', { class: 'muted small' }, f.trigger_place) : null) : h('p', { class: 'muted small' }, L('Область не выбрана.')),
      list ? h('div', { class: 'list' }, list.map((t) => h('div', { class: 'li' + (t.teleport ? '' : ' click'), onclick: t.teleport ? null : () => {
        f.trigger = t.id; f.trigger_place = placeTitle(t); draw(list); onChange();
      } }, h('span', { class: 'grow' }, h('b', null, `№${t.id}`), ' · ' + placeTitle(t),
        h('div', { class: 'muted small' }, L('{0} м от точки, радиус {1} м', t.dist, t.radius))),
      t.teleport ? badge(L('вход в подземелье'), 'bad') : t.busy ? badge(L('уже в {0} зад.', t.quests), null) : null,
      f.trigger === t.id ? badge(L('выбрана'), 'ok') : null))) : null,
      h('button', { class: 'btn', type: 'button', onclick: () => mapModal({ title: L('Куда нужно дойти'), sub: L('Щёлкните по месту — панель покажет ближайшие области исследования.'),
        pickLabel: L('Найти области рядом'), onPick: async (p, close) => {
          try { const r = (await api(`/api/quest/triggers?map=${p.map}&x=${p.x}&y=${p.y}`)).data; close(); draw(r); if (!r.length) toast(L('Рядом нет областей исследования — выберите место ближе к городу, шахте или пещере.'), true); }
          catch (e) { toast(e.message, true); }
        } }) }, icon('worldmap'), L('Выбрать место на карте')));
  };
  draw(null);
  return box;
}

async function questEditor(entry, preset = {}) {
  const box = h('div', { class: 'drawer npc-ed', role: 'dialog', 'aria-modal': 'true' });
  const close = openOverlay(box);
  const reopen = (e) => { close(); questEditor(e); };
  try { if (!questMeta) questMeta = (await api('/api/quest/meta')).data; } catch (e) { fill(box, h('div', { class: 'drawer-b' }, errorCard(e))); return; }

  const blank = (kind) => ({
    entry: null, kind, title: '', details: '', objectives: '', offer_text: '', request_text: '', end_text: '', objective_texts: ['', '', '', ''],
    emotes: { details: 1, incomplete: 0, complete: 0, offer: 2 }, level: { quest: 10, min: 8, max: 255 }, races: 0, classes: 0, type: 0, suggested: 0,
    repeatable: false, time_limit: 0, prev: 0, next: 0, zone: 0,
    giver: preset.giver ? { type: 'npc', ...preset.giver } : { type: 'npc' }, ender: null, same_ender: true,
    kill: [{ creature: null, count: 10 }], collect: [{ item: null, count: 5, drop: { creature: null, chance: 35 } }], src_item: { item: null, count: 1 },
    trigger: null, req_money: 0, rep_objective: { faction: 0, value: 0 },
    rewards: { money: 0, xp: 0, items: [], choice: [], rep: [], spell: 0 }, status: 'new',
  });

  if (!entry) {
    fill(box, drawerBox(L('Новое задание'), L('Какое задание делаем?'), () => close()),
      h('div', { class: 'drawer-b' }, h('div', { class: 'kind-grid' }, QUEST_KINDS.map(([k, label, text]) =>
        h('button', { class: 'kind', type: 'button', onclick: () => render(blank(k)) }, h('b', null, label), h('span', null, text))))));
    return;
  }
  fill(box, h('div', { class: 'drawer-b' }, h('div', { class: 'empty' }, L('Загружаю…'))));
  try {
    const d = (await api('/api/quest?entry=' + entry)).data;
    const f = blank(d.kind);
    Object.assign(f, { entry: d.entry, title: d.title, details: d.details, objectives: d.objectives, offer_text: d.offer_text, request_text: d.request_text,
      end_text: d.end_text, objective_texts: d.objective_texts, emotes: d.emotes, level: d.level, races: d.races, classes: d.classes, type: d.type,
      suggested: d.suggested, repeatable: d.repeatable, time_limit: d.time_limit, prev: d.prev, next: d.next, zone: d.zone,
      trigger: d.trigger, req_money: d.req_money, status: d.status,
      rep_objective: d.rep_objective || { faction: 0, value: 0 } });
    f.giver = d.item_givers.length ? { type: 'item', item: d.item_givers[0] } : { type: 'npc', ...(d.givers[0] || {}) };
    f.ender = d.enders[0] || null;
    f.same_ender = !!(f.ender && d.givers[0] && f.ender.entry === d.givers[0].entry);
    if (d.kill.length) f.kill = d.kill.map((k) => ({ creature: k.creature, count: k.count }));
    f.kill.forEach((k, i) => { k.text = d.objective_texts[i] || ''; });
    if (d.kind === 'collect') f.collect = d.collect.map((c) => ({ item: c.item, count: c.count, drop: { creature: c.drop ? c.drop.creature : null, chance: c.drop ? c.drop.chance : 35 } }));
    if (d.src_item) f.src_item = { item: d.src_item.item, count: d.src_item.count };
    f.rewards = { money: d.rewards.money, xp: d.rewards.xp, spell: d.rewards.spell,
      items: d.rewards.items.map((x) => ({ item: x.item, count: x.count })), choice: d.rewards.choice.map((x) => ({ item: x.item, count: x.count })),
      rep: d.rewards.rep.map((x) => ({ ...x })) };
    render(f);
  } catch (e) { fill(box, h('div', { class: 'drawer-b' }, errorCard(e))); }

  function render(f) {
    const preview = h('div');
    const drawPreview = () => fill(preview, questPreview(f));
    const goalBox = h('div', { class: 'stack' });
    const drawGoal = () => {
      const kinds = seg(QUEST_KINDS.map(([k, l]) => [k, l]), f.kind, (k) => { f.kind = k; drawGoal(); drawPreview(); });
      const parts = [kinds, h('p', { class: 'muted small' }, (QUEST_KINDS.find(([k]) => k === f.kind) || [])[2])];
      if (f.kind === 'kill') {
        parts.push(...f.kill.map((k, i) => h('div', { class: 'goal-row' },
          k.creature ? npcCardSmall(k.creature, () => { k.creature = null; drawGoal(); drawPreview(); }) : npcPicker((n) => { k.creature = n; drawGoal(); drawPreview(); }),
          h('div', { class: 'fields-2' }, fld(L('Сколько'), bindInput(k, 'count', { type: 'number', min: 1, max: 250 }, drawPreview)),
            fld(L('Подпись в журнале'), bindInput(k, 'text', { maxlength: 250, placeholder: L('Необязательно: иначе имя существа') }, drawPreview))),
          f.kill.length > 1 ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { f.kill.splice(i, 1); drawGoal(); drawPreview(); } }, L('убрать цель')) : null)));
        if (f.kill.length < 4) parts.push(h('button', { class: 'btn sm', type: 'button', onclick: () => { f.kill.push({ creature: null, count: 5, text: '' }); drawGoal(); } }, L('+ ещё вид существ')));
      }
      if (f.kind === 'collect') {
        parts.push(...f.collect.map((c, i) => h('div', { class: 'goal-row' },
          c.item ? itemChip(c.item, null, () => { c.item = null; drawGoal(); drawPreview(); }) : itemPicker((it) => { c.item = it; drawGoal(); drawPreview(); }),
          fld(L('Сколько'), bindInput(c, 'count', { type: 'number', min: 1, max: 250 }, drawPreview)),
          h('b', { class: 'small' }, L('Падает только на этом задании с…')),
          c.drop.creature ? npcCardSmall(c.drop.creature, () => { c.drop.creature = null; drawGoal(); }) : npcPicker((n) => { c.drop.creature = n; drawGoal(); }, { placeholder: L('Необязательно: с кого падает (если предмет и так где-то добывается — оставьте пустым)') }),
          c.drop.creature ? fld(L('Шанс, %'), bindInput(c.drop, 'chance', { type: 'number', min: 1, max: 100 })) : null,
          f.collect.length > 1 ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { f.collect.splice(i, 1); drawGoal(); drawPreview(); } }, L('убрать предмет')) : null)));
        if (f.collect.length < 4) parts.push(h('button', { class: 'btn sm', type: 'button', onclick: () => { f.collect.push({ item: null, count: 1, drop: { creature: null, chance: 35 } }); drawGoal(); } }, L('+ ещё предмет')));
        parts.push(h('p', { class: 'muted small' }, L('Если существо — своё, добыча правится у него одного; у существ игры предмет добавится в их добычу (и уберётся, когда задание удалят).')));
      }
      if (f.kind === 'deliver') {
        parts.push(fld(L('Что отнести'), f.src_item.item ? itemChip(f.src_item.item, null, () => { f.src_item.item = null; drawGoal(); drawPreview(); })
          : itemPicker((it) => { f.src_item.item = it; drawGoal(); drawPreview(); }), L('НПС отдаст этот предмет, когда игрок возьмёт задание. Лучше свой предмет с привязкой «задание» — его можно сделать в «Предметах».')),
        fld(L('Сколько'), bindInput(f.src_item, 'count', { type: 'number', min: 1, max: 20 })));
      }
      if (f.kind === 'explore') {
        parts.push(triggerPicker(f, drawPreview), fld(L('Строка в журнале, когда дошёл'), bindInput(f, 'end_text', { maxlength: 250, placeholder: L('Например: Осмотреть старую шахту') })));
      }
      if (f.kind === 'talk') parts.push(h('p', { class: 'muted small' }, L('Цели нет: задание сдаётся, как только игрок поговорит с тем, кому его надо сдать.')));
      fill(goalBox, ...parts);
    };
    drawGoal();

    const giverBox = h('div', { class: 'stack' });
    const drawGiver = () => {
      const g = f.giver;
      fill(giverBox, 
        seg([['npc', L('НПС')], ['item', L('Предмет')]], g.type, (k) => { f.giver = { type: k }; drawGiver(); }),
        g.type === 'npc' ? npcSlot(f, 'giver_npc_tmp', L('Кто даёт'), null) : null,
        g.type === 'item' ? fld(L('Предмет, который начинает задание'), g.item ? itemChip(g.item, null, () => { g.item = null; drawGiver(); })
          : itemPicker((it) => { g.item = it; drawGiver(); }, { customOnly: true, placeholder: L('Свой предмет (номер от 90000)') }),
        L('Игрок щёлкнет по предмету в сумке — и получит задание. Только свои предметы, чтобы не менять предметы игры.')) : null,
        bindCheck(f, 'same_ender', L('Сдавать тому же НПС'), () => drawGiver()),
        !f.same_ender || g.type === 'item' ? npcSlot(f, 'ender', L('Кому сдавать'), null) : null);
    };
    // npcSlot работает с полем объекта: «кто даёт» держим в giver_npc_tmp и переносим в giver при сохранении
    f.giver_npc_tmp = f.giver.type === 'npc' && f.giver.entry ? { ...f.giver } : null;
    drawGiver();

    const rewardBox = h('div', { class: 'stack' });
    const drawRewards = () => {
      const r = f.rewards;
      const typ = questMeta.typical[f.level.quest] || {};
      const list = (arr, max, label) => h('div', { class: 'stack tight' }, h('b', null, label),
        ...arr.map((x, i) => itemChip(x.item, bindInput(x, 'count', { type: 'number', min: 1, max: 1000, class: 'inp inp-n' }, drawPreview),
          () => { arr.splice(i, 1); drawRewards(); drawPreview(); })),
        arr.length < max ? itemPicker((it) => { arr.push({ item: it, count: 1 }); drawRewards(); drawPreview(); }) : null);
      fill(rewardBox, 
        h('div', { class: 'fields-2' }, fld(L('Опыт'), bindInput(r, 'xp', { type: 'number', min: 0, max: 100000 }, drawPreview),
          typ.xp ? L('Задания {0} уровня в игре дают в среднем {1}. На 60 уровне вместо опыта — деньги.', f.level.quest, fmtN(typ.xp)) : null),
        h('div', null, h('span', { class: 'small' }, L('Деньги')), moneyInputs(r, 'money'), typ.money ? h('small', { class: 'muted' }, L('В среднем на этом уровне: '), coins(typ.money)) : null)),
        list(r.items, 4, L('Выдаётся всегда (до 4)')), list(r.choice, 6, L('На выбор — игрок берёт одно (до 6)')),
        h('div', { class: 'stack tight' }, h('b', null, L('Репутация')), ...r.rep.map((x, i) => h('div', { class: 'row' },
          bindSelect(x, 'faction', [[0, L('Фракция…')], ...questMeta.factions.map((ff) => [ff.id, ff.name])], drawPreview),
          bindInput(x, 'value', { type: 'number', min: -10000, max: 10000, class: 'inp inp-n' }, drawPreview),
          h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { r.rep.splice(i, 1); drawRewards(); drawPreview(); } }, '×'))),
        r.rep.length < 5 ? h('button', { class: 'btn sm', type: 'button', onclick: () => { r.rep.push({ faction: 0, value: 250 }); drawRewards(); } }, L('+ репутация')) : null),
        fld(L('Заклинание на игрока при сдаче (номер)'), bindInput(r, 'spell', { type: 'number', min: 0 }), L('Необязательно: например, бафф. Номер можно найти в «Консоли» → lookup spell.')));
    };
    drawRewards();

    const texts = h('div', { class: 'stack' },
      fld(L('Название'), bindInput(f, 'title', { maxlength: 200 }, drawPreview)),
      fld(L('Что говорит НПС, выдавая задание'), bindArea(f, 'details', { rows: 5, maxlength: 4000, placeholder: L('Приветствую, $N. У меня беда…') }, drawPreview)),
      fld(L('Цель — коротко'), bindArea(f, 'objectives', { rows: 2, maxlength: 1000, placeholder: L('Принесите 8 шкур волков Нортширу.') }, drawPreview)),
      fld(L('Если пришёл, не выполнив'), bindArea(f, 'request_text', { rows: 2, maxlength: 2000, placeholder: L('Ну как, получилось?') }), L('Показывается, когда задание ещё не готово.')),
      fld(L('Что говорит при сдаче'), bindArea(f, 'offer_text', { rows: 4, maxlength: 4000, placeholder: L('Отлично, $N! Вот твоя награда.') })),
      h('div', { class: 'fields-2' }, fld(L('Жест при выдаче'), bindSelect(f.emotes, 'details', EMOTES)), fld(L('Жест при сдаче'), bindSelect(f.emotes, 'offer', EMOTES))),
      h('p', { class: 'muted small' }, L('$N — имя игрока, $C — класс, $R — раса, $G он:она; — по полу. Перенос строки — Enter.')));

    const cond = h('div', { class: 'stack' },
      h('div', { class: 'fields-3' }, fld(L('Уровень задания'), bindInput(f.level, 'quest', { type: 'number', min: 1, max: 63 }, () => drawRewards()), L('От него зависит цвет в журнале и опыт.')),
        fld(L('Брать с уровня'), bindInput(f.level, 'min', { type: 'number', min: 1, max: 63 })), fld(L('Брать до уровня'), bindInput(f.level, 'max', { type: 'number', min: 1, max: 255 }), L('255 — без ограничения.'))),
      fld(L('Для каких рас'), maskChips(f, 'races', RACE_BITS, [[0, L('Все')], [77, L('Альянс')], [178, L('Орда')]])),
      fld(L('Для каких классов'), maskChips(f, 'classes', CLASS_BITS, [[0, L('Все')]])),
      h('div', { class: 'fields-3' }, fld(L('Вид'), bindSelect(f, 'type', QUEST_TYPES)), fld(L('Игроков (для группового)'), bindInput(f, 'suggested', { type: 'number', min: 0, max: 40 })),
        fld(L('На время, минут'), bindInput({ get m() { return f.time_limit ? f.time_limit / 60 : ''; }, set m(v) { f.time_limit = Math.round((Number(v) || 0) * 60); } }, 'm', { type: 'number', min: 0, max: 1440 }), L('Пусто — без ограничения.'))),
      bindCheck(f, 'repeatable', L('Можно выполнять много раз')),
      fld(L('Раздел журнала (зона)'), bindSelect(f, 'zone', [[0, L('Как у квестодателя / без зоны')], ...questMeta.zones.map((z) => [z.id, z.name])])),
      h('div', { class: 'fields-2' }, questSearchField(f, 'prev', L('Сначала выполнить задание'), L('Цепочка: это задание появится после указанного.')),
        questSearchField(f, 'next', L('Следом предложить задание'), L('После сдачи НПС сразу предложит следующее.'))),
      h('b', null, L('Дополнительно для выполнения')),
      h('div', { class: 'stack tight' }, h('span', { class: 'small' }, L('Принести денег')), moneyInputs(f, 'req_money')),
      h('div', { class: 'fields-2' }, fld(L('Набрать репутацию у фракции'), bindSelect(f.rep_objective, 'faction', [[0, L('— не нужно —')], ...questMeta.factions.map((ff) => [ff.id, ff.name])])),
        fld(L('До значения'), bindInput(f.rep_objective, 'value', { type: 'number', min: 0, max: 42000 }), L('3000 — дружелюбие, 9000 — уважение, 21000 — почтение.'))));

    const out = h('div');
    const saveBtn = h('button', { class: 'btn pri', type: 'button' }, f.entry ? L('Сохранить') : L('Создать задание'));
    saveBtn.onclick = async () => {
      const g = f.giver.type === 'npc' ? f.giver_npc_tmp : null;
      const ender = f.same_ender && f.giver.type === 'npc' ? g : f.ender;
      if (f.giver.type === 'npc' && !g) { toast(L('Выберите, кто даёт задание.'), true); return; }
      if (f.giver.type === 'item' && !(f.giver.item && f.giver.item.id)) { toast(L('Выберите предмет, который начинает задание.'), true); return; }
      if (!ender) { toast(L('Выберите, кому сдавать задание.'), true); return; }
      const payload = {
        entry: f.entry || undefined, kind: f.kind, title: f.title, details: f.details, objectives: f.objectives, offer_text: f.offer_text,
        request_text: f.request_text, end_text: f.end_text, emotes: f.emotes, level: f.level, races: f.races, classes: f.classes, type: f.type,
        suggested: f.suggested, repeatable: f.repeatable, time_limit: f.time_limit, prev: f.prev, next: f.next, zone: f.zone,
        giver: f.giver.type === 'npc' ? { type: 'npc', entry: g.entry } : { type: 'item', entry: f.giver.item.id },
        ender: { entry: ender.entry },
        objective_texts: f.kind === 'kill' ? f.kill.map((k) => k.text || '') : f.objective_texts,
        kill: f.kill.filter((k) => k.creature).map((k) => ({ creature: k.creature.entry, count: k.count })),
        collect: f.collect.filter((c) => c.item).map((c) => ({ item: c.item.id, count: c.count, drop: c.drop.creature ? { creature: c.drop.creature.entry, chance: c.drop.chance } : null })),
        src_item: f.src_item.item ? { item: f.src_item.item.id, count: f.src_item.count } : null,
        trigger: f.trigger, req_money: f.req_money, rep_objective: f.rep_objective,
        rewards: { money: f.rewards.money, xp: f.rewards.xp, spell: f.rewards.spell,
          items: f.rewards.items.filter((x) => x.item).map((x) => ({ item: x.item.id, count: x.count })),
          choice: f.rewards.choice.filter((x) => x.item).map((x) => ({ item: x.item.id, count: x.count })),
          rep: f.rewards.rep.filter((x) => x.faction) },
      };
      saveBtn.disabled = true;
      try {
        const r = (await api('/api/quest/save', payload)).data;
        toast(r.created ? L('Задание создано: №{0}.', r.entry) : L('Сохранено.'));
        if (preset.onSaved) preset.onSaved(r.entry);
        reopen(r.entry);
      } catch (e) { fill(out, resultView({ success: false, output: e.message })); }
      finally { saveBtn.disabled = false; }
    };

    drawPreview();
    fill(box, 
      drawerBox(f.entry ? `${f.title} · №${f.entry}` : L('Новое задание'), f.entry ? null : L('Заполните карточки сверху вниз — справа видно, как это будет в игре.'), () => close()),
      h('div', { class: 'drawer-b' }, h('div', { class: 'npc-grid' },
        h('div', { class: 'stack' },
          card(L('Кто даёт и кому сдавать'), null, null, h('div', { class: 'card-b' }, giverBox)),
          card(L('Что нужно сделать'), null, null, h('div', { class: 'card-b' }, goalBox)),
          card(L('Тексты'), null, null, h('div', { class: 'card-b' }, texts)),
          card(L('Награда'), null, null, h('div', { class: 'card-b' }, rewardBox)),
          card(L('Условия'), null, null, h('div', { class: 'card-b' }, cond))),
        h('div', { class: 'stack npc-side' }, preview)), out,
        h('div', { class: 'row' }, f.entry ? statusBadge(f.status) : null, h('span', { class: 'spacer' }),
          f.entry ? h('button', { class: 'btn dng', type: 'button', onclick: () => formModal({ title: L('Удалить задание «{0}»?', f.title),
            text: L('Уберутся само задание, его связи с НПС, области и добавленная добыча. У тех, кто его взял, оно пропадёт из журнала.'),
            fields: [{ name: 'confirm', label: L('Впишите название задания, чтобы подтвердить') }], submit: L('Удалить'), danger: true,
            onSubmit: (v) => api('/api/quest/delete', { entry: f.entry, confirm: v.confirm }).then((r) => r.data),
            onDone: (res) => { if (res && res.success) { close(); route(); } } }) }, L('Удалить')) : null,
          saveBtn)));
  }
}

PAGES.quests = {
  title: L('Свои задания'), sub: L('Задания со своими текстами, целями и наградами — у своих НПС или у НПС игры.'),
  async render(el) {
    const load = async () => {
      const rows = (await api('/api/quests')).data;
      const pending = rows.some((r) => r.status === 'pending');
      const restart = rows.some((r) => r.status === 'restart');
      fill(el, 
        pending ? h('div', { class: 'result bad' }, icon('warn'), h('div', null, h('b', null, L('Есть изменения, которые мир ещё не знает')),
          h('p', { class: 'small' }, L('Задания можно применить без перезапуска: ядро перечитает их, и все в игре увидят несколько служебных строк «DB table … reloaded».')),
          h('button', { class: 'btn sm pri', type: 'button', onclick: async () => {
            try { const r = await api('/api/quest/apply', {}); infoModal(L('Применено'), resultView(r.data)); load(); } catch (e) { toast(e.message, true); }
          } }, L('Применить сейчас')))) : null,
        restart ? restartHint(rows.filter((r) => r.status === 'restart'), L('Заданий')) : null,
        rows.length ? card(null, null, null, h('div', { class: 'card-b flush' }, table({
          cols: [
            { label: L('Задание'), render: (r) => h('span', null, h('b', null, r.title), r.repeatable ? ' ' : null, r.repeatable ? badge(L('повторяемое'), null) : null) },
            { label: L('Ур.'), cls: 'r', key: 'level' },
            { label: L('Даёт'), render: (r) => r.giver || r.item_giver || '—' },
            { label: L('Сдавать'), render: (r) => r.ender || '—' },
            { label: '', render: (r) => statusBadge(r.status) },
          ], rows, onRow: (r) => questEditor(r.entry) })))
          : card(null, null, null, h('div', { class: 'card-b stack' }, h('p', null, L('Своих заданий пока нет.')),
            h('p', { class: 'muted small' }, L('Выберите тип (поговорить, доставить, убить, собрать, исследовать), кто его даёт — НПС игры или свой, — что он говорит и какая награда.')))));
    };
    setTools(h('button', { class: 'btn pri', type: 'button', onclick: () => questEditor(null) }, L('Создать задание')),
      refreshBtn(() => load().catch((e) => toast(e.message, true))));
    await load();
  },
};

// ============================================================ Журнал

PAGES.audit = {
  title: L('Журнал'), sub: L('Всё, что делалось через панель: кто входил, какие команды, что ответило ядро.'),
  async render(el) {
    const load = async () => {
      const rows = (await api('/api/audit?limit=500')).data;
      el.replaceChildren(card(null, null, null, h('div', { class: 'card-b flush' }, table({
        cols: [
          { label: L('Когда'), render: (r) => h('span', { class: 'nowrap' }, fmtDT(r.ts)) },
          { label: '', render: (r) => h('i', { class: 'dot ' + (r.ok ? 'ok' : 'bad'), title: r.ok ? L('успешно') : L('не выполнено') }) },
          { label: L('Действие'), render: (r) => h('span', { class: 'mono small' }, r.action) },
          { label: L('Что'), key: 'detail' },
          { label: L('Ответ'), render: (r) => (r.output ? h('span', { class: 'muted small' }, r.output.length > 140 ? r.output.slice(0, 140) + '…' : r.output) : '') },
        ], rows, empty: L('Журнал пуст.') }))));
    };
    setTools(refreshBtn(() => load().catch((e) => toast(e.message, true))));
    await load();
  },
};

// ============================================================ События и праздники
/* Календарь событий мира (game_event): праздники, ярмарки, выходные полей боя, вторжения.
   Расписание считает panel.py тем же кодом, что ядро (GameEventMgr). Включить и выключить —
   event start / event stop; «держать включённым / выключенным до …» панель помнит сама и
   раз в минуту сверяет с ядром. У каждого события — своя тема оформления: цвет, узор
   (картинки SVG прямо в app.css) и иконка игры; в карточке — кто из НПС появится. */

const EV_CATS = [['holiday', L('Праздники')], ['fair', L('Ярмарки и забавы')], ['pvp', L('Поля боя')],
  ['world', L('События мира')], ['service', L('Служебные')], ['other', L('Другие')]];
const EV_CAT = Object.fromEntries(EV_CATS);
const DAY = 86400;

const evMain = (e) => !e.parent && e.cat !== 'service';
const evOn = (e) => (e.active == null ? e.scheduled : e.active);

function evDur(min) {
  if (!min) return '—';
  if (min % 1440 === 0) return L('{0} дн.', min / 1440);
  if (min >= 1440) return L('{0} дн. {1} ч', Math.floor(min / 1440), Math.round((min % 1440) / 60));
  if (min % 60 === 0) return L('{0} ч', min / 60);
  return min > 60 ? L('{0} ч {1} мин', Math.floor(min / 60), min % 60) : L('{0} мин', min);
}

function evSchedule(e) {
  const len = evDur(e.length);
  if (e.schedule_type === 0) return L('Своего расписания нет — включает скрипт ядра или вы вручную');
  if (!e.occurence || !e.length || e.occurence < e.length) return L('Отключено в базе мира');
  if (e.schedule_type === 11) return L('Каждый год в одни и те же числа, длится {0}', len);
  if (e.schedule_type === 12) return L('Каждый год со второго новолуния после зимнего солнцестояния, длится {0}', len);
  if (e.schedule_type === 13) return L('Каждый год с Пасхи, длится {0}', len);
  if (e.schedule_type >= 2 && e.schedule_type <= 9) return L('По первым понедельникам месяцев, длится {0}', len);
  const occ = e.occurence;
  if (occ === 525600) return L('Раз в 365 дней, длится {0}', len);
  if (occ === 10080) return L('Каждую неделю, длится {0}', len);
  if (occ === 1440) return L('Каждый день, длится {0}', len);
  if (occ === 60) return L('Каждый час, длится {0}', len);
  return L('Каждые {0}, длится {1}', evDur(occ), len);
}

// Окно [начало, конец): конец ровно в полночь показываем прошедшим днём
function evRange(w) {
  if (!w) return '—';
  const [s, e] = w;
  if (e - s < DAY) return `${fmtDT(s)} – ${new Date(e * 1000).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })}`;
  return `${fmtD(s)} – ${fmtD(e - 1)}`;
}

function evIn(sec) {
  if (sec < 3600) return L('через {0} мин', Math.max(1, Math.round(sec / 60)));
  if (sec < DAY) return L('через {0} ч', Math.round(sec / 3600));
  return L('через {0} дн.', Math.round(sec / DAY));
}

function evLeft(sec) {
  if (sec < 3600) return L('ещё {0} мин', Math.max(1, Math.round(sec / 60)));
  if (sec < DAY) return L('ещё {0} ч', Math.round(sec / 3600));
  return L('ещё {0} дн.', Math.round(sec / DAY));
}

/* Что с событием сейчас: идёт ли и почему — по расписанию, вручную или его держит панель */
function evStatus(e) {
  const f = e.force;
  if (f) {
    const till = f.until ? L(' до {0}', fmtDT(f.until)) : '';
    if (f.kind === 'run') return f.mode === 'on' ? [L('включено вручную') + till, 'acc'] : [L('выключено вручную') + till, 'warn'];
    return f.mode === 'on' ? [L('держит панель: включено') + till, 'acc'] : [L('держит панель: выключено') + till, 'warn'];
  }
  if (e.active == null) return e.scheduled ? [L('по расписанию идёт'), 'ok'] : [L('по расписанию не идёт'), null];
  if (e.active && e.scheduled) return [L('идёт'), 'ok'];
  if (e.active) return [L('включено вручную'), 'acc'];
  if (e.scheduled) return [L('выключено вручную'), 'warn'];
  return [L('не идёт'), null];
}

function evBadge(e) { const [t, k] = evStatus(e); return badge(t, k); }

function evIcon(e, size = 'l') { return h('span', { class: `ev-ico ev-t-${e.theme}` }, gicon(e.icon, size, e.name)); }

/* ---------- карточка «сейчас идёт» */

function evNowCard(e, now, open) {
  const left = e.current ? e.current[1] - now : null;
  return h('button', { class: `ev-now ev-t-${e.theme}`, type: 'button', onclick: () => open(e.entry) },
    gicon(e.icon, 'xl'),
    h('span', { class: 'ev-now-t' },
      h('b', null, e.name),
      h('small', null, e.current ? `${evRange(e.current)} · ${evLeft(left)}`
        : e.force && e.force.until ? L('включено вручную · {0}', evLeft(e.force.until - now)) : L('включено вручную')),
      h('span', null, evBadge(e))));
}

/* ---------- месяц: сетка 7×6, полосы событий идут через дни */

function evMonthView(st, list, open) {
  const first = new Date(st.year, st.month, 1);
  const shift = (first.getDay() + 6) % 7;                    // неделя с понедельника
  const start = new Date(st.year, st.month, 1 - shift);
  const days = [...Array(42)].map((_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const t0 = days[0].getTime() / 1000, t1 = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 42).getTime() / 1000;
  // каждое окно события — на свою дорожку: первая свободная к его началу (так полосы не прыгают по строкам)
  const items = list.flatMap((e) => e.windows.filter(([s, en]) => en > t0 && s < t1).map((w) => ({ e, w })))
    .sort((a, b) => a.w[0] - b.w[0] || b.w[1] - a.w[1]);
  const laneEnd = [];
  for (const it of items) {
    let i = laneEnd.findIndex((end) => end <= it.w[0]);
    if (i < 0) { i = laneEnd.length; laneEnd.push(0); }
    laneEnd[i] = it.w[1];
    it.lane = i;
  }
  const MAXL = 6;
  const nl = Math.min(laneEnd.length, MAXL);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const wd = [...Array(7)].map((_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(LOCALE, { weekday: 'short' }));
  const cells = days.map((d, i) => {
    const ds = d.getTime() / 1000, de = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() / 1000;
    const here = items.filter((it) => it.w[1] > ds && it.w[0] < de);
    const bars = [...Array(nl)].map((_, lane) => {
      const it = here.find((x) => x.lane === lane);
      if (!it) return h('div', { class: 'evb none' });
      const { e, w: win } = it;
      const isStart = win[0] >= ds, isEnd = win[1] <= de;
      const label = isStart || i % 7 === 0 || d.getDate() === 1;
      return h('button', { class: `evb ev-t-${e.theme}${isStart ? ' s' : ''}${isEnd ? ' e' : ''}`, type: 'button', title: `${e.name}\n${evRange(win)}`,
        onclick: () => open(e.entry) }, label ? [gicon(e.icon, 's'), h('span', null, e.name)] : null);
    });
    const more = here.filter((x) => x.lane >= MAXL).length;
    return h('div', { class: 'evm-d' + (d.getMonth() !== st.month ? ' out' : '') + (d.getTime() === today.getTime() ? ' today' : '') },
      h('span', { class: 'evm-n' }, d.getDate()), h('div', { class: 'evm-bars' }, bars),
      more ? h('span', { class: 'evm-more' }, L('ещё {0}', more)) : null);
  });
  return h('div', { class: 'evm' }, wd.map((w) => h('div', { class: 'evm-w' }, w)), cells);
}

/* ---------- год: полосы на 12 месяцев */

function evYearView(st, list, open, now) {
  const y0 = new Date(st.year, 0, 1).getTime() / 1000, y1 = new Date(st.year + 1, 0, 1).getTime() / 1000;
  const pct = (t) => Math.max(0, Math.min(100, ((t - y0) / (y1 - y0)) * 100));
  const months = [...Array(12)].map((_, m) => {
    const a = new Date(st.year, m, 1).getTime() / 1000, b = new Date(st.year, m + 1, 1).getTime() / 1000;
    return h('div', { class: 'evy-m', style: `left:${pct(a)}%;width:${pct(b) - pct(a)}%` },
      new Date(st.year, m, 1).toLocaleDateString(LOCALE, { month: 'short' }));
  });
  const nowLine = now >= y0 && now < y1 ? h('div', { class: 'evy-now', style: `left:${pct(now)}%`, title: L('сегодня') }) : null;
  const rows = list.filter((e) => e.windows.some(([s, en]) => en > y0 && s < y1)).map((e) =>
    h('div', { class: 'evy-r' },
      h('button', { class: 'evy-l', type: 'button', onclick: () => open(e.entry) }, gicon(e.icon, 's'), h('span', null, e.name)),
      h('div', { class: 'evy-t' }, e.windows.filter(([s, en]) => en > y0 && s < y1).map((w) =>
        h('button', { class: `evy-b ev-t-${e.theme}`, type: 'button', title: `${e.name}\n${evRange(w)}`, onclick: () => open(e.entry),
          style: `left:${pct(w[0])}%;width:max(4px, ${pct(w[1]) - pct(w[0])}%)` })), nowLine ? nowLine.cloneNode() : null)));
  if (!rows.length) return h('div', { class: 'empty' }, L('В этом году таких событий по расписанию нет.'));
  return h('div', { class: 'evy' }, h('div', { class: 'evy-r head' }, h('div', { class: 'evy-l' }), h('div', { class: 'evy-t' }, months, nowLine)), rows);
}

/* ---------- все события: плитки по 5–6 в ряд, разделы сворачиваются (что свёрнуто — помнит браузер) */

function evTile(e, open, quick, now) {
  const when = e.current ? L('идёт · {0}', evLeft(e.current[1] - now))
    : e.next ? `${fmtD(e.next[0])} · ${evIn(e.next[0] - now)}` : L('нет в расписании');
  return h('div', { class: `ev-tile ev-t-${e.theme}${evOn(e) ? ' on' : ''}`, role: 'button', tabindex: 0, title: evSchedule(e),
    onclick: () => open(e.entry), onkeydown: (ev) => { if (ev.key === 'Enter') open(e.entry); } },
    h('div', { class: 'ev-tile-top' }, gicon(e.icon, 'l'), evBadge(e)),
    h('b', { class: 'ev-tile-n' }, e.name),
    h('span', { class: 'ev-tile-w' }, when),
    e.active == null ? null : h('button', { class: 'btn sm ev-tile-b', type: 'button', onclick: (ev) => { ev.stopPropagation(); quick(e, !evOn(e)); } },
      icon(evOn(e) ? 'pause' : 'play'), evOn(e) ? L('Выключить') : L('Включить')));
}

function evListView(list, open, quick, now) {
  const groups = EV_CATS.map(([cat, title]) => [cat, title, list.filter((e) => e.cat === cat)]).filter(([, , items]) => items.length);
  if (!groups.length) return h('div', { class: 'empty' }, L('Нет событий в выбранных разделах.'));
  const folded = new Set(pref.get('ev-fold', '').split(',').filter(Boolean));
  return h('div', { class: 'stack tight' }, groups.map(([cat, title, items]) => {
    const on = items.filter(evOn).length;
    const box = h('details', { class: 'ev-group', open: !folded.has(cat) || null },
      h('summary', null, h('b', null, title), h('span', { class: 'muted small' }, ` · ${L('{0} шт.', items.length)}`),
        on ? badge(L('идёт: {0}', on), 'ok') : null),
      h('div', { class: 'ev-tiles' }, items.map((e) => evTile(e, open, quick, now))));
    box.addEventListener('toggle', () => {
      if (box.open) folded.delete(cat); else folded.add(cat);
      pref.set('ev-fold', [...folded].join(','));
    });
    return box;
  }));
}

/* ---------- части события: как связаны с главным (panel.py, EVENT_ROLE)
   core — ядро само включает часть в её время, но только пока идёт главное (linkedTo в базе);
   during / before / after — у части свой календарь, ядро её с главным не связывает;
   script — этап, который включает скрипт ядра. */

const EV_PART = { core: [L('ядро включает само'), 'ok'], during: [L('свой календарь'), null], before: [L('подготовка'), null],
  after: [L('после события'), null], script: [L('этап скрипта'), 'warn'] };
const evClock = (t) => new Date(t * 1000).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
const evNames = (list) => list.map((c) => `«${c.name}»`).join(', ');
const evNote = (text) => ({ node: h('div', { class: 'alert info' }, icon('events'), h('span', null, text)) });

function evPartTime(e) {
  const w = e.current || e.next;
  if (!w || e.schedule_type === 0) return evSchedule(e);
  if (e.occurence === 1440) return L('каждый день в {0}, {1}', evClock(w[0]), evDur(e.length));
  if (e.occurence === 10080) return L('каждую неделю: {0} в {1}, {2}', new Date(w[0] * 1000).toLocaleDateString(LOCALE, { weekday: 'long' }), evClock(w[0]), evDur(e.length));
  return L('по календарю: {0}', evRange(w));
}

function evPartNote(c, main) {
  if (c.part === 'core') return L('Ядро включает её само в своё время — только пока идёт «{0}».', main);
  if (c.part === 'script') return L('Этап, который включает скрипт ядра. Вручную — только если знаете зачем.');
  if (c.part === 'before') return L('Готовит «{0}» по своему календарю. Пока «{0}» держат включённым, панель её не пускает.', main);
  if (c.part === 'after') return L('Идёт после «{0}» по своему календарю.', main);
  return L('Свой календарь: ядро с «{0}» её не связывает. Панель может включить её вместе с ним.', main);
}

function evPartWarn(e) {
  const p = e.parent_name || '#' + e.parent;
  if (e.part === 'core') return L('Это часть «{0}»: ядро включает её само в её время, но только пока идёт «{0}». Включить можно и отдельно — пойдёт свою обычную длину.', p);
  if (e.part === 'script') return L('Это этап «{0}», его включает скрипт ядра. Ручное включение добавит существ и объекты этапа, но не логику скрипта.', p);
  return L('Это часть «{0}», но у неё свой календарь: ядро их не связывает. Панель выключает её вместе с «{0}» и не пускает, пока «{0}» держат выключенным.', p);
}

/* ---------- карточка события */

function evActionModal(e, mode, done) {
  const on = mode === 'keep_on';
  const fam = e.family || [];
  const core = fam.filter((c) => c.part === 'core');
  const during = fam.filter((c) => c.part === 'during' && c.ruled);
  formModal({
    title: on ? L('Держать включённым: {0}', e.name) : L('Держать выключенным: {0}', e.name),
    text: on ? L('Панель раз в минуту проверяет, идёт ли событие, и включает его снова — в том числе после перезапуска мира. Срок пустой — пока не вернёте расписание.')
      : L('Панель раз в минуту проверяет, не началось ли событие по расписанию, и выключает его. Срок пустой — пока не вернёте расписание.'),
    fields: [{ name: 'until', label: L('До какого времени'), type: 'datetime-local', hint: L('Можно оставить пустым.') },
      ...(on && core.length ? [evNote(L('Сами начнутся в своё время, пока идёт событие: {0}.', core.map((c) => `«${c.name}» — ${evPartTime(c)}`).join('; ')))] : []),
      ...(on ? during.map((c) => ({ name: 'part_' + c.entry, type: 'checkbox', value: false, label: L('Держать включённым и «{0}»', c.name) })) : []),
      ...(!on && fam.length ? [evNote(L('Части события панель тоже будет держать выключенными: {0}.', evNames(fam)))] : []),
      ...(on && e.conflict_list.length ? [{ name: 'stop_conflicts', type: 'checkbox', value: true,
        label: L('Остановить и держать выключенными мешающие события: {0}', e.conflict_list.map((c) => c.name).join(', ')) }] : []),
      ...(on && evMain(e) ? [{ name: 'announce', label: L('Объявить игрокам в чат (пусто — без объявления)'), value: L('Начался праздник «{0}»!', e.name) }] : [])],
    submit: on ? L('Держать включённым') : L('Держать выключенным'), danger: !on,
    onSubmit: async (v) => (await api('/api/event', { entry: e.entry, action: mode, until: v.until ? Math.floor(new Date(v.until).getTime() / 1000) : null,
      stop_conflicts: !!v.stop_conflicts, announce: v.announce || '', parts: during.filter((c) => v['part_' + c.entry]).map((c) => c.entry) })).data,
    onDone: done,
  });
}

/* «Включить/Выключить сейчас»: у события с расписанием это срок — панель держит его сама,
   даже если мир перезапустится, а потом возвращает расписание */
function evQuickModal(e, on, done) {
  const fam = e.family || [];
  const core = fam.filter((c) => c.part === 'core');
  const during = fam.filter((c) => c.part === 'during' && c.ruled && !evOn(c));
  const before = fam.filter((c) => c.part === 'before' && evOn(c));
  const running = fam.filter(evOn);
  const now = Date.now() / 1000;
  const ruled = e.ruled !== false;
  const cur = e.natural && e.current;
  const text = on
    ? (!ruled ? L('Событие начнётся сейчас. Своего расписания у него нет: оно идёт, пока его не выключат — вы или скрипт ядра.')
      : cur ? L('Событие снова пойдёт — до конца срока по расписанию, {0}.', fmtDT(cur[1]))
        : L('Событие пойдёт сейчас на свою обычную длину ({0}) — до {1}. Панель держит его весь срок, даже если мир перезапустится, а потом вернёт расписание.', evDur(e.length), fmtDT(now + e.length * 60)))
    : (!ruled ? L('Событие закончится сейчас.')
      : cur ? L('Событие выключится до конца своего срока по расписанию ({0}): панель не даст ему начаться снова. Потом всё пойдёт как обычно.', fmtDT(cur[1]))
        : L('Событие закончится сейчас, дальше — по расписанию{0}.', e.next ? L(': ближайшее {0}', evRange(e.next)) : ''));
  const fields = [];
  if (on && core.length) fields.push(evNote(L('Сами начнутся в своё время, пока идёт событие: {0}.', core.map((c) => `«${c.name}» — ${evPartTime(c)}`).join('; '))));
  if (on) for (const c of during) {
    fields.push({ name: 'part_' + c.entry, type: 'checkbox', value: false,
      label: L('Сразу включить и «{0}» (по календарю — {1})', c.name, c.next ? evRange(c.next) : evSchedule(c)) });
  }
  if (on && before.length) fields.push(evNote(L('Сейчас идёт подготовка — панель её выключит, раз событие уже начинается: {0}.', evNames(before))));
  if (!on && running.length) fields.push({ name: 'with_parts', type: 'checkbox', value: true, label: L('Выключить и части, которые сейчас идут: {0}', evNames(running)) });
  if (on && (e.conflict_list || []).some((c) => c.active)) {
    fields.push({ name: 'stop_conflicts', type: 'checkbox', value: true,
      label: L('Сначала остановить мешающие события: {0}', e.conflict_list.filter((c) => c.active).map((c) => c.name).join(', ')) });
  }
  if (on && evMain(e)) fields.push({ name: 'announce', label: L('Объявить игрокам в чат (пусто — без объявления)'), value: L('Начался праздник «{0}»!', e.name) });
  formModal({
    title: on ? L('Включить: {0}', e.name) : L('Выключить: {0}', e.name), text, fields,
    submit: on ? L('Включить') : L('Выключить'), danger: !on,
    onSubmit: async (v) => (await api('/api/event', { entry: e.entry, action: on ? 'start' : 'stop', stop_conflicts: !!v.stop_conflicts,
      announce: v.announce || '', parts: during.filter((c) => v['part_' + c.entry]).map((c) => c.entry), with_parts: v.with_parts !== false })).data,
    onDone: done,
  });
}

/* ---------- где проходит: зоны по существам и объектам события, точки на карте мира */

const evPlaceTitle = (p) => areaTitle(p.zone, p.zone_name) || (p.map in MAP_CONT ? MAP_CONT[p.map] : L('карта {0}', p.map));

function placesMapModal({ title, label, places, focus, note }) {
  const marks = places.flatMap((p) => p.points.map(([x, y, npc]) => ({ map: p.map, x, y, cls: npc ? 'npc' : 'obj',
    title: `${label} · ${evPlaceTitle(p)} · ${npc ? L('существо') : L('объект')}` })));
  const first = focus || places.find((p) => p.map in MAP_CONT);
  const open = focus ? { map: focus.map, zoneArea: focus.zone, x: focus.points[0][0], y: focus.points[0][1] } : { map: first ? first.map : 1 };
  const view = worldMapView({ marks, open, readonly: true, note });
  let close;
  const box = h('div', { class: 'drawer wm-drawer' },
    h('div', { class: 'drawer-h' }, h('div', { class: 'grow' }, h('h2', null, title),
      h('div', { class: 'sub' }, focus ? evPlaceTitle(focus) : L('{0} мест', places.length))),
    h('button', { class: 'btn ghost sm x', type: 'button', 'aria-label': L('Закрыть'), onclick: () => close() }, icon('x'))),
    h('div', { class: 'drawer-b' }, view.el));
  close = openOverlay(box);
}

function eventMapModal(e, places, focus) {
  placesMapModal({ title: L('Где проходит: {0}', e.name), label: e.name, places, focus,
    note: L('Точки — где стоят существа (зелёные) и объекты (жёлтые) события. Другой материк — выше, в строке «Мир ›».') });
}

/* Места списком: зона, материк, сколько там, подзоны и «На карте»; больше шести — под «Ещё» */
function placeRows(places, onMap) {
  const row = (p) => h('div', { class: 'ev-place' },
    h('div', { class: 'ev-place-h' },
      h('b', null, evPlaceTitle(p)),
      badge(p.map in MAP_CONT ? MAP_CONT[p.map] : L('подземелье или поле боя')),
      h('span', { class: 'muted small grow' }, [p.creatures ? L('существ: {0}', fmtN(p.creatures)) : null,
        p.objects ? L('объектов: {0}', fmtN(p.objects)) : null].filter(Boolean).join(' · ')),
      p.map in MAP_CONT && p.points.length ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => onMap(p) },
        icon('worldmap'), L('На карте')) : null),
    p.areas.length ? h('div', { class: 'chips' }, p.areas.map((a) => h('span', { class: 'chip static' }, areaTitle(a.area, a.area_name)))) : null);
  const top = places.slice(0, 6), rest = places.slice(6);
  return [h('div', { class: 'ev-places' }, top.map(row)),
    rest.length ? h('details', { class: 'ev-more' }, h('summary', null, L('Ещё {0} мест', rest.length)), h('div', { class: 'ev-places' }, rest.map(row))) : null];
}

function evPlacesCard(e, where) {
  const body = h('div', { class: 'card-b' }, h('p', { class: 'muted small' }, L('Ищу, где стоят существа и объекты события…')));
  const all = h('button', { class: 'btn sm', type: 'button', hidden: true }, icon('worldmap'), L('Все места на карте'));
  const box = card(L('Где проходит'), null, all, body);
  (async () => {
    const places = (await api('/api/event/places?entry=' + e.entry)).data;
    await mapsManifest().catch(() => null);                 // русские названия зон — из areas.json
    if (!places.length) {
      fill(body, h('p', { class: 'muted' }, e.schedule_type === 0
        ? L('Своих существ и объектов в мире у события нет — всё делает скрипт ядра.')
        : L('Своих существ и объектов в мире у события нет: оно меняет что-то другое — например, кто ждёт в подземелье.')));
      return;
    }
    const names = places.slice(0, 3).map(evPlaceTitle);
    fill(where, icon('worldmap'), h('span', null, names.join(', ') + (places.length > 3 ? L(' и ещё {0}', places.length - 3) : '')));
    const onMap = places.some((p) => p.map in MAP_CONT && p.points.length);
    all.hidden = !onMap;
    all.onclick = () => eventMapModal(e, places);
    fill(body, placeRows(places, (p) => eventMapModal(e, places, p)));
  })().catch((err) => fill(body, h('p', { class: 'warn-text small' }, err.message)));
  return box;
}

/* Карточка события. back — карточка, из которой сюда перешли (она остаётся открытой под этой):
   «‹ Назад» закрывает эту и обновляет ту. Переходы дальше (часть, главное, существо) — так же. */
function eventDrawer(entry, onChange, back) {
  const box = h('div', { class: 'drawer ev-drawer', role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'drawer-b' }, h('div', { class: 'empty' }, L('Загружаю…'))));
  let closing = false;
  const close = openOverlay(box, back ? back.refresh : null);
  const changed = () => { draw(); if (onChange) onChange(); };
  const draw = async () => {
    let e;
    try { e = trNames((await api('/api/event?entry=' + entry)).data); } catch (err) {
      fill(box, drawerBox(L('Событие №{0}', entry), null, close, back), h('div', { class: 'drawer-b' }, errorCard(err)));
      return;
    }
    const nav = { label: e.name, refresh: () => { if (!closing && box.isConnected) changed(); },
      closeAll: () => { closing = true; if (back) back.closeAll(); close(); } };
    const goEvent = (id) => eventDrawer(id, onChange, nav);
    const goNpc = (id) => creatureDrawer(id, nav);
    const now = Date.now() / 1000;
    const [stText, stKind] = evStatus(e);
    const cast = e.creatures.filter((c) => c.thumb).slice(0, 6);
    const where = h('div', { class: 'ev-where' });
    const placesCard = evPlacesCard(e, where);
    const hero = h('div', { class: `ev-hero ev-t-${e.theme}` },
      h('div', { class: 'ev-hero-ico' }, gicon(e.icon, 'xxl')),
      h('div', { class: 'ev-hero-t' },
        h('div', { class: 'row' }, badge(EV_CAT[e.cat] || e.cat), badge(stText, stKind)),
        h('h3', null, e.name), e.name_en && e.name_en !== e.name ? h('div', { class: 'ev-en' }, e.name_en) : null,
        e.about ? h('p', null, e.about) : null, where),
      cast.length ? h('div', { class: 'ev-cast' }, cast.map((c) => h('figure', { class: 'click', title: c.sub ? `${c.name} <${c.sub}>` : c.name,
        onclick: () => goNpc(c.entry) }, npcThumb(c.thumb, 'm'), h('figcaption', null, c.name)))) : null);

    const cnt = e.counts || {};
    const adds = [cnt.creatures ? L('существ: {0}', fmtN(cnt.creatures)) : null, cnt.objects ? L('объектов: {0}', fmtN(cnt.objects)) : null,
      cnt.quests ? L('заданий: {0}', fmtN(cnt.quests)) : null, cnt.changes ? L('меняет внешность: {0}', fmtN(cnt.changes)) : null].filter(Boolean);
    const removes = [cnt.creatures_off ? L('существ: {0}', fmtN(cnt.creatures_off)) : null, cnt.objects_off ? L('объектов: {0}', fmtN(cnt.objects_off)) : null].filter(Boolean);
    const info = card(L('Расписание и что даёт'), null, null, h('div', { class: 'card-b' }, facts([
      [L('Расписание'), evSchedule(e)],
      [L('Сейчас'), e.current ? `${L('идёт по расписанию')}: ${evRange(e.current)} · ${evLeft(e.current[1] - now)}` : L('по расписанию не идёт')],
      [L('Ближайшие'), e.upcoming.length ? h('div', { class: 'ev-dates' }, e.upcoming.filter((w) => w[1] > now).slice(0, 6).map((w) =>
        h('span', { class: 'chip static' }, evRange(w)))) : L('по расписанию не будет')],
      [L('Добавляет в мир'), adds.length ? adds.join(', ') : '—'],
      removes.length ? [L('Убирает из мира'), removes.join(', ')] : null,
      e.parent_name ? [L('Часть события'), h('a', { href: '#', onclick: (ev) => { ev.preventDefault(); goEvent(e.parent); } }, e.parent_name)] : null,
    ].filter(Boolean))));

    const warns = [];
    if (e.schedule_type === 0 && !e.parent) warns.push(L('Это событие ведёт скрипт ядра. Ручной запуск добавит его существ и объекты, но не саму логику (нападения, этапы).'));
    if (e.parent) warns.push(evPartWarn(e));
    for (const c of e.conflict_list) {
      warns.push(L('Делит существ и объекты с «{0}» ({1} шт.): если идут оба, то, что закончится первым, уберёт и общее.', c.name, fmtN(c.n))
        + (c.active ? L(' Оно сейчас идёт.') : ''));
    }
    const f = e.force;
    const world = e.active != null;
    const ctrl = card(L('Управление'), world ? null : L('мир не запущен'), null, h('div', { class: 'card-b stack tight' },
      warns.map((w) => h('div', { class: 'alert warning' }, icon('warn'), h('span', null, w))),
      h('div', { class: 'row' },
        world ? h('button', { class: 'btn pri', type: 'button', disabled: evOn(e) || null, onclick: () => evQuickModal(e, true, changed) }, icon('play'), L('Включить сейчас')) : null,
        world ? h('button', { class: 'btn dng', type: 'button', disabled: !evOn(e) || null, onclick: () => evQuickModal(e, false, changed) }, icon('pause'), L('Выключить сейчас')) : null,
        h('button', { class: 'btn', type: 'button', onclick: () => evActionModal(e, 'keep_on', changed) }, L('Держать включённым…')),
        h('button', { class: 'btn', type: 'button', onclick: () => evActionModal(e, 'keep_off', changed) }, L('Держать выключенным…')),
        f ? h('button', { class: 'btn', type: 'button', onclick: () => formModal({ title: L('Вернуть расписание: {0}', e.name),
          text: L('Панель перестанет держать событие и приведёт его к расписанию ядра.'), submit: L('Вернуть'),
          onSubmit: async () => (await api('/api/event', { entry: e.entry, action: 'auto' })).data, onDone: changed }) }, icon('refresh'), L('Вернуть расписание')) : null),
      e.guard ? h('p', { class: 'muted small' }, L('Время этого события панель возвращает к расписанию: его включали или выключали вручную, и ядро до перезапуска мира сдвинуло своё время. На ближайшей границе по расписанию панель всё поправит.')) : null,
      h('p', { class: 'muted small' }, world
        ? L('«Включить» и «Выключить» действуют на срок: событие идёт свою обычную длину или стоит до конца своего окна по расписанию — даже если мир перезапустится. Потом панель возвращает расписание. «Держать…» — до выбранного срока или пока не вернёте сами.')
        : L('Мир не запущен: «Держать…» панель применит, как только он поднимется.'))));

    const fam = e.family.length ? card(L('Части события'), L('{0} шт.', e.family.length), null, h('div', { class: 'card-b stack tight' },
      h('p', { class: 'muted small' }, L('Выключаете главное — панель выключает и идущие части. Включаете — части с пометкой «ядро включает само» начнутся в своё время, остальные можно включить сразу.')),
      h('div', { class: 'ev-parts' }, e.family.map((c) => {
        const [pt, pk] = EV_PART[c.part] || [c.part, null];
        return h('div', { class: `ev-part ev-t-${c.theme}` },
          gicon(c.icon, 'm'),
          h('div', { class: 'ev-part-t' },
            h('div', { class: 'ev-part-n' },
              h('a', { href: '#', onclick: (ev) => { ev.preventDefault(); goEvent(c.entry); } }, c.name), badge(pt, pk), evBadge(c)),
            h('small', { class: 'muted' }, evPartTime(c)),
            h('small', null, evPartNote(c, e.name))),
          world ? h('button', { class: 'btn sm', type: 'button', onclick: () => evQuickModal(c, !evOn(c), changed) },
            icon(evOn(c) ? 'pause' : 'play'), evOn(c) ? L('Выключить') : L('Включить')) : null);
      })))) : null;
    const quests = e.quests.length ? card(L('Задания события'), L('{0} · щёлкните — карточка задания', fmtN(e.quests.length)), null,
      h('div', { class: 'list scroll-box' }, e.quests.map((q) =>
        h('div', { class: 'li click', onclick: () => questDrawer(q.entry, nav) }, gicon('inv_misc_note_01', 's'), h('span', { class: 'grow' }, q.title),
          h('span', { class: 'muted small' }, L('с {0} ур.', q.min_level || 1)))))) : null;
    const npcs = e.creatures.length ? card(L('Кто появляется'), L('щёлкните — карточка существа'), null, h('div', { class: 'ev-npcs' }, e.creatures.map((c) =>
      h('button', { class: 'ev-npc click', type: 'button', onclick: () => goNpc(c.entry) }, npcThumb(c.thumb, 's'),
        h('span', { class: 'grow' }, h('b', null, c.name), c.sub ? h('span', { class: 'muted' }, ` <${c.sub}>`) : null),
        c.n > 1 ? h('span', { class: 'muted small' }, '×' + c.n) : null)))) : null;
    const core = e.core ? card(L('Что говорит ядро'), `.event ${e.entry}`, null, h('pre', { class: 'out ev-core' }, e.core)) : null;
    [[placesCard, 'ev-places'], [info, 'ev-info'], [ctrl, 'ev-ctrl'], [fam, 'ev-parts'], [npcs, 'ev-npcs'], [quests, 'ev-quests'], [core, 'ev-core']]
      .forEach(([c, k]) => foldCard(c, k));
    fill(box, drawerBox(e.name, L('событие №{0}', e.entry), close, back), h('div', { class: 'drawer-b' }, hero,
      h('div', { class: 'grid g2 ev-cols' }, h('div', { class: 'stack' }, placesCard, info, ctrl, fam), h('div', { class: 'stack' }, npcs, quests, core))));
  };
  draw();
}

/* ---------- карточка задания: что надо сделать, что дадут, кто выдаёт и принимает, что до и что после */

const QUEST_HOW = { done: L('сначала сдать'), active: L('сначала взять'), chain: L('предложат сразу после'), opens: L('откроется после') };

function questDrawer(entry, back) {
  const box = h('div', { class: 'drawer cr-drawer', role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'drawer-b' }, h('div', { class: 'empty' }, L('Загружаю…'))));
  let closing = false;
  const close = openOverlay(box, back ? back.refresh : null);
  (async () => {
    let d;
    try {
      [d] = await Promise.all([api('/api/quest?entry=' + entry).then((r) => trNames(r.data)),
        questMeta ? null : api('/api/quest/meta').then((r) => { questMeta = r.data; }).catch(() => null)]);
    } catch (err) {
      fill(box, drawerBox(L('Задание №{0}', entry), null, close, back), h('div', { class: 'drawer-b' }, errorCard(err)));
      return;
    }
    const nav = { label: d.title, refresh: () => {}, closeAll: () => { closing = true; if (back) back.closeAll(); close(); } };
    const goQuest = (id) => questDrawer(id, nav);
    const goNpc = (id) => creatureDrawer(id, nav);
    const npcRow = (n, extra) => h('div', { class: 'li click', onclick: () => goNpc(n.entry) }, npcThumb(n.thumb, 's'),
      h('span', { class: 'grow' }, h('b', null, n.name), n.subname ? h('span', { class: 'muted' }, ` <${n.subname}>`) : null), extra || null);
    const qRow = (q, note) => h('div', { class: 'li click', onclick: () => goQuest(q.entry) }, gicon('inv_misc_note_01', 's'),
      h('span', { class: 'grow' }, q.title), note ? badge(note, 'acc') : null, h('span', { class: 'muted small' }, L('ур. {0}', q.level > 0 ? q.level : q.min_level)));
    const lv = d.level;
    const head = h('div', { class: 'cr-hero' }, gicon('inv_misc_note_01', 'xl'),
      h('div', { class: 'grow stack tight' }, h('h3', null, d.title),
        h('div', { class: 'row' }, badge(L('ур. {0}', lv.quest > 0 ? lv.quest : lv.min), 'acc'), lv.min ? badge(L('взять с {0} ур.', lv.min)) : null,
          d.repeatable ? badge(L('можно повторять'), 'ok') : null, d.time_limit ? badge(L('на время: {0}', evDur(Math.round(d.time_limit / 60))), 'warn') : null,
          d.suggested > 1 ? badge(L('группа из {0}', d.suggested), 'warn') : null,
          ...d.events.map((ev) => h('button', { class: 'badge click ev-badge', type: 'button', onclick: () => eventDrawer(ev.entry, null, nav) }, L('событие «{0}»', ev.name))))));
    const goals = [];
    for (const k of d.kill) {
      goals.push(h('div', { class: 'li click', onclick: () => goNpc(k.creature.entry) }, npcThumb(k.creature.thumb, 's'),
        h('span', { class: 'grow' }, L('Убить: {0}', k.creature.name || '#' + k.creature.entry)), badge('×' + k.count)));
    }
    for (const c of d.collect) {
      goals.push(h('div', { class: 'li' }, itemChip(c.item, c.count > 1 ? h('span', { class: 'muted' }, '×' + c.count) : null),
        c.drop && c.drop.creature ? h('a', { href: '#', class: 'small', onclick: (ev) => { ev.preventDefault(); goNpc(c.drop.creature.entry); } },
          L('падает с «{0}»', c.drop.creature.name)) : null));
    }
    if (d.src_item && d.src_item.item) goals.push(h('div', { class: 'li' }, h('span', { class: 'muted small' }, L('Выдают с собой:')), itemChip(d.src_item.item)));
    if (d.trigger) goals.push(h('div', { class: 'li' }, h('span', null, L('Дойти до места (область №{0})', d.trigger))));
    if (d.req_money) goals.push(h('div', { class: 'li' }, h('span', { class: 'grow' }, L('Принести денег:')), coins(d.req_money)));
    const r = d.rewards;
    const rewItems = r.items.filter((x) => x.item), choice = r.choice.filter((x) => x.item);
    const reward = card(L('Награда'), null, null, h('div', { class: 'card-b stack tight' },
      choice.length ? h('div', null, h('div', { class: 'small muted' }, L('На выбор одно из:')),
        h('div', { class: 'reward-grid' }, choice.map((x) => itemChip(x.item, x.count > 1 ? h('span', { class: 'muted' }, '×' + x.count) : null)))) : null,
      rewItems.length ? h('div', null, h('div', { class: 'small muted' }, L('Дадут всё это:')),
        h('div', { class: 'reward-grid' }, rewItems.map((x) => itemChip(x.item, x.count > 1 ? h('span', { class: 'muted' }, '×' + x.count) : null)))) : null,
      facts([r.money ? [L('Деньги'), coins(r.money)] : null, r.xp ? [L('Опыт'), L('до {0}', fmtN(r.xp))] : null,
        ...r.rep.map((x) => [L('Репутация'), `${d.faction_names[x.faction] || '#' + x.faction} ${x.value > 0 ? '+' : ''}${x.value}`]),
        r.spell ? [L('Заклинание'), `№${r.spell}`] : null].filter(Boolean)),
      !choice.length && !rewItems.length && !r.money && !r.xp && !r.rep.length ? h('p', { class: 'muted' }, L('Награды нет.')) : null));
    const who = card(L('Кто выдаёт и принимает'), null, null, h('div', { class: 'card-b stack tight' },
      h('div', { class: 'small muted' }, L('Выдаёт')),
      d.givers.length || d.item_givers.length || d.obj_givers.length ? h('div', { class: 'list' },
        d.givers.map((n) => npcRow(n)), d.item_givers.map((it) => h('div', { class: 'li' }, itemChip(it), h('span', { class: 'muted small' }, L('начинает задание')))),
        d.obj_givers.map((o) => h('div', { class: 'li' }, gicon('inv_misc_note_02', 's'), h('span', { class: 'grow' }, o.name), h('span', { class: 'muted small' }, L('предмет в мире'))))) : h('p', { class: 'muted small' }, '—'),
      h('div', { class: 'small muted' }, L('Принимает')),
      d.enders.length || d.obj_enders.length ? h('div', { class: 'list' }, d.enders.map((n) => npcRow(n)),
        d.obj_enders.map((o) => h('div', { class: 'li' }, gicon('inv_misc_note_02', 's'), h('span', { class: 'grow' }, o.name), h('span', { class: 'muted small' }, L('предмет в мире'))))) : h('p', { class: 'muted small' }, '—')));
    const ch = d.chain;
    const chain = ch.before.length || ch.after.length || ch.exclusive.length ? card(L('Цепочка заданий'), null, null, h('div', { class: 'card-b stack tight' },
      ch.before.length ? [h('div', { class: 'small muted' }, L('Чтобы его взять')), h('div', { class: 'list' }, ch.before.map((q) => qRow(q, QUEST_HOW[q.how])))] : null,
      ch.after.length ? [h('div', { class: 'small muted' }, L('После него')), h('div', { class: 'list' }, ch.after.map((q) => qRow(q, QUEST_HOW[q.how])))] : null,
      ch.exclusive.length ? [h('div', { class: 'small muted' }, L('Можно сделать только одно из них и это')), h('div', { class: 'list' }, ch.exclusive.map((q) => qRow(q)))] : null))
      : card(L('Цепочка заданий'), null, null, h('div', { class: 'card-b' }, h('p', { class: 'muted' }, L('Задание само по себе: до него ничего не нужно, после него ничего не открывается.'))));
    const goalCard = card(L('Что сделать'), null, null, h('div', { class: 'card-b stack tight' },
      d.objectives ? h('div', { class: 'qtext' }, wowText(d.objectives)) : null,
      goals.length ? h('div', { class: 'list' }, goals) : h('p', { class: 'muted small' }, L('Поговорить с тем, кто принимает задание.'))));
    const story = d.details || d.objectives ? card(L('Как в игре'), L('текст задания'), null, h('div', { class: 'card-b' }, questPreview(d))) : null;
    [[goalCard, 'q-goal'], [reward, 'q-reward'], [who, 'q-who'], [chain, 'q-chain'], [story, 'q-story']].forEach(([c, k]) => foldCard(c, k));
    fill(box, drawerBox(d.title, L('задание №{0}', d.entry), () => { if (!closing) close(); }, back), h('div', { class: 'drawer-b' }, head,
      h('div', { class: 'grid g2 ev-cols' }, h('div', { class: 'stack' }, goalCard, reward, chain), h('div', { class: 'stack' }, who, story))));
  })();
}

/* ---------- карточка существа: что это, в каких событиях, какие задания даёт, где стоит */

const REACTION = { hostile: [L('враждебен'), 'bad'], friendly: [L('дружелюбен'), 'ok'], neutral: [L('нейтрален'), 'warn'] };

function creatureDrawer(entry, back) {
  const box = h('div', { class: 'drawer cr-drawer', role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'drawer-b' }, h('div', { class: 'empty' }, L('Загружаю…'))));
  let closing = false;
  const close = openOverlay(box, back ? back.refresh : null);
  (async () => {
    let c;
    try { c = trNames((await api('/api/creature?entry=' + entry)).data); } catch (err) {
      fill(box, drawerBox(L('Существо №{0}', entry), null, close, back), h('div', { class: 'drawer-b' }, errorCard(err)));
      return;
    }
    await mapsManifest().catch(() => null);
    const nav = { label: c.name, refresh: () => {}, closeAll: () => { closing = true; if (back) back.closeAll(); close(); } };
    const opt = (list, v) => (list.find(([k]) => k === v) || [v, String(v)])[1];
    const lvl = c.minlevel === c.maxlevel ? String(c.minlevel) : `${c.minlevel}–${c.maxlevel}`;
    const hp = c.health && c.health[0] != null
      ? (c.health[1] == null || c.health[0] === c.health[1] ? fmtN(c.health[0]) : `${fmtN(c.health[0])}–${fmtN(c.health[1])}`) : null;
    const react = (k) => { const [t, kind] = REACTION[k] || ['—', null]; return badge(t, kind); };
    const roles = c.roles.map((r) => Lsrv(r));
    const hero = h('div', { class: 'cr-hero' }, npcThumb(c.thumb, 'l'),
      h('div', { class: 'grow stack tight' },
        h('h3', null, c.name, c.subname ? h('span', { class: 'muted' }, ` <${c.subname}>`) : null),
        h('div', { class: 'row' }, badge(L('ур. {0}', lvl), 'acc'), c.rank ? badge(opt(NPC_RANKS, c.rank), 'warn') : null,
          badge(opt(NPC_TYPES, c.type)), ...roles.map((r) => badge(r, 'ok'))),
        h('div', { class: 'row small cr-react' }, h('span', { class: 'muted' }, L('Альянсу:')), react(c.faction.alliance),
          h('span', { class: 'muted' }, L('Орде:')), react(c.faction.horde))));
    const stats = card(L('Характеристики'), null, null, h('div', { class: 'card-b' }, facts([
      [L('Уровень'), lvl],
      [L('Здоровье'), hp || L('×{0} к обычному для уровня', c.health_mult)],
      [L('Тип'), opt(NPC_TYPES, c.type)], [L('Ранг'), opt(NPC_RANKS, c.rank)], [L('Класс'), opt(NPC_CLASSES, c.unitclass)],
      [L('Фракция'), `${c.faction.name || '—'} (№${c.faction.id})`],
      [L('Кто это'), roles.length ? roles.join(', ') : c.civilian ? L('мирный житель') : L('обычное существо')],
      [L('Добыча'), c.loot ? L('есть') : L('нет')],
      [L('В мире'), c.spawns ? L('{0} шт.', fmtN(c.spawns)) : L('нигде не стоит — его вызывает скрипт или событие')],
    ])));
    const events = c.events.length ? card(L('В событиях'), null, null, h('div', { class: 'list' }, c.events.map((ev) =>
      h('div', { class: 'li click', onclick: () => eventDrawer(ev.entry, null, nav) }, evIcon(ev, 's'), h('span', { class: 'grow' }, ev.name),
        h('span', { class: 'muted small' }, ev.off ? L('на время события убирают: {0}', fmtN(ev.n)) : L('появляется: {0}', fmtN(ev.n))))))) : null;
    const quests = c.quests.length ? card(L('Задания'), fmtN(c.quests.length), null, h('div', { class: 'list scroll-box' }, c.quests.map((q) =>
      h('div', { class: 'li click', onclick: () => questDrawer(q.entry, nav) }, gicon('inv_misc_note_01', 's'),
        h('span', { class: 'grow' }, q.title, q.event_name ? h('a', { href: '#', class: 'small cr-qev', onclick: (ev) => { ev.preventDefault(); ev.stopPropagation(); eventDrawer(q.event, null, nav); } },
          ' · ' + L('только в «{0}»', q.event_name)) : null),
        q.gives ? badge(L('даёт'), 'ok') : null, q.takes ? badge(L('принимает'), 'acc') : null,
        h('span', { class: 'muted small' }, L('с {0} ур.', q.min_level || 1)))))) : null;
    const onMap = c.places.some((p) => p.map in MAP_CONT && p.points.length);
    const mapOf = (focus) => placesMapModal({ title: L('Где стоит: {0}', c.name), label: c.name, places: c.places, focus,
      note: L('Зелёные точки — где стоит это существо. Другой материк — выше, в строке «Мир ›».') });
    const where = card(L('Где стоит'), c.spawns ? L('{0} мест', fmtN(c.spawns)) : null,
      onMap ? h('button', { class: 'btn sm', type: 'button', onclick: () => mapOf(null) }, icon('worldmap'), L('Все места на карте')) : null,
      h('div', { class: 'card-b' }, c.places.length ? placeRows(c.places, mapOf)
        : h('p', { class: 'muted' }, L('В мире его нет: появляется по скрипту, в событии или в подземелье по вызову.'))));
    [[stats, 'cr-stats'], [events, 'cr-events'], [quests, 'cr-quests'], [where, 'cr-places']].forEach(([k, key]) => foldCard(k, key));
    fill(box, drawerBox(c.name, L('существо №{0}', c.entry), () => { if (!closing) close(); }, back), h('div', { class: 'drawer-b' }, hero,
      h('div', { class: 'grid g2 ev-cols' }, h('div', { class: 'stack' }, stats, events), h('div', { class: 'stack' }, where, quests))));
  })();
}

PAGES.events = {
  title: L('События и праздники'), sub: L('Календарь праздников, ярмарок и событий мира. Любое можно включить или выключить вручную.'),
  async render(el) {
    const today = new Date();
    const st = { year: today.getFullYear(), month: today.getMonth(), view: pref.get('ev-view', 'month'), data: null,
      cats: new Set((pref.get('ev-cats', 'holiday,fair,pvp,world')).split(',').filter(Boolean)) };
    const box = h('div', { class: 'stack' });
    const open = (entry) => eventDrawer(entry, () => load().catch(() => {}));
    const load = async () => {
      st.data = trNames((await api('/api/events?year=' + st.year)).data);
      draw();
    };
    // со «включить» у события с конфликтами — сразу в карточку: там видно, с чем оно спорит
    const quick = async (e, on) => {
      if (on && e.conflicts.length) { open(e.entry); return; }
      let full = e;
      if (e.children.length) {
        try { full = trNames((await api('/api/event?entry=' + e.entry)).data); } catch (err) { toast(err.message, true); return; }
      }
      evQuickModal(full, on, () => load().catch(() => {}));
    };
    const move = (dm) => {
      const d = new Date(st.year, st.month + dm, 1);
      const yearChanged = d.getFullYear() !== st.year;
      st.year = d.getFullYear(); st.month = d.getMonth();
      if (yearChanged) load().catch((err) => toast(err.message, true)); else draw();
    };
    const draw = () => {
      const d = st.data, now = d.now;
      const all = d.events;
      const shown = all.filter((e) => st.cats.has(e.cat) && (st.cats.has('service') || !e.parent));
      const nowList = all.filter((e) => evMain(e) && evOn(e));
      const soon = all.filter((e) => evMain(e) && !evOn(e) && e.next && e.next[0] - now < 120 * DAY && e.cat !== 'world' && e.occurence >= 10080)
        .sort((a, b) => a.next[0] - b.next[0]).slice(0, 6);
      const nextHoliday = all.filter((e) => e.cat === 'holiday' && e.next).sort((a, b) => a.next[0] - b.next[0])[0];
      const strip = card(L('Сейчас идёт'), d.world ? null : L('мир не запущен — по расписанию'), null, h('div', { class: 'card-b' },
        nowList.length ? h('div', { class: 'ev-nows' }, nowList.map((e) => evNowCard(e, now, open)))
          : h('p', { class: 'muted' }, L('Сейчас ни праздников, ни ярмарок.'), nextHoliday ? ' ' + L('Ближайший праздник — «{0}», {1}.', nextHoliday.name, evIn(nextHoliday.next[0] - now)) : '')));
      const soonCard = soon.length ? card(L('Скоро'), L('ближайшие 120 дней'), null, h('div', { class: 'list' }, soon.map((e) =>
        h('div', { class: 'li click ev-soon', onclick: () => open(e.entry) }, evIcon(e, 'm'),
          h('span', { class: 'grow' }, h('b', null, e.name), h('span', { class: 'muted small' }, evRange(e.next))),
          badge(evIn(e.next[0] - now), 'acc'))))) : null;

      const views = seg([['month', L('Месяц')], ['year', L('Год')], ['list', L('Все события')]], st.view, (k) => { st.view = k; pref.set('ev-view', k); draw(); });
      const chips = h('div', { class: 'chips' }, EV_CATS.filter(([c]) => all.some((e) => e.cat === c)).map(([c, title]) =>
        h('button', { class: 'chip' + (st.cats.has(c) ? ' on' : ''), type: 'button', onclick: () => {
          if (st.cats.has(c)) st.cats.delete(c); else st.cats.add(c);
          pref.set('ev-cats', [...st.cats].join(',')); draw();
        } }, title)));
      const monthName = new Date(st.year, st.month, 1).toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' });
      const nav = st.view === 'list' ? null : h('div', { class: 'row ev-nav' },
        h('button', { class: 'btn sm', type: 'button', 'aria-label': L('Назад'), onclick: () => move(st.view === 'year' ? -12 : -1) }, '‹'),
        monthButton(st.view === 'year' ? String(st.year) : monthName, (el) => monthPicker(el, { year: st.year, month: st.month, yearsOnly: st.view === 'year' },
          (y, m) => { const yc = y !== st.year; st.year = y; if (m != null) st.month = m; if (yc) load().catch((err) => toast(err.message, true)); else draw(); }), 'ev-period'),
        h('button', { class: 'btn sm', type: 'button', 'aria-label': L('Вперёд'), onclick: () => move(st.view === 'year' ? 12 : 1) }, '›'),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { const yc = today.getFullYear() !== st.year; st.year = today.getFullYear(); st.month = today.getMonth(); if (yc) load(); else draw(); } }, L('Сегодня')));
      const body = st.view === 'list' ? evListView(shown, open, quick, now)
        : st.view === 'year' ? evYearView(st, shown, open, now) : evMonthView(st, shown, open);
      const calCard = card(null, null, null, h('div', { class: 'card-b stack tight' }, h('div', { class: 'row' }, views, nav, h('span', { class: 'spacer' }), chips), body));
      fill(box, d.world ? null : h('div', { class: 'alert warning' }, icon('warn'), h('span', null, L('Мир не запущен: показываю расписание. Включать и выключать события можно, когда он работает.'))),
        h('div', { class: 'grid ev-top' }, strip, soonCard), calCard);
    };
    setTools(refreshBtn(() => load().catch((e) => toast(e.message, true))));
    el.replaceChildren(box);
    await load();
    every(120000, () => load().catch(() => {}));
  },
};

PAGES.settings = {
  title: L('Настройки'), sub: L('Язык, оформление и музыка. Хранятся в этом браузере.'),
  async render(el) { el.replaceChildren(settingsView(false)); },
};

boot();
