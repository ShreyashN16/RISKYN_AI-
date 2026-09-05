@echo off
title RISKYN AI
cd /d "%~dp0backend"

if not exist ".venv" (
    echo Creating virtual environment...
    python -m venv .venv
)
call .venv\Scripts\activate

echo Installing dependencies...
pip install -r requirements.txt -q

echo.
echo RISKYN AI starting - training model on synthetic data...
echo Dashboard will be live at: http://127.0.0.1:8000
echo.
python -m uvicorn main:app --host 127.0.0.1 --port 8000
pause
