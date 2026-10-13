(() => {
  if (globalThis.AZVK) return;
  const defaults = Object.freeze({
    communityUrl: '',
    artist: 'Три слога',
    documentUrl: 'https://docs.google.com/document/d/1P-uauTVZ_u8GkYct3f7UN__g6pTFS8y-/edit'
  });
  function normalizeSettings(value = defaults) {
    let community, document;
    try { community = new URL(String(value.communityUrl || '').trim()); }
    catch { throw new Error('Укажите ссылку на сообщество: https://vk.ru/имя или https://vk.com/club123.'); }
    if (community.protocol !== 'https:' || !['vk.ru','vk.com'].includes(community.hostname) || community.port || community.username || community.password)
      throw new Error('Сообщество должно быть на https://vk.ru/ или https://vk.com/.');
    const slug = community.pathname.replace(/^\/|\/$/gu,'');
    if (!/^[a-z0-9_.]+$/iu.test(slug) || /^(?:id\d+|feed|im|audio|video|photos|friends|settings|login)$/iu.test(slug))
      throw new Error('Укажите страницу сообщества, например https://vk.ru/club123, а не профиль или запись.');
    const artist = String(value.artist || '').replace(/\s+/gu,' ').trim();
    if (!artist || artist.length > 200) throw new Error('Укажите имя исполнителя (до 200 символов).');
    try { document = new URL(String(value.documentUrl || '').trim()); }
    catch { throw new Error('Укажите ссылку на Google Документ.'); }
    const id = document.pathname.match(/^\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)(?:\/|$)/u)?.[1];
    if (document.protocol !== 'https:' || document.hostname !== 'docs.google.com' || document.port || document.username || document.password || !id)
      throw new Error('Нужна ссылка вида https://docs.google.com/document/d/ID/edit.');
    return {communityUrl:`${community.origin}/${slug}`,artist,documentUrl:`https://docs.google.com/document/d/${id}/edit`};
  }
  const documentExport = settings => normalizeSettings(settings).documentUrl.replace(/\/edit$/u,'/export?format=html');
  async function loadSettings() {
    const {settings} = await chrome.storage.local.get('settings');
    return normalizeSettings({...defaults,...settings});
  }
  function matchesCommunity(url,settings,community) {
    try {
      const target = new URL(url);
      return target.protocol === 'https:' && ['vk.ru','vk.com'].includes(target.hostname) &&
        [new URL(settings.communityUrl).pathname,community?.path].includes(target.pathname.replace(/\/$/u,''));
    } catch { return false; }
  }
  // chrome.scripting serializes this function; keep it self-contained.
  function resolveCommunity(communityUrl) {
    const requested = new URL(communityUrl);
    const path = location.pathname.replace(/\/$/u,'');
    const numeric = requested.pathname.match(/^\/(?:club|public|event)(\d+)$/u)?.[1];
    if (!['vk.ru','vk.com'].includes(location.hostname) || (!numeric && path !== requested.pathname.replace(/\/$/u,'')))
      throw new Error('VK открыл другую страницу. Проверьте ссылку на сообщество.');
    const heading = document.querySelector('[data-testid="group-name"],.group_name,#group_name,.page_name');
    const name = heading?.textContent.replace(/\s+/gu,' ').trim();
    if (!name || !document.querySelector('[data-testid="group_publish_block"],#group_manage_menu_manage,[data-testid="group_manage_menu_manage"],#page_wall_posts'))
      throw new Error('Не удалось подтвердить страницу сообщества. Войдите в VK и проверьте права на создание постов.');
    const ids = new Set();
    const add = id => { if (/^\d+$/u.test(id || '') && Number(id)>0) ids.add(id); };
    add(path.match(/^\/(?:club|public|event)(\d+)$/u)?.[1]);
    for (const el of document.querySelectorAll('[data-testid="group_publish_block"][data-owner-id],#page_wall_posts[data-owner-id]'))
      add(el.getAttribute('data-owner-id')?.replace(/^-/u,''));
    // Queue/wall and album-list links identify the community; individual reposts and photos do not.
    for (const a of document.querySelectorAll('a[href]')) {
      let url; try { url = new URL(a.getAttribute('href'),location.href); } catch { continue; }
      if (!['vk.ru','vk.com'].includes(url.hostname)) continue;
      const wall = url.pathname.match(/^\/wall-(\d+)\/?$/u);
      const albums = url.pathname.match(/^\/albums-(\d+)\/?$/u);
      if (wall || albums) add((wall || albums)[1]);
    }
    if (!ids.size) {
      const wall = document.querySelector('#page_wall_posts,[data-testid="feed-items"],.wall_posts');
      const post = wall?.querySelector('[id^="post-"],[data-post-id^="-"]');
      add((post?.id || post?.getAttribute('data-post-id') || '').match(/^(?:post)?-(\d+)_/u)?.[1]);
    }
    // A numeric community URL also works for empty walls and VK's vanity-name redirects.
    if (!ids.size && numeric) add(numeric);
    if (ids.size !== 1) throw new Error('Не удалось однозначно определить ID сообщества. Используйте ссылку https://vk.ru/club<ID>.');
    const id = [...ids][0];
    if (numeric && numeric !== id) throw new Error('ID открытого сообщества не совпадает со ссылкой в настройках.');
    return {owner:`-${id}`,path,name,origin:location.origin};
  }
  globalThis.AZVK = {defaults,normalizeSettings,documentExport,loadSettings,matchesCommunity,resolveCommunity};
})();
