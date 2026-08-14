# busybar-livesplit

LiveSplit timer on a [BUSY Bar](https://busy.app/)

## What you get

**Front**

- Bold run time, LiveSplit colors (ahead / behind gaining / losing, cyan PB)
- Attempt count, current split name + compact delta (`-1.2` / `+3.4`) on the bottom row
- Gold: the delta turns yellow when the **segment just completed** beat Best Segments

**Back**

- Up to 5 splits, current one highlighted
- Live / run time + BEST column
- Attempt count in the header

**Feedback**

- Short LED flash on start / split / reset / PB
- Quiet stock sounds: start, reset and finish **only if** the last split is done and the run is a PB

## Requirements

- Node.js 22+
- [LiveSplit](https://livesplit.org/) with **Control → Start TCP Server** (port `16834`)
- BUSY Bar on USB, Wi-Fi or cloud

## Setup

```bash
git clone https://github.com/viirtualp1/busybar-livesplit.git
cd busybar-livesplit
npm install
cp .env.example .env
```

Edit `.env`, then:

```bash
npm run dev
```

Leave Busybar on a BUSY / CUSTOM session, or the Bar's own session will outrank the
draws (see `DRAW_PRIORITY` below).

## Bar connection

| Mode  | `BUSY_ADDR`            | Auth                               |
| ----- | ---------------------- | ---------------------------------- |
| USB   | `10.0.4.20`            | none                               |
| Wi-Fi | Bar LAN IP             | `BUSY_HTTP_PASSWORD` (HTTP Access) |
| Cloud | `https://api.busy.app` | `BUSY_TOKEN`                       |

**Wi-Fi:** the Bar and the machine running this process must share a network.
`BUSY_ADDR` is the **Bar's** IP, not the PC's.

1. Plug in USB once, open `http://10.0.4.20` → **Network**.
2. Connect the Bar to Wi-Fi. Copy its LAN IP (e.g. `192.168.1.42`).
3. Enable **HTTP API access** and set a password.
4. In `.env` (same folder you run `npm run dev` from):

```env
BUSY_ADDR=192.168.1.42
BUSY_HTTP_PASSWORD=the-password-from-step-3
BUSY_TOKEN=
```

Leave `BUSY_TOKEN` empty on a LAN — that token only works against `api.busy.app`.
Unused credentials are reported on startup instead of being silently dropped.

## LiveSplit

Right-click LiveSplit → **Control → Start TCP Server**. Default port is `16834`.

`LIVESPLIT_PROTOCOL=auto` tries TCP first, then `ws://host:port/livesplit`. Set `tcp`
or `ws` to skip the other. If LiveSplit runs on this machine keep
`LIVESPLIT_HOST=127.0.0.1`; if the timer is on another PC, point it at that PC's LAN IP.

## Config

| Variable             | Default                                                  | Description                                            |
| -------------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| `BUSY_ADDR`          | `https://api.busy.app` if token is set, else `10.0.4.20` | Bar host                                               |
| `BUSY_TOKEN`         | empty                                                    | Cloud token                                            |
| `BUSY_HTTP_PASSWORD` | empty                                                    | Wi-Fi HTTP Access password                             |
| `LIVESPLIT_HOST`     | `127.0.0.1`                                              | LiveSplit host                                         |
| `LIVESPLIT_PORT`     | `16834`                                                  | LiveSplit port                                         |
| `LIVESPLIT_PROTOCOL` | `auto`                                                   | `auto` / `tcp` / `ws`                                  |
| `SPLITS_FILE`        | auto from LiveSplit                                      | Path to the `.lss` if auto-detect misses it            |
| `POLL_MS`            | `250`                                                    | LiveSplit poll interval                                |
| `FRAME_MS`           | `60`                                                     | Bar redraw interval                                    |
| `DRAW_PRIORITY`      | `40`                                                     | Must be ≥ the app on screen; BUSY/CUSTOM session is 90 |