#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/aipsite}"

echo "Installing base packages..."
sudo apt-get update
sudo apt-get install -y ca-certificates curl git gnupg lsb-release openssl

echo "Installing Docker Engine and Compose plugin..."
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc >/dev/null
sudo chmod a+r /etc/apt/keyrings/docker.asc

. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" |
  sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker

echo "Preparing ${APP_DIR}..."
sudo mkdir -p "${APP_DIR}"
sudo chown "${USER}:${USER}" "${APP_DIR}"

if ! groups "${USER}" | grep -q '\bdocker\b'; then
  sudo usermod -aG docker "${USER}"
  echo "Added ${USER} to the docker group. Log out and SSH back in before running Docker without sudo."
fi

sudo docker version
sudo docker compose version

echo "Bootstrap complete."
echo "Next:"
echo "  cd ${APP_DIR}"
echo "  bash ~/aipsite-gcp/gcp/deploy-app.sh"
