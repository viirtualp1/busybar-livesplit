# busybar-livesplit

LiveSplit timer on a [BUSY Bar](https://busy.app/)

## What you get

**Front**

- Bold run time, LiveSplit colors (ahead / behind gaining / losing, cyan PB)
- Attempt count, current split name + compact delta (`-1.2` / `+3.4`) on the bottom row
- Gold: delta turns yellow when the **current segment** is faster than Best Segments

**Back**

- Up to 5 splits
- Live / run time + PB column
- Attempt count in the header, `PB` over the right column

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

Leave Busybar on a BUSY / CUSTOM session

## Bar connection


| Mode  | `BUSY_ADDR`            | Auth                               |
| ----- | ---------------------- | ---------------------------------- |
| USB   | `10.0.4.20`            | none                               |
| Wi-Fi | Bar LAN IP             | `BUSY_HTTP_PASSWORD` (HTTP Access) |
| Cloud | `https://api.busy.app` | `BUSY_TOKEN`                       |


**Wi-Fi:** Bar and the PC running this process must be on the same network. `BUSY_ADDR` is the **Bar’s** IP, not the Windows PC

1. Plug USB once, open `http://10.0.4.20` → **Network**.
2. Connect the Bar to Wi-Fi. Copy its LAN IP (e.g. `192.168.1.42`).
3. Enable **HTTP API access** and set a password.
4. In `.env` (same folder you run `npm run dev` from):

```env
BUSY_ADDR=192.168.1.42
BUSY_HTTP_PASSWORD=the-password-from-step-3
BUSY_TOKEN=
```

Leave `BUSY_TOKEN` empty on LAN — that token is only for `api.busy.app`. If LiveSplit is on this Windows PC, keep `LIVESPLIT_HOST=127.0.0.1`. If this process runs on another machine, set `LIVESPLIT_HOST` to the **Windows** LAN IP instead.

## LiveSplit

Right-click LiveSplit → **Control → Start TCP Server**. Default port is `16834`

`LIVESPLIT_PROTOCOL=auto` tries TCP first, then `ws://host:port/livesplit`. Set `tcp` or `ws` to skip the other

## Config


| Variable             | Default                                                  |                                                        |
| -------------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| `BUSY_ADDR`          | `https://api.busy.app` if token is set, else `10.0.4.20` | Bar host                                               |
| `BUSY_TOKEN`         | empty                                                    | Cloud token                                            |
| `BUSY_HTTP_PASSWORD` | empty                                                    | Wi-Fi HTTP Access password                             |
| `LIVESPLIT_HOST`     | `127.0.0.1`                                              | LiveSplit host                                         |
| `LIVESPLIT_PORT`     | `16834`                                                  | LiveSplit port                                         |
| `LIVESPLIT_PROTOCOL` | `auto`                                                   | `auto` / `tcp` / `ws`                                  |
| `POLL_MS`            | `80`                                                     | LiveSplit poll interval                                |
| `DRAW_PRIORITY`      | `40`                                                     | Must be ≥ the app on screen; BUSY/CUSTOM session is 90 |


## Troubleshooting

`LiveSplit timeout` — TCP Server is not running, or the host/port is wrong. Restart LiveSplit’s server and this process

**Draws ignored / 409** — a BUSY or CUSTOM session is on screen. Stop it, or raise `DRAW_PRIORITY` (session is 90)

**Waiting for BUSY Bar** — USB: `10.0.4.20`. Wi-Fi: HTTP Access enabled + password. Cloud: valid `BUSY_TOKEN`

**No gold** — add a Best Segments comparison in LiveSplit, or the current segment is not beating it yet (needs >200 ms of segment time)

**No sound** — volume is not muted on the Bar. Finish sound plays only on a PB (delta `< 0`, or no comparison on a first complete run)
