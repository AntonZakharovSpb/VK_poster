# Три Слога — VK publisher

Chrome extension for https://vk.ru/tri_sloga_band. Version 0.5.4 creates a finite batch of scheduled posts instead of publishing periodically.

## Use

1. Reload the extension in chrome://extensions and refresh the VK community tab.
2. Choose **Amount** (number of posts) and **Interval** (seconds to wait between creating posts).
3. Click **Запланировать партию**. Keep Chrome and the VK tab open until it finishes.

The extension reads **Отложенные посты** at `https://vk.ru/wall-220995299?postponed=1` in a temporary tab using the existing VK login. It loads the list, reads dates from post headers and closes that tab, leaving the community editor open. The first new post is scheduled one day later, preserving the time of day. Each subsequent post is scheduled on the next day. If the queue is explicitly empty, the first post is scheduled tomorrow at the current Moscow time. Dates use Europe/Moscow, including month/year rollover.

It reads the shared [song document](https://docs.google.com/document/d/1P-uauTVZ_u8GkYct3f7UN__g6pTFS8y-/edit), chooses a random song and a random verse, and appends `Три слога - <song title>`. Photos are selected natively in **Выбрать из ВКонтакте → Фото VK**, scrolling the community grid to load more. No thumbnail download/upload or album tabs are used.

Music search uses the document title and selects the first similar title credited to **Три слога**, including collaborations. If none appears, it searches for a random community reserve song. If the reserve cannot be matched, it selects the first reserve search result. Duplicate versions use the first eligible row.

The final action uses **Запланировать**, verifies the date/time inputs, and confirms the resulting post and date in **Отложенные**. The normal batch flow never clicks **Опубликовать**. Progress is saved after each confirmed scheduled post; the next post starts after Interval seconds. Browser throttling or sleep can lengthen this pause.

## CAPTCHA and recovery

A visible CAPTCHA pauses actions and shows a notification and **ОК — продолжить** in the extension. Solve the challenge yourself in VK, then click that button. Closing the challenge alone does not resume actions. CAPTCHA waiting does not consume ordinary interface timeouts. **Остановить** cancels the remaining batch.

Errors pause the batch with **Исправлено — повторить** and automatically download `Tri-Sloga-diagnostics-YYYY-MM-DD_HH-MM-SS.json` to Chrome's download folder. The filename includes the Moscow date and time and is explicitly suggested through the Chrome downloads API. No diagnostics button is required. An unconfirmed scheduled submission ends its batch with a warning and retains only the confirmed count. It is never automatically retried. A new batch can start immediately and reads its dates from VK again. Old paused or stopped pending batches are recovered when the popup opens or a new batch starts. Closing/restarting the browser, closing the VK tab, or replacing its main document pauses an unfinished batch; progress is retained. Loading indicators, VK history changes, and iframe navigation do not end the publication session. Resume manually after checking VK. This version disables the previous hourly schedule.

VK controls vary by account and interface version. The extension supports the calendar popup, navigates months and years, selects the required day and time, and submits using **Добавить в очередь**. Unsupported controls or unreadable dates stop the batch and automatically download diagnostics rather than choosing an unverified date.

## Project

- `extension/content.js`: media selection, queue/date inspection, scheduling and CAPTCHA pause.
- `extension/batch.js`: batch settings, tab dispatch, saved progress and notifications.
- `extension/background.js`: document fetching and submission guards.
- `extension/popup.*`: Amount, Interval, progress and recovery controls.
- `extension/scheduler.js`: previous hourly scheduler retained for reference, not loaded by the batch version.
- `app.py`: earlier desktop prototype, not the active extension.

All automated tests use offline browser fixtures and never publish or schedule real VK posts. Run `python -m unittest discover -v`.

Changes stay on review branches until the user approves merging. Browser profiles, credentials, diagnostics and generated ZIPs are excluded from Git.
