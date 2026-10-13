if (typeof importScripts === 'function') importScripts('config.js', 'batch.js');
let jobQueue = Promise.resolve();
// Name only our diagnostic downloads; leave all other downloads untouched.
chrome.downloads?.onDeterminingFilename?.addListener((item,suggest)=>{
  if(item.byExtensionId!==chrome.runtime.id || !item.url?.startsWith('data:application/json')) {suggest();return;}
  try {
    const data=JSON.parse(decodeURIComponent(item.url.slice(item.url.indexOf(',')+1)));
    if(/^Tri-Sloga-diagnostics-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/u.test(data.diagnosticFilename)) {
      suggest({filename:data.diagnosticFilename,conflictAction:'uniquify'});return;
    }
  } catch {}
  suggest();
});
async function downloadDiagnostics(error,batchId) {
  const snapshot=await chrome.storage.local.get(['lastDiagnostic','batch','publicationAttempt','diagnosticDownload']);
  const key=`${batchId||snapshot.batch?.id||''}:${error}`;
  if(snapshot.diagnosticDownload?.key===key && Date.now()-snapshot.diagnosticDownload.time<10000)return;
  if(!chrome.downloads?.download)return;
  const data={time:new Date().toISOString(),error,batch:snapshot.batch,publicationAttempt:snapshot.publicationAttempt,lastDiagnostic:snapshot.lastDiagnostic};
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})
    .formatToParts(new Date()).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
  const filename=`Tri-Sloga-diagnostics-${parts.year}-${parts.month}-${parts.day}_${parts.hour}-${parts.minute}-${parts.second}.json`;
  data.diagnosticFilename=filename;
  await chrome.downloads.download({url:'data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(data,null,2)),
    filename,saveAs:false,conflictAction:'uniquify'});
  await chrome.storage.local.set({diagnosticDownload:{key,time:Date.now()}});
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
        time: new Date().toISOString(), photo: message.photo, audio: message.audio,scheduledAt:message.scheduledAt,batchId:message.batchId}});
      return {};
    }
    if (message.type === 'completePublish' && publicationAttempt?.jobId === message.jobId) {
      await chrome.storage.local.set({publicationAttempt: {...publicationAttempt, status: message.unconfirmed===true ? 'unconfirmed' : 'published'}});
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
    if (['settingsGet','settingsSave'].includes(message.type)) {
      if (sender.tab) throw new Error('Используйте настройки расширения.');
      if (message.type === 'settingsGet') return {settings:await AZVK.loadSettings()};
      return batchSerial(async () => {
        const {batch} = await chrome.storage.local.get('batch');
        if (batch?.enabled) throw new Error('Остановите партию перед изменением настроек.');
        const settings = AZVK.normalizeSettings(message.settings);
        await chrome.storage.local.set({settings}); return {settings};
      });
    }
    if(message.type==='pendingInspect') {
      if(!fromVK)throw new Error('Запрос должен поступить из VK.');
      return batchCommand(message,sender);
    }
    if (message.type.startsWith('batch')) {
      if(['batchProgress','batchError','batchCaptcha','batchHeartbeat'].includes(message.type) && !fromVK) throw new Error('Команда должна поступить из VK.');
      if(['batchStart','batchStatus','batchApprove'].includes(message.type) && sender.tab) throw new Error('Используйте настройки расширения.');
      const result=await batchCommand(message,sender);
      if(message.type==='batchError')await downloadDiagnostics(String(message.error),message.batchId);
      return result;
    }
    if (typeof scheduleCommand === 'function' && ['scheduleSet', 'scheduleStop', 'scheduleStatus', 'scheduleResult', 'scheduleRetry'].includes(message.type)) {
      if (message.type === 'scheduleRetry' && sender.tab && !fromVK) throw new Error('Повтор доступен только из VK.');
      if (message.type === 'scheduleResult' && !fromVK) throw new Error('Результат должен поступить из VK.');
      if (['scheduleSet', 'scheduleStatus'].includes(message.type) && sender.tab) throw new Error('Используйте настройки расширения.');
      return scheduleCommand(message, sender);
    }
    if (['claim', 'release', 'beginPublish', 'completePublish'].includes(message.type)) {
      if (!fromVK) throw new Error('Публикация доступна только из VK.');
      return jobCommand(message, sender);
    }
    if (['lyrics','quotes'].includes(message.type)) {
      if (!fromVK) throw new Error('Запрос должен поступить из вкладки VK.');
      const {batch} = await chrome.storage.local.get('batch');
      if (message.batchId && (!batch?.enabled || batch.id !== message.batchId || batch.tabId !== sender.tab.id))
        throw new Error('Устаревший сеанс партии.');
      const settings = message.batchId ? batch.settings || await AZVK.loadSettings() : await AZVK.loadSettings();
      if (message.type === 'quotes') {
        if (settings.noText || settings.textMode !== 'quote') throw new Error('Режим цитат не включён.');
        const base = 'https://ru.wikiquote.org';
        const reference = settings.quoteReference;
        const urls = [base+'/wiki/'+encodeURIComponent(reference.replace(/ /gu,'_'))];
        if (message.search === true) {
          const search = await fetchLimited(base+'/w/index.php?title=Special:Search&search='+encodeURIComponent(reference)+'&limit=5&ns0=1&fulltext=1',2_000_000);
          const html = new TextDecoder().decode(search.data);
          urls.length = 0;
          for (const match of html.matchAll(/class="mw-search-result-heading"[^>]*>\s*<a[^>]*href="([^"#]+)"/gu)) {
            const url = new URL(match[1].replace(/&amp;/gu,'&'),base);
            if (url.origin === base && url.pathname.startsWith('/wiki/')) urls.push(url.href);
            if (urls.length === 4) break;
          }
        }
        const pages = [];
        for (const url of [...new Set(urls)]) {
          try {
            const result = await fetchLimited(url,2_000_000);
            pages.push({url,html:new TextDecoder().decode(result.data)});
          } catch (error) { if (!message.search && !/HTTP 404/u.test(error.message)) throw error; }
        }
        return {pages};
      }
      const result = await fetchLimited(AZVK.documentExport(settings), 2_000_000);
      return {html: new TextDecoder().decode(result.data)};
    }
    if (message.type === 'diagnostic') {
      if (!fromVK) throw new Error('Диагностика доступна только из VK.');
      await chrome.storage.local.set({lastDiagnostic: message.data});
      if(message.download)await downloadDiagnostics(message.data.error,message.batchId);
      return {};
    }
    throw new Error('Неизвестная команда.');
  };
  task().then(data => reply({ok: true, ...data}), error => reply({ok: false, error: error.message}));
  return true;
});
