# Telegram Gallery Downloader Bot

A Telegram bot that accepts one or more gallery URLs, downloads all images in parallel, organizes them into folders, and returns a ZIP download link.

## Features

- Send one or multiple gallery URLs (one per line)
- Parallel image downloading (concurrency: 5)
- Each gallery saved in its own folder
- All galleries compressed into a single ZIP file
- Download link sent back via Telegram
- Structured logging
- JSON-driven site strategies (CSS selectors per domain)

## Supported Sites

Configured via `src/config/siteStrategies.json`. Currently includes:
- elitebabes.com
- definebabe.com

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/ali934h/telegram-gallery-downloader-bot.git
cd telegram-gallery-downloader-bot
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env with your BOT_TOKEN and other settings
```

### 4. Run in development mode

```bash
npm run dev
```

### 5. Run in production mode

```bash
NODE_ENV=production node src/index.js
```

## Usage

1. Start the bot with `/start`
2. Send one or more gallery URLs, one per line:
   ```
   https://example.com/gallery/gallery-one
   https://example.com/gallery/gallery-two
   ```
3. Wait for the bot to download and package all images
4. Receive your ZIP download link (valid for 24 hours)

## Adding New Sites

Edit `src/config/siteStrategies.json`:

```json
"newsite.com": {
  "name": "New Site",
  "images": {
    "selector": "a[href*='cdn'][href$='.jpg']",
    "attr": "href",
    "filterPatterns": ["thumb", "_w400"]
  }
}
```

## Project Structure

```
src/
├── index.js              # Entry point
├── bot.js                # Bot logic
├── scrapers/
│   ├── jsdomScraper.js   # HTML scraper
│   └── strategyEngine.js # Site strategy loader
├── downloaders/
│   ├── imageDownloader.js # Parallel image downloader
│   └── zipCreator.js      # ZIP creation via system command
├── utils/
│   ├── logger.js          # Structured logger
│   └── fileManager.js     # File/dir utilities
└── config/
    └── siteStrategies.json
```

## Requirements

- Node.js >= 20
- `zip` command available on the server (`apt install zip`)
