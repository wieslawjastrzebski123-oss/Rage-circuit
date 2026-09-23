#!/usr/bin/env bash
# Deploys RAGE CIRCUIT (client + multiplayer server) to an Ubuntu host.
#   SSH_KEY=~/.ssh/key.pem ./scripts/deploy-server.sh ubuntu@1.2.3.4
# First run also installs Node.js, the systemd service and the nginx site.
set -euo pipefail
TARGET="${1:?usage: deploy-server.sh user@host}"
KEY="${SSH_KEY:?set SSH_KEY to the private key path}"
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new"
cd "$(dirname "$0")/.."

echo "== uploading sources"
$SSH "$TARGET" 'sudo mkdir -p /opt/rage-circuit && sudo chown -R $USER:$USER /opt/rage-circuit'
rsync -az --delete -e "$SSH" \
  --exclude node_modules --exclude dist --exclude .git --exclude .claude \
  ./ "$TARGET:/opt/rage-circuit/"

echo "== installing, building and (re)starting on the server"
$SSH "$TARGET" 'bash -s' <<'REMOTE'
set -euo pipefail
cd /opt/rage-circuit
if ! command -v node >/dev/null || [ "$(node -p "process.versions.node.split(\".\")[0]")" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
npm ci --no-audit --no-fund
npm run build
sudo cp deploy/rage-circuit.service /etc/systemd/system/rage-circuit.service
sudo systemctl daemon-reload
sudo systemctl enable rage-circuit >/dev/null
sudo systemctl restart rage-circuit
sudo cp deploy/nginx-rage-circuit.conf /etc/nginx/sites-available/rage-circuit
sudo ln -sf /etc/nginx/sites-available/rage-circuit /etc/nginx/sites-enabled/rage-circuit
sudo nginx -t
sudo systemctl reload nginx
# the server needs a few seconds to boot
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1/health >/dev/null 2>&1; then echo "game server healthy"; exit 0; fi
  sleep 1
done
echo "game server did not come up – check: sudo journalctl -u rage-circuit -n 50" >&2
exit 1
REMOTE
echo "== done: http://${TARGET#*@}/"
