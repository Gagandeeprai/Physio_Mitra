@echo off
title AI Physiotherapy Assistant
color 0A

echo ===================================================
echo      Starting AI Physiotherapy Assistant...
echo ===================================================
echo.
echo Starting Node.js server and AI models...
echo Please wait while the camera initializes in the background.
echo.

:: Wait for 2 seconds to give Node.js a headstart before opening browser
start "" http://localhost:3000

:: Start the server
node server.js

pause
