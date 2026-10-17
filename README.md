<h1 align="center">⚔️ WoW Vanilla Admin Panel</h1>

<p align="center">
  <b>A web control panel for a World of Warcraft 1.12.1 server on <a href="https://github.com/cmangos/mangos-classic">CMaNGOS Classic</a>.</b><br>
  Manage players, the world, events and your own content from the browser — without the console and without SQL.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/World%20of%20Warcraft-1.12.1-c8a04b?style=for-the-badge" alt="World of Warcraft 1.12.1">
  <img src="https://img.shields.io/badge/CMaNGOS-Classic-8b1a1a?style=for-the-badge" alt="CMaNGOS Classic">
  <img src="https://img.shields.io/badge/Python-3.10%2B-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python 3.10+">
  <img src="https://img.shields.io/badge/MariaDB%20%2F%20MySQL-003545?style=for-the-badge&logo=mariadb&logoColor=white" alt="MariaDB / MySQL">
  <br>
  <img src="https://img.shields.io/badge/Linux-systemd-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Linux + systemd">
  <img src="https://img.shields.io/badge/languages-9-2ea043?style=for-the-badge" alt="9 languages">
  <img src="https://img.shields.io/badge/Docker-not%20required-555555?style=for-the-badge&logo=docker&logoColor=white" alt="Docker not required">
  <img src="https://img.shields.io/github/last-commit/bboyJohnn/wow-vanilla-AdminPanel?style=for-the-badge&color=c8a04b" alt="Last commit">
</p>

<p align="center">
  <a href="#-features">Features</a> •
  <a href="#-screenshots">Screenshots</a> •
  <a href="#-quick-start">Quick start</a> •
  <a href="#-installation-step-by-step">Installation</a> •
  <a href="#-where-everything-is-configured">Configuration</a> •
  <a href="#-troubleshooting">Troubleshooting</a>
</p>

<p align="center">
  <img src="docs/screenshots/overview.webp" alt="Overview page of the panel" width="100%">
</p>

<p align="center"><sub>Screenshots show demo data. Map pictures come from your own game client, in its language.</sub></p>

---

## ✨ Why this panel

<table>
  <tr>
    <td width="33%" valign="top">
      <h3>🧩 One process, nothing extra</h3>
      One Python file next to your <code>mangosd</code>. No Docker, no bots, no extra scripts — just your CMaNGOS
      server, its database and Python.
    </td>
    <td width="33%" valign="top">
      <h3>🛡️ Commands go through the core</h3>
      Everything the server can do itself is sent as a GM command over SOAP, exactly as if you typed it in the
      console. Every action is written to an audit log.
    </td>
    <td width="33%" valign="top">
      <h3>🎨 Looks like the game</h3>
      Character sheets with an equipment doll, item icons and tooltips, the game's fonts and maps, themed event
      cards — or a plain light/dark style.
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h3>🗺️ Real world map</h3>
      Zoom with the wheel from the world down to a zone, or switch to a top-down view made of the game's
      minimaps. Click a spot — the panel finds the ground height and teleports a character there.
    </td>
    <td valign="top">
      <h3>🎃 Events under control</h3>
      A calendar of all holidays, fairs and battleground weekends with the exact schedule of the core. Turn any
      event on or off, the panel keeps its timing right.
    </td>
    <td valign="top">
      <h3>🌍 9 languages</h3>
      English, Deutsch, Français, Español, Português, Polski, 日本語, 中文 and Русский — the whole interface, including
      event names sent by the server.
    </td>
  </tr>
</table>

---

## 🧭 Features

| Section | What you can do |
|---|---|
| 📊 **Overview** | Who is online, accounts and characters, world uptime, memory / CPU / disk, process status, alerts, online chart, recent logins with countries. |
| 👤 **Accounts** | Search, create, change password, GM level, lock to IP, ban, delete (through the core), login history, calendar and statistics per account. |
| 🛡️ **Characters** | A character sheet like in the game: equipment doll with item icons and tooltips, bags, talents, reputations, skills, pets, quests, mail, play sessions. Teleport, send mail / items / money, level, kick, mute, revive, repair, rename on next login, reset talents / spells / stats, restore a deleted character, remove and give back a single item. |
| 🗺️ **World map** | World → continent → zone → click a spot (or type coordinates) and teleport a character there, online or offline. Wheel zoom towards the cursor, drag, pinch on a phone. **Top-down view** made of the client's minimaps, like on wow.tools. |
| 🎃 **Events and holidays** | Calendar (month, year, all events as tiles) of every `game_event`: holidays, Darkmoon Faire, battleground weekends, invasions. Themed card for each event: next dates, where it takes place, who appears, its quests and parts. Turn on / off now or keep on / off until a date; conflicting events are shown. |
| 🧌 **Creature and quest cards** | Click any creature: level, health, faction and how it treats Alliance and Horde, events, quests, where it stands on the map. Click a quest: what to do, rewards, who gives and takes it, which quest comes before and which after. |
| ⚒️ **Items** | Create your own items: stats, resistances, "on equip" spells, any look from the game. |
| 🧙 **Custom NPCs** | Your own NPCs and mobs based on any creature look: name, level, faction, rank, size, pose, weapons, dialog text, lines they say when they see a player, aggro or die. Place them with a click on the map or next to a character. |
| 📜 **Custom quests** | Talk to / deliver an item / kill / collect / explore a place; who gives it and who takes it (a game NPC, your NPC or an item), texts, rewards, requirements, a live preview of the quest window. **Apply now** reloads quests without a restart. |
| 🚫 **Moderation** | Bans of accounts, IPs and characters. |
| 📈 **Statistics** | Factions, classes and races, top players, economy, guilds, logins and countries, when players play, stability of the world. |
| ⚙️ **Server** | Restart now, when nobody is online or on a schedule (with a countdown), maintenance mode, player limit, announcements, message of the day, realm name, processes, and ~50 safe `mangosd.conf` settings (rates, skills, cross-faction, creatures…) with automatic backups. |
| 🤖 **Bots** | Settings of the playerbots module, if your core is built with it (the page is hidden otherwise). |
| 🧾 **Logs · Console · Audit log** | The core's log files with filter and auto-refresh; any GM command with a searchable command reference; every action done in the panel. |

---

## 📸 Screenshots

<table>
  <tr>
    <td width="50%" align="center"><img src="docs/screenshots/character.webp" alt="Character sheet"><br><b>Character sheet</b> — equipment, bags, talents, sessions, actions</td>
    <td width="50%" align="center"><img src="docs/screenshots/events.webp" alt="Events calendar"><br><b>Events and holidays</b> — calendar with the core's real schedule</td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/event-card.webp" alt="Event card"><br><b>Event card</b> — where it takes place, who appears, parts, control</td>
    <td align="center"><img src="docs/screenshots/creature.webp" alt="Creature card"><br><b>Creature card</b> — stats, faction, events, quests, places</td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/world-map.webp" alt="World map"><br><b>World map</b> — click a spot and teleport a character there</td>
    <td align="center"><img src="docs/screenshots/top-down-view.webp" alt="Top-down view"><br><b>Top-down view</b> — the game's minimaps, zoomable</td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/quest.webp" alt="Quest card"><br><b>Quest card</b> — rewards, who gives it, quest chain</td>
    <td align="center"><img src="docs/screenshots/statistics.webp" alt="Statistics"><br><b>Statistics</b> — online, when they play, factions, economy</td>
  </tr>
  <tr>
    <td colspan="2" align="center"><img src="docs/screenshots/server.webp" alt="Server page" width="70%"><br><b>Server</b> — restarts with countdown and schedule, access, messages, realm, services, <code>mangosd.conf</code></td>
  </tr>
</table>

---

## 🧱 How it fits together

```mermaid
flowchart LR
    B["🌐 Your browser"] -- "HTTPS (nginx) or SSH tunnel" --> P["⚔️ Panel<br/>panel.py · aiohttp<br/>127.0.0.1:8090"]
    P -- "GM commands over SOAP" --> W["🗡️ mangosd<br/>world server"]
    P -- "SQL" --> D[("🗄️ MariaDB / MySQL<br/>realmd · characters · world")]
    P -- "reads" --> F["📁 mangosd.conf · dbc/ · maps/ · logs"]
    W --- D
```

The panel runs on the **same machine** as `mangosd`: it reads `mangosd.conf`, the DBC and map files from the
server's `DataDir` and the core's log files.

---

## ✅ Requirements

| What | Notes |
|---|---|
| **CMaNGOS Classic** (1.12.1) server that already works | Tested with core commit `20d2885` (December 2025) and classic-db. Other cores (vMaNGOS, AzerothCore, TrinityCore) have different databases and are **not** supported. |
| **Linux** | The panel reads `/proc` to see the server processes. Any distribution; the commands below are for Debian / Ubuntu. |
| **The same machine as `mangosd`** | The panel reads `mangosd.conf`, the DBC and map files from the server's `DataDir`, and the core's log files. |
| **MariaDB or MySQL** | The one your server already uses. The panel connects with the core's own database user by default. |
| **Python 3.10+** | With two packages: `aiohttp` and `PyMySQL` (installed below into a virtual environment). |
| **SOAP enabled in the core** | The panel sends commands to the world server through SOAP (step 4). |
| A WoW 1.12.1 game client *(optional)* | Only to build the fonts, music, world map pictures and the top-down view (step 11). |

> [!NOTE]
> The examples below assume:
> - the server runs as the Linux user **`wow`**;
> - the server is installed in **`/home/wow/cmangos/run`** (with `bin/mangosd`, `bin/realmd`, `etc/mangosd.conf`, `etc/realmd.conf`);
> - the panel goes to **`/opt/wow-panel`**.
>
> Replace these with your own paths and user everywhere.

---

## 🚀 Quick start

For those who have done this before. Every step is explained in detail in the next section.

```bash
# 1. get the panel and its packages
sudo apt install -y git python3 python3-venv
sudo git clone https://github.com/bboyJohnn/wow-vanilla-AdminPanel.git /opt/wow-panel
sudo chown -R wow:wow /opt/wow-panel
sudo -u wow python3 -m venv /opt/wow-panel/venv
sudo -u wow /opt/wow-panel/venv/bin/pip install -r /opt/wow-panel/requirements.txt

# 2. mangosd.conf: SOAP.Enabled = 1, SOAP.IP = 127.0.0.1 — restart the world
# 3. mangosd console: account create WEBPANEL <password> / account set gmlevel WEBPANEL 3

# 4. settings and the panel password
cd /opt/wow-panel
sudo -u wow cp .env.example .env && sudo -u wow chmod 600 .env
sudo -u wow nano .env                          # WOW_MANGOSD_CONF, SOAP_USER, SOAP_PASS
sudo -u wow venv/bin/python tools/passwd.py
sudo -u wow venv/bin/python panel.py --check   # everything must be "ok" or "warn"

# 5. run it as a service
sudo cp deploy/wow-panel.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now wow-panel

# 6. on your computer: open http://127.0.0.1:8090 through a tunnel
ssh -N -L 8090:127.0.0.1:8090 you@your-server
```

---

## 📦 Installation, step by step

> [!TIP]
> Run the commands one by one and look at the result of each before going on. Every step ends with a way to
> check that it worked.

### Step 1. Look at your server

Make sure you know where things are:

```bash
ls /home/wow/cmangos/run/bin
```

```bash
ls /home/wow/cmangos/run/etc
```

```bash
grep -E '^(DataDir|LogsDir|RealmID|Console\.Enable|SOAP\.)' /home/wow/cmangos/run/etc/mangosd.conf
```

✔️ **Check:** `bin/` has `mangosd` and `realmd`, `etc/` has `mangosd.conf`. `DataDir` must point to the folder
with `dbc/` and `maps/` (the files you extracted from the client for the core).

### Step 2. Install Python and git

```bash
sudo apt update
```

```bash
sudo apt install -y git python3 python3-venv
```

Check the version — it must be 3.10 or newer:

```bash
python3 --version
```

✔️ **Check:** `Python 3.10.x` or higher.

### Step 3. Download the panel and install its packages

```bash
sudo git clone https://github.com/bboyJohnn/wow-vanilla-AdminPanel.git /opt/wow-panel
```

```bash
sudo chown -R wow:wow /opt/wow-panel
```

```bash
sudo -u wow python3 -m venv /opt/wow-panel/venv
```

```bash
sudo -u wow /opt/wow-panel/venv/bin/pip install -r /opt/wow-panel/requirements.txt
```

✔️ **Check:** pip ends with `Successfully installed aiohttp … PyMySQL …`.

> [!NOTE]
> No git? Download the ZIP from GitHub (**Code → Download ZIP**), unpack it to `/opt/wow-panel` and continue the same way.

### Step 4. Enable SOAP in `mangosd.conf`

The panel talks to the world server through SOAP. Open `/home/wow/cmangos/run/etc/mangosd.conf` and set:

```ini
SOAP.Enabled = 1
SOAP.IP = 127.0.0.1
SOAP.Port = 7878
```

Restart the world server so it picks this up (type `server restart 10` in its console, or restart it the way
you usually do).

> [!WARNING]
> Keep `SOAP.IP = 127.0.0.1` — SOAP must never be reachable from the internet.

✔️ **Check:** after the restart `ss -ltn | grep 7878` shows `127.0.0.1:7878`.

### Step 5. Create the account the panel works through

In the **mangosd console** (where you type server commands):

```
account create WEBPANEL YourStrongPassword
```

```
account set gmlevel WEBPANEL 3
```

The panel logs in to SOAP with this account, so it needs GM level 3. Optionally forbid playing on it —
lock it to `127.0.0.1` (SOAP still works, the game client cannot log in from anywhere else):

```bash
sudo mysql -e "UPDATE classicrealmd.account SET locked = 1, lockedIp = '127.0.0.1' WHERE username = 'WEBPANEL';"
```

> [!NOTE]
> `sudo mysql` works with MariaDB on Debian / Ubuntu; elsewhere use `mysql -u root -p`. Change `classicrealmd`
> if your login database has another name.

### Step 6. Write the settings file `.env`

```bash
cd /opt/wow-panel
```

```bash
sudo -u wow cp .env.example .env
```

```bash
sudo -u wow chmod 600 .env
```

```bash
sudo -u wow nano .env
```

Fill in only the **REQUIRED** part:

```ini
WOW_MANGOSD_CONF=/home/wow/cmangos/run/etc/mangosd.conf
SOAP_USER=WEBPANEL
SOAP_PASS=YourStrongPassword
```

Everything else — database connection, SOAP port, realm id, `DataDir`, `LogsDir` — the panel reads from
`mangosd.conf` itself. Save the file (`Ctrl+O`, `Enter`, `Ctrl+X` in nano).

Now set the password you will type to open the panel. It is stored only as a hash:

```bash
sudo -u wow venv/bin/python tools/passwd.py
```

✔️ **Check:** `.env` now has `PANEL_PASSWORD_HASH=` and `PANEL_SECRET=` filled in.

### Step 7. Check the setup

```bash
sudo -u wow venv/bin/python panel.py --check
```

You get a list like this:

```
  ok   mangosd.conf               /home/wow/cmangos/run/etc/mangosd.conf
  ok   DBC files (dbc/)           /home/wow/cmangos/data/dbc
  ok   Map files (maps/)          /home/wow/cmangos/data/maps — needed for the world map teleport
  ok   Log: server                /home/wow/cmangos/run/bin/Server.log
  warn GeoIP database             /opt/wow-panel/data/GeoLite2-Country.mmdb — optional, shows countries of IPs
  warn Game fonts                 static/fonts — tools/build_assets.py
  ok   Database classicrealmd     12 rows in account (mangos@127.0.0.1:3306)
  ok   Database classiccharacters 31 rows in characters (mangos@127.0.0.1:3306)
  ok   Database classicmangos     10385 rows in creature_template (mangos@127.0.0.1:3306)
  ok   World process (mangosd)    pid 1234
  ok   SOAP 127.0.0.1:7878        CMaNGOS/0.18 (…) for Linux_x64 (little-endian)
```

✔️ **Check:** no `FAIL` lines (they must be fixed — see [Troubleshooting](#-troubleshooting)); `warn` lines are
optional features. The command exits with code 0 when there are no `FAIL`s.

### Step 8. Run the panel as a service

```bash
sudo cp deploy/wow-panel.service /etc/systemd/system/
```

```bash
sudo nano /etc/systemd/system/wow-panel.service
```

Change `User=`, `Group=`, `WorkingDirectory=` and `ExecStart=` if your user or paths differ. Run the panel as
the **same user** that runs `mangosd`: it edits `mangosd.conf` and reads the core's logs. Then:

```bash
sudo systemctl daemon-reload
```

```bash
sudo systemctl enable --now wow-panel
```

```bash
systemctl status wow-panel
```

✔️ **Check:** it says `active (running)`. The panel's output and errors: `journalctl -u wow-panel -f`.

### Step 9. Open the panel in your browser

By default the panel listens only on `127.0.0.1:8090` — it cannot be reached from outside. Pick one way:

<details open>
<summary><b>A. SSH tunnel — recommended, nothing to open on the server</b></summary>

On your own computer (Linux, macOS, or Windows PowerShell — OpenSSH is built in):

```bash
ssh -N -L 8090:127.0.0.1:8090 you@your-server
```

Keep it running and open **http://127.0.0.1:8090** in the browser. Log in with the password from step 6.

</details>

<details>
<summary><b>B. Home network</b></summary>

In `.env` set the panel to listen on all interfaces and allow your network:

```ini
PANEL_HOST=0.0.0.0
PANEL_ALLOWED_PEERS=127.0.0.1,::1,192.168.1.0/24
```

```bash
sudo systemctl restart wow-panel
```

Open `http://<server-lan-ip>:8090`.

⚠️ **The panel speaks plain HTTP — do not open this port to the internet.**

</details>

<details>
<summary><b>C. From the internet, with HTTPS (nginx)</b></summary>

Put nginx in front of the panel and keep the panel on `127.0.0.1`:

```nginx
server {
    listen 443 ssl;
    server_name panel.example.com;
    ssl_certificate     /etc/letsencrypt/live/panel.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/panel.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_set_header Host $host;
    }
}
```

nginx connects from `127.0.0.1`, which is already allowed by default. A certificate: `sudo certbot --nginx`.

</details>

✔️ **Check:** the login page opens; after the password you see the **Overview**.

### Step 10 (recommended). Run the world and realm servers under systemd

The **Restart** button makes the world save everyone and exit with the "restart" code (`2`). Something has
to start it again. If you run `mangosd` by hand in `screen`/`tmux`, the panel still works, but after a
restart you start the world yourself. With systemd it comes back on its own:

1. Stop the world and realm servers the way you run them now.
2. In `mangosd.conf` set **`Console.Enable = 0`**.

> [!IMPORTANT]
> Under systemd there is no keyboard: with the console on, `mangosd` reads "end of input" and shuts down
> right after starting. You still have a console — the panel's **Console** page.

3. Install the two example units, edit `User=` and the paths in them, and start them:

```bash
sudo cp deploy/cmangos-realm.service deploy/cmangos-world.service /etc/systemd/system/
```

```bash
sudo nano /etc/systemd/system/cmangos-world.service
```

```bash
sudo nano /etc/systemd/system/cmangos-realm.service
```

```bash
sudo systemctl daemon-reload
```

```bash
sudo systemctl enable --now cmangos-realm cmangos-world
```

How the world unit behaves: `.server restart` or a crash → started again after 15 s; `.server shutdown` →
stays stopped; `systemctl stop cmangos-world` → saves players and stops.

4. Optional: let the panel restart realmd from the **Services** table — add to `.env` and restart the panel:

```ini
PANEL_KILLABLE=realmd
```

```bash
sudo systemctl restart wow-panel
```

✔️ **Check:** `systemctl status cmangos-world` is `active (running)`; **Restart** in the panel brings the world back by itself.

### Step 11 (optional). Fonts, music, map pictures and the top-down view from your game client

The repository contains **no Blizzard files**. Without them the panel works, but uses ordinary fonts, has
no music, and the **World map** page shows no pictures (typing coordinates still works). Build them from
your own **1.12.1 client**. Do it on the computer where the game is installed — for example a Windows PC:

1. Install Python 3 from [python.org](https://www.python.org/downloads/) (tick "Add python.exe to PATH").
2. Download this repository as ZIP from GitHub (**Code → Download ZIP**) and unpack it, e.g. to `C:\wow-vanilla-AdminPanel`.
3. In PowerShell:

```powershell
py -m pip install pillow
```

```powershell
cd C:\wow-vanilla-AdminPanel
```

```powershell
py tools\build_assets.py "C:\Games\World of Warcraft"
```

| Folder | What | Size |
|---|---|---|
| `static\fonts\` | 2 game fonts (Friz Quadrata, Morpheus) | < 1 MB |
| `static\music\` | 13 tracks: main theme, capitals, zones, taverns | ~19 MB |
| `static\wow\maps\` | 49 world / continent / zone maps | ~6 MB |
| `static\wow\minimap\` | the top-down view: ~1900 tiles from the client minimaps (1–2 minutes) | ~22 MB |

Only some of them: `--only fonts,music`, `--only maps`, `--only minimap`.

4. Copy them to the server:

```powershell
ssh you@your-server "mkdir -p /tmp/wow-assets"
```

```powershell
scp -r static\fonts static\music static\wow\maps static\wow\minimap you@your-server:/tmp/wow-assets/
```

5. On the server:

```bash
sudo cp -r /tmp/wow-assets/fonts /tmp/wow-assets/music /opt/wow-panel/static/
```

```bash
sudo cp /tmp/wow-assets/maps/*.webp /opt/wow-panel/static/wow/maps/
```

```bash
sudo rm -rf /opt/wow-panel/static/wow/minimap && sudo cp -r /tmp/wow-assets/minimap /opt/wow-panel/static/wow/
```

```bash
sudo chown -R wow:wow /opt/wow-panel/static && rm -rf /tmp/wow-assets
```

✔️ **Check:** reload the page in the browser (`Ctrl+F5`) — the game fonts are there, **World map** shows
pictures and the **Top-down view** button appears. No restart needed.

> [!TIP]
> If the client files are on the server anyway, you can run it there instead:
> `sudo -u wow venv/bin/pip install pillow` and `sudo -u wow venv/bin/python tools/build_assets.py /path/to/client`.

> [!NOTE]
> The 1.12 minimaps are 256 px per 533 yards — there is no sharper source anywhere, so the top-down view stops
> zooming at ×2.5, where it still looks clean.

### Step 12 (optional). Countries of IP addresses

The panel shows a country next to every IP if it finds a **GeoLite2-Country** database. Get it for free
from MaxMind (registration needed): <https://dev.maxmind.com/geoip/geolite2-free-geolocation-data>, then:

```bash
sudo -u wow cp GeoLite2-Country.mmdb /opt/wow-panel/data/
```

The file is read locally — IP addresses are never sent anywhere. Replace the file to update it; the panel
notices the new file by itself.

### Step 13 (optional). Backgrounds and race/class pictures

The "World of Warcraft" look can also use artwork from Blizzard's **Fan Site Kit** (not part of the client):

- four backgrounds `static/wow/bg-portal.jpg`, `bg-gryphon.jpg`, `bg-ironforge.jpg`, `bg-nightelves.jpg`;
- race + class pictures `static/wow/renders/<race>_<class>.webp`
  (race: `human orc dwarf nightelf scourge tauren gnome troll`,
  class: `warrior paladin hunter rogue priest shaman mage warlock druid`).

If `bg-portal.jpg` is present, the panel offers the backgrounds and shows the pictures on character sheets;
otherwise it uses a plain dark background and the race portrait.

---

## 🔧 Where everything is configured

**`.env`** next to `panel.py` — the only settings file of the panel. `.env.example` lists every key with a
comment. The important ones:

| Key | Default | What |
|---|---|---|
| `WOW_MANGOSD_CONF` | — (required) | Path to `mangosd.conf`. Most other settings are read from it. |
| `PANEL_PASSWORD_HASH`, `PANEL_SECRET` | — (required) | Set by `tools/passwd.py`. A new secret logs everyone out. |
| `SOAP_USER`, `SOAP_PASS` | — (required) | The GM-3 account from step 5. |
| `PANEL_HOST`, `PANEL_PORT` | `127.0.0.1`, `8090` | Where the panel listens. |
| `PANEL_ALLOWED_PEERS` | `127.0.0.1,::1` | Addresses / networks allowed to connect at all (before the password). |
| `PANEL_TITLE`, `PANEL_ADDRESS` | `WoW Server`, empty | Server name and the address shown under the menu. |
| `PANEL_HUB` | empty | Optional "All panels" button: a URL or `:port`. |
| `PANEL_SERVICES` | `mariadb:mariadbd\|mysqld,realmd:realmd,mangosd:mangosd,panel:self` | Processes on the Overview. Remove `mariadb` if the database is on another machine. |
| `PANEL_KILLABLE` | empty | Services the panel may restart by stopping them (only with systemd `Restart=always`). |
| `PANEL_LOGS` | empty | Extra log files for the Logs page: `Label=/path/file.log,…` |
| `PANEL_DATA` | `./data` | The panel's own data (see below). |
| `GEOIP_DB` | `./data/GeoLite2-Country.mmdb` | Country database. |
| `DB_*`, `SOAP_HOST`, `SOAP_PORT`, `REALM_ID`, `WOW_*` | from `mangosd.conf` | Overrides, only if the automatic values are wrong. |

<details>
<summary><b>What the panel takes from <code>mangosd.conf</code></b></summary>

`LoginDatabaseInfo`, `CharacterDatabaseInfo`, `WorldDatabaseInfo` (host, port, user, password, database names),
`SOAP.IP`, `SOAP.Port`, `RealmID`, `DataDir` (→ `dbc/`, `maps/`), `LogsDir`, `LogFile`, `DBErrorLogFile`,
`EventAIErrorLogFile`, `CharLogFile`. From `realmd.conf` next to it — `LogsDir` and `LogFile`. Relative paths are
counted from the folder of `mangosd` (`WOW_BIN`, by default `bin/` next to `etc/`). The panel uses **one**
database user for all three databases, so that user needs rights on each of them (the core's own user has them).

</details>

**The panel's own data** — `data/` (created automatically, keep it when updating):

| File | What |
|---|---|
| `panel.db` | SQLite: online history, audit log, restart schedule, removed items, notes about custom NPCs/quests, events the panel holds on or off |
| `custom_items.sql`, `custom_npcs.sql`, `custom_quests.sql` | Copies of everything you created — see [How it works](#-how-it-works) |
| `GeoLite2-Country.mmdb` | Optional, step 12 |

**In the browser** (`Settings` page, stored per browser): language, look, background, music.

---

## 🔄 Updating

```bash
cd /opt/wow-panel
```

```bash
sudo -u wow git pull
```

```bash
sudo -u wow venv/bin/pip install -r requirements.txt
```

```bash
sudo systemctl restart wow-panel
```

Then `Ctrl+F5` in the browser. Your `.env`, `data/` and the files from step 11 are not touched by `git pull`.

---

## 🔍 How it works

<details>
<summary><b>Commands, data and what the panel writes to the database</b></summary>

- **Commands go through the core.** Everything the server can do itself (kick, ban, mail, teleport,
  restart, delete a character…) is sent as a GM command over SOAP, exactly as if you typed it in the
  console. The answer of the core is shown to you and written to the audit log.
- **Data for tables and charts** is read directly from the three databases.
- **The panel writes to the database directly only** for: realm name and maintenance mode (`realmlist`),
  account IP lock, moving an *offline* character on the world map, removing / giving back one item of an
  offline character, and your custom items, NPCs and quests.
- **Icons** of items, spells, races and classes are loaded by your browser from Wowhead's image server
  `wow.zamimg.com` — the only outside address the page may use.

</details>

<details>
<summary><b>Custom items, NPCs and quests</b></summary>

- **Custom content uses its own ID ranges**, far above classic-db, so database updates never collide with it:
  items `item_template` 90000+, creatures `creature_template` 90000–94535 (with their texts, gossip and
  scripts in their own ranges), quests `quest_template` 90000–199999. Original game rows are never changed,
  except the "quest giver" flag of a game NPC you give a custom quest to — the panel remembers the original
  value and puts it back when that NPC has no custom quests left.
- **What needs a world restart.** The core reads items, creatures and their spawns only at start-up, so new
  or changed items and NPCs appear after a restart (the panel shows "waits for restart"). Quests and their
  givers can be applied at once with **Apply now** (`reload` commands); only the "!" mark over a game NPC that
  had no quests before appears after a restart. Players who already saw an edited item must delete the `WDB`
  folder of their client.
- **Backups of custom content.** After every change the panel writes `data/custom_items.sql`,
  `data/custom_npcs.sql` and `data/custom_quests.sql`. If you reinstall or update the world database,
  load them back (the same for `custom_npcs.sql` and `custom_quests.sql`, then restart the world):

```bash
mysql -u mangos -p classicmangos < /opt/wow-panel/data/custom_items.sql
```

</details>

<details>
<summary><b>Server settings, restarts and the map teleport</b></summary>

- **`mangosd.conf` settings.** Only a whitelist of ~50 safe keys can be edited. Before every save the file is
  copied to `etc/backups/` (last 20 copies). Some settings apply at once (`reload config`), others after a
  restart — the page says which.
- **Restart countdown and schedule** live in `panel.db`: the core does not report a running countdown, so
  the panel remembers the ones it started and shows a timer.
- **Map teleport.** For an offline character the new position is written to the database. An online
  character can only be moved by the core to a named teleport point, so the panel keeps one row
  `panel_tp` in `game_tele`, moves it to the chosen spot, runs `reload game_tele` and `tele name`.
  (The core prints "game_tele reloaded" in the chat of everyone in game.) The ground height comes from the
  server's `maps/*.map` files; inside buildings and caves the height of the nearest NPC is used.

</details>

<details>
<summary><b>Events and holidays</b></summary>

- The panel calculates the schedule of every event exactly like the core does
  (`GameEventMgr::ComputeEventStartAndEndTime`, the moon phases of the Lunar Festival, Easter for Noblegarden,
  the Darkmoon Faire Mondays) and asks the core which events are running (`event list`).
- **Turn on now** / **Turn off now** use `event start` / `event stop`, but the core counts the event's time from
  that minute and forgets manual changes on a restart or its weekly recalculation — so the panel holds the
  event itself for its usual length (or until the end of its scheduled window), checks it every minute, and
  afterwards gives one more command exactly at a boundary of the schedule, which puts the core's timing back
  as it was. **Keep on / off until …** is the same without the automatic end.
- **Parts of an event:** the core starts the parts linked with `linkedTo` itself, only while the main event
  runs, but does not stop them with it — the panel turns off the running parts when you turn the main event
  off; parts with their own calendar (Winter Veil gifts, Darkmoon Faire building stages, fishing contest
  announcements) can be turned on together with it. Holds and the returning of the timing live in `panel.db`.

</details>

---

## 🔐 Security

- The panel **password** is stored as an scrypt hash; after 5 wrong attempts within 10 minutes logins are refused.
- The login cookie is `HttpOnly`, `SameSite=Strict`, signed with `PANEL_SECRET`, valid for 7 days.
- Every request must come from an address in `PANEL_ALLOWED_PEERS`; every change request must carry a
  special header (protection from other sites); strict Content-Security-Policy.
- Keep `.env` at mode `600` — it contains the SOAP password (and the database password, if you put it there).
- SOAP must listen on `127.0.0.1` only (`SOAP.IP` in `mangosd.conf`).

> [!WARNING]
> The panel itself has **no HTTPS**. Keep it on `127.0.0.1` and use an SSH tunnel or a reverse proxy with
> HTTPS. Never publish port 8090 to the internet. Whoever has the panel password has full GM power over the
> server and can edit `mangosd.conf` — use a long password.

---

## 🩺 Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The browser shows just `Forbidden` | Your address is not in `PANEL_ALLOWED_PEERS`. Add it (or your network, e.g. `192.168.1.0/24`) and restart the panel. |
| `--check`: **Database … FAIL** | Wrong database settings. Check `LoginDatabaseInfo` in `mangosd.conf`, or set `DB_USER` / `DB_PASSWORD` in `.env`. The user needs rights on all three databases. |
| `--check`: **SOAP … no answer** | `SOAP.Enabled = 1` missing or the world was not restarted after it; `SOAP.Port` differs; the world is still loading. |
| SOAP rejects the login / "no administrator rights" | Wrong `SOAP_USER` / `SOAP_PASS`, or the account's GM level is below 3 (`account set gmlevel WEBPANEL 3`). |
| `mangosd` stops right after starting under systemd | `Console.Enable = 1` in `mangosd.conf`. Set it to `0` (step 10). |
| **Restart** stops the world but it does not come back | Nothing starts it again. Run it under systemd (step 10), or start it yourself. |
| Saving settings fails with "Permission denied" | The panel runs as a different user than the owner of `mangosd.conf`. Run the panel as the server's user. |
| Zone names are missing (numbers instead of names) | DBC files not found: check `DataDir` in `mangosd.conf` or set `WOW_DBC` in `.env`. |
| World map without pictures / no **Top-down view** button | Build them from the client (step 11). Without `maps/*.map` on the server (`WOW_MAPS`) the height of a point cannot be found. |
| No countries next to IPs | No GeoLite2 database (step 12). |
| Character "Sessions" are empty | The core writes logins to `Char.log` (`CharLogFile` in `mangosd.conf`); check that the file exists and `WOW_LOGS` points to its folder. |
| A new item / NPC is not in the game | It appears after a world restart. Quests: press **Apply now**. |
| Any other error | `journalctl -u wow-panel -n 100` shows the panel's errors; `python panel.py --check` shows what it found. |

---

## 🌍 Translations

The interface is written in Russian; every text in `static/app.js` is wrapped in `L('…')`, and that Russian
text is the translation key. Dictionaries: `static/i18n/<code>.js`. Messages of the server (`panel.py`),
including event names, are translated in the browser with the same dictionaries. The language follows the
browser, or the choice on the **Settings** page.

**All 9 languages are complete.** To check after a change:

```bash
python3 tools/i18n.py check
```

It shows, per language, what is missing and where placeholders `{0}` don't match. `tools/i18n.py keys` lists
all keys with numbers, `tools/i18n.py build <lang> file.txt` adds translations from a "number<TAB>text" file.
A missing translation shows the Russian text, nothing breaks. Code comments are in Russian.

---

## 📁 Project layout

```
panel.py               the whole server side (aiohttp): settings, API, SOAP, database, DBC and map readers
static/                the page: index.html, boot.js, app.js, app.css, i18n/<lang>.js
static/wow/maps/       maps.json and areas.json (zone bounds and names); *.webp from tools/build_assets.py
static/wow/minimap/    top-down view tiles and minimap.json (built by tools/build_assets.py, not in the repository)
tools/build_assets.py  fonts, music, map pictures and top-down view from your own game client
tools/build_maps.py    the map part of it (also rebuilds maps.json / areas.json with --json)
tools/build_minimap.py the top-down view part of it (minimap tiles)
tools/mpq.py           a small reader of the client's MPQ archives
tools/passwd.py        sets the panel password in .env
tools/i18n.py          translation checker
deploy/                systemd units: the panel, and optional ones for mangosd and realmd
docs/screenshots/      the pictures of this README
.env.example           all settings with comments
requirements.txt       aiohttp, PyMySQL
```

---

## 📜 Legal

World of Warcraft® and Blizzard Entertainment® are trademarks or registered trademarks of Blizzard
Entertainment, Inc. in the U.S. and/or other countries. This project is not affiliated with or endorsed by
Blizzard Entertainment. The repository contains no game files: fonts, music and map pictures are built by
you from your own copy of the game client; icons are loaded from Wowhead's public image server. The
screenshots in `docs/screenshots/` show the panel with demo data.

<p align="center"><sub>Made for the CMaNGOS Classic community ⚔️</sub></p>
