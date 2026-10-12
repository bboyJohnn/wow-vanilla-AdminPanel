'use strict';
/* Ставит язык и оформление ещё до отрисовки страницы — иначе при каждом открытии панель
   на миг мигала бы другим стилем. Встроенные скрипты CSP запрещает, поэтому это отдельный
   маленький файл без defer. Всё меняется на странице «Настройки».

   Язык: выбранный в «Настройках», иначе первый подходящий из языков браузера, иначе английский.
   Русский — язык исходного текста, словарь ему не нужен; для остальных подключается
   static/i18n/<код>.js — обычным <script> через document.write, чтобы он успел до app.js. */
(function () {
  var V = '2';    // версия файлов — та же, что ?v= в index.html
  var LANGS = [
    ['ru', 'Русский', 'ru-RU'], ['en', 'English', 'en-GB'], ['de', 'Deutsch', 'de-DE'],
    ['fr', 'Français', 'fr-FR'], ['es', 'Español', 'es-ES'], ['pt', 'Português', 'pt-BR'],
    ['pl', 'Polski', 'pl-PL'], ['ja', '日本語', 'ja-JP'], ['zh', '中文（简体）', 'zh-CN']];
  window.PANEL_LANGS = LANGS;

  var d = document.documentElement;
  var get = function (k) { try { return localStorage.getItem('wowpanel-' + k); } catch (e) { return null; } };
  var known = function (c) { for (var i = 0; i < LANGS.length; i++) if (LANGS[i][0] === c) return true; return false; };

  var lang = get('lang');
  if (!known(lang)) {
    lang = 'en';
    var wish = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
    for (var i = 0; i < wish.length; i++) {
      var c = String(wish[i]).slice(0, 2).toLowerCase();
      if (known(c)) { lang = c; break; }
    }
  }
  d.lang = lang;
  if (lang !== 'ru') document.write('<script src="/static/i18n/' + lang + '.js?v=' + V + '"><\/script>');

  var bgs = ['portal', 'gryphon', 'ironforge', 'nightelves'];
  d.setAttribute('data-style', get('style') === 'plain' ? 'plain' : 'wow');
  d.setAttribute('data-bg', bgs.indexOf(get('bg')) >= 0 ? get('bg') : 'portal');
  var t = get('theme');
  if (t === 'light' || t === 'dark') d.setAttribute('data-theme', t);
})();
