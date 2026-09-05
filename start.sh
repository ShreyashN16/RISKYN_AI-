#!/bin/bash
# RISKYN AI — one-command launcher (Mac/Linux)
set -e
cd "$(dirname "$0")/backend"

if [ ! -d ".venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -r requirements.txt -q --disable-pip-version-check

echo ""
echo "RISKYN AI starting — training model on synthetic data..."
echo "Dashboard will be live at: http://127.0.0.1:8000"
echo ""
python3 -m uvicorn main:app --host 127.0.0.1 --port 8000
