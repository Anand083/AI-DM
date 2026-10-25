#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu 24.04 server. Run it as root (or with sudo).
#
#   sudo DEPLOY_PUBKEY="ssh-ed25519 AAAA... deploy-key" bash server-setup.sh
#
# It is safe to run again. It does this:
#   - makes a "deploy" user that can log in only with an SSH key and can run Docker
#   - turns off root login and password login over SSH
#   - firewall (ufw): only ports 22, 80, 443
#   - fail2ban for SSH, automatic security updates
#   - 2 GB swap file
#   - Docker and the compose plugin
#   - the app folder /home/deploy/app
#
# BEFORE you run it, open a second terminal and keep it logged in. If something goes wrong
# with SSH settings, that session lets you fix it.
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
SWAP_GB="${SWAP_GB:-2}"
APP_DIR="/home/$DEPLOY_USER/app"

[ "$(id -u)" = "0" ] || { echo "Run as root (use sudo)." >&2; exit 1; }
[ -n "${DEPLOY_PUBKEY:-}" ] || { echo "Set DEPLOY_PUBKEY to the public key that may log in." >&2; exit 1; }
case "$DEPLOY_PUBKEY" in ssh-*|ecdsa-*|sk-*) ;; *) echo "DEPLOY_PUBKEY does not look like a public key." >&2; exit 1 ;; esac
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || { echo "This script is for Ubuntu." >&2; exit 1; }

say() { echo; echo "==> $*"; }
export DEBIAN_FRONTEND=noninteractive

say "Updating packages"
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl gnupg ufw fail2ban unattended-upgrades

say "Deploy user"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
AUTH="/home/$DEPLOY_USER/.ssh/authorized_keys"
touch "$AUTH"
grep -qxF "$DEPLOY_PUBKEY" "$AUTH" || echo "$DEPLOY_PUBKEY" >> "$AUTH"
chown "$DEPLOY_USER:$DEPLOY_USER" "$AUTH"
chmod 600 "$AUTH"

say "SSH: key login only, no root, no passwords"
cat > /etc/ssh/sshd_config.d/99-hardening.conf <<CONF
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowUsers $DEPLOY_USER ${EXTRA_SSH_USERS:-}
CONF
sshd -t
systemctl reload ssh

say "Firewall (22, 80, 443)"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

say "fail2ban and automatic security updates"
cat > /etc/fail2ban/jail.d/sshd.local <<CONF
[sshd]
enabled = true
maxretry = 5
findtime = 10m
bantime = 1h
CONF
systemctl enable --now fail2ban
systemctl restart fail2ban
cat > /etc/apt/apt.conf.d/20auto-upgrades <<CONF
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
systemctl enable --now unattended-upgrades

say "Swap (${SWAP_GB} GB)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l "${SWAP_GB}G" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
fi
grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
sysctl -p /etc/sysctl.d/99-swappiness.conf >/dev/null

say "Docker"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
# Containers start again after a reboot (the compose file uses restart: unless-stopped).
systemctl enable --now docker
usermod -aG docker "$DEPLOY_USER"
# Keep container logs from filling the disk even for containers outside compose.
cat > /etc/docker/daemon.json <<CONF
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
CONF
systemctl restart docker

say "App folder"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR" "$APP_DIR/scripts" "$APP_DIR/docker"

say "Done"
echo "Next: from your own computer, test the login in a NEW terminal before closing this one:"
echo "  ssh $DEPLOY_USER@<server-ip>"
echo "Then put your production settings in $APP_DIR/.env (see .env.prod.example)."
