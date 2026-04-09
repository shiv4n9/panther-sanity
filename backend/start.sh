#!/bin/bash
# Start script for Sanity Test API Server

set -e

echo "🚀 Starting Sanity Test API Server..."

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "❌ Virtual environment not found. Please run ./install.sh first."
    exit 1
fi

# Activate virtual environment
source venv/bin/activate

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Start the server
echo "✅ Server starting on http://${HOST:-0.0.0.0}:${PORT:-3001}"
echo "📁 CSV Directory: ${CSV_DIR:-/root/gramasub/PANTHER_SANITY}"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

python server.py
