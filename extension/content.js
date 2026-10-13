(() => {
  if (globalThis.TriSloga) return;
  let settings = {...AZVK.defaults};
  let OWNER = null, PATH = null, NAME = '';
  function configure(nextSettings,community) {
    settings = AZVK.normalizeSettings(nextSettings);
    if (!community || !/^-[1-9]\d*$/u.test(community.owner) || !community.path || !community.name)
      throw new Error('Не удалось определить выбранное сообщество.');
    ({owner:OWNER,path:PATH,name:NAME} = community);
  }
  const isCommunityName = text => normalize(text).toLocaleLowerCase('ru') === NAME.toLocaleLowerCase('ru');
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const normalize = text => (text || '').replace(/\s+/g, ' ').trim();
  const visible = el => !!el && !el.closest('[hidden],[aria-hidden="true"]') &&
    getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' &&
    el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
  const all = (scope, selector) => [...scope.querySelectorAll(selector)];
  const label = el => normalize(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent);
  const state = {running: false, stopped: false, stage: '', logs: [], composer: null, photo: null, audio: null, panel: null,
    photoAttached: false, audioSelectionVerified: null, communityContext: false};
  function captchaVisible() {
    return all(document,'iframe[src*="captcha"],iframe[src*="challenge"],input[name*="captcha"],[data-testid*="captcha" i],[id*="captcha" i],.captcha').some(visible);
  }
  function pauseForCaptcha() {
    if(!state.batch || state.captchaPaused || !captchaVisible()) return;
    state.captchaPaused=true;
    log('CAPTCHA: действия приостановлены. Решите её и нажмите «ОК — продолжить» в расширении.');
    message({type:'batchCaptcha',batchId:state.batch.id,paused:true}).catch(()=>{});
  }
  async function captchaGate() {
    if(state.stopped || state.batchStopped) throw new Error('Остановлено пользователем.');
    const started=Date.now();pauseForCaptcha();
    while(state.captchaPaused) {
      if(state.stopped || state.batchStopped) throw new Error('Остановлено пользователем.');
      await delay(200);
    }
    return Date.now()-started;
  }
  new MutationObserver(pauseForCaptcha).observe(document.documentElement,{subtree:true,childList:true,attributes:true});

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
    let end = Date.now() + timeout;
    while (Date.now() < end) {
      end += await captchaGate();
      if (state.stopped) throw new Error('Остановлено пользователем.');
      const result = fn();
      if (result) return result;
      await delay(200);
    }
    throw new Error(`Не найдено: ${description}.`);
  }
  async function click(el) {
    await captchaGate();
    if (state.stopped) throw new Error('Остановлено пользователем.');
    if (!visible(el)) throw new Error('Нужная кнопка сейчас скрыта.');
    el.scrollIntoView({block: 'center'});
    // Let sticky headers/React settle after scrolling before sending the press.
    await delay(120);
    await captchaGate();
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
      await captchaGate();
      if(state.stopped || state.batchStopped) throw new Error('Остановлено пользователем.');
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
      root.innerHTML = `<style>:host{font:13px "Segoe UI",sans-serif;color:#17212d}section{width:330px;background:white;border:1px solid #d4dfec;box-shadow:0 8px 32px #17212d25;border-radius:16px;padding:16px}header{display:flex;justify-content:space-between;align-items:center;font-size:16px;font-weight:600}pre{white-space:pre-wrap;overflow:auto;max-height:220px;font:12px/1.6 "Segoe UI",sans-serif;color:#4c5e73}button{border:0;border-radius:8px;padding:8px 10px;background:#e9f1fc;color:#006edd;cursor:pointer;font:12px "Segoe UI"}.actions{display:flex;gap:8px;flex-wrap:wrap}.reset{margin-top:8px}small{color:#657688;font-size:11px}</style><section><header>AZ_vk_poster <button id="hide">Скрыть</button></header><pre></pre><div class="actions"><button id="stop">Остановить</button><button id="copy">Копировать журнал</button></div><button class="reset" id="fixed">Исправлено — повторить</button><button class="reset" id="reset">Я проверил стену: разрешить новую попытку</button><p><small>Устраните причину ошибки и нажмите «Исправлено — повторить».</small></p></section>`;
      root.getElementById('fixed').onclick = async () => {
        if (state.running) return;
        const {publicationAttempt} = await chrome.storage.local.get('publicationAttempt');
        const uncertain = publicationAttempt?.status === 'pending';
        if (uncertain && !confirm('Проверьте стену: предыдущий пост мог появиться. Подтвердите, что его нет, прежде чем создавать новый.')) return;
        try { await message({type:'batchResume', confirmNoPost:uncertain}); }
        catch (error) { panel(); log(error.message); }
      };
      root.getElementById('hide').onclick = () => { host.style.display = 'none'; };
      root.getElementById('stop').onclick = () => {
        state.stopped = true; log('Останавливаю действия и расписание…');
        state.batchStopped=true; message({type: 'batchStop'}).catch(() => {});
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
    if (location.pathname.replace(/\/$/u,'') !== PATH) throw new Error('VK открыл другую страницу. Откройте сообщество и запустите снова.');
  }
  async function collectMedia() {
    state.stage = 'community music';
    state.audio = {id:null,title:state.songTitle || '',artist:settings.artist};
    if (!all(document,'[data-testid="group_tab_audios"]').some(visible)) {
      log('В сообществе нет вкладки музыки. Использую поиск выбранного исполнителя.');
      return;
    }
    await section('audios');
    try {
      const audios = await until(() => { const items = audioCandidates(); return items.length ? items : null; }, 'песни сообщества', 5000);
      state.audio = audios[Math.floor(Math.random() * audios.length)];
      log(`Резервная песня на случай пустого поиска: ${state.audio.artist} — ${state.audio.title}.`);
    } catch (error) {
      if (state.stopped) throw error;
      log('В сообществе нет доступных песен. Использую поиск выбранного исполнителя.');
    }
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
      location.pathname.replace(/\/$/u,'') === PATH && all(document,'[data-testid="group-name"],.group_name,#group_name,.page_name').some(el=>isCommunityName(el.textContent)) &&
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
    let started = Date.now();
    let stable = 0, previous = '';
    while (Date.now() - started < 30000) {
      started += await captchaGate();
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
    const group = control(picker,{test:isCommunityName}).filter(visible);
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
  function searchAudioRows(picker) {
    const rows = audioRows(picker);
    const outer = rows.filter(row => !rows.some(other => other !== row && other.contains(row)));
    const unique = new Map();
    for (const row of outer) {
      const audio = audioMetadata(row);
      if (!audio.title || !audio.artist) continue;
      const key = audio.id || normalize(`${audio.title} ${audio.artist} ${audio.duration || ''}`).toLocaleLowerCase('ru');
      if (!unique.has(key)) unique.set(key,row);
    }
    return [...unique.values()];
  }
  function firstSearchAudio(picker) {
    return searchAudioRows(picker)[0];
  }
  function artistMatches(credit) {
    const artist = settings.artist.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
    const boundary = '(?:[,;&/]|\\bfeat\\.?|\\bft\\.?)';
    return new RegExp(`(?:^|${boundary})\\s*${artist}\\s*(?=$|${boundary})`,'iu').test(normalize(credit));
  }
  function firstBandSearchAudio(picker) {
    return searchAudioRows(picker)
      .find(row => {
        const audio = audioMetadata(row);
        return songSimilarity(state.songTitle, audio.title) > 0 &&
          artistMatches(audio.artist);
      });
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
    const community = control(picker,{test:isCommunityName}).filter(visible);
    if (community.length === 1) await click(community[0]);
    const search = one(all(picker, 'input').filter(el => (el.dataset.testid === 'posting_audio_search_audio_input' || /поиск|найти/iu.test(el.placeholder || el.getAttribute('aria-label') || '')) && visible(el)), 'поиск в выборе музыки');
    const searchFor = async query => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, query);
      search.dispatchEvent(new Event('input', {bubbles:true}));
      await delay(1200);
    };
    let row;
    if (normalize(state.songTitle)) {
      log(`Ищу песню: ${settings.artist} — ${state.songTitle}.`);
      await searchFor(`${settings.artist} ${state.songTitle}`.trim());
      try { row = await until(() => firstBandSearchAudio(picker), `песня исполнителя ${settings.artist} в поиске`, 10000); }
      catch (error) {
        if (state.stopped) throw error;
        log('Песня с названием из документа не найдена. Ищу только по исполнителю.');
      }
    }
    if (!row) {
      log(`Ищу случайную песню исполнителя ${settings.artist}.`);
      await searchFor(settings.artist);
      try {
        const candidates = await until(() => {
          const matches = searchAudioRows(picker).filter(item => artistMatches(audioMetadata(item).artist));
          return matches.length ? matches : null;
        }, `песни исполнителя ${settings.artist}`, 10000);
        row = candidates[Math.floor(Math.random() * candidates.length)];
      }
      catch (error) {
        if (state.stopped) throw error;
        log('Песни выбранного исполнителя не найдены. Беру первый результат поиска.');
        row = await until(() => firstSearchAudio(picker), 'первый результат поиска музыки', 3000);
      }
    }
    const chosen = audioMetadata(row);
    state.sourceAudio = {...state.audio};
    state.audio = {...chosen, id: chosen.id || `search-result:${crypto.randomUUID()}`};
    log(`Выбрана песня из поиска: ${chosen.artist} — ${chosen.title}.`);
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
    if (controls.length) return controls.some(el => {
      const owner = el.getAttribute('data-owner-id');
      if (owner) return owner === OWNER;
      return isCommunityName(el.textContent) ||
        all(el, 'a[href]').some(a => new URL(a.href, location.href).pathname.replace(/\/$/u,'') === PATH);
    });
    // Modern group publishing has no author selector. Its target is fixed by
    // the community admin Create block that opened this same posting dialog.
    return state.communityContext && state.composer?.modern && location.pathname.replace(/\/$/u,'') === PATH &&
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
    return {title: song.title, text: `${verse}\n\n${settings.artist} - ${song.title}`};
  }
  function normalizedSongTitle(title) {
    return normalize(title).toLocaleLowerCase('ru').replace(/ё/gu, 'е')
      .replace(/(?:альбомная|альбомный|сингловая|сингловый|album|single)\s*(?:версия|version)?/giu, ' ')
      .replace(/(?:версия|version)\s*\d{4}/giu, ' ')
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
    const result = await message({type: 'lyrics',batchId:state.batch?.id});
    const prepared = chooseSongExcerpt(result.html);
    state.songTitle = prepared.title;
    return prepared.text;
  }
  function diagnostics(error = '') {
    const scope = currentComposerRoot() || document;
    return {version: '0.5.6', time: new Date().toISOString(), stage: state.stage, error,
      batch:state.batch ? {id:state.batch.id,amount:state.batch.amount,completed:state.batch.completed,intervalSeconds:state.batch.intervalSeconds} : null,
      plannedAt:state.plannedAt,captchaPaused:!!state.captchaPaused,verification:state.verification,
      scheduledPostHeaders:scheduledPosts(document).slice(0,40).map(post=>({id:post.id,
        header:normalize(post.querySelector('.post_header,[data-testid="post-header"],.post_date')?.textContent||'').slice(0,180),
        date:pendingPostDate(post)})),
      dateInputs:all(document,'input[type="date"],input[type="time"],input[type="datetime-local"],input[data-testid*="date"],input[data-testid*="time"]').filter(visible)
        .map(el=>({type:el.type,testid:el.dataset.testid,value:el.value,placeholder:el.placeholder})),
      page: location.origin + location.pathname + location.hash,
      photo: state.photo?.id, audio: state.audio?.id, sourceAudio: state.sourceAudio,
      songTitle: state.songTitle, settings, community:{owner:OWNER,path:PATH,name:NAME},
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

  const MOSCOW='Europe/Moscow';
  function dateParts(timestamp) {
    return Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:MOSCOW,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
      .formatToParts(new Date(timestamp)).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
  }
  function moscowDate(year,month,day,hour,minute) {
    const value=Date.UTC(year,month-1,day,hour-3,minute);
    const p=dateParts(value);
    if(Number(p.year)!==year||Number(p.month)!==month||Number(p.day)!==day||Number(p.hour)!==hour||Number(p.minute)!==minute) return null;
    return value;
  }
  function parsePostDate(text,now=Date.now()) {
    const normalized=normalize(text).toLocaleLowerCase('ru');
    const today=dateParts(now);
    let match=normalized.match(/(?:^|\D)(\d{1,2})[./](\d{1,2})[./](\d{4}).*?(\d{1,2}):(\d{2})/u);
    if(match) return moscowDate(+match[3],+match[2],+match[1],+match[4],+match[5]);
    const months=['янв','фев','мар','апр','ма','июн','июл','авг','сен','окт','ноя','дек'];
    match=normalized.match(/(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?(?:\s*г\.?)?\s*(?:в|,)?\s*(\d{1,2}):(\d{2})/u);
    if(match) {
      const month=months.findIndex(name=>match[2].startsWith(name))+1;
      if(!month) return null;
      let year=Number(match[3]||today.year);
      let value=moscowDate(year,month,+match[1],+match[4],+match[5]);
      if(!match[3] && value!==null && value<now-60000) value=moscowDate(year+1,month,+match[1],+match[4],+match[5]);
      return value;
    }
    match=normalized.match(/(сегодня|завтра|послезавтра).*?(\d{1,2}):(\d{2})/u);
    if(match) {
      const value=moscowDate(+today.year,+today.month,+today.day,+match[2],+match[3]);
      return value===null?null:value+({сегодня:0,завтра:1,послезавтра:2}[match[1]])*86400000;
    }
    return null;
  }
  function pendingPostDate(post) {
    const times=all(post,'time[datetime],[data-scheduled-at],[data-publish-date]');
    for(const el of times) {
      const raw=el.getAttribute('datetime')||el.dataset.scheduledAt||el.dataset.publishDate;
      const value=/^\d+$/u.test(raw||'') ? Number(raw)*(raw.length<=10?1000:1) : Date.parse(raw);
      if(Number.isFinite(value)) return value;
    }
    const labels=all(post,'[data-testid="post_date_block_preview"],.post_date,[data-testid*="schedule-date"],.post_header,[data-testid="post-header"]');
    for(const el of labels) {const value=parsePostDate(el.textContent);if(value!==null)return value;}
    return parsePostDate(post.textContent);
  }
  function scheduledPosts(root) {
    const posts=all(root,`[data-testid="post"],.wall_item,[id^="post${OWNER}_"],[data-post-id^="${OWNER}_"]`).filter(visible);
    return posts.filter(post=>!posts.some(other=>other!==post && other.contains(post)));
  }
  function pendingRoot() {
    const root=all(document,'[data-testid="scheduled-posts"],#page_wall_posts,[data-testid="feed-items"],.wall_posts,#wall_postponed').find(visible);
    if(root)return root;
    if(location.pathname===`/wall${OWNER}` && new URLSearchParams(location.search).get('postponed')==='1') return document.body;
    return null;
  }
  async function openPending() {
    if(location.pathname===`/wall${OWNER}` && new URLSearchParams(location.search).get('postponed')==='1') return until(pendingRoot,'список отложенных записей');
    const tab=await until(()=>{
      const matches=all(document,'button,a,[role="tab"],[role="button"]').filter(el=>visible(el)&&/^Отложенные(?: посты)?(?:\s*\(?\d+\)?)?$/u.test(label(el)));
      return matches.length ? one(matches,'вкладка «Отложенные»') : null;
    },'вкладка «Отложенные»');
    await click(tab);await delay(700);
    return until(pendingRoot,'список отложенных записей');
  }
  async function latestPendingDate(onPost) {
    state.stage='read scheduled posts';
    let root=await openPending();
    let latest=null,stable=0,signature='',started=Date.now();
    while(Date.now()-started<45000) {
      started += await captchaGate();
      const posts=scheduledPosts(root);
      for(const post of posts) {
        const value=pendingPostDate(post);
        if(onPost)onPost(post,value);
        if(value===null) throw new Error('Не удалось прочитать дату отложенной записи. Нужна диагностика формата VK.');
        latest=latest===null?value:Math.max(latest,value);
      }
      if(!posts.length && (all(root,'[data-testid="empty_wall"]').some(visible) || /нет отложенных|отложенных (?:записей|постов) нет|пока нет|нет записей|отложенные посты\s*0(?:\D|$)/iu.test(root.textContent))) return null;
      const more=control(root,/^(Показать ещё|Показать еще|Ещё|Еще)$/u).filter(visible);
      if(more.length===1) await click(more[0]);
      else {
        let scroll=root;
        while(scroll && !(scroll.scrollHeight>scroll.clientHeight+2 && /auto|scroll/u.test(getComputedStyle(scroll).overflowY)))scroll=scroll.parentElement;
        if(scroll) {scroll.scrollTop=scroll.scrollHeight;scroll.dispatchEvent(new Event('scroll',{bubbles:true}));}
        else if(posts.length) posts[posts.length-1].scrollIntoView({block:'end'});
      }
      await delay(700);
      root=pendingRoot()||root;
      const current=`${scheduledPosts(root).length}:${root.scrollHeight}:${latest}`;
      stable=current===signature?stable+1:0;signature=current;
      if(stable>=4 && !more.length) {if(latest===null)throw new Error('Не удалось определить, пуст ли список «Отложенные».');return latest;}
    }
    throw new Error('Список «Отложенные» не закончил загрузку. Дата последней записи не подтверждена.');
  }
  function setField(input,value) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
    input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
  }
  const CALENDAR_MONTHS=['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
  function calendarMonth(root) {
    const labels=[root.getAttribute('aria-label'),...all(root,'[aria-label],caption,[aria-live],span').filter(visible).flatMap(el=>[el.getAttribute('aria-label'),el.textContent])];
    for(const text of labels) {
      const match=normalize(text).toLocaleLowerCase('ru').match(/^(январь|февраль|март|апрель|май|июнь|июль|август|сентябрь|октябрь|ноябрь|декабрь)\s*(\d{4})(?:\s*г\.?)?$/u);
      if(match)return {year:+match[2],month:CALENDAR_MONTHS.indexOf(match[1])+1};
    }
    return null;
  }
  function calendarDayCells(root) {
    const cells=new Map();
    for(const node of all(root,'[aria-label],span')) {
      const text=normalize(node.getAttribute('aria-label')||node.textContent);
      if(!/(?:^|,\s*)\d{1,2}\s+[а-яё]+(?:\s+\d{4})?(?:\s*г\.?)?$/iu.test(text))continue;
      const cell=node.closest('button,[role="button"],[role="gridcell"],[tabindex]');
      if(cell && root.contains(cell) && visible(cell))cells.set(cell,text);
    }
    return [...cells].map(([cell,text])=>({cell,text}));
  }
  function calendarPopup() {
    const roots=all(document,'[role="dialog"],[role="grid"]').filter(visible)
      .filter(root=>calendarMonth(root)&&calendarDayCells(root).length);
    // Retain the dialog rather than a nested day grid, so time controls are included.
    return roots.find(root=>!roots.some(other=>other!==root && other.contains(root)));
  }
  async function selectCalendarDate(timestamp) {
    const target=dateParts(timestamp),wanted=+target.year*12+(+target.month-1);
    let calendar=calendarPopup();
    for(let step=0;step<120;step++) {
      const view=calendarMonth(calendar);
      if(!view)throw new Error('Не удалось прочитать месяц и год календаря VK.');
      const current=view.year*12+(view.month-1);
      if(current===wanted)break;
      const direction=current<wanted?/^Следующий месяц/iu:/^Предыдущий месяц/iu;
      await click(one(control(calendar,direction),'стрелка месяца календаря'));
      calendar=await until(()=>{const live=calendarPopup(),value=live&&calendarMonth(live);return value && value.year*12+value.month-1!==current ? live : null;},'обновлённый месяц календаря');
    }
    const view=calendarMonth(calendar);
    if(view.year!==+target.year||view.month!==+target.month)throw new Error('Нужная дата слишком далеко от открытого месяца.');
    const dayPattern=new RegExp(`(?:^|[,\\s])${+target.day}\\s+([а-яё]+)(?:\\s+${target.year})?(?:\\s*г\\.?)?$`,'iu');
    const monthRoots=['январ','феврал','март','апрел','ма','июн','июл','август','сентябр','октябр','ноябр','декабр'];
    const days=calendarDayCells(calendar).filter(({cell})=>!cell.disabled&&cell.getAttribute('aria-disabled')!=='true')
      .filter(({text})=>{const match=text.match(dayPattern);return match&&match[1].toLocaleLowerCase('ru').startsWith(monthRoots[+target.month-1]);}).map(({cell})=>cell);
    await click(one(days,'день публикации в календаре'));await delay(250);
    let root=currentComposerRoot();
    let summary=all(root,'[data-testid="posting_postponed_button"],[data-testid="posting_postponed_cell_title"]').find(visible);
    const time=`${target.hour}:${target.minute}`;
    if(!normalize(summary?.textContent).includes(time)) {
      calendar=calendarPopup();
      if(!calendar) {await click(one(all(root,'[data-testid="posting_postponed_button"]'),'дата публикации'));calendar=await until(calendarPopup,'календарь времени');}
      for(const [count,value,name] of [[24,+target.hour,'час'],[60,+target.minute,'минута']]) {
        const selects=all(calendar,'select').filter(select=>select.options.length===count && [...select.options].every(option=>/^\d{1,2}$/u.test(option.value)));
        if(selects.length===1) {
          const select=selects[0],option=[...select.options].find(option=>+option.value===value);
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,option.value);
          select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));await captchaGate();
        } else {
          const inputs=all(calendar,'input').filter(visible).filter(el=>/^\d{1,2}$/u.test(el.value));
          if(inputs.length===2) {
            await setField(inputs[count===24?0:1],String(value).padStart(2,'0'));
            inputs[count===24?0:1].blur();await captchaGate();continue;
          }
          const combos=all(calendar,'[role="combobox"]').filter(visible).filter(el=>/^\d{1,2}$/u.test(normalize(el.textContent)));
          if(combos.length!==2)throw new Error('Не удалось определить часы и минуты календаря VK.');
          await click(combos[count===24?0:1]);
          const option=await until(()=>{
            const choices=all(document,'[role="option"]').filter(visible).filter(el=>+normalize(el.textContent)===value);
            return choices.length ? one(choices,name+' в списке времени') : null;
          },name+' в списке времени');await click(option);
        }
      }
      await delay(250);root=currentComposerRoot();
      summary=all(root,'[data-testid="posting_postponed_button"],[data-testid="posting_postponed_cell_title"]').find(visible);
    }
    await until(()=>parsePostDate(summary?.textContent)===timestamp,'выбранная дата и время на кнопке VK');
    // Close the popover by toggling its own date button, without submitting.
    if(calendarPopup()) {await click(one(all(root,'[data-testid="posting_postponed_button"]'),'закрытие календаря'));await delay(150);}
    return one(all(currentComposerRoot(),'[data-testid="posting_postponed_publish_button"]').filter(visible),'кнопка «Добавить в очередь»');
  }
  async function prepareScheduledSubmission(timestamp) {
    state.stage='schedule date';
    let root=currentComposerRoot();
    const options=control(root,/^(Запланировать|Отложить|Запланировать публикацию)$/u).filter(visible);
    const dateButtons=all(root,'[data-testid="posting_postponed_button"]').filter(visible);
    const schedule=dateButtons.length ? one(dateButtons,'дата публикации') : options.length ? one(options,'кнопка планирования') : one(all(root,'button,[role="button"]').filter(el=>visible(el)&&/запланировать|время публикации|дата публикации/iu.test(el.getAttribute('aria-label')||el.getAttribute('title')||'')),'настройка даты публикации');
    await click(schedule);
    const dateRoot=await until(()=>calendarPopup() || all(document,'[role="dialog"],.box_layout').filter(visible)
      .filter(el=>el.querySelector('input[type="date"],input[type="datetime-local"],input[placeholder*="дд"],input[placeholder*="ДД"],input[data-testid*="date"]'))
      .find(el=>!all(el,'[role="dialog"],.box_layout').some(inner=>inner.querySelector('input[type="date"],input[type="datetime-local"],input[placeholder*="дд"],input[placeholder*="ДД"],input[data-testid*="date"]'))),'выбор даты отложенной записи');
    if(calendarPopup()) {
      const button=await selectCalendarDate(timestamp),p=dateParts(timestamp);
      log(`Дата публикации: ${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute} (Москва).`);return button;
    }
    const p=dateParts(timestamp),day=`${p.year}-${p.month}-${p.day}`,time=`${p.hour}:${p.minute}`;
    const expected=[];
    const combined=all(dateRoot,'input[type="datetime-local"]').filter(visible);
    if(combined.length) {
      const input=one(combined,'дата и время');setField(input,`${day}T${time}`);expected.push([input,`${day}T${time}`]);
    }
    else {
      const dates=all(dateRoot,'input[type="date"],input[placeholder*="дд"],input[placeholder*="ДД"],input[data-testid*="date"]').filter(visible);
      const date=one(dates,'поле даты'),dateValue=date.type==='date'?day:`${p.day}.${p.month}.${p.year}`;setField(date,dateValue);expected.push([date,dateValue]);
      await captchaGate();
      const times=all(dateRoot,'input[type="time"],input[placeholder*="чч"],input[placeholder*="ЧЧ"],input[data-testid*="time"]').filter(visible);
      const clock=one(times,'поле времени');setField(clock,time);expected.push([clock,time]);
    }
    await delay(300);await captchaGate();
    if(expected.some(([input,value])=>!input.isConnected || input.value!==value)) throw new Error('VK изменил введённую дату или время. Запись не отправлена.');
    const save=control(dateRoot,/^(Сохранить|Выбрать|Готово)$/u).filter(visible);
    if(save.length) {await click(one(save,'сохранение даты'));await delay(300);root=currentComposerRoot();}
    else root=dateRoot;
    const final=one(control(root,/^(Запланировать|Отложить|Запланировать публикацию)$/u),'подтверждение отложенной записи');
    if(final.disabled) throw new Error('VK не принял дату публикации.');
    log(`Дата публикации: ${p.day}.${p.month}.${p.year} ${time} (Москва).`);
    return final;
  }
  async function runBatch(batch) {
    if(state.batchRunning) throw new Error('Партия уже выполняется в этой вкладке.');
    if (batch.settings && batch.community) configure(batch.settings,batch.community);
    state.batchRunning=true;state.batch=batch;state.batchStopped=false;state.stopped=false;state.captchaPaused=false;
    const heartbeat=setInterval(()=>message({type:'batchHeartbeat',batchId:batch.id}).catch(()=>{}),30000);
    try {
      await captchaGate();
      const latest=Object.hasOwn(batch,'queueDate') ? batch.queueDate : await latestPendingDate();
      let previous=Math.floor(Math.max(latest||0,batch.lastDate||0)/60000)*60000;
      if(!previous) {const p=dateParts(Date.now());previous=moscowDate(+p.year,+p.month,+p.day,+p.hour,+p.minute);}
      if(batch.waitBeforeNext) {
        state.stage='batch interval';
        let remaining=batch.intervalSeconds*1000;
        while(remaining>0) {await captchaGate();const chunk=Math.min(remaining,200);await delay(chunk);remaining-=chunk;}
      }
      for(let completed=batch.completed;completed<batch.amount;completed++) {
        if(state.batchStopped) throw new Error('Остановлено пользователем.');
        const planned=previous+86400000;
        state.plannedAt=planned;
        const result=await run({automatic:true,scheduledAt:planned});
        if(!result?.success) throw new Error(result?.error||'Отложенная запись не подтверждена.');
        await message({type:'batchProgress',batchId:batch.id,completed:completed+1,lastDate:planned,unconfirmed:!!result.unconfirmed});
        state.batch.completed=completed+1;state.batch.lastDate=planned;
        previous=planned;
        if(completed+1<batch.amount) {
          state.stage='batch interval';
          let remaining=batch.intervalSeconds*1000;
          while(remaining>0) {
            await captchaGate();if(state.batchStopped)throw new Error('Остановлено пользователем.');
            const chunk=Math.min(remaining,200);await delay(chunk);remaining-=chunk;
          }
        }
      }
    } catch(error) {
      if(state.stopped || state.batchStopped)return;
      log('Партия остановлена: '+error.message);panel();
      try {await message({type:'diagnostic',data:diagnostics(error.message),download:true,batchId:batch.id});}catch{}
      try {await message({type:'batchError',batchId:batch.id,error:error.message});}catch{}
    } finally {clearInterval(heartbeat);state.batchRunning=false;state.batch=null;state.captchaPaused=false;}
  }
  async function run(options) {
    if (!['vk.ru','vk.com'].includes(location.hostname)) throw new Error('Откройте выбранное сообщество.');
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
      if (state.batch?.settings && state.batch?.community) configure(state.batch.settings,state.batch.community);
      else {
        const saved = await AZVK.loadSettings();
        configure(saved,AZVK.resolveCommunity(saved.communityUrl));
      }
      if (location.pathname.replace(/\/$/u,'') !== PATH) throw new Error('Откройте выбранное сообщество.');
      if (composerCandidates().length) throw new Error('Уже открыт черновик. Завершите или закройте его перед запуском.');
      state.stage = 'song text'; const text = await preparePostText();
      log(state.songTitle ? `Текст подготовлен: ${state.songTitle}.` : 'Текст подготовлен.');
      await collectMedia();
      state.stage = 'open composer';
      const composer = await openComposer({unattended: !!options.scheduleRunId || !!options.scheduledAt}); await captchaGate();setText(composer.editor, text);
      await attachPhoto(); await advanceComposer(); await attachAudio();
      state.stage = 'verify';
      const root = currentComposerRoot();
      if (photoAttachments(root).length !== 1 || audioAttachments(root).length !== 1) throw new Error('Вложения не удалось проверить. Пост оставлен в редакторе.');
      if (!options.automatic) { log('Пост подготовлен. Проверьте автора и вложения, затем опубликуйте в VK вручную.'); return; }
      if (!authorVerified(root)) throw new Error(`Не удалось подтвердить автора «${NAME}». Пост оставлен в редакторе. Проверьте автора; отправьте диагностику для настройки.`);
      if (state.stopped) throw new Error('Остановлено пользователем.');
      const submit=options.scheduledAt ? await prepareScheduledSubmission(options.scheduledAt) : one(control(root, /^Опубликовать$/u), 'кнопка публикации');
      await message({type: 'beginPublish', jobId, photo: state.photo.id, audio: state.audio.id,scheduledAt:options.scheduledAt,batchId:state.batch?.id});
      if (state.stopped) throw new Error('Остановлено пользователем. Проверьте стену перед новой попыткой.');
      state.stage = 'publish';state.verification=null;
      await click(submit);
      log('Публикация отправлена один раз. Проверяю результат…');
      try {
        if(options.scheduledAt) {
          await until(()=>!currentComposerRoot(),'закрытие редактора после планирования',20000);
          if(state.batch && Object.hasOwn(state.batch,'queueDate')) {
            const check=await message({type:'pendingInspect',batchId:state.batch.id,text:text.split('\n')[0],date:options.scheduledAt});
            state.verification=check;
            if(!check.found) throw new Error('Новая запись с выбранным текстом и датой не найдена в «Отложенные».');
          } else {
            const pending=await openPending();
            await until(()=>scheduledPosts(pending).find(post=>post.textContent.includes(text.split('\n')[0]) &&
              pendingPostDate(post)===options.scheduledAt),'новая запись с выбранной датой в «Отложенные»',20000);
          }
        } else await until(() => all(document, '[data-testid="post"],.wall_item').find(post =>
          visible(post) && post.textContent.includes(text.split('\n')[0])), 'новая публикация на стене', 20000);
      } catch (verificationError) {
        state.verification={...state.verification,error:verificationError.message};
        if(options.scheduledAt && state.batch && !currentComposerRoot() && !state.stopped && !state.batchStopped) {
          await message({type:'completePublish',jobId,unconfirmed:true});
          log('Отправка не подтверждена. Продолжаю без повторной отправки; дата будет в итоговом списке.');
          outcome={success:true,unconfirmed:true};return outcome;
        }
        if(options.scheduledAt && state.batch)throw new Error('Результат отправки не подтверждён: запись могла попасть в «Отложенные». Партия остановлена без повторной отправки. Можно начать новую партию.');
        throw new Error('Результат отправки не подтверждён. Проверьте стену и «Отложенные»: пост мог появиться. Повторная отправка заблокирована.');
      }
      await message({type: 'completePublish', jobId});
      log(options.scheduledAt ? 'Пост сохранён в «Отложенные».' : 'Пост опубликован на стене сообщества.');
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
    return outcome;
  }

  globalThis.TriSloga = {configure,artistMatches,firstBandSearchAudio,run, photoCandidates, audioCandidates, composerCandidates, parseSongs, chooseSongExcerpt,
    songSimilarity, matchingCommunityAudio, state, openComposer,
    creationMenuItems, musicPicker, matchesAudio, attachAudio, attachPhoto, nativePhotoCards, currentComposerRoot, audioAttachments, photoAttachments, authorVerified,
    parsePostDate,pendingPostDate,latestPendingDate,prepareScheduledSubmission,runBatch,captchaGate,captchaVisible,dateParts,scheduledPosts};
  chrome.runtime.onMessage.addListener((options, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    if(options.type==='inspectPending') {
      try { configure(options.batch.settings,options.batch.community); }
      catch (error) {reply({ok:false,error:error.message});return;}
      if(location.pathname!==`/wall${OWNER}` || new URLSearchParams(location.search).get('postponed')!=='1') {reply({ok:false,error:'Открыта другая страница отложенных записей.'});return;}
      state.batch=options.batch;state.stopped=false;state.batchStopped=false;state.captchaPaused=false;
      const heartbeat=setInterval(()=>message({type:'batchHeartbeat',batchId:options.batch.id}).catch(()=>{}),20000);
      (async()=>{
        try {
          let found=options.text ? false : undefined;
          const observed=[];
          const latest=await latestPendingDate((post,date)=>{
            const textMatches=options.text ? normalize(post.textContent).includes(normalize(options.text)) : undefined;
            if(textMatches && date===options.date)found=true;
            if(observed.length<60)observed.push({id:post.id,date,textMatches});
          });
          reply({ok:true,latest,found,verification:{expectedText:options.text,expectedDate:options.date,observed}});
        } catch(error) {
          try {await message({type:'diagnostic',data:diagnostics(error.message),download:!options.text && !state.stopped,batchId:options.batch.id});}catch{}
          reply({ok:false,error:error.message});
        } finally {clearInterval(heartbeat);state.batch=null;}
      })();return true;
    }
    if(options.type==='captchaResume') {
      if(options.batchId!==state.batch?.id || !state.captchaPaused) {reply({ok:false,error:'Нет CAPTCHA для продолжения.'});return;}
      if(captchaVisible()) {reply({ok:false,error:'CAPTCHA ещё видна. Сначала решите её во вкладке VK.'});return;}
      state.captchaPaused=false;
      message({type:'batchCaptcha',batchId:state.batch.id,paused:false}).catch(()=>{});
      reply({ok:true});return;
    }
    if(options.type==='batchStop') {
      if(options.batchId && options.batchId!==state.batch?.id) {reply({ok:false,error:'Устаревшая партия.'});return;}
      state.batchStopped=true;state.stopped=true;reply({ok:true});return;
    }
    if(options.type==='batchStart') {
      if(state.batchRunning || state.running) {reply({ok:false,error:'Партия уже выполняется.'});return;}
      reply({ok:true});runBatch(options.batch);return;
    }
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
