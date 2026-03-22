#!/bin/bash
# install.sh — Setup Soon Expertise Agent sur un Mac
set -e

echo ""
echo "═══════════════════════════════════════"
echo "  Soon Expertise v3.0 — Installation"
echo "═══════════════════════════════════════"
echo ""

# 1. Vérifier Node.js
if ! command -v node &> /dev/null; then
  echo "❌ Node.js n'est pas installé. Installez-le d'abord : https://nodejs.org"
  exit 1
fi
echo "✓ Node.js $(node -v)"

# 2. Créer le dossier iCloud partagé
ICLOUD="$HOME/Library/Mobile Documents/com~apple~CloudDocs/SoonExpertise"
mkdir -p "$ICLOUD/inbox"
mkdir -p "$ICLOUD/missions"
mkdir -p "$ICLOUD/missions/_archive"
echo "✓ Dossier iCloud : $ICLOUD"

# 3. Créer le dossier local
mkdir -p "$HOME/.soon-expertise"

# 4. Installer les dépendances
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/agent"
npm install --production 2>&1 | tail -1
npm run build 2>&1
echo "✓ Agent compilé"

# 5. Configurer ce Mac
echo ""
read -p "Nom de ce Mac (mac-cabinet / mac-bureau / mac-portable) : " MACHINE_ID
MACHINE_ID=${MACHINE_ID:-mac-principal}

read -p "Clé API Claude (sk-ant-..., laisser vide si pas encore) : " CLAUDE_KEY
read -p "Clé API Mistral (laisser vide si pas besoin) : " MISTRAL_KEY

TOKEN=$(openssl rand -hex 16)

cat > .env << EOF
MACHINE_ID=$MACHINE_ID
CLAUDE_API_KEY=$CLAUDE_KEY
MISTRAL_API_KEY=$MISTRAL_KEY
ICLOUD_BASE=$ICLOUD
PORT=9721
AUTH_TOKEN=$TOKEN
EOF

echo ""
echo "✓ Configuration .env créée"
echo "  Token d'auth : $TOKEN"
echo "  → À coller dans l'extension Chrome (paramètres)"

# 6. Installer le LaunchAgent (démarrage auto au login)
NODE_PATH=$(which node)
AGENT_PATH="$SCRIPT_DIR/agent/dist/agent/src/index.js"
WORK_DIR="$SCRIPT_DIR/agent"

cat > ~/Library/LaunchAgents/com.soon-expertise.agent.plist << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.soon-expertise.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_PATH</string>
        <string>$AGENT_PATH</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$WORK_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$HOME/.soon-expertise/agent.log</string>
    <key>StandardErrorPath</key>
    <string>$HOME/.soon-expertise/agent.error.log</string>
</dict>
</plist>
PLIST

launchctl load ~/Library/LaunchAgents/com.soon-expertise.agent.plist 2>/dev/null || true
echo "✓ Agent installé comme service (démarre au login)"

echo ""
echo "═══════════════════════════════════════"
echo "  Installation terminée !"
echo ""
echo "  L'agent surveille : $ICLOUD/inbox/"
echo "  API locale : http://127.0.0.1:9721"
echo "  Logs : ~/.soon-expertise/agent.log"
echo ""
echo "  Pour tester :"
echo "  curl http://127.0.0.1:9721/health"
echo ""
echo "  Pour arrêter :"
echo "  launchctl unload ~/Library/LaunchAgents/com.soon-expertise.agent.plist"
echo "═══════════════════════════════════════"
