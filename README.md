# Три Слога — VK publisher

Editable Chrome extension for https://vk.ru/tri_sloga_band, with an earlier Windows desktop prototype included in `app.py`.

The extension uses your existing Chrome VK login, chooses a random loaded community photo and song, and adds a Russian quote from Wikiquote containing «любовь» or «счастье». You can review the draft or enable immediate publication.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` in your normal Chrome profile and enable Developer mode.
3. Click **Load unpacked** and select this repository's `extension` folder.
4. Log into VK, open the community, and click the extension icon.

For calibration, disable immediate publication and inspect the draft first. Full instructions and known limitations are in [extension/INSTALL.txt](extension/INSTALL.txt). The latest changes have browser fixture coverage; successful live publication still needs confirmation in the user's Chrome session.

## Customize

- `extension/content.js`: VK interface automation and attachment checks.
- `extension/background.js`: quote fetching, media downloads, temporary album tabs, and publication protection.
- `extension/popup.js`, `popup.html`, `popup.css`: controls and preferences.

After editing, reload the extension in `chrome://extensions` and refresh the community tab. VK interface changes can require further calibration. Selection is among loaded media; it is not a uniform sample of all community media. No VPN service is used; site availability depends on your connection.

## Tests and desktop prototype

Python and installed Google Chrome are required for browser tests:

```powershell
python -m pip install -r requirements.txt
python -m unittest test_extension test_login test_composer
```

For the older desktop prototype, see [README.txt](README.txt). Build it with:

```powershell
python -m pip install pyinstaller
python -m PyInstaller --noconfirm --windowed --onedir --name TriSlogaPublisher app.py
```

Browser profiles, diagnostics, local inspection scripts, and generated packages are excluded from version control.
