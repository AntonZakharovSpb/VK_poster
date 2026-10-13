# AZ_vk_poster

Chrome extension for VK communities. Version 0.6.0 creates a finite batch of scheduled posts and lets you choose the community, music artist, and Google Docs text source.

## Use

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `C:\Users\Anton\Documents\VK_poster\extension`. Load this folder, not the project root or the old ZIP. If already installed from this folder, click **Reload** and refresh the VK tab. For an installation from another folder, disable the old extension and load this folder.
2. Sign in to VK in Chrome with an account allowed to create community posts. Pin **AZ_vk_poster** using Chrome's extensions menu.
3. Open the popup, enter **Ссылка на сообщество VK**, **Исполнитель**, and **Ссылка на Google Документ с текстами**, and click **Сохранить настройки**. Both `https://vk.ru/name` and `https://vk.com/club123` community links work. Numeric `club<ID>` or `public<ID>` links can also be used when VK does not expose the ID for a short name. The default artist is **Три слога**; the previous community and document remain initial defaults.
4. The Google Doc must be readable via its link without signing in. Use real heading styles for song titles and paragraphs for lyrics; separate verses with blank paragraphs. A private document requiring a Google login will stop the batch. Only Google Docs links are supported for now.
5. Choose **Amount** (number of posts) and **Interval** (seconds to wait between creating posts), then click **Запланировать партию**. Starting also saves the current fields. Keep Chrome and the VK tab open until it finishes. Settings are saved between popup openings and fixed for a running or paused batch; stop it before changing them.

The extension reads **Отложенные посты** at `https://vk.ru/wall-<selected community ID>?postponed=1` (or the `vk.com` equivalent) in a temporary tab using the existing VK login. It loads the list, reads dates from post headers and closes that tab, leaving the community editor open. The first new post is scheduled one day later, preserving the time of day. Each subsequent post is scheduled on the next day. If the queue is explicitly empty, the first post is scheduled tomorrow at the current Moscow time. Dates use Europe/Moscow, including month/year rollover.

It reads the selected Google Doc, chooses a random song and a random verse with the existing parser, and appends `<selected artist> - <song title>`. Song selection and verse selection are unchanged. Photos are selected natively in **Выбрать из ВКонтакте → Фото VK**, scrolling the community grid to load more. No thumbnail download/upload or album tabs are used.

Music search uses **the selected artist + the document song title** and selects the first similar title credited to that artist, including collaborations. If none appears, it searches for the selected artist with a random community reserve title and uses the first eligible result. A missing or empty community music tab does not prevent searching the selected artist. Results from a different artist are not attached. Duplicate versions use the first eligible row.

The final action uses **Запланировать**, verifies the date/time inputs, and confirms the resulting post and date in **Отложенные**. The normal batch flow never clicks **Опубликовать**. Progress is saved after each confirmed scheduled post; the next post starts after Interval seconds. Browser throttling or sleep can lengthen this pause.

## CAPTCHA and recovery

A visible CAPTCHA pauses actions and shows a notification and **ОК — продолжить** in the extension. Solve the challenge yourself in VK, then click that button. Closing the challenge alone does not resume actions. CAPTCHA waiting does not consume ordinary interface timeouts. **Остановить** cancels the remaining batch.

Errors pause the batch with **Исправлено — повторить** and automatically download `Tri-Sloga-diagnostics-YYYY-MM-DD_HH-MM-SS.json` to Chrome's download folder. The filename includes the Moscow date and time and is explicitly suggested through the Chrome downloads API. No diagnostics button is required. If the editor closed after submission but verification cannot confirm the text/date in VK, the batch continues without retrying that post. Its intended Moscow date/time is retained in the final popup report. No confirmation click or diagnostic download is needed for this case. Failures before submission, an editor that remains open, and unexpected interruptions still stop the batch and download diagnostics. Already paused batches do not download again on extension startup. Closing/restarting the browser, closing the VK tab, or replacing its main document pauses an unfinished batch; progress is retained. Loading indicators, VK history changes, and iframe navigation do not end the publication session. Resume manually after checking VK. This version disables the previous hourly schedule.

VK controls vary by account and interface version. The extension supports the calendar popup, navigates months and years, selects the required day and time, and submits using **Добавить в очередь**. Unsupported controls or unreadable dates stop the batch and automatically download diagnostics rather than choosing an unverified date.

## Project

- `extension/config.js`: defaults, settings validation, Google Docs export URLs, and community identification.
- `extension/content.js`: media selection, queue/date inspection, scheduling and CAPTCHA pause.
- `extension/batch.js`: batch settings, tab dispatch, saved progress and notifications.
- `extension/background.js`: document fetching and submission guards.
- `extension/popup.*`: community, artist, document, Amount, Interval, progress and recovery controls.
- `extension/scheduler.js`: previous hourly scheduler retained for reference, not loaded by the batch version.
- `app.py`: earlier desktop prototype, not the active extension.

All automated tests use offline browser fixtures and never publish or schedule real VK posts. Run `python -m unittest discover -v`.

Changes stay on local branches until the user approves pushing and merging. Browser profiles, credentials, diagnostics and generated ZIPs are excluded from Git.

Verification normalizes whitespace, retains matches seen while scrolling, and records the underlying error plus text/date match details in diagnostics.
