const COMMUNITY_PATH = '/tri_sloga_band';
const LYRICS_SOURCE = 'https://docs.google.com/document/d/1P-uauTVZ_u8GkYct3f7UN__g6pTFS8y-/export?format=html';
if (typeof importScripts === 'function') importScripts('scheduler.js');
let jobQueue = Promise.resolve();

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

async function fetchLimited(url, limit) {
  const response = await fetch(url, {signal: AbortSignal.timeout(25000), credentials: 'omit'});
  if (!response.ok) throw new Error(`Источник недоступен: HTTP ${response.status}`);
  const type = (response.headers.get('content-type') || '').split(';')[0];
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
    if (['scheduleSet', 'scheduleStop', 'scheduleStatus', 'scheduleResult', 'scheduleRetry'].includes(message.type)) {
      if (message.type === 'scheduleRetry' && sender.tab && !fromVK) throw new Error('Повтор доступен только из VK.');
      if (message.type === 'scheduleResult' && !fromVK) throw new Error('Результат должен поступить из VK.');
      if (['scheduleSet', 'scheduleStatus'].includes(message.type) && sender.tab) throw new Error('Используйте настройки расширения.');
      return scheduleCommand(message, sender);
    }
    if (['claim', 'release', 'beginPublish', 'completePublish'].includes(message.type)) {
      if (!fromVK) throw new Error('Публикация доступна только из VK.');
      return jobCommand(message, sender);
    }
    if (message.type === 'lyrics') {
      if (!fromVK) throw new Error('Запрос должен поступить из вкладки VK.');
      const result = await fetchLimited(LYRICS_SOURCE, 2_000_000);
      return {html: new TextDecoder().decode(result.data)};
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
