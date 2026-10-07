# Три Слога — VK publisher

Editable Chrome extension for https://vk.ru/tri_sloga_band, with an earlier Windows desktop prototype included in `app.py`.

The extension uses your existing Chrome VK login, chooses a random loaded community photo and song, and adds a Russian quote from Wikiquote containing «любовь» or «счастье». Choose an interval in hours and enable automatic publication: the first post starts immediately, then subsequent attempts follow the saved schedule.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` in your normal Chrome profile and enable Developer mode.
3. Click **Load unpacked** and select this repository's `extension` folder.
4. Log into VK, open the community, and click the extension icon.

Choose the interval and click **Включить**. **Остановить** disables the schedule and stops subsequent actions in the running job. Changing an active interval reschedules the next attempt without an extra immediate post. Full instructions and known limitations are in [extension/INSTALL.txt](extension/INSTALL.txt). Browser fixture tests cover the scheduler and publishing interface; successful live publication still needs confirmation in the user's Chrome session.

Chrome must be running and the computer awake. Whenever Chrome starts with automation enabled, the extension immediately attempts one post and starts a fresh interval, even if the previous interval was not due. This also works when the last normal Chrome window is closed and reopened while Chrome continues running in background mode. Device shutdown is handled when Chrome next starts. Ordinary service-worker restarts and extension reloads restore the saved countdown without an extra post; missed intervals after sleep produce at most one attempt, without a backlog.

A failed attempt pauses the countdown and shows the reason through a Windows notification, red toolbar badge, and popup status. Correct the problem and click **Исправлено — повторить** in the popup, error panel, or notification to retry immediately and restart the interval. A loading failure refreshes the existing community tab on retry. A failed retry stays paused; changing the interval or restarting Chrome does not bypass a paused error. VPN advice is a connection troubleshooting hint, not VPN detection. OS notification settings may suppress notifications; popup status and the badge remain available.

The on-page action log stays hidden during normal work and appears only if an error occurs. The VK editor itself still opens while the extension creates the post.

An uncertain Publish result blocks further sending until you check the wall and confirm that the post is absent using the popup or error panel. The notification button cannot bypass that confirmation. A closed tab or interrupted job is reported by a 15-minute watchdog. The extension preserves existing drafts and stops rather than overwriting them.

Scheduling uses [Chrome alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms); Chrome may delay alarms, so intervals are best-effort rather than exact deadlines.

## Customize

Music selection prefers the exact track. Duplicate matches use the first row;
otherwise the first search result is accepted. An empty version-specific
search is repeated without the version suffix. Final attachment verification
uses the actual selected track, which may differ from the requested version.

- `extension/content.js`: VK interface automation and attachment checks.
- `extension/background.js`: quote fetching, media downloads, temporary album tabs, and publication protection.
- `extension/scheduler.js`: scheduling, community tab loading, notifications, and interrupted-job detection.
- `extension/popup.js`, `popup.html`, `popup.css`: controls and preferences.

After editing, reload the extension in `chrome://extensions` and refresh the community tab. VK interface changes can require further calibration. Selection is among loaded media; it is not a uniform sample of all community media. No VPN service is used; site availability depends on your connection.

## Tests and desktop prototype

Python and installed Google Chrome are required for browser tests:

```powershell
python -m pip install -r requirements.txt
python -m unittest test_scheduler test_extension test_login test_composer
```

For the older desktop prototype, see [README.txt](README.txt). Build it with:

```powershell
python -m pip install pyinstaller
python -m PyInstaller --noconfirm --windowed --onedir --name TriSlogaPublisher app.py
```

Browser profiles, diagnostics, local inspection scripts, and generated packages are excluded from version control.
