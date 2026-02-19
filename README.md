# Telegram Gallery Downloader Bot

A Telegram bot that accepts one or more gallery URLs, downloads all images in parallel, packages them into a ZIP file, and sends back a direct download link — all without uploading anything to Telegram.

## Quick Install

On a fresh Ubuntu/Debian server, run:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/ali934h/telegram-gallery-downloader-bot/main/install.sh)
```

The script will ask for:
- Telegram Bot Token
- Webhook domain (e.g. `https://gallery.example.com`)
- SSL certificate and key paths
- Allowed Telegram user IDs (whitelist)
- Downloads directory path

Then it automatically installs Node.js, PM2, clones the repo, writes `.env`, and starts the bot.

## Features

- Send one or multiple gallery URLs (one per line)
- Parallel image downloading with concurrency control
- Each gallery saved in its own subfolder inside the ZIP
- Cancel download mid-way — partial results are packaged and sent
- Direct HTTPS download link (no file upload to Telegram)
- User whitelist via `ALLOWED_USERS` env variable
- Gallery source URLs saved alongside each ZIP for reference
- File manager via `/files` command — browse, view sources, delete
- JSON-driven site strategy config (CSS selectors per domain)
- Structured logging

## Manual Setup

### 1. Requirements

- Ubuntu / Debian server
- Node.js >= 20
- A domain with a valid SSL certificate pointed to the server
- A bot token from [@BotFather](https://t.me/BotFather)

### 2. Clone

```bash
git clone https://github.com/ali934h/telegram-gallery-downloader-bot.git
cd telegram-gallery-downloader-bot
npm install
```

### 3. Configure

```bash
cp .env.example .env
nano .env
```

Key variables:

| Variable | Description |
|---|---|
| `BOT_TOKEN` | Telegram bot token from @BotFather |
| `WEBHOOK_DOMAIN` | Full HTTPS domain, e.g. `https://gallery.example.com` |
| `SSL_CERT` | Path to SSL certificate (fullchain.pem) |
| `SSL_KEY` | Path to SSL private key (privkey.pem) |
| `DOWNLOADS_DIR` | Directory to store ZIP files |
| `DOWNLOAD_BASE_URL` | Public URL prefix for download links |
| `ALLOWED_USERS` | Comma-separated Telegram user IDs (empty = everyone) |

### 4. Run

```bash
# Development (polling)
npm run dev

# Production (webhook, port 443)
NODE_ENV=production node src/index.js

# With PM2
pm2 start src/index.js --name gallery-bot
```

## Usage

1. Start the bot with `/start`
2. Send one or more gallery URLs, one per line
3. Choose an archive name or use the default
4. Tap **Start Download**
5. Use the **❌ Cancel** button any time to stop and receive what was downloaded so far
6. Receive a direct download link

### Commands

| Command | Description |
|---|---|
| `/start` | Welcome message |
| `/files` | Browse and manage downloaded ZIPs |
| `/help` | Usage instructions |
| `/cancel` | Cancel pending operation |

## Adding New Sites

Edit `src/config/siteStrategies.json`:

```json
"example.com": {
  "name": "Example Site",
  "images": {
    "selector": "a[href*='cdn'][href$='.jpg']",
    "attr": "href",
    "filterPatterns": ["thumb", "_small"]
  }
}
```

- `selector` — CSS selector targeting image elements
- `attr` — attribute containing the image URL (`href` or `src`)
- `filterPatterns` — substrings to exclude (thumbnails, low-res, etc.)

## Project Structure

```
├── install.sh                    # One-command installer
src/
├── index.js                      # Entry point
├── bot.js                        # Bot logic & handlers
├── scrapers/
│   ├── jsdomScraper.js           # HTML scraper (jsdom)
│   └── strategyEngine.js         # Site strategy loader
├── downloaders/
│   ├── imageDownloader.js        # Parallel downloader with abort support
│   └── zipCreator.js             # ZIP creation
├── utils/
│   ├── logger.js                 # Structured logger
│   └── fileManager.js            # File/dir utilities
└── config/
    └── siteStrategies.json       # Per-domain CSS selectors
```

## Useful PM2 Commands

```bash
pm2 logs gallery-bot        # Live logs
pm2 restart gallery-bot     # Restart
pm2 stop gallery-bot        # Stop
pm2 status                  # Process status
```
