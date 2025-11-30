#!/bin/bash

# Stop fde-server daemon

PID_FILE="./fde-server.pid"

if [ ! -f "$PID_FILE" ]; then
    echo "❌ PID file not found: $PID_FILE"
    echo "💡 Server may not be running in daemon mode"
    exit 1
fi

PID=$(cat "$PID_FILE")

if [ -z "$PID" ]; then
    echo "❌ PID file is empty"
    exit 1
fi

# Check if process is running
if ! kill -0 "$PID" 2>/dev/null; then
    echo "⚠️  Process $PID is not running"
    rm "$PID_FILE"
    exit 1
fi

# Stop the process
echo "🛑 Stopping server (PID: $PID)..."
kill "$PID"

# Wait for process to stop
for i in {1..10}; do
    if ! kill -0 "$PID" 2>/dev/null; then
        echo "✅ Server stopped successfully"
        rm "$PID_FILE"
        exit 0
    fi
    sleep 0.5
done

# Force kill if still running
echo "⚠️  Process did not stop gracefully, forcing..."
kill -9 "$PID"
rm "$PID_FILE"
echo "✅ Server force stopped"
