# VigilLocal NVR — Operação Local em LXC Debian 13

Aplicação web de NVR on-premises com back-end Node.js + Express, banco SQLite (modo WAL), motor FFmpeg (`-c:v copy`) e interface React escura para consulta diária e replay temporal contínuo.

## Requisitos no LXC Debian 13

- LXC Debian 13 (usa o disco do próprio sistema operacional, sem necessidade de volume externo)
- Script `setup_lxc.sh` instala automaticamente: **Node.js 22+**, **SQLite3** e **FFmpeg**

## Deploy Automatizado no LXC Debian 13

Copie os arquivos do projeto para o servidor (por exemplo em `/opt/vigilnvr`) e execute como `root`:

```bash
cd /opt/vigilnvr
chmod +x setup_lxc.sh
./setup_lxc.sh
```

O script `setup_lxc.sh` executa:
1. Instalação de **Node.js 22 LTS**, **SQLite3** e **FFmpeg**.
2. Criação do usuário dedicado `vigilnvr` e das pastas `/var/lib/vigilnvr` (banco SQLite) e `/var/lib/vigilnvr/recordings` (vídeos MP4), com trava de segurança padrão de `85%` de uso do disco.
3. Compilação da aplicação (`npm run build`) e geração do `.env` com chaves criptográficas aleatórias.
4. Criação e ativação do serviço `vigilnvr.service` no `systemd` com `Restart=always`, `RestartSec=5` e logs centralizados no `journald` (`journalctl -u vigilnvr -f`).

## Proxy Reverso Nginx (Opcional — Porta 80)

Caso deseje publicar na porta 80 via Nginx preservando o streaming `HTTP 206`:

```bash
apt install -y nginx
cp /opt/vigilnvr/deploy/nginx-vigilnvr.conf /etc/nginx/sites-available/vigilnvr
ln -sf /etc/nginx/sites-available/vigilnvr /etc/nginx/sites-enabled/vigilnvr
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```
