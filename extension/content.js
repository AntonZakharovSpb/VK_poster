(() => {
  if (globalThis.TriSloga) return;
  const OWNER = '-220995299';
  const PATH = '/tri_sloga_band';
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const normalize = text => (text || '').replace(/\s+/g, ' ').trim();
  const visible = el => !!el && !el.closest('[hidden],[aria-hidden="true"]') &&
    getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' &&
    el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
  const all = (scope, selector) => [...scope.querySelectorAll(selector)];
  const label = el => normalize(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent);
  const state = {running: false, stopped: false, stage: '', logs: [], composer: null, photo: null, audio: null, panel: null,
    photoPreview: null, photoAttached: false, audioSelectionVerified: null, communityContext: false};

  function one(items, description) {
    const matches = [...new Set(items)].filter(visible);
    if (matches.length !== 1) throw new Error(`${description}: найдено элементов — ${matches.length}.`);
    return matches[0];
  }
  function control(scope, regex) {
    return all(scope, 'button,[role="button"],[role="menuitem"],a,[tabindex="0"]').filter(el => regex.test(label(el)));
  }
  function log(text) {
    state.logs.push(`${new Date().toLocaleTimeString('ru-RU')} · ${text}`);
    if (state.panel) state.panel.querySelector('pre').textContent = state.logs.join('\n');
  }
  async function until(fn, description, timeout = 15000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (state.stopped) throw new Error('Остановлено пользователем.');
      const result = fn();
      if (result) return result;
      await delay(200);
    }
    throw new Error(`Не найдено: ${description}.`);
  }
  async function click(el) {
    if (state.stopped) throw new Error('Остановлено пользователем.');
    if (!visible(el)) throw new Error('Нужная кнопка сейчас скрыта.');
    el.scrollIntoView({block: 'center'});
    // Let sticky headers/React settle after scrolling before sending the press.
    await delay(120);
    if (!el.isConnected && el.dataset.testid) {
      el = one(all(document, `[data-testid="${CSS.escape(el.dataset.testid)}"]`), 'обновлённая кнопка');
    }
    if (state.stopped) throw new Error('Остановлено пользователем.');
    if (!visible(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') throw new Error('Кнопка недоступна.');
    const rect = el.getBoundingClientRect();
    const options = {bubbles: true, cancelable: true, composed: true, view: window,
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, button: 0, detail: 1};
    // Some VK controls open on a pointer/mouse press rather than a lone click.
    for (const type of ['pointerover', 'mouseover', 'pointerenter', 'mouseenter', 'pointermove', 'mousemove',
                        'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      if (type === 'pointerup') el.focus?.({preventScroll: true});
      const down = type.endsWith('down');
      const EventClass = type.startsWith('pointer') ? PointerEvent : MouseEvent;
      el.dispatchEvent(new EventClass(type, {...options, bubbles: !type.endsWith('enter'), buttons: down ? 1 : 0,
        pointerId: 1, pointerType: 'mouse', isPrimary: true}));
    }
  }
  async function message(data) {
    const reply = await chrome.runtime.sendMessage(data);
    if (!reply?.ok) throw new Error(reply?.error || 'Нет ответа от расширения.');
    return reply;
  }
  function panel() {
    let host = document.getElementById('tri-sloga-extension-panel');
    if (!host) {
      host = document.createElement('div'); host.id = 'tri-sloga-extension-panel';
      host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647';
      document.documentElement.append(host);
      const root = host.attachShadow({mode: 'open'});
      root.innerHTML = `<style>:host{font:13px "Segoe UI",sans-serif;color:#17212d}section{width:330px;background:white;border:1px solid #d4dfec;box-shadow:0 8px 32px #17212d25;border-radius:16px;padding:16px}header{display:flex;justify-content:space-between;align-items:center;font-size:16px;font-weight:600}pre{white-space:pre-wrap;overflow:auto;max-height:220px;font:12px/1.6 "Segoe UI",sans-serif;color:#4c5e73}button{border:0;border-radius:8px;padding:8px 10px;background:#e9f1fc;color:#006edd;cursor:pointer;font:12px "Segoe UI"}.actions{display:flex;gap:8px;flex-wrap:wrap}.reset{margin-top:8px}small{color:#657688;font-size:11px}</style><section><header>Три Слога <button id="hide">Скрыть</button></header><pre></pre><div class="actions"><button id="stop">Остановить</button><button id="copy">Копировать журнал</button></div><button class="reset" id="fixed">Исправлено — повторить</button><button class="reset" id="reset">Я проверил стену: разрешить новую попытку</button><p><small>Устраните причину ошибки и нажмите «Исправлено — повторить».</small></p></section>`;
      root.getElementById('fixed').onclick = async () => {
        if (state.running) return;
        const {publicationAttempt} = await chrome.storage.local.get('publicationAttempt');
        const uncertain = publicationAttempt?.status === 'pending';
        if (uncertain && !confirm('Проверьте стену: предыдущий пост мог появиться. Подтвердите, что его нет, прежде чем создавать новый.')) return;
        try { await message({type:'scheduleRetry', confirmNoPost:uncertain}); }
        catch (error) { panel(); log(error.message); }
      };
      root.getElementById('hide').onclick = () => { host.style.display = 'none'; };
      root.getElementById('stop').onclick = () => {
        state.stopped = true; log('Останавливаю действия и расписание…');
        message({type: 'scheduleStop'}).catch(() => {});
      };
      root.getElementById('copy').onclick = async () => {
        try { await navigator.clipboard.writeText(state.logs.join('\n')); log('Журнал скопирован.'); }
        catch { log('Не удалось скопировать. Журнал можно выделить вручную.'); }
      };
      root.getElementById('reset').onclick = async () => {
        if (state.running) { log('Сначала дождитесь завершения текущей попытки.'); return; }
        if (confirm('Проверьте стену сообщества. Предыдущий пост мог быть опубликован. Разрешить НОВУЮ попытку?')) {
          await chrome.storage.local.remove('publicationAttempt'); log('Разрешена новая попытка.');
        }
      };
      state.panel = root;
    } else { host.style.display = 'block'; }
    state.panel.querySelector('pre').textContent = state.logs.join('\n');
  }

  function photoCandidates(scope = document) {
    const result = new Map();
    for (const anchor of all(scope, 'a[href]')) {
      if (anchor.closest('[data-testid="post"],.wall_item')) continue;
      const id = anchor.getAttribute('href')?.match(new RegExp(`(?:/|^)photo(${OWNER}_\\d+)`))?.[1];
      const img = anchor.querySelector('img');
      if (id && img && visible(anchor) && (img.currentSrc || img.src)) {
        result.set(id, {id, url: anchor.href, image: img.currentSrc || img.src});
      }
    }
    for (const item of all(scope, '[data-photo-id]')) {
      const id = item.dataset.photoId;
      const img = item.querySelector('img');
      if (id?.startsWith(OWNER + '_') && visible(item) && img?.src && !item.closest('[data-testid="post"]')) {
        result.set(id, {id, url: `${location.origin}/photo${id}`, image: img.currentSrc || img.src});
      }
    }
    return [...result.values()];
  }
  function audioCandidates(scope = document) {
    const result = new Map();
    for (const row of all(scope, '[data-audio-id],.audio_row[data-full-id]')) {
      const id = row.dataset.audioId || row.dataset.fullId;
      if (!id?.startsWith(OWNER + '_') || !visible(row) || row.closest('[data-testid="post"],.wall_item')) continue;
      const title = normalize(row.querySelector('[data-testid="MusicTrackRow_Title"],.audio_row__title_inner,.audio_row__title')?.textContent);
      const artist = normalize(row.querySelector('[data-testid="MusicTrackRow_Authors"],.audio_row__performer')?.textContent);
      const duration = normalize(row.querySelector('[data-testid="MusicTrackRow_Duration"],.audio_row__duration')?.textContent);
      if (title) result.set(id, {id, title, artist, duration});
    }
    return [...result.values()];
  }
  async function section(name) {
    const tab = await until(() => all(document, `[data-testid="group_tab_${name}"]`).find(visible), `вкладка ${name}`);
    await click(tab);
    await delay(1000);
    if (location.pathname !== PATH) throw new Error('VK открыл другую страницу. Откройте сообщество и запустите снова.');
  }
  async function collectMedia() {
    state.stage = 'community photos';
    log('Ищу фотографии во вкладке Фото сообщества.');
    await section('photos');
    let photos = await until(() => {
      const items = photoCandidates();
      const albums = all(document, 'a[href]').filter(a => new RegExp(`^/album${OWNER}_\\d+$`).test(new URL(a.href, location.href).pathname));
      return items.length ? {items} : albums.length ? {albums} : null;
    }, 'фотографии или альбомы сообщества');
    if (photos.albums) {
      const album = photos.albums[Math.floor(Math.random() * photos.albums.length)];
      log('Открываю случайный альбом в служебной вкладке; после выбора фото она закроется.');
      const result = await message({type: 'album', url: album.href});
      photos = result.photos;
    } else photos = photos.items;
    if (!photos.length) throw new Error('В выбранном альбоме нет доступных фотографий.');
    state.photo = photos[Math.floor(Math.random() * photos.length)];
    log(`Выбрана фотография ${state.photo.id} из ${photos.length} загруженных.`);
    state.stage = 'community music';
    await section('audios');
    const audios = await until(() => { const items = audioCandidates(); return items.length ? items : null; }, 'песни сообщества');
    state.audio = audios[Math.floor(Math.random() * audios.length)];
    log(`Выбрана песня: ${state.audio.artist} — ${state.audio.title}.`);
    await section('wall');
  }

  function composerCandidates() {
    const modern = all(document, '[data-testid="posting_modal_box"]').filter(visible).map(root => {
      const editor = all(root, '[contenteditable="true"],textarea').find(visible);
      return editor ? {root, editor, publish: control(root, /^Опубликовать$/u).find(visible), modern: true} : null;
    }).filter(Boolean);
    if (modern.length) return modern;
    const publishButtons = control(document, /^Опубликовать$/u).filter(visible);
    const result = [];
    for (const button of publishButtons) {
      let parent = button.parentElement;
      for (let i = 0; parent && parent !== document.body && i < 14; i++, parent = parent.parentElement) {
        const editors = all(parent, '[contenteditable="true"],textarea').filter(el => visible(el) &&
          !/коммент|ответ/iu.test(el.getAttribute('aria-label') || el.getAttribute('placeholder') || '') &&
          !el.closest('[data-testid="wall_comments_comment_root"],[data-testid="wall_comments_layout_root"]'));
        if (editors.length === 1 && !parent.querySelector('[data-testid="feed-items"]')) {
          result.push({root: parent, editor: editors[0], publish: button}); break;
        }
      }
    }
    return result;
  }
  async function openComposer({unattended = false} = {}) {
    if (composerCandidates().length) throw new Error('Уже открыт редактор с черновиком. Завершите или закройте его перед запуском.');
    const create = await until(() => all(document, '[data-testid="group_publish_create_button"]').find(visible), 'кнопка «Создать»');
    state.communityContext = !!create.closest('[data-testid="group_publish_block"]') &&
      location.pathname === PATH && all(document,'[data-testid="group-name"]').some(el=>/^Три Слога$/iu.test(normalize(el.textContent))) &&
      all(document,'[data-testid="group_manage_menu_manage"]').some(visible);
    await click(create);
    const detect = () => {
      if (composerCandidates().length) return {editor: true};
      const menu = creationMenuItems();
      return menu.length ? {menu} : null;
    };
    let opened;
    try { opened = await until(detect, 'меню создания поста или редактор', 5000); }
    catch (error) {
      if (state.stopped) throw error;
      if (unattended) throw new Error('VK не открыл меню создания поста автоматически. Скачайте диагностику: требуется настройка интерфейса.');
      log('VK не открыл меню автоматически. Нажмите «Создать» на странице VK; я продолжу после открытия меню.');
      opened = await until(detect, 'меню после нажатия «Создать»', 120000);
    }
    if (opened.menu) await click(one(opened.menu, 'пункт «Пост»'));
    const items = await until(() => { const list = composerCandidates(); return list.length ? list : null; }, 'редактор новой публикации');
    if (items.length !== 1) throw new Error('Открыто несколько редакторов публикации.');
    state.composer = items[0];
    if (normalize(state.composer.editor.textContent || state.composer.editor.value)) throw new Error('В редакторе уже есть текст. Черновик сохранён; очистите его вручную перед новым запуском.');
    return items[0];
  }
  function creationMenuItems() {
    const regex = /^(Запись|Пост|Создать запись|Написать запись)$/u;
    const items = [];
    for (const root of all(document, '[data-testid="dropdownactionsheet"],[role="menu"],[role="dialog"]')) {
      if (!visible(root) || root.matches('[data-testid="posting_modal_box"]')) continue;
      const controls = control(root, regex).filter(visible);
      if (controls.length) { items.push(...controls); continue; }
      // VK also renders plain spans inside clickable cells without menuitem roles.
      const leaves = all(root, 'span,div').filter(el => visible(el) && regex.test(normalize(el.textContent)) &&
        !all(el,'span,div').some(child=>regex.test(normalize(child.textContent))));
      items.push(...leaves);
    }
    return [...new Set(items)];
  }
  function setText(editor, text) {
    editor.focus();
    if (editor.tagName === 'TEXTAREA') {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(editor, text);
      editor.dispatchEvent(new Event('input', {bubbles: true}));
    } else {
      const selection = getSelection();
      const range = document.createRange(); range.selectNodeContents(editor); selection.removeAllRanges(); selection.addRange(range);
      if (!document.execCommand('insertText', false, text)) {
        editor.textContent = text;
        editor.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: text}));
      }
    }
  }
  function currentComposerRoot() {
    const modern = all(document, '[data-testid="posting_modal_box"]').find(visible);
    if (modern) return modern;
    const editor = state.composer?.editor;
    // Prefer the entire editor dialog over a small text/button container.
    return editor?.closest('[role="dialog"],.box_layout,#submit_post_box,[data-testid="post-composer"]') || state.composer?.root;
  }
  async function attachmentControl(kind) {
    const regex = kind === 'photo' ? /^(Фотография|Фото|Добавить фото|Прикрепить фото)$/u : /^(Музыка|Аудиозапись|Добавить музыку|Прикрепить музыку)$/u;
    const root = currentComposerRoot();
    let matches = control(root, regex).filter(visible);
    if (!matches.length) {
      const more = control(root, /^(Прикрепить|Ещё|Добавить вложение)$/u).filter(visible);
      if (more.length === 1) {
        await click(more[0]);
        await delay(250);
        // A menu can be portalled outside the editor. Only search explicit menus.
        matches = all(document, '[role="menu"],[role="listbox"]').flatMap(menu => control(menu, regex)).filter(visible);
      }
    }
    return one(matches, `кнопка ${kind === 'photo' ? 'Фото' : 'Музыка'} в редакторе публикации`);
  }
  async function attachPhoto() {
    state.stage = 'attach photo';
    const originalImages = new Set(all(currentComposerRoot(), 'img').map(img => img.currentSrc || img.src));
    const image = await message({type: 'image', url: state.photo.image});
    const data = Uint8Array.from(atob(image.base64), char => char.charCodeAt(0));
    const ext = image.mime === 'image/png' ? 'png' : image.mime === 'image/webp' ? 'webp' : 'jpg';
    const file = new File([data], `tri-sloga-${state.photo.id}.${ext}`, {type: image.mime});
    let inputs = all(currentComposerRoot(), 'input[type="file"]').filter(el => /image|\.jpe?g|\.png/iu.test(el.accept));
    if (!inputs.length) {
      await click(await attachmentControl('photo'));
      await delay(500);
      const dialogs = all(document, '[role="dialog"],.box_layout').filter(visible);
      inputs = dialogs.flatMap(root => all(root, 'input[type="file"]')).filter(el => /image|\.jpe?g|\.png/iu.test(el.accept));
    }
    inputs = [...new Set(inputs)];
    if (inputs.length !== 1) throw new Error('Не удалось определить загрузку фото в редакторе. Если VK открыл выбор файла, закройте его; отправьте диагностику.');
    if (state.stopped) throw new Error('Остановлено пользователем.');
    const transfer = new DataTransfer(); transfer.items.add(file); inputs[0].files = transfer.files;
    inputs[0].dispatchEvent(new Event('change', {bubbles: true}));
    await until(() => {
      const root = currentComposerRoot();
      if (photoAttachments(root).length === 1) return true;
      if (state.composer.modern) {
        const newImages = all(root, 'img').filter(img => visible(img) && (img.currentSrc || img.src) &&
          !originalImages.has(img.currentSrc || img.src) && img.getBoundingClientRect().width >= 80 &&
          img.getBoundingClientRect().height >= 80 && !img.closest('[data-testid*="avatar"]'));
        if (newImages.length === 1) { state.photoPreview = newImages[0].currentSrc || newImages[0].src; return true; }
      }
      return false;
    }, 'прикреплённая фотография', 30000);
    state.photoAttached = true;
    log('Фотография из сообщества прикреплена.');
  }
  function photoAttachments(root) {
    const specific = all(root, '[data-attachment-type="photo"],.page_preview_photo,[data-testid="primary-attachment-photo"],[data-testid="post-editor-photo"],[data-testid="photo-attachment"],[data-testid^="posting_"][data-testid*="photo"]')
      .filter(visible).filter((el, i, items) => !items.some(other => other !== el && other.contains(el)));
    if (specific.length) return specific;
    if (state.photoAttached) {
      const previews = all(root,'[data-testid="posting_preview_attachment_item"]').filter(el=>visible(el) &&
        el.querySelector('img') && !el.querySelector('video,[data-attachment-type="video"]'));
      if (previews.length) return previews;
    }
    return state.photoPreview ? all(root,'img').filter(img=>visible(img) && (img.currentSrc || img.src) === state.photoPreview) : [];
  }
  function audioAttachments(root) {
    if (root.querySelector('[data-testid="posting_audio_search_audio_input"]')) return [];
    const summaries = all(root,'[data-testid="posting_audio_select_audio_selected"]').filter(visible);
    if (summaries.length) {
      if (summaries.length !== 1 || state.audioSelectionVerified !== state.audio.id) return [];
      const summary = summaries[0];
      const id = rowAudioId(summary);
      if (id && id !== state.audio.id) return [];
      const clone = summary.cloneNode(true);
      for (const el of all(clone,'button,[data-testid="posting_audio_unselect_audio"]')) el.remove();
      const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
      const parts = [];
      while (walker.nextNode()) if (normalize(walker.currentNode.textContent)) parts.push(walker.currentNode.textContent);
      const text = normalize(parts.join(' ')).toLocaleLowerCase('ru');
      const expected = normalize(`${state.audio.title} ${state.audio.artist}`).toLocaleLowerCase('ru');
      return text === expected || (state.audio.duration && text === `${expected} ${state.audio.duration}`) ? summaries : [];
    }
    const items = audioRows(root);
    const outer = items.filter(row => !items.some(other => other !== row && other.contains(row)));
    return outer.length === 1 && matchesAudio(outer[0], state.audio) ? outer : [];
  }
  function audioRows(root) {
    return all(root, '[data-audio-id],.audio_row[data-full-id],[data-testid="posting_audio_audio_track_row"],[data-testid="music-cell"]')
      .filter(visible);
  }
  function rowAudioId(row) {
    const elements = [row, ...all(row, '[data-audio-id],[data-full-id],[data-track-id],[data-id],input[value]')];
    for (const el of elements) {
      for (const value of [el.dataset.audioId, el.dataset.fullId, el.dataset.trackId, el.dataset.id, el.getAttribute('value')]) {
        if (/^-?\d+_\d+$/u.test(value || '')) return value;
      }
    }
    return null;
  }
  function matchesAudio(row, audio) {
    const id = rowAudioId(row);
    if (id) return id === audio.id;
    const title = normalize(row.querySelector('[data-testid="music-cell-title"],[data-testid="MusicTrackRow_Title"],.audio_row__title_inner')?.textContent);
    const artist = normalize(row.querySelector('[data-testid="music-cell-artists"],[data-testid="MusicTrackRow_Authors"],.audio_row__performer')?.textContent);
    const duration = row.textContent.match(/\b\d{1,3}:\d{2}\b/u)?.[0];
    return !!audio.title && !!audio.artist && title.toLocaleLowerCase('ru') === audio.title.toLocaleLowerCase('ru') &&
      artist.toLocaleLowerCase('ru') === audio.artist.toLocaleLowerCase('ru') && (!audio.duration || duration === audio.duration);
  }
  function selectedAudioRow(picker) {
    const matches = audioRows(picker).filter(row => matchesAudio(row, state.audio));
    const outer = matches.filter(row => !matches.some(other => other !== row && other.contains(row)));
    if (outer.length > 1) throw new Error('Несколько песен совпадают с выбранной. Нужна диагностика; случайная замена не выбрана.');
    return outer[0];
  }
  function musicPicker() {
    const searches = all(document, '[data-testid="posting_audio_search_audio_input"]').filter(visible);
    if (searches.length === 1) return searches[0].closest('[role="dialog"],.box_layout');
    const dialogs = all(document, '[role="dialog"],.box_layout').filter(root => visible(root) &&
      !root.contains(state.composer.editor) && root.querySelector('input,.audio_row,[data-audio-id]'));
    // Nested popup wrappers are one picker; retain the innermost container.
    return one(dialogs.filter(root => !dialogs.some(inner => inner !== root && root.contains(inner))), 'выбор музыки');
  }
  async function attachAudio() {
    state.stage = 'attach music';
    await click(await attachmentControl('audio'));
    await delay(500);
    const picker = musicPicker();
    const community = control(picker, /^Три Слога$/iu).filter(visible);
    if (community.length === 1) await click(community[0]);
    let row = selectedAudioRow(picker);
    if (!row) {
      const search = one(all(picker, 'input').filter(el => (el.dataset.testid === 'posting_audio_search_audio_input' || /поиск|найти/iu.test(el.placeholder || el.getAttribute('aria-label') || '')) && visible(el)), 'поиск в выборе музыки');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, `${state.audio.artist} ${state.audio.title}`.trim());
      search.dispatchEvent(new Event('input', {bubbles: true}));
      row = await until(() => selectedAudioRow(picker), 'выбранная песня сообщества в списке музыки');
    }
    const selection = row.querySelector('[data-testid="posting_audio_audio_track_selected_icon"],input[type="checkbox"]');
    if (selection) {
      if (!selection.checked) await click(visible(selection) ? selection : row);
      await until(() => {
        const current = selectedAudioRow(picker);
        return current?.querySelector('[data-testid="posting_audio_audio_track_selected_icon"],input[type="checkbox"]')?.checked ||
          current?.getAttribute('aria-selected') === 'true';
      }, 'отмеченная песня');
    } else {
      const add = [...control(row, /^(Добавить|Прикрепить|Выбрать|Добавить аудиозапись)$/u), ...all(row, '.audio_row__action_add')];
      await click(one(add, 'добавление выбранной песни'));
    }
    state.audioSelectionVerified = state.audio.id;
    const done = control(picker, /^(Прикрепить|Готово|Сохранить)$/u).filter(visible);
    if (done.length === 1) await click(done[0]);
    await until(() => audioAttachments(currentComposerRoot()).length === 1, 'прикреплённая песня сообщества');
    log('Песня сообщества прикреплена.');
  }
  async function advanceComposer() {
    if (!state.composer.modern) return;
    const next = all(currentComposerRoot(), '[data-testid="posting_base_screen_next"]').find(visible);
    if (!next) return;
    state.stage = 'next posting screen';
    await click(next);
    await until(() => !next.isConnected || !visible(next), 'следующий шаг формы публикации');
    await delay(300);
  }
  function authorVerified(root) {
    const controls = all(root, '[data-testid*="author"],[data-testid*="publisher"],[data-testid*="owner"],.post_from_group,.submit_post_from')
      .filter(el=>visible(el) && !/coowners|coauthors/u.test(el.dataset.testid || ''));
    if (controls.length) return controls.some(el => el.getAttribute('data-owner-id') === OWNER ||
      /^Три Слога$/iu.test(normalize(el.textContent)) ||
      all(el, 'a[href]').some(a => new URL(a.href, location.href).pathname === PATH));
    // Modern group publishing has no author selector. Its target is fixed by
    // the community admin Create block that opened this same posting dialog.
    return state.communityContext && state.composer?.modern && location.pathname === PATH &&
      root.dataset.testid === 'posting_modal_box' && !!root.querySelector('[data-testid="posting_submit_button"]');
  }
  function parseQuotes(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return [...new Set(all(doc, '.mw-parser-output li').filter(el => !el.querySelector('li')).map(el =>
      normalize(el.textContent.replace(/\[\d+\]/gu, ''))).filter(text => text.length >= 35 && text.length <= 240 &&
      /(^|[^а-яё])(?:любовь|счастье)(?=$|[^а-яё])/iu.test(text) && !/↑|ISBN|http|править/iu.test(text)))];
  }
  async function getQuote(custom) {
    if (custom) {
      if (!/(^|[^а-яё])(?:любовь|счастье)(?=$|[^а-яё])/iu.test(custom)) throw new Error('Текст должен содержать «любовь» или «счастье».');
      return custom;
    }
    const result = await message({type: 'quote'});
    const quotes = parseQuotes(result.html);
    if (!quotes.length) throw new Error('Не удалось получить подходящую цитату из интернета.');
    return quotes[Math.floor(Math.random() * quotes.length)] + '\n\nИсточник: ' + result.source;
  }
  function diagnostics(error = '') {
    const scope = currentComposerRoot() || document;
    return {version: '0.3.0', time: new Date().toISOString(), stage: state.stage, error,
      page: location.origin + location.pathname + location.hash,
      photo: state.photo?.id, audio: state.audio?.id,
      communityContext: state.communityContext, photoAttached: state.photoAttached, audioSelectionVerified: state.audioSelectionVerified,
      controls: all(scope, 'button,[role="button"],[role="menuitem"],input,[contenteditable="true"]').filter(visible).slice(0,100).map(el => ({
        tag: el.tagName, role: el.getAttribute('role'), testid: el.dataset.testid,
        id: el.id, label: label(el).slice(0,90), accept: el.getAttribute('accept')})),
      fileInputs: all(document,'input[type="file"]').map(el=>({id:el.id,testid:el.dataset.testid,accept:el.accept,
        inComposer:!!state.composer && currentComposerRoot().contains(el)})),
      menus: all(document,'[role="menu"],[role="dialog"],[data-testid="dropdownactionsheet"]')
        .filter(visible).map(root=>({role:root.getAttribute('role'),testid:root.dataset.testid,
          labels:all(root,'span,button,[role="menuitem"]').filter(visible).map(el=>label(el).slice(0,80)).slice(0,35)})),
      audioRows: audioRows(scope).slice(0,30).map(row=>({id:rowAudioId(row),testid:row.dataset.testid,
        label:normalize(row.textContent).slice(0,130),checked:row.querySelector('input[type="checkbox"]')?.checked})),
      testids: [...new Set(all(scope, '[data-testid]').map(el => el.dataset.testid))].slice(0,150), logs: state.logs};
  }

  async function run(options) {
    if (location.pathname !== PATH || !['vk.ru','vk.com'].includes(location.hostname)) throw new Error('Откройте сообщество Три Слога.');
    if (state.running) throw new Error('Публикация уже выполняется.');
    state.running = true; state.stopped = false; state.logs = []; state.composer = null; state.photoPreview = null;
    state.scheduleRunId = options.scheduleRunId || null;
    state.photoAttached = false; state.audioSelectionVerified = null; state.communityContext = false;
    const oldPanel = document.getElementById('tri-sloga-extension-panel');
    if (oldPanel) oldPanel.style.display = 'none';
    let jobId, outcome = {success: false, error: 'Публикация не завершена.'};
    try {
      const claim = await message({type: 'claim'}); jobId = claim.jobId;
      log('Запуск в вашей текущей вкладке VK.');
      state.stage = 'login';
      if (!all(document, '#top_profile_link,#l_pr,[data-testid="header-profile-menu-button"]').some(visible)) {
        throw new Error('Войдите в VK в этой вкладке, затем нажмите «Исправлено — повторить».');
      }
      if (composerCandidates().length) throw new Error('Уже открыт черновик. Завершите или закройте его перед запуском.');
      state.stage = 'quote'; const text = await getQuote(options.quote);
      log('Цитата получена.');
      await collectMedia();
      state.stage = 'open composer';
      const composer = await openComposer({unattended: !!options.scheduleRunId}); setText(composer.editor, text);
      await attachPhoto(); await advanceComposer(); await attachAudio();
      state.stage = 'verify';
      const root = currentComposerRoot();
      if (photoAttachments(root).length !== 1 || audioAttachments(root).length !== 1) throw new Error('Вложения не удалось проверить. Пост оставлен в редакторе.');
      if (!options.automatic) { log('Пост подготовлен. Проверьте автора и вложения, затем опубликуйте в VK вручную.'); return; }
      if (!authorVerified(root)) throw new Error('Не удалось подтвердить автора «Три Слога». Пост оставлен в редакторе. Проверьте автора; отправьте диагностику для настройки.');
      if (state.stopped) throw new Error('Остановлено пользователем.');
      await message({type: 'beginPublish', jobId, photo: state.photo.id, audio: state.audio.id});
      if (state.stopped) throw new Error('Остановлено пользователем. Проверьте стену перед новой попыткой.');
      state.stage = 'publish';
      await click(one(control(root, /^Опубликовать$/u), 'кнопка публикации'));
      log('Публикация отправлена один раз. Проверяю результат…');
      try {
        await until(() => all(document, '[data-testid="post"],.wall_item').find(post =>
          visible(post) && post.textContent.includes(text.split('\n')[0])), 'новая публикация на стене', 20000);
      } catch {
        throw new Error('Результат публикации не подтверждён. Проверьте стену: пост мог появиться. Повторная отправка заблокирована.');
      }
      await message({type: 'completePublish', jobId});
      log('Пост опубликован на стене сообщества.');
      outcome = {success: true};
    } catch (error) { outcome = {success: false, error: error.message}; log('Остановлено: ' + error.message); panel(); }
    finally {
      try { await message({type: 'diagnostic', data: diagnostics(state.logs.at(-1))}); } catch { /* Log remains visible. */ }
      if (jobId) { try { await message({type: 'release', jobId}); } catch { /* Lease expires. */ } }
      state.running = false;
      if (options.scheduleRunId) {
        try { await message({type: 'scheduleResult', runId: options.scheduleRunId, ...outcome}); } catch { /* Watchdog reports an interrupted job. */ }
      }
    }
  }

  globalThis.TriSloga = {run, photoCandidates, audioCandidates, composerCandidates, parseQuotes, state, openComposer,
    creationMenuItems, musicPicker, matchesAudio, attachAudio, audioAttachments, photoAttachments, authorVerified};
  chrome.runtime.onMessage.addListener((options, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    if (options.type === 'stop') {
      if (!options.scheduleRunId || options.scheduleRunId === state.scheduleRunId) state.stopped = true;
      reply({ok: true}); return;
    }
    if (options.type !== 'start') return;
    if (state.running) { reply({ok: false, error: 'Публикация уже выполняется.'}); return; }
    reply({ok: true});
    run(options).catch(error => { panel(); log('Остановлено: ' + error.message); });
  });
})();
