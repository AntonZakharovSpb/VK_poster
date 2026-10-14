# AZ_vk_poster

Chrome extension for VK communities. Version 0.9.2 creates a finite batch of scheduled posts with your chosen community, artist and text source: Google Docs, a random internet quote about a supplied word or phrase, or one custom text for all posts.

Full download, installation, use and update instructions for new users: [USER_GUIDE.txt](USER_GUIDE.txt). The repository is private; a new user needs GitHub access from its owner.

Community and document links are saved immediately as you type or paste, so closing the popup to copy another link does not discard them. Other settings still use Save or Start. With audio enabled, an empty artist field uses **Три слога**. The optional **дополнительная подпись** is appended after the existing text/footer with a blank line; **Без текста** also skips this signature.

Documents without headings choose one whole numbered or dash-prefixed list item first, otherwise one section separated by blank lines, otherwise one paragraph. The footer is the community name. Documents with headings keep their existing song/verse selection.

Enable **по-порядку** under the document link to use its parts in document order instead of randomly. Each new batch starts at the first part and wraps at the end; resumed batches use their saved completed-post count, and retries keep the same part. The option is off by default.

Document excerpts end with the community name and document heading, when present. Quotes are fetched from Russian Wikiquote and end with a link to their source page. The author is included when available; a missing author does not reject the quote or trigger another search. Custom text keeps its line breaks and ends with the community name. Quote/custom modes search music by artist without a document song title. The app version is shown in the popup and diagnostics and increases with every requested change.

## Use

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `C:\Users\Anton\Documents\VK_poster\extension`. Load this folder, not the project root or the old ZIP. If already installed from this folder, click **Reload** and refresh the VK tab. For an installation from another folder, disable the old extension and load this folder.
2. Sign in to VK in Chrome with an account allowed to create community posts. Pin **AZ_vk_poster** using Chrome's extensions menu.
3. Open the popup, enter **Ссылка на сообщество VK**, **Исполнитель для прикрепленных треков**, and **Ссылка на Google Документ с текстами**, and click **Сохранить настройки**. Both `https://vk.ru/name` and `https://vk.com/club123` community links work. Numeric `club<ID>` or `public<ID>` links can also be used when VK does not expose the ID for a short name. Community and document fields start empty; the default artist is **Три слога**. Explicitly saved settings remain saved.
4. Check **Без аудио** to skip music, or **Без текста** to disable all text fields and skip text retrieval. Both options can be enabled for a photo-only post. Select a text mode: **Документ по ссылке** (publicly readable Google Doc; heading styles for titles, blank paragraphs between verses), **Случайная цитата из интернета** (enter a topic word or phrase), or **Один текст для всех постов** (enter your text). Text and authorless quotes are never invented when no matching quote is found; the batch pauses with an explanation.
5. Choose **Всего постов (Amount)**, **Пауза, сек. (Interval)** between creation attempts, **Постов в день** (1–12), **Время начала (Москва)**, and **Интервал2 внутри дня, часы**. Starting time + (posts per day - 1) × Interval2 must be strictly before 24:00; intervals have whole-minute precision. The popup previews daily times. Click **Запланировать партию**. Starting also saves the current fields. Keep Chrome and the VK tab open until it finishes. Settings are saved between popup openings and fixed for a running or paused batch; stop it before changing them.

The extension reads **Отложенные посты** at `https://vk.ru/wall-<selected community ID>?postponed=1` (or the `vk.com` equivalent) in a temporary tab using the existing VK login at batch start/resume. It loads the list, reads dates from post headers and closes that tab, leaving the community editor open. The first day is the day after its latest post, or tomorrow if empty, at your selected Moscow starting time. Each day gets up to the selected number of posts at Interval2-hour gaps. Amount is the total across all days; the final day can be partial. A saved timing plan keeps remaining same-day slots on resume. If newer external posts appear while paused, remaining posts start the day after that new latest date. Dates use Europe/Moscow, including month/year rollover.

It reads the selected Google Doc and chooses a song verse or an untitled post item, randomly by default or in document order with **по-порядку**. The footer contains the community name and title when present. Photos are selected natively in **Выбрать из ВКонтакте → Фото VK**, scrolling the community grid to load more. No thumbnail download/upload or album tabs are used.

Music search first uses **the selected artist + the document song title** and selects the first similar title credited to that artist, including collaborations. If that fails or there is no title, it searches by **artist name only** and chooses a random matching track. If no track matches the exact artist name, it searches **Три слога** and chooses a random eligible track by that band. A Chrome notification and popup warning ask the user to check the exact artist name; the warning does not pause the batch and is notified once per batch. If the fallback search also has no eligible tracks, the batch pauses. A missing or empty community music tab does not prevent searching the selected artist.

**Не кота бот** credited to **Три слога**, including versions and collaborations, is excluded from every audio selection path. Another eligible track is chosen instead. With **Без текста**, music uses the artist-only search. With **Без аудио**, music search and attachment are skipped entirely. Photo selection remains unchanged.

The final action uses **Запланировать** and verifies the date/time inputs before sending. After submission, a closed editor without a new visible VK error counts as sent. No scheduled-posts tab is opened and no queue lookup is performed after each post. The normal batch flow never clicks **Опубликовать**. Progress is saved after each accepted submission; the next creation attempt starts after Interval seconds. Browser throttling or sleep can lengthen this pause.

Queue inspection scrolls to the actual bottom of the page or nested list, waits for loading indicators and a stable bottom, and keeps the maximum date seen across loaded pages. A list that never finishes loading stops the batch before choosing a date.

## CAPTCHA and recovery

A visible CAPTCHA pauses actions and shows a notification and **ОК — продолжить** in the extension. Solve the challenge yourself in VK, then click that button. Closing the challenge alone does not resume actions. CAPTCHA waiting does not consume ordinary interface timeouts. **Остановить** cancels the remaining batch.

Errors pause the batch with **Исправлено — повторить** and automatically download `Tri-Sloga-diagnostics-YYYY-MM-DD_HH-MM-SS.json` to Chrome's download folder. The filename includes the Moscow date and time. No diagnostics button is required. Failures before submission, a visible submission error, an editor that remains open, and unexpected interruptions stop the batch and download diagnostics. Closed editors without errors are accepted without queue verification or a confirmation prompt. Already paused batches do not download again on extension startup. Closing/restarting the browser, closing the VK tab, or replacing its main document pauses an unfinished batch; progress is retained. Loading indicators, VK history changes, and iframe navigation do not end the publication session. Resume manually after checking VK. This version disables the previous hourly schedule.

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
