#!/bin/bash
# Android (Termux) Setup Script for Schedule Sync
# This script helps you set up the schedule sync on Android without gcloud CLI

set -e

echo "📱 Android Schedule Sync Setup"
echo "================================"
echo ""

# Check if running in Termux
if [[ "$PREFIX" != *"com.termux"* ]]; then
    echo "⚠️  Warning: This script is designed for Termux on Android"
    echo "   It may not work correctly in other environments."
    echo ""
fi

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    echo ""
    echo "Install it with:"
    echo "  pkg install nodejs-lts"
    exit 1
fi

NODE_VERSION=$(node --version)
echo "✅ Node.js $NODE_VERSION installed"
echo ""

# Check if .env exists
if [ -f .env ]; then
    echo "⚠️  .env file already exists"
    read -p "Do you want to overwrite it? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Setup cancelled. Edit .env manually."
        exit 0
    fi
fi

# Create .env file
echo "📝 Creating .env configuration..."
echo ""

# Get project ID
read -p "Enter your Google Cloud Project ID: " PROJECT_ID
if [ -z "$PROJECT_ID" ]; then
    echo "❌ Project ID is required"
    exit 1
fi

# Get Gemini API key
echo ""
echo "Get your Gemini API key from: https://aistudio.google.com/apikey"
read -p "Enter your Gemini API key: " GEMINI_KEY
if [ -z "$GEMINI_KEY" ]; then
    echo "❌ Gemini API key is required for IATSE sync"
    exit 1
fi

# Ask about service account key
echo ""
echo "🔑 Service Account Setup"
echo "------------------------"
echo "You need a service account key file for Firestore authentication."
echo ""
echo "To create one on your computer:"
echo "  1. Run: gcloud iam service-accounts create firestore-sync"
echo "  2. Run: gcloud projects add-iam-policy-binding $PROJECT_ID \\"
echo "            --member=\"serviceAccount:firestore-sync@${PROJECT_ID}.iam.gserviceaccount.com\" \\"
echo "            --role=\"roles/datastore.user\""
echo "  3. Run: gcloud iam service-accounts keys create ~/firestore-key.json \\"
echo "            --iam-account=firestore-sync@${PROJECT_ID}.iam.gserviceaccount.com"
echo "  4. Transfer ~/firestore-key.json to your Android device"
echo ""

# Default path for service account key
DEFAULT_KEY_PATH="$HOME/firestore-key.json"
read -p "Enter path to service account key [$DEFAULT_KEY_PATH]: " KEY_PATH
KEY_PATH=${KEY_PATH:-$DEFAULT_KEY_PATH}

if [ ! -f "$KEY_PATH" ]; then
    echo ""
    echo "⚠️  Warning: Service account key not found at: $KEY_PATH"
    echo "   The sync will not work until you add this file."
    echo ""
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Setup cancelled."
        exit 0
    fi
else
    # Check file permissions
    chmod 600 "$KEY_PATH"
    echo "✅ Service account key found and secured (chmod 600)"
fi

# Google Calendar OAuth
echo ""
echo "📅 Google Calendar OAuth Setup"
echo "-------------------------------"
echo "You need OAuth credentials to sync events to Google Calendar."
echo ""
echo "If you haven't set up OAuth yet, run renew-auth.sh on your computer first."
echo ""

read -p "Enter Google OAuth Client ID: " CLIENT_ID
read -p "Enter Google OAuth Client Secret: " CLIENT_SECRET

echo ""
echo "Enter your Google OAuth token (the entire GOOGLE_TOKEN value from renew-auth.sh):"
echo "It should look like: {\"access_token\":\"...\",\"refresh_token\":\"...\",...}"
read -p "Token: " OAUTH_TOKEN

# Portal sources
echo ""
echo "🌐 Portal Sources (Optional)"
echo "----------------------------"
echo "Portal sources (Rhino, CrewOne) require Chromium, which may not work well on Android."
echo "You can skip this and use IATSE-only mode."
echo ""

read -p "Do you want to configure portal sources? (y/N) " -n 1 -r
echo
CONFIGURE_PORTALS=$REPLY

SCHEDULE_SOURCES=""
RHINO_EMAIL=""
RHINO_PASSWORD=""
CREWONE_EMAIL=""
CREWONE_PASSWORD=""
CREWONE_URL=""
CHROMIUM_PATH=""

if [[ $CONFIGURE_PORTALS =~ ^[Yy]$ ]]; then
    # Check for system Chromium
    if command -v chromium-browser &> /dev/null; then
        CHROMIUM_PATH=$(which chromium-browser)
        echo "✅ Found Chromium at: $CHROMIUM_PATH"
    else
        echo "⚠️  Chromium not found. Install with: pkg install chromium"
        read -p "Enter Chromium path (leave empty to skip): " CHROMIUM_PATH
    fi

    if [ -n "$CHROMIUM_PATH" ]; then
        echo ""
        read -p "Configure Rhino? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            read -p "Rhino email: " RHINO_EMAIL
            read -sp "Rhino password: " RHINO_PASSWORD
            echo
            SCHEDULE_SOURCES="rhino"
        fi

        echo ""
        read -p "Configure CrewOne? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            read -p "CrewOne email: " CREWONE_EMAIL
            read -sp "CrewOne password: " CREWONE_PASSWORD
            echo
            read -p "CrewOne login URL: " CREWONE_URL
            
            if [ -n "$SCHEDULE_SOURCES" ]; then
                SCHEDULE_SOURCES="$SCHEDULE_SOURCES,crewOne"
            else
                SCHEDULE_SOURCES="crewOne"
            fi
        fi
    fi
fi

# Write .env file
echo ""
echo "💾 Writing .env file..."

cat > .env << EOF
# Google Cloud Project
GOOGLE_CLOUD_PROJECT=$PROJECT_ID

# Service Account Authentication (for Android/Termux without gcloud CLI)
GOOGLE_APPLICATION_CREDENTIALS=$KEY_PATH

# IATSE 927 - Gemini AI
GEMINI_API_KEY=$GEMINI_KEY
GEMINI_MODEL=gemini-2.5-flash

# Google Calendar OAuth
GOOGLE_CLIENT_ID=$CLIENT_ID
GOOGLE_CLIENT_SECRET=$CLIENT_SECRET
GOOGLE_REDIRECT_URI=http://localhost
GOOGLE_TOKEN='$OAUTH_TOKEN'

EOF

if [ -n "$SCHEDULE_SOURCES" ]; then
    cat >> .env << EOF
# Portal Sources
SCHEDULE_SOURCES=$SCHEDULE_SOURCES

EOF

    if [ -n "$CHROMIUM_PATH" ]; then
        echo "PUPPETEER_EXECUTABLE_PATH=$CHROMIUM_PATH" >> .env
        echo "" >> .env
    fi

    if [[ $SCHEDULE_SOURCES == *"rhino"* ]]; then
        cat >> .env << EOF
# Rhino
RHINO_EMAIL=$RHINO_EMAIL
RHINO_PASSWORD=$RHINO_PASSWORD

EOF
    fi

    if [[ $SCHEDULE_SOURCES == *"crewOne"* ]]; then
        cat >> .env << EOF
# CrewOne
CREWONE_EMAIL=$CREWONE_EMAIL
CREWONE_PASSWORD=$CREWONE_PASSWORD
CREWONE_LOGIN_URL=$CREWONE_URL

EOF
    fi
fi

# Secure .env
chmod 600 .env

echo "✅ .env file created and secured (chmod 600)"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
if npm install; then
    echo "✅ Dependencies installed"
else
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "📋 Next steps:"
echo "  1. Make sure $KEY_PATH exists and has proper permissions"
echo "  2. Test Firestore connection: node scripts/list-iatse927.js"
echo "  3. Run a sync: node sync.js"
echo ""

if [ -z "$SCHEDULE_SOURCES" ]; then
    echo "💡 Tip: You're in IATSE-only mode (no portal sources)."
    echo "   This is the most reliable setup for Android."
    echo ""
fi

echo "📚 For more information, see ANDROID_SETUP.md"
