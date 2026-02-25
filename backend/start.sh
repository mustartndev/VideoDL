#!/bin/bash
set -e

echo "[STARTUP] Starting bgutil POT provider on port 4416..."
cd /opt/pot-provider/server
node build/main.js --port 4416 &
POT_PID=$!

# Wait for POT provider to be ready
sleep 2
echo "[STARTUP] POT provider started (PID: $POT_PID)"

echo "[STARTUP] Starting VideoDL server on port 8080..."
cd /app
exec uvicorn main:app --host 0.0.0.0 --port 8080
