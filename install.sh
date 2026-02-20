#!/bin/bash
# ============================================================
#  Gallery Downloader Bot - Installer
#  Usage: bash <(curl -Ls https://raw.githubusercontent.com/ali934h/telegram-gallery-downloader-bot/main/install.sh)
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[x]${NC} $1"; exit 1; }
ask()  { echo -e "${BLUE}[?]${NC} $1"; }

INSTALL_DIR="/root/telegram-gallery-downloader-bot"
REPO_URL="https://github.com/ali934h/telegram-gallery-downloader-bot.git"

clear
echo -e ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     Gallery Downloader Bot - Installer       ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo -e ""

# ── Root check ────────────────────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  err "This script must be run as root (sudo -i)"
fi

# ── Collect configuration ─────────────────────────────────────────────────────────────────
echo -e "${YELLOW}Please answer the following questions:${NC}\n"

ask "Bot Token (from @BotFather):"
read -r BOT_TOKEN
[[ -z "$BOT_TOKEN" ]] && err "Bot token cannot be empty."

ask "Webhook domain (e.g. gallery.example.com or https://gallery.example.com):"
read -r WEBHOOK_DOMAIN
[[ -z "$WEBHOOK_DOMAIN" ]] && err "Domain cannot be empty."

# Auto-add https:// if missing
if [[ ! "$WEBHOOK_DOMAIN" =~ ^https?:// ]]; then
  WEBHOOK_DOMAIN="https://${WEBHOOK_DOMAIN}"
  log "Auto-added https:// → ${WEBHOOK_DOMAIN}"
fi

# Force https (Telegram requires HTTPS for webhooks)
if [[ "$WEBHOOK_DOMAIN" =~ ^http:// ]]; then
  WEBHOOK_DOMAIN="${WEBHOOK_DOMAIN/http:/https:}"
  warn "Changed http:// to https:// (required for Telegram webhooks)"
fi

# Strip trailing slash
WEBHOOK_DOMAIN=${WEBHOOK_DOMAIN%/}

ask "SSL certificate path (e.g. /etc/letsencrypt/live/example.com/fullchain.pem):"
read -r SSL_CERT
[[ -z "$SSL_CERT" ]] && err "SSL cert path cannot be empty."

ask "SSL key path (e.g. /etc/letsencrypt/live/example.com/privkey.pem):"
read -r SSL_KEY
[[ -z "$SSL_KEY" ]] && err "SSL key path cannot be empty."

ask "Allowed Telegram user IDs (comma-separated, leave empty to allow everyone):"
read -r ALLOWED_USERS

ask "Download concurrency (1-20, default: 5):"
read -r DOWNLOAD_CONCURRENCY
DOWNLOAD_CONCURRENCY=${DOWNLOAD_CONCURRENCY:-5}

ask "Downloads directory (default: /root/gallery-downloads):"
read -r DOWNLOADS_DIR
DOWNLOADS_DIR=${DOWNLOADS_DIR:-/root/gallery-downloads}

DOWNLOAD_BASE_URL="${WEBHOOK_DOMAIN}/downloads"

# ── Proxy configuration (optional) ────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}═══════════════════════════════════════════════${NC}"
echo -e "${YELLOW}  Proxy Configuration (Optional)${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════${NC}"
echo ""
echo -e "Some sites (like pornpics.com) block datacenter IPs."
echo -e "You can install Xray with VLESS proxy to bypass this."
echo ""
ask "Do you want to install and configure Xray proxy? [y/N]:"
read -r INSTALL_PROXY

PROXY_URL=""
if [[ "$INSTALL_PROXY" =~ ^[Yy]$ ]]; then
  echo ""
  echo -e "${BLUE}Enter your VLESS configuration details:${NC}"
  echo ""
  
  ask "Server address (e.g. chatgpt.com):"
  read -r VLESS_ADDRESS
  [[ -z "$VLESS_ADDRESS" ]] && err "Server address cannot be empty."
  
  ask "Server port (default: 443):"
  read -r VLESS_PORT
  VLESS_PORT=${VLESS_PORT:-443}
  
  ask "UUID (e.g. 6a4901c2-aae4-4466-bc72-e65a3d69c21f):"
  read -r VLESS_UUID
  [[ -z "$VLESS_UUID" ]] && err "UUID cannot be empty."
  
  ask "SNI / Server Name (e.g. example.workers.dev):"
  read -r VLESS_SNI
  [[ -z "$VLESS_SNI" ]] && err "SNI cannot be empty."
  
  ask "WebSocket path (e.g. /path?ed=2560):"
  read -r VLESS_PATH
  [[ -z "$VLESS_PATH" ]] && err "WebSocket path cannot be empty."
  
  ask "WebSocket Host header (e.g. example.workers.dev):"
  read -r VLESS_HOST
  [[ -z "$VLESS_HOST" ]] && err "Host header cannot be empty."
  
  PROXY_URL="socks5://127.0.0.1:1080"
fi

echo ""
log "Configuration summary:"
echo    "  Domain      : $WEBHOOK_DOMAIN"
echo    "  SSL Cert    : $SSL_CERT"
echo    "  SSL Key     : $SSL_KEY"
echo    "  Downloads   : $DOWNLOADS_DIR"
echo    "  Download URL: $DOWNLOAD_BASE_URL"
echo    "  Concurrency : $DOWNLOAD_CONCURRENCY"
echo    "  Allowed IDs : ${ALLOWED_USERS:-<everyone>}"
if [[ "$INSTALL_PROXY" =~ ^[Yy]$ ]]; then
  echo "  Proxy       : Enabled (Xray VLESS)"
  echo "    └─ Server : $VLESS_ADDRESS:$VLESS_PORT"
  echo "    └─ SNI    : $VLESS_SNI"
else
  echo "  Proxy       : Disabled"
fi
echo ""
ask "Proceed with installation? [Y/n]:"
read -r CONFIRM
[[ "$CONFIRM" =~ ^[Nn]$ ]] && { warn "Aborted."; exit 0; }

# ── System dependencies ───────────────────────────────────────────────────────────────────
log "Updating package list..."
apt-get update -qq

log "Installing dependencies (curl, git, unzip)..."
apt-get install -y -qq curl git unzip

# ── Xray installation (if enabled) ────────────────────────────────────────────────────────
if [[ "$INSTALL_PROXY" =~ ^[Yy]$ ]]; then
  echo ""
  log "Installing Xray..."
  
  if command -v xray &>/dev/null; then
    warn "Xray already installed: $(xray version | head -1)"
  else
    bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install &>/dev/null
    log "Xray installed successfully."
  fi
  
  log "Creating Xray configuration..."
  cat > /usr/local/etc/xray/config.json << EOF
{
  "log": {
    "loglevel": "warning"
  },
  "inbounds": [
    {
      "port": 1080,
      "listen": "127.0.0.1",
      "protocol": "socks",
      "settings": {
        "udp": true
      }
    },
    {
      "port": 10809,
      "listen": "127.0.0.1",
      "protocol": "http"
    }
  ],
  "outbounds": [
    {
      "protocol": "vless",
      "settings": {
        "vnext": [
          {
            "address": "${VLESS_ADDRESS}",
            "port": ${VLESS_PORT},
            "users": [
              {
                "id": "${VLESS_UUID}",
                "encryption": "none",
                "level": 0
              }
            ]
          }
        ]
      },
      "streamSettings": {
        "network": "ws",
        "security": "tls",
        "tlsSettings": {
          "serverName": "${VLESS_SNI}",
          "fingerprint": "chrome",
          "alpn": ["http/1.1"]
        },
        "wsSettings": {
          "path": "${VLESS_PATH}",
          "headers": {
            "Host": "${VLESS_HOST}"
          }
        }
      }
    }
  ]
}
EOF
  
  log "Starting Xray service..."
  systemctl enable xray &>/dev/null
  systemctl restart xray
  
  if systemctl is-active --quiet xray; then
    log "Xray is running successfully."
  else
    err "Failed to start Xray. Check: systemctl status xray"
  fi
  
  log "Testing proxy connection..."
  if curl --proxy socks5://127.0.0.1:1080 -s --connect-timeout 10 https://www.google.com -I &>/dev/null; then
    log "Proxy is working! ✓"
  else
    warn "Proxy test failed. Check Xray config: /usr/local/etc/xray/config.json"
  fi
fi

# ── Node.js ───────────────────────────────────────────────────────────────────────────────
if command -v node &>/dev/null; then
  NODE_VER=$(node -v)
  log "Node.js already installed: $NODE_VER"
else
  log "Installing Node.js 20.x..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - &>/dev/null
  apt-get install -y -qq nodejs
  log "Node.js installed: $(node -v)"
fi

# ── PM2 ───────────────────────────────────────────────────────────────────────────────────
if command -v pm2 &>/dev/null; then
  log "PM2 already installed: $(pm2 -v)"
else
  log "Installing PM2..."
  npm install -g pm2 --silent
  log "PM2 installed."
fi

# ── Clone / update repo ───────────────────────────────────────────────────────────────────
if [[ -d "$INSTALL_DIR/.git" ]]; then
  warn "Existing installation found at $INSTALL_DIR. Updating..."
  cd "$INSTALL_DIR"
  git pull origin main --quiet
else
  log "Cloning repository to $INSTALL_DIR ..."
  git clone "$REPO_URL" "$INSTALL_DIR" --quiet
  cd "$INSTALL_DIR"
fi

# ── npm install ───────────────────────────────────────────────────────────────────────────
log "Installing npm packages..."
npm install --silent

# ── Downloads directory ───────────────────────────────────────────────────────────────────
log "Creating downloads directory: $DOWNLOADS_DIR"
mkdir -p "$DOWNLOADS_DIR"

# ── Write .env ────────────────────────────────────────────────────────────────────────────
log "Writing .env file..."
cat > "$INSTALL_DIR/.env" << EOF
# Telegram
BOT_TOKEN=${BOT_TOKEN}

# Environment
NODE_ENV=production

# Webhook
WEBHOOK_DOMAIN=${WEBHOOK_DOMAIN}
WEBHOOK_PATH=/webhook
HTTPS_PORT=443

# Downloads
DOWNLOADS_DIR=${DOWNLOADS_DIR}
DOWNLOAD_BASE_URL=${DOWNLOAD_BASE_URL}

# SSL
SSL_CERT=${SSL_CERT}
SSL_KEY=${SSL_KEY}

# Whitelist (comma-separated user IDs, empty = everyone)
ALLOWED_USERS=${ALLOWED_USERS}

# Download concurrency (parallel image downloads per gallery)
DOWNLOAD_CONCURRENCY=${DOWNLOAD_CONCURRENCY}

# Proxy (leave empty to disable)
PROXY_URL=${PROXY_URL}
EOF

chmod 600 "$INSTALL_DIR/.env"
log ".env written and secured (chmod 600)."

# ── Start / restart with PM2 ──────────────────────────────────────────────────────────────
cd "$INSTALL_DIR"

if pm2 list | grep -q "gallery-bot"; then
  log "Restarting existing PM2 process..."
  pm2 restart gallery-bot --update-env
else
  log "Starting bot with PM2..."
  pm2 start src/index.js --name gallery-bot
fi

log "Saving PM2 process list..."
pm2 save

log "Enabling PM2 on system startup..."
pm2 startup systemd -u root --hp /root 2>/dev/null | tail -1 | bash 2>/dev/null || true

# ── Done ──────────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           Installation Complete!             ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Bot URL    : ${WEBHOOK_DOMAIN}"
echo -e "  Install dir: ${INSTALL_DIR}"
echo -e "  Downloads  : ${DOWNLOADS_DIR}"
echo -e "  Download URL: ${DOWNLOAD_BASE_URL}"
echo -e "  Concurrency: ${DOWNLOAD_CONCURRENCY}"
if [[ "$INSTALL_PROXY" =~ ^[Yy]$ ]]; then
  echo -e "  Proxy      : Enabled (${PROXY_URL})"
else
  echo -e "  Proxy      : Disabled"
fi
echo ""
echo -e "  Useful commands:"
echo -e "    pm2 logs gallery-bot     # view live logs"
echo -e "    pm2 restart gallery-bot  # restart bot"
echo -e "    pm2 stop gallery-bot     # stop bot"
if [[ "$INSTALL_PROXY" =~ ^[Yy]$ ]]; then
  echo -e "    systemctl status xray    # check Xray status"
  echo -e "    systemctl restart xray   # restart Xray"
fi
echo ""
