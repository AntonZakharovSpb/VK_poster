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
    photoAttached: false, audioSelectionVerified: null, communityContext: false};

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
    state.stage = 'community music';
    await section('audios');
    const audios = await until(() => { const items = audioCandidates(); return items.length ? items : null; }, 'песни сообщества');
    state.audio = audios[Math.floor(Math.random() * audios.length)];
    log(`Резервная песня на случай пустого поиска: ${state.audio.artist} — ${state.audio.title}.`);
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
    if (state.composer?.modern) {
      const dialogs = all(document, '[role="dialog"],.box_layout').filter(root => visible(root) &&
        root.querySelector('[data-testid="posting_base_screen_input_message"],[data-testid="posting_base_screen_next"],[data-testid="posting_preview_attachment_item"]'));
      const inner = dialogs.filter(root => !dialogs.some(other => other !== root && root.contains(other)));
      if (inner.length === 1) return inner[0];
    }
    const editor = state.composer?.editor;
    // Prefer the entire editor dialog over a small text/button container.
    const root = editor?.closest('[role="dialog"],.box_layout,#submit_post_box,[data-testid="post-composer"]') || state.composer?.root;
    return root?.isConnected && visible(root) ? root : null;
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
  function photoId(el) {
    for (const value of [el.dataset.photoId, el.dataset.id, el.getAttribute('href')]) {
      const match = (value || '').match(/(?:photo)?(-?\d+_\d+)(?:$|[?&#])/u);
      if (match) return match[1];
    }
    return null;
  }
  function nativePhotoCards(root) {
    const cards = new Map();
    for (const el of all(root, '[data-photo-id],[data-id],a[href*="photo"]')) {
      const id = photoId(el);
      if (!id?.startsWith(OWNER + '_') || !visible(el)) continue;
      const card = el.closest('[data-photo-id],.photos_choose_row,.photos_choose_photo,.photos_row') || el.closest('button') || el;
      if (!cards.has(id)) cards.set(id, {id, card});
    }
    // Modern VK cards expose no photo ID. The owner switch points to personal
    // photos only while the picker currently shows the community's photos.
    const ownerSwitch = root.querySelector('[data-testid="posting_photo_picker_switch_owner"]');
    if (state.communityContext && normalize(ownerSwitch?.textContent || '') === 'К моим фото') {
      all(root, '[data-testid="posting_photo_picker_photos_item"]').forEach((card, index) => {
        if (!visible(card)) return;
        const ids = [card, ...all(card, '[data-photo-id],[data-id],a[href*="photo"]')].map(photoId).filter(Boolean);
        if (ids.length) return; // Explicit IDs must pass the owner check above.
        const id = `community-grid:${index}`;
        cards.set(id, {id, card, nativeGrid: true});
      });
    }
    return [...cards.values()];
  }
  function nativePhotoPicker() {
    const roots = all(document, '[role="dialog"],.box_layout').filter(root => visible(root) &&
      root.dataset.testid !== 'dropdownactionsheet' && !root.querySelector('[data-testid="posting_base_screen_select_photo_vk"]') &&
      !root.contains(state.composer.editor) && !root.querySelector('[contenteditable="true"],[data-testid="posting_base_screen_next"],[data-testid="posting_submit_button"]') &&
      root.querySelector('[data-photo-id],a[href*="photo"],a[href*="album"],[data-testid*="photo"],[data-testid*="album"]'));
    const inner = roots.filter(root => !roots.some(other => other !== root && root.contains(other)));
    if (inner.length > 1) throw new Error('Открыто несколько окон выбора фотографии.');
    return inner[0];
  }
  async function loadPhotoGrid() {
    const started = Date.now();
    let stable = 0, previous = '';
    while (Date.now() - started < 30000) {
      if (state.stopped) throw new Error('Остановлено пользователем.');
      const picker = nativePhotoPicker();
      const cards = picker ? nativePhotoCards(picker) : [];
      if (!cards.length) return cards;
      let scroll = cards[cards.length - 1].card.parentElement;
      while (scroll && !(scroll.scrollHeight > scroll.clientHeight + 2 && /auto|scroll/u.test(getComputedStyle(scroll).overflowY))) scroll = scroll.parentElement;
      if (!scroll) return cards;
      scroll.scrollTop = scroll.scrollHeight;
      scroll.dispatchEvent(new Event('scroll', {bubbles:true}));
      cards[cards.length - 1].card.scrollIntoView({block:'end'});
      await delay(700);
      const live = nativePhotoPicker();
      const loaded = live ? nativePhotoCards(live) : [];
      const signature = `${loaded.length}:${scroll.scrollHeight}`;
      stable = signature === previous ? stable + 1 : 0;
      previous = signature;
      if (stable >= 4) return loaded;
    }
    const picker = nativePhotoPicker();
    return picker ? nativePhotoCards(picker) : [];
  }
  function nativePhotoPreviews(root) {
    if (!root) return [];
    const candidates = all(root, '[data-attachment-type="photo"],.page_preview_photo,[data-testid="primary-attachment-photo"],[data-testid="post-editor-photo"],[data-testid="photo-attachment"],[data-testid="posting_preview_attachment_item"],[data-testid="posting_attachment_item"]')
      .filter(el => el.dataset.testid !== 'posting_attachment_item' || !!el.querySelector('[data-testid="posting_attachment_photo_item_remove"]'))
      .filter(visible).filter(el => !el.querySelector('video,[data-attachment-type="video"]'));
    return candidates.filter(el => !candidates.some(other => other !== el && other.contains(el)))
      .filter(el => {
        const ids = [el, ...all(el, '[data-photo-id],[data-id],a[href*="photo"]')].map(photoId).filter(Boolean);
        return !ids.length || ids.every(id => state.photo.nativeGrid ? id.startsWith(OWNER + '_') : id === state.photo.id);
      });
  }
  async function attachPhoto() {
    state.stage = 'choose photo from VK';
    const root = currentComposerRoot();
    if (!root) throw new Error('Редактор VK закрыт. Откройте сообщество и нажмите «Исправлено — повторить».');
    const existing = all(root, '[data-testid="posting_base_screen_select_from_vk"]').map(el => el.closest('button,[role="button"]') || el).filter(visible);
    await click(existing.length ? one(existing, 'выбор фото из VK') : await attachmentControl('photo'));
    const photoOption = await until(() => {
      const exact = all(document, '[data-testid="posting_base_screen_select_photo_vk"]').filter(visible)
        .map(el => el.closest('button,[role="button"]') || el);
      if (exact.length) return one(exact, 'пункт «Фото VK»');
      const menus = all(document, '[role="menu"],[data-testid="dropdownactionsheet"]').filter(visible);
      const options = menus.flatMap(menu => control(menu, /^(Фото VK|Фотография|Фотографии|Фото)$/u)).filter(visible);
      return options.length ? one(options, 'пункт «Фото VK»') : null;
    }, 'пункт «Фото VK»');
    await click(photoOption);
    let picker = await until(nativePhotoPicker, 'окно выбора фотографии из VK');
    const group = control(picker, /^Три Слога$/iu).filter(visible);
    if (group.length === 1) { await click(group[0]); await delay(400); }
    let cards = await until(() => {
      const current = nativePhotoPicker();
      const loaded = current ? nativePhotoCards(current) : [];
      return loaded.length ? loaded : null;
    }, 'фотографии сообщества в общем списке Фото VK');
    cards = await loadPhotoGrid();
    if (!cards.length) throw new Error('Список фотографий VK исчез после прокрутки.');
    const chosen = cards[Math.floor(Math.random() * cards.length)];
    state.photo = {id: chosen.id, nativeGrid: !!chosen.nativeGrid,
      url: chosen.nativeGrid ? null : `${location.origin}/photo${chosen.id}`};
    log(`В Фото VK выбрана фотография сообщества ${chosen.nativeGrid ? 'из общей сетки' : chosen.id} из ${cards.length} загруженных, без открытия альбомов.`);
    const checkbox = chosen.card.querySelector('input[type="checkbox"]');
    const livePicker = nativePhotoPicker();
    if (livePicker && all(livePicker, 'input[type="checkbox"]:checked').some(el => !chosen.card.contains(el))) {
      throw new Error('В выборе VK уже отмечено другое вложение. Снимите его перед повтором.');
    }
    if (!checkbox?.checked) await click(checkbox && visible(checkbox) ? checkbox : chosen.card);
    if (checkbox) await until(() => {
      const live = nativePhotoPicker();
      const selected = live && nativePhotoCards(live).find(item => item.id === chosen.id)?.card;
      return selected?.querySelector('input[type="checkbox"]')?.checked || selected?.getAttribute('aria-selected') === 'true';
    }, 'отмеченная фотография сообщества');
    const after = nativePhotoPicker();
    if (after) {
      const done = await until(() => {
        const live = nativePhotoPicker();
        if (!live) return null;
        const buttons = control(live, /^(Выбрать фотографии|Прикрепить|Добавить|Готово|Выбрать)(?:\s*\(?\d+\)?)?$/u).filter(visible);
        return buttons.length ? one(buttons, 'кнопка «Выбрать фотографии»') : null;
      }, 'кнопка «Выбрать фотографии»');
      await click(done);
    }
    let missingSince;
    await until(() => {
      const current = currentComposerRoot();
      if (!current) {
        missingSince ??= Date.now();
        if (Date.now() - missingSince > 3000) throw new Error('Редактор VK исчез после выбора фотографии. Пост не отправлен.');
        return false;
      }
      missingSince = null;
      const error = all(current, '[role="alert"],[data-testid*="error"]').filter(visible).map(el => normalize(el.textContent))
        .find(text => /ошиб|не удалось|не поддерж|слишком|превыш/iu.test(text));
      if (error) throw new Error(`VK не прикрепил фото: ${error}`);
      return !nativePhotoPicker() && nativePhotoPreviews(current).length === 1;
    }, 'прикреплённая фотография из VK', 30000);
    state.photoAttached = true;
    state.photoSelectionVerified = state.photo.id;
    log('Оригинальная фотография сообщества прикреплена из VK без скачивания и повторной загрузки.');
  }
  function photoAttachments(root) {
    if (!state.photoAttached || !state.photoSelectionVerified || state.photoSelectionVerified !== state.photo?.id) return [];
    return nativePhotoPreviews(root);
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
    return outer[0];
  }
  function firstSearchAudio(picker) {
    const rows = audioRows(picker);
    const outer = rows.filter(row => !rows.some(other => other !== row && other.contains(row)));
    return outer.find(row => audioMetadata(row).title && audioMetadata(row).artist);
  }
  function audioMetadata(row) {
    return {id: rowAudioId(row),
      title: normalize(row.querySelector('[data-testid="music-cell-title"],[data-testid="MusicTrackRow_Title"],.audio_row__title_inner')?.textContent),
      artist: normalize(row.querySelector('[data-testid="music-cell-artists"],[data-testid="MusicTrackRow_Authors"],.audio_row__performer')?.textContent),
      duration: row.textContent.match(/\b\d{1,3}:\d{2}\b/u)?.[0]};
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
    let row;
    if (state.songTitle) {
      const search = one(all(picker, 'input').filter(el => (el.dataset.testid === 'posting_audio_search_audio_input' || /поиск|найти/iu.test(el.placeholder || el.getAttribute('aria-label') || '')) && visible(el)), 'поиск в выборе музыки');
      log(`Ищу музыку по названию: ${state.songTitle}.`);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, state.songTitle);
      search.dispatchEvent(new Event('input', {bubbles:true}));
      await delay(1200);
      try { row = await until(() => firstSearchAudio(picker), 'результаты поиска по названию песни', 10000); }
      catch (error) {
        if (state.stopped) throw error;
        log('Поиск по названию не дал результатов. Добавляю резервную песню сообщества.');
      }
      if (row) {
        const chosen = audioMetadata(row);
        state.sourceAudio = {...state.audio};
        state.audio = {...chosen, id: chosen.id || `search-result:${crypto.randomUUID()}`};
        log(`Выбрана первая песня из поиска: ${chosen.artist} — ${chosen.title}.`);
      }
    }
    if (!row && !state.songTitle) row = selectedAudioRow(picker);
    if (!row) {
      const search = one(all(picker, 'input').filter(el => (el.dataset.testid === 'posting_audio_search_audio_input' || /поиск|найти/iu.test(el.placeholder || el.getAttribute('aria-label') || '')) && visible(el)), 'поиск в выборе музыки');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, `${state.audio.artist} ${state.audio.title}`.trim());
      search.dispatchEvent(new Event('input', {bubbles: true}));
      await delay(1200);
      try { row = await until(() => selectedAudioRow(picker), 'точная песня в поиске', 3000); }
      catch (error) {
        if (state.stopped) throw error;
        row = firstSearchAudio(picker);
        if (!row) {
          const baseTitle = state.audio.title.replace(/\s*[\[(].*?[\])]\s*/gu, ' ')
            .replace(/\s*(?:[-–—]\s*)?(?:альбомная|альбомный|сингловая|сингловый|album|single)\s*(?:версия|version)?\s*$/iu, '').trim();
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, `${state.audio.artist} ${baseTitle}`.trim());
          search.dispatchEvent(new Event('input', {bubbles: true}));
          await delay(1200);
          row = await until(() => selectedAudioRow(picker) || firstSearchAudio(picker), 'результаты поиска песни');
        }
        const chosen = audioMetadata(row);
        state.sourceAudio = {...state.audio};
        state.audio = {...chosen, id: chosen.id || `search-result:${crypto.randomUUID()}`};
        log(`Точное совпадение не найдено. Выбрана первая песня из поиска: ${chosen.artist} — ${chosen.title}.`);
      }
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
  function parseSongs(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const songs = [];
    let song;
    for (const block of all(doc.body, 'h1,h2,h3,h4,h5,h6,p')) {
      if (/^H[1-6]$/u.test(block.tagName)) {
        const title = normalize(block.textContent);
        song = title ? {title, lines: []} : null;
        if (song) songs.push(song);
      } else if (song) {
        const clone = block.cloneNode(true);
        for (const br of all(clone, 'br')) br.replaceWith(doc.createTextNode('\n'));
        song.lines.push(clone.textContent.replace(/\u00a0/gu, ' ').trim());
      }
    }
    return songs.map(({title, lines}) => {
      const text = lines.join('\n').trim();
      return {title, text, parts: text.split(/\n[ \t]*\n+/u).map(part => part.trim()).filter(Boolean)};
    }).filter(song => song.text);
  }
  function chooseSongExcerpt(html, random = Math.random) {
    const songs = parseSongs(html);
    if (!songs.length) throw new Error('В документе не найдены песни с заголовками и текстом. Проверьте доступ и структуру документа.');
    const song = songs[Math.floor(random() * songs.length)];
    const verse = song.parts.length ? song.parts[Math.floor(random() * song.parts.length)] : song.text;
    return {title: song.title, text: `${verse}\n\nТри слога - ${song.title}`};
  }
  function normalizedSongTitle(title) {
    return normalize(title).toLocaleLowerCase('ru').replace(/ё/gu, 'е')
      .replace(/(?:альбомная|альбомный|сингловая|сингловый|album|single)\s*(?:версия|version)?/giu, ' ')
      .replace(/[^а-яa-z0-9]+/gu, ' ').trim().replace(/\s+/gu, ' ');
  }
  function songSimilarity(wanted, candidate) {
    const a = normalizedSongTitle(wanted), b = normalizedSongTitle(candidate);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const left = new Set(a.split(' ')), right = new Set(b.split(' '));
    const common = [...left].filter(word => right.has(word)).length;
    const overlap = common / Math.max(left.size, right.size);
    if (overlap >= 0.6) return overlap * 0.95;
    const row = Array.from({length: b.length + 1}, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let diagonal = row[0]; row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const previous = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
        diagonal = previous;
      }
    }
    const similarity = 1 - row[b.length] / Math.max(a.length, b.length);
    return similarity >= 0.75 ? similarity * 0.9 : 0;
  }
  function matchingCommunityAudio(audios, title) {
    let best = null, bestScore = 0;
    for (const audio of audios) {
      const score = songSimilarity(title, audio.title);
      if (score > bestScore) { best = audio; bestScore = score; }
    }
    return best;
  }
  async function preparePostText() {
    state.songTitle = null;
    const result = await message({type: 'lyrics'});
    const prepared = chooseSongExcerpt(result.html);
    state.songTitle = prepared.title;
    return prepared.text;
  }
  function diagnostics(error = '') {
    const scope = currentComposerRoot() || document;
    return {version: '0.4.5', time: new Date().toISOString(), stage: state.stage, error,
      page: location.origin + location.pathname + location.hash,
      photo: state.photo?.id, audio: state.audio?.id, sourceAudio: state.sourceAudio,
      songTitle: state.songTitle,
      composerConnected: !!state.composer?.root?.isConnected,
      liveComposerFound: !!currentComposerRoot(), photoSelectionVerified: state.photoSelectionVerified,
      sourcePhoto: state.sourcePhoto,
      photoGrid: all(document, '[data-testid="posting_photo_picker_photos_item"]').filter(visible).slice(0,50)
        .map(el => ({photoId:photoId(el),selected:el.getAttribute('aria-selected'),
          checked:el.querySelector('input[type="checkbox"]')?.checked,
          image:el.querySelector('img')?.getAttribute('src'),testids:all(el,'[data-testid]').map(child=>child.dataset.testid)})),
      photoPickerControls: all(document, '[role="dialog"],.box_layout').filter(visible).map(root => ({
        testid: root.dataset.testid, controls: all(root,'button,[role="button"],a,input').filter(visible).slice(0,50)
          .map(el => ({testid:el.dataset.testid,label:label(el).slice(0,100),photoId:photoId(el),href:el.getAttribute('href')}))})),
      communityContext: state.communityContext, photoAttached: state.photoAttached, audioSelectionVerified: state.audioSelectionVerified,
      controls: all(scope, 'button,[role="button"],[role="menuitem"],input,[contenteditable="true"]').filter(visible).slice(0,100).map(el => ({
        tag: el.tagName, role: el.getAttribute('role'), testid: el.dataset.testid,
        id: el.id, label: label(el).slice(0,90), accept: el.getAttribute('accept')})),
      fileInputs: all(document,'input[type="file"]').map(el=>({id:el.id,testid:el.dataset.testid,accept:el.accept,
        inComposer:!!currentComposerRoot()?.contains(el)})),
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
    state.running = true; state.stopped = false; state.logs = []; state.composer = null;
    state.scheduleRunId = options.scheduleRunId || null;
    state.photoAttached = false; state.audioSelectionVerified = null; state.communityContext = false;
    state.photo = null;
    state.sourceAudio = null;
    state.songTitle = null;
    state.photoSelectionVerified = null; state.sourcePhoto = null;
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
      state.stage = 'song text'; const text = await preparePostText();
      log(state.songTitle ? `Текст подготовлен: ${state.songTitle}.` : 'Текст подготовлен.');
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

  globalThis.TriSloga = {run, photoCandidates, audioCandidates, composerCandidates, parseSongs, chooseSongExcerpt,
    songSimilarity, matchingCommunityAudio, state, openComposer,
    creationMenuItems, musicPicker, matchesAudio, attachAudio, attachPhoto, nativePhotoCards, currentComposerRoot, audioAttachments, photoAttachments, authorVerified};
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
