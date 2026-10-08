// Finite batches run in the VK page; persisted checkpoints survive popup closure.
let batchQueue = Promise.resolve();
const batchSerial = task => {
  const next = batchQueue.then(task); batchQueue = next.catch(() => {}); return next;
};
async function batchNotify(error) {
  await chrome.action.setBadgeText({text:'!'});
  await chrome.action.setBadgeBackgroundColor({color:'#d93025'});
  try { await chrome.notifications.create('tri-sloga-error', {type:'basic',iconUrl:'icon.png',
    title:'Три Слога — партия приостановлена',message:error,priority:2}); } catch {}
}
async function batchTab() {
  const tabs = await chrome.tabs.query({url:['https://vk.ru/*','https://vk.com/*']});
  const matches = tab => /^https:\/\/(vk\.ru|vk\.com)\/tri_sloga_band\/?(?:[?#]|$)/.test(tab.url || '');
  const tab = tabs.find(t=>t.active && matches(t)) || tabs.find(matches);
  return tab ? chrome.tabs.update(tab.id,{active:true}) : chrome.tabs.create({url:'https://vk.ru/tri_sloga_band',active:true});
}
async function readPendingPage(batch,check={}) {
  const tab=await chrome.tabs.create({url:'https://vk.ru/wall-220995299?postponed=1',active:false});
  try {
    await batchSerial(async()=>{
      const {batch:current}=await chrome.storage.local.get('batch');
      if(!current?.enabled || current.id!==batch.id)throw new Error('Партия остановлена.');
      await chrome.storage.local.set({batch:{...current,inspectionTabId:tab.id}});
    });
    const deadline=Date.now()+45000;
    let ready=false;
    while(Date.now()<deadline) {
      if((await chrome.tabs.get(tab.id)).status==='complete') {
        try {
          const [probe]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>
            location.pathname==='/wall-220995299' && new URLSearchParams(location.search).get('postponed')==='1' && !!document.body});
          if(probe?.result) {ready=true;break;}
        }catch{}
      }
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    if(!ready)throw new Error('Страница «Отложенные посты» не загрузилась. Проверьте VK и VPN.');
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
    const response=await chrome.tabs.sendMessage(tab.id,{type:'inspectPending',batch,...check});
    if(!response?.ok)throw new Error(response?.error||'Не удалось прочитать «Отложенные посты».');
    return response;
  } finally {
    await batchSerial(async()=>{
      const {batch:current}=await chrome.storage.local.get('batch');
      if(current?.id===batch.id)await chrome.storage.local.set({batch:{...current,inspectionTabId:null}});
    });
    try {await chrome.tabs.remove(tab.id);}catch{}
  }
}
async function batchLaunch(id) {
  try {
    const tab = await batchTab();
    const allowed = await batchSerial(async()=>{
      const {batch} = await chrome.storage.local.get('batch');
      if (!batch?.enabled || batch.id !== id) return false;
      await chrome.storage.local.set({batch:{...batch,tabId:tab.id}}); return true;
    });
    if (!allowed) return;
    const deadline = Date.now()+45000;
    let loaded=false;
    while(Date.now()<deadline) {
      if ((await chrome.tabs.get(tab.id)).status==='complete') {
        try {
          const [probe]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>
            location.pathname==='/tri_sloga_band' && !!document.querySelector('#top_profile_link,[data-testid="header-profile-menu-button"],#login_form,input[type="password"]')});
          if(probe?.result) {loaded=true;break;}
        } catch {}
      }
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    if (!loaded) throw new Error('VK не загрузился за 45 секунд. Проверьте соединение и VPN.');
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
    const {batch:currentBatch}=await chrome.storage.local.get('batch');
    const queue=await readPendingPage(currentBatch);
    await batchSerial(async()=>{
      const {batch}=await chrome.storage.local.get('batch');
      if (!batch?.enabled || batch.id!==id) return;
      const response=await chrome.tabs.sendMessage(tab.id,{type:'batchStart',batch:{...batch,queueDate:queue.latest}});
      if (!response?.ok) throw new Error(response?.error || 'Не удалось запустить партию.');
    });
  } catch(error) {
    await batchSerial(async()=>{
      const {batch}=await chrome.storage.local.get('batch');
      if(batch?.id===id && batch.enabled) {
        await chrome.storage.local.set({batch:{...batch,running:false,needsFix:true,error:error.message}});
        await batchNotify(error.message);
        if(typeof downloadDiagnostics==='function')await downloadDiagnostics(error.message,id);
      }
    });
  }
}
async function batchCommand(message,sender) {
  if(message.type==='batchStatus') return chrome.storage.local.get(['batch','publicationAttempt']);
  if(message.type==='pendingInspect') {
    const {batch}=await chrome.storage.local.get('batch');
    if(!batch?.enabled||batch.id!==message.batchId||batch.tabId!==sender.tab?.id)throw new Error('Устаревший сеанс партии.');
    return readPendingPage(batch,{text:message.text,date:message.date});
  }
  if(message.type==='batchStart') {
    const amount=Number(message.amount), intervalSeconds=Number(message.intervalSeconds);
    if(!Number.isInteger(amount)||amount<1||amount>1000) throw new Error('Количество: целое число от 1 до 1000.');
    if(!Number.isFinite(intervalSeconds)||intervalSeconds<1||intervalSeconds>86400) throw new Error('Интервал: от 1 до 86400 секунд.');
    const id=await batchSerial(async()=>{
      const {batch,publicationAttempt,activeJob}=await chrome.storage.local.get(['batch','publicationAttempt','activeJob']);
      if(batch?.enabled) throw new Error('Сначала остановите или завершите текущую партию.');
      if(activeJob?.expires>Date.now()) throw new Error('Предыдущая попытка ещё завершается.');
      if(publicationAttempt?.status==='pending') throw new Error('Предыдущая отправка не подтверждена. Проверьте «Отложенные» и повторите через кнопку исправления.');
      const id=crypto.randomUUID();
      await chrome.storage.local.set({batch:{id,enabled:true,running:true,amount,intervalSeconds,completed:0,lastDate:null,error:''},
        schedule:{enabled:false}});
      await chrome.alarms.clear('tri-sloga-publish');await chrome.alarms.clear('tri-sloga-watchdog');
      await chrome.action.setBadgeText({text:''}); return id;
    });
    batchLaunch(id);return chrome.storage.local.get('batch');
  }
  if(message.type==='batchResume') {
    let {batch,publicationAttempt}=await chrome.storage.local.get(['batch','publicationAttempt']);
    if(!batch?.enabled) throw new Error('Нет приостановленной партии.');
    if(batch.captcha) {
      const reply=await chrome.tabs.sendMessage(batch.captchaTabId||batch.tabId,{type:'captchaResume',batchId:batch.id});
      if(!reply?.ok) throw new Error(reply?.error || 'Вкладка с CAPTCHA недоступна.');
    } else {
      if(!batch.needsFix) throw new Error('Партия уже выполняется.');
      if(publicationAttempt?.status==='published' && publicationAttempt.batchId===batch.id &&
          publicationAttempt.scheduledAt>(batch.lastDate||0)) {
        batch={...batch,completed:batch.completed+1,lastDate:publicationAttempt.scheduledAt};
        if(batch.completed>=batch.amount) {
          await chrome.storage.local.set({batch:{...batch,enabled:false,running:false,needsFix:false,done:true,error:''}});
          return chrome.storage.local.get('batch');
        }
      }
      if(publicationAttempt?.status==='pending') {
        if(message.confirmNoPost!==true) throw new Error('Проверьте «Отложенные»: предыдущая запись могла быть сохранена.');
        await chrome.storage.local.remove('publicationAttempt');
      }
      await chrome.storage.local.set({batch:{...batch,running:true,needsFix:false,error:''}});
      batchLaunch(batch.id);
    }
    return chrome.storage.local.get('batch');
  }
  if(message.type==='batchStop') {
    return batchSerial(async()=>{
      const {batch}=await chrome.storage.local.get('batch');
      if(batch?.tabId) { try {await chrome.tabs.sendMessage(batch.tabId,{type:'batchStop',batchId:batch.id});}catch{} }
      if(batch?.inspectionTabId) {try {await chrome.tabs.sendMessage(batch.inspectionTabId,{type:'batchStop',batchId:batch.id});}catch{}}
      await chrome.storage.local.set({batch:{...batch,enabled:false,running:false,captcha:false,stopped:true}});
      return chrome.storage.local.get('batch');
    });
  }
  return batchSerial(async()=>{
    const {batch,activeJob}=await chrome.storage.local.get(['batch','activeJob']);
    const inspection=sender.tab?.id===batch?.inspectionTabId && ['batchCaptcha','batchHeartbeat'].includes(message.type);
    if(!batch?.enabled||batch.id!==message.batchId||(!inspection && batch.tabId!==sender.tab?.id)) throw new Error('Устаревший сеанс партии.');
    if(message.type==='batchHeartbeat') {
      if(activeJob?.tabId===batch.tabId) await chrome.storage.local.set({activeJob:{...activeJob,expires:Date.now()+15*60000}});
      return {};
    }
    if(message.type==='batchCaptcha') {
      await chrome.storage.local.set({batch:{...batch,captcha:message.paused===true,captchaTabId:message.paused?sender.tab.id:null,error:message.paused?'Решите CAPTCHA во вкладке VK и нажмите «ОК — продолжить».':''}});
      if(message.paused) {await chrome.tabs.update(sender.tab.id,{active:true});await batchNotify('Решите CAPTCHA во вкладке VK и нажмите «ОК — продолжить».');}
      else await chrome.action.setBadgeText({text:''});
      return {};
    }
    if(message.type==='batchProgress') {
      if(message.completed!==batch.completed+1||message.completed>batch.amount||!Number.isFinite(message.lastDate)||message.lastDate<=(batch.lastDate||0)) throw new Error('Неверная контрольная точка партии.');
      const done=message.completed===batch.amount;
      await chrome.storage.local.set({batch:{...batch,completed:message.completed,lastDate:message.lastDate,
        enabled:!done,running:!done,done,captcha:false,error:'',needsFix:false}});
      await chrome.action.setBadgeText({text:''});return {};
    }
    if(message.type==='batchError') {
      await chrome.storage.local.set({batch:{...batch,running:false,needsFix:true,captcha:false,error:String(message.error)}});
      await batchNotify(String(message.error));return {};
    }
    throw new Error('Неизвестная команда партии.');
  });
}
async function batchInterrupted() {
  const {batch}=await chrome.storage.local.get('batch');
  if(batch?.enabled) {
    await chrome.storage.local.set({batch:{...batch,running:false,captcha:false,needsFix:true,
      error:'Вкладка или браузер были закрыты. Проверьте «Отложенные» перед продолжением партии.'}});
    await chrome.storage.local.remove(['activeJob']);
    if(typeof downloadDiagnostics==='function')await downloadDiagnostics('Вкладка или браузер были закрыты. Проверьте «Отложенные» перед продолжением партии.',batch.id);
  }
}
chrome.runtime.onStartup.addListener(()=>batchInterrupted().catch(console.error));
chrome.runtime.onInstalled.addListener(async()=>{
  await chrome.alarms.clear('tri-sloga-publish');await chrome.alarms.clear('tri-sloga-watchdog');
  await chrome.storage.local.set({schedule:{enabled:false}});await batchInterrupted();
});
chrome.tabs.onRemoved?.addListener(tabId=>{
  chrome.storage.local.get('batch').then(({batch})=>{if(batch?.tabId===tabId)return batchInterrupted();}).catch(console.error);
});
chrome.tabs.onUpdated?.addListener((tabId,change)=>{
  if(change.status!=='loading')return;
  chrome.storage.local.get('batch').then(({batch})=>{if(batch?.enabled && batch.tabId===tabId)return batchInterrupted();}).catch(console.error);
});
chrome.notifications.onClicked.addListener(id=>{
  if(id==='tri-sloga-error')chrome.storage.local.get('batch').then(({batch})=>batch?.captchaTabId?
    chrome.tabs.update(batch.captchaTabId,{active:true}):batchTab()).catch(console.error);
});
