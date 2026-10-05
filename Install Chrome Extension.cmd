@echo off
echo 1. Enable Developer mode in Chrome.
echo 2. Click Load unpacked and select the extension folder opened below.
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" "chrome://extensions/"
start "" explorer.exe "%~dp0extension"
