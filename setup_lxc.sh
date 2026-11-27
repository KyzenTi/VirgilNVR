#!/usr/bin/env bash
set -euo pipefail

# VigilLocal NVR — Script de provisionamento para LXC Debian 13 (disco único do SO)
APP_USER="vigilnvr"
APP_GROUP="vigilnvr"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$SCRIPT_DIR}"
DATA_DIR="/var/lib/vigilnvr"
RECORDINGS_DIR="/var/lib/vigilnvr/recordings"
SERVICE_FILE="/etc/systemd/system/vigilnvr.service"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Erro: execute este script como root (ex.: sudo ./setup_lxc.sh)."
  exit 1
fi

echo "==> [1/5] Atualizando pacotes e instalando SQLite3, FFmpeg e utilitários no Debian 13..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y \
  curl \
  ca-certificates \
  gnupg \
  openssl \
  sqlite3 \
  libsqlite3-dev \
  ffmpeg \
  build-essential \
  python3

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/^v//' | cut -d. -f1)" -lt 22 ]]; then
  echo "==> [1/5] Instalando Node.js 22 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "    Node.js: $(node -v)"
echo "    SQLite3: $(sqlite3 --version | awk '{print $1}')"
echo "    FFmpeg:  $(ffmpeg -version | head -n1)"

echo "==> [2/5] Configurando usuário do sistema ($APP_USER) e diretórios em $DATA_DIR..."
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin "$APP_USER"
fi

mkdir -p "$DATA_DIR" "$RECORDINGS_DIR"
chown -R "$APP_USER:$APP_GROUP" "$DATA_DIR"
chmod 750 "$DATA_DIR" "$RECORDINGS_DIR"

echo "==> [3/5] Instalando dependências da aplicação e compilando front-end em $APP_DIR..."
cd "$APP_DIR"
if [[ -f "$APP_DIR/package-lock.json" ]]; then
  npm ci
else
  npm install
fi
npm run build

if [[ ! -f "$APP_DIR/.env" ]]; then
  echo "==> Gerando $APP_DIR/.env com caminhos locais e chaves aleatórias..."
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  sed -i "s|^DATA_DIR=.*|DATA_DIR=$DATA_DIR|" "$APP_DIR/.env"
  sed -i "s|^STORAGE_ROOT=.*|STORAGE_ROOT=$RECORDINGS_DIR|" "$APP_DIR/.env"
  {
    echo ""
    echo "SESSION_SECRET=$(openssl rand -hex 32)"
    echo "RTSP_ENCRYPTION_KEY=$(openssl rand -hex 32)"
  } >> "$APP_DIR/.env"
else
  # Garante que DATA_DIR e STORAGE_ROOT apontem para /var/lib/vigilnvr caso ainda estejam nos valores padrão
  sed -i "s|^DATA_DIR=\\./data|DATA_DIR=$DATA_DIR|" "$APP_DIR/.env"
  sed -i "s|^STORAGE_ROOT=\\./recordings|STORAGE_ROOT=$RECORDINGS_DIR|" "$APP_DIR/.env"
fi

chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"
chmod 600 "$APP_DIR/.env"

echo "==> [4/5] Configurando unidade systemd ($SERVICE_FILE)..."
NODE_BIN="$(command -v node)"
cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=VigilLocal NVR - Gravador Local RTSP e Replay Temporal
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_GROUP
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
EnvironmentFile=$APP_DIR/.env
ExecStart=$NODE_BIN $APP_DIR/server.ts
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=15
LimitNOFILE=65536
StandardOutput=journal
StandardError=journal
SyslogIdentifier=vigilnvr
ReadWritePaths=$DATA_DIR $RECORDINGS_DIR

[Install]
WantedBy=multi-user.target
EOF

echo "==> [5/5] Habilitando e iniciando serviço vigilnvr no systemd..."
systemctl daemon-reload
systemctl enable --now vigilnvr

echo ""
echo "=================================================================="
echo "VigilLocal NVR instalado e ativo!"
echo "  - Banco SQLite:  $DATA_DIR/nvr.db"
echo "  - Gravações MP4: $RECORDINGS_DIR"
echo "  - Status:        systemctl status vigilnvr"
echo "  - Logs ao vivo:  journalctl -u vigilnvr -f"
echo "=================================================================="
