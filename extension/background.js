const COMMUNITY_PATH = '/tri_sloga_band';
const QUOTE_SOURCE = 'https://ru.wikiquote.org/wiki/Любовь';
if (typeof importScripts === 'function') importScripts('scheduler.js');
let jobQueue = Promise.resolve();

async function collectAlbum(raw, windowId) {
  const url = new URL(raw);
  if (!['vk.ru','vk.com'].includes(url.hostname) || url.protocol !== 'https:' || url.username || url.password || url.port ||
      !/^\/album-220995299_\d+$/.test(url.pathname)) throw new Error('Недопустимый альбом сообщества.');
  const options = {url: url.href, active: false};
  if (Number.isInteger(windowId)) options.windowId = windowId;
  const tab = await chrome.tabs.create(options);
  try {
    for (let i = 0; i < 160; i++) {
      const current = await chrome.tabs.get(tab.id);
      if (current.status === 'complete') break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const results = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: async () => {
      const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
      for (let n = 0; n < 100; n++) {
        const photos = new Map();
        for (const item of document.querySelectorAll('a[href*="photo-220995299_"],[data-photo-id^="-220995299_"]')) {
          const id = item.dataset.photoId || item.getAttribute('href')?.match(/photo(-220995299_\d+)/)?.[1];
          const card = item.closest('.photos_row,[data-photo-id]') || item;
          const img = card.querySelector('img');
          const background = [card,...card.querySelectorAll('[style]')].map(el => getComputedStyle(el).backgroundImage).find(css => css.startsWith('url('));
          const image = img?.currentSrc || img?.src || background?.slice(4,-1).replace(/^["']|["']$/g,'');
          if (id && image?.startsWith('https://') && !item.closest('[data-testid="post"],.wall_item')) photos.set(id,{id,image,url:`${location.origin}/photo${id}`});
        }
        if (photos.size) return [...photos.values()];
        await delay(200);
      }
      throw new Error('VK не показал фотографии в выбранном альбоме.');
    }});
    return results[0].result;
  } finally { try { await chrome.tabs.remove(tab.id); } catch { /* Already closed. */ } }
}

function jobCommand(message, sender) {
  const task = jobQueue.then(async () => {
    const {activeJob, publicationAttempt} = await chrome.storage.local.get(['activeJob', 'publicationAttempt']);
    if (message.type === 'claim') {
      if (publicationAttempt?.status === 'pending') throw new Error('Предыдущая отправка не подтверждена. Проверьте стену и разрешите новую попытку кнопкой в панели.');
      if (activeJob?.expires > Date.now()) {
        const reloaded = activeJob.tabId === sender.tab.id && activeJob.documentId && sender.documentId && activeJob.documentId !== sender.documentId;
        if (!reloaded) throw new Error('Публикация уже выполняется в другой вкладке. Если её закрыли, попробуйте через 15 минут.');
      }
      const job = {id: crypto.randomUUID(), tabId: sender.tab.id, documentId: sender.documentId, expires: Date.now() + 15 * 60 * 1000};
      await chrome.storage.local.set({activeJob: job});
      return {jobId: job.id};
    }
    if (!activeJob || activeJob.id !== message.jobId || activeJob.tabId !== sender.tab.id) throw new Error('Сеанс публикации завершён. Запустите снова.');
    if (message.type === 'release') {
      await chrome.storage.local.remove('activeJob'); return {};
    }
    if (message.type === 'beginPublish') {
      if (publicationAttempt?.status === 'pending') throw new Error('Повторная отправка заблокирована. Проверьте стену.');
      await chrome.storage.local.set({publicationAttempt: {jobId: message.jobId, status: 'pending',
        time: new Date().toISOString(), photo: message.photo, audio: message.audio}});
      return {};
    }
    if (message.type === 'completePublish' && publicationAttempt?.jobId === message.jobId) {
      await chrome.storage.local.set({publicationAttempt: {...publicationAttempt, status: 'published'}});
      return {};
    }
    throw new Error('Неизвестное действие публикации.');
  });
  jobQueue = task.catch(() => {});
  return task;
}

function allowedImage(raw) {
  const url = new URL(raw);
  const roots = ['vkuserphoto.ru', 'vkuserphoto.com', 'userapi.com', 'vk.com', 'vk.ru'];
  return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
    roots.some(root => url.hostname === root || url.hostname.endsWith('.' + root));
}

async function fetchLimited(url, limit, image = false) {
  const response = await fetch(url, {signal: AbortSignal.timeout(25000), credentials: 'omit'});
  if (!response.ok) throw new Error(`Источник недоступен: HTTP ${response.status}`);
  if (image && !allowedImage(response.url || url)) throw new Error('Неожиданный адрес изображения.');
  const type = (response.headers.get('content-type') || '').split(';')[0];
  if (image && !['image/jpeg', 'image/png', 'image/webp'].includes(type)) throw new Error('Источник вернул не фотографию.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Error('Файл слишком большой.'); }
    chunks.push(value);
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return {data, type};
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const fromExtension = sender.id === chrome.runtime.id;
  const fromVK = sender.tab && /^https:\/\/(vk\.ru|vk\.com)\//.test(sender.url || sender.tab.url || '');
  if (!fromExtension) return;
  const task = async () => {
    if (['scheduleSet', 'scheduleStop', 'scheduleStatus', 'scheduleResult'].includes(message.type)) {
      if (message.type === 'scheduleResult' && !fromVK) throw new Error('Результат должен поступить из VK.');
      if (['scheduleSet', 'scheduleStatus'].includes(message.type) && sender.tab) throw new Error('Используйте настройки расширения.');
      return scheduleCommand(message, sender);
    }
    if (['claim', 'release', 'beginPublish', 'completePublish'].includes(message.type)) {
      if (!fromVK) throw new Error('Публикация доступна только из VK.');
      return jobCommand(message, sender);
    }
    if (message.type === 'quote') {
      if (!fromVK) throw new Error('Запрос должен поступить из вкладки VK.');
      const result = await fetchLimited(QUOTE_SOURCE, 2_000_000);
      return {html: new TextDecoder().decode(result.data), source: QUOTE_SOURCE};
    }
    if (message.type === 'album') {
      if (!fromVK) throw new Error('Запрос альбома должен поступить из VK.');
      return {photos: await collectAlbum(message.url, sender.tab.windowId)};
    }
    if (message.type === 'image') {
      if (!fromVK || !allowedImage(message.url)) throw new Error('Недопустимый источник фотографии.');
      const {data, type} = await fetchLimited(message.url, 15_000_000, true);
      let binary = '';
      for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192));
      return {base64: btoa(binary), mime: type};
    }
    if (message.type === 'diagnostic') {
      if (!fromVK) throw new Error('Диагностика доступна только из VK.');
      await chrome.storage.local.set({lastDiagnostic: message.data});
      return {};
    }
    throw new Error('Неизвестная команда.');
  };
  task().then(data => reply({ok: true, ...data}), error => reply({ok: false, error: error.message}));
  return true;
});
