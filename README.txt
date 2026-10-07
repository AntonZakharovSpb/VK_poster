Три слога — Windows prototype

CHROME EXTENSION (preferred version)
Source and installable unpacked package: extension\
Install instructions: extension\INSTALL.txt
Open "Install Chrome Extension.cmd" to open Chrome's extension manager and
the source folder, then enable Developer mode and use Load unpacked.
The extension uses your normal Chrome VK login. It replaces the Windows
prototype below; do not run both publishers at the same time.
Version 0.3.0: posts immediately on browser startup, hides the normal action
log, and pauses failures until "Fixed - retry" starts a fresh countdown.
Choose an interval in hours and click Enable. See README.md and
extension\INSTALL.txt for scheduling and notification details.

STATUS: The VK publishing workflow has NOT been validated against the target
community. VK selectors in app.py may need adjustment. Do not treat this build
as a finished publisher until a live community test succeeds.

Run dist\TriSlogaPublisher\TriSlogaPublisher.exe. Keep its _internal folder beside it.
Chrome must be installed. Python is not needed for the packaged application.

First run: enter the exact community URL and its exact displayed name.
Default community: https://vk.ru/tri_sloga_band
Both vk.ru and vk.com links are accepted.
Click Save and Publish. Log into VK yourself in the Chrome window, then click
the login-complete button in the application. Passwords are not collected.
Chrome uses a separate persistent profile, not your everyday Chrome profile.

Later launches automatically attempt ONE post. It fetches a Russian quote from
Wikiquote containing the whole word любовь or счастье, includes a source link,
selects random visible photo/music entries in community media pickers, checks
the posting identity and attachments, then clicks Publish once.
Selection is among loaded visible media, not a uniform sample of every album.
The first version supports community photo/music pickers; reusing old wall
attachments is not implemented.

If any verification fails, publication stops. A screenshot is saved locally.
Chrome remains open after an error until you close Chrome or the application.
Login is checked from the current page, not an old saved login flag. The login
button is enabled only while waiting for login; there is no login time limit.
A local last-error.html snapshot is also saved for troubleshooting. It may
contain private page content; keep it private together with your profile.
If the publish click succeeds but confirmation fails, check the wall manually
before allowing a new post. The application never retries the publish click.

Settings, login profile and error screenshot:
%LOCALAPPDATA%\TriSlogaPublisher
Treat this directory as private: it contains your browser login session.

There is no VPN, cloud AI service, paid API, or external automation server.
Runtime network access is to VK and Russian Wikiquote. Availability depends
on your internet provider and those sites; access throughout Russia is not
guaranteed. CAPTCHA and VK login checks require your intervention.

Source: app.py
Customization: get_quote controls quote selection and source attribution;
pick_attachment controls media selection; publish controls browser actions
and posting checks; App controls the desktop interface and startup behavior.
Edit app.py and rebuild to update the executable. User settings and Chrome
login live outside the project and survive a rebuild.
Build: python -m pip install playwright pyinstaller
       python -m PyInstaller --noconfirm --windowed --onedir --name TriSlogaPublisher app.py
