const status=document.getElementById('status');
const interval=document.getElementById('interval'),amount=document.getElementById('amount');
const enable=document.getElementById('enable'),disable=document.getElementById('disable');
const fixed=document.getElementById('fixed'),captcha=document.getElementById('captcha');
const approve=document.getElementById('approve');
const communityUrl=document.getElementById('communityUrl'),artist=document.getElementById('artist'),documentUrl=document.getElementById('documentUrl');
const saveSettings=document.getElementById('saveSettings');
const noAudio=document.getElementById('noAudio'),noText=document.getElementById('noText');
const documentInOrder=document.getElementById('documentInOrder');
let settingsLoaded=false;
let batchEnabled=false;
enable.disabled=true;saveSettings.disabled=true;
const textMode=document.getElementById('textMode'),quoteReference=document.getElementById('quoteReference'),customText=document.getElementById('customText');
document.getElementById('version').textContent='v'+AZVK.version;
const settingsFields=[communityUrl,artist,documentUrl,textMode,quoteReference,customText];
function inputSettings(){return AZVK.normalizeSettings({...Object.fromEntries(settingsFields.map(field=>[field.id,field.value])),noAudio:noAudio.checked,noText:noText.checked,documentInOrder:documentInOrder.checked});}
function updateSettingsFields(){
  communityUrl.disabled=batchEnabled;
  artist.disabled=batchEnabled||noAudio.checked;
  documentUrl.disabled=batchEnabled||noText.checked;
  documentInOrder.disabled=batchEnabled||noText.checked;
  textMode.disabled=quoteReference.disabled=customText.disabled=batchEnabled||noText.checked;
  for(const [mode,id] of [['document','documentFields'],['quote','quoteFields'],['manual','manualFields']])document.getElementById(id).hidden=textMode.value!==mode;
  noAudio.disabled=noText.disabled=batchEnabled;
}
function showSettings(settings){
  for(const field of settingsFields)field.value=settings[field.id]??AZVK.defaults[field.id];
  noAudio.checked=settings.noAudio===true;noText.checked=settings.noText===true;
  documentInOrder.checked=settings.documentInOrder===true;
  updateSettingsFields();
}
noAudio.onchange=noText.onchange=textMode.onchange=updateSettingsFields;
let approval=null;
let uncertain=false;
async function command(data) {
  const reply=await chrome.runtime.sendMessage(data);
  if(!reply?.ok) throw new Error(reply?.error||'Расширение не ответило.');return reply;
}
function render({batch,publicationAttempt,settings}) {
  batchEnabled=!!batch?.enabled;
  if(!settingsLoaded || batch?.enabled){showSettings(batch?.enabled && batch.settings ? batch.settings : {...AZVK.defaults,...settings});settingsLoaded=true;}
  updateSettingsFields();
  saveSettings.disabled=!!batch?.enabled;
  uncertain=publicationAttempt?.status==='pending';
  approval=batch?.awaitingApproval ? {batchId:batch.id,attemptId:publicationAttempt?.jobId} : null;
  approve.hidden=!approval;
  if(batch?.amount) amount.value=batch.amount;
  if(batch?.intervalSeconds) interval.value=batch.intervalSeconds;
  enable.disabled=!!batch?.enabled;amount.disabled=interval.disabled=!!batch?.enabled;
  disable.disabled=!batch?.enabled;
  fixed.hidden=!batch?.enabled||!batch?.needsFix||!!batch?.captcha;
  captcha.hidden=!batch?.captcha;
  const lines=[batch?.unconfirmed?'Партия остановлена. Можно начать новую.':batch?.done?'Партия завершена.':batch?.enabled?'Партия запущена.':'Партия не запущена.'];
  if(batch?.amount)lines.push(`${batch.unconfirmed?'Подтверждено':batch.uncertainDates?.length?'Обработано':'Запланировано'}: ${batch.completed||0} из ${batch.amount}.`);
  if(batch?.artistWarning)lines.push(batch.artistWarning);
  if(batch?.lastDate)lines.push('Последняя дата: '+new Date(batch.lastDate).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' (Москва).');
  if(batch?.captcha)lines.push('Решите CAPTCHA во вкладке VK и нажмите «ОК — продолжить».');
  else if(batch?.error)lines.push(batch.error);
  else if(batch?.running)lines.push('Создаю отложенные записи во вкладке VK…');
  if(approval)lines.push('Если запись есть в «Отложенные», нажмите «Подтверждаю — продолжить». Учту её и создам оставшиеся посты без повторной отправки.');
  status.textContent=lines.join('\n');
}
async function refresh(){try{render(await command({type:'batchStatus'}));}catch(error){status.textContent=error.message;}}
enable.onclick=async()=>{
  enable.disabled=true;
  try{render(await command({type:'batchStart',settings:inputSettings(),amount:Number(amount.value),intervalSeconds:Number(interval.value)}));}
  catch(error){status.textContent=error.message;enable.disabled=false;}
};
saveSettings.onclick=async()=>{
  saveSettings.disabled=true;
  try{const reply=await command({type:'settingsSave',settings:inputSettings()});showSettings(reply.settings);status.textContent='Настройки сохранены.';}
  catch(error){status.textContent=error.message;}
  finally{saveSettings.disabled=!settingsLoaded || batchEnabled;}
};
disable.onclick=async()=>{try{render(await command({type:'batchStop'}));}catch(error){status.textContent=error.message;}};
approve.onclick=async()=>{
  if(!approval)return;
  approve.disabled=true;
  try{render(await command({type:'batchApprove',...approval}));}catch(error){status.textContent=error.message;}
  finally{approve.disabled=false;}
};
fixed.onclick=async()=>{
  if(uncertain&&!confirm('Проверьте «Отложенные»: предыдущая запись могла сохраниться. Вы подтверждаете, что её нет, и хотите повторить?'))return;
  fixed.disabled=true;
  try{render(await command({type:'batchResume',confirmNoPost:uncertain}));}catch(error){status.textContent=error.message;}
  finally{fixed.disabled=false;}
};
captcha.onclick=async()=>{
  captcha.disabled=true;
  try{render(await command({type:'batchResume'}));}catch(error){status.textContent=error.message;}
  finally{captcha.disabled=false;}
};
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(changes.batch||changes.publicationAttempt))refresh();});
refresh();
