const status=document.getElementById('status');
const interval=document.getElementById('interval'),amount=document.getElementById('amount');
const enable=document.getElementById('enable'),disable=document.getElementById('disable');
const fixed=document.getElementById('fixed'),captcha=document.getElementById('captcha');
let uncertain=false;
async function command(data) {
  const reply=await chrome.runtime.sendMessage(data);
  if(!reply?.ok) throw new Error(reply?.error||'Расширение не ответило.');return reply;
}
function render({batch,publicationAttempt}) {
  uncertain=publicationAttempt?.status==='pending';
  if(batch?.amount) amount.value=batch.amount;
  if(batch?.intervalSeconds) interval.value=batch.intervalSeconds;
  enable.disabled=!!batch?.enabled;amount.disabled=interval.disabled=!!batch?.enabled;
  disable.disabled=!batch?.enabled;
  fixed.hidden=!batch?.enabled||!batch?.needsFix||!!batch?.captcha;
  captcha.hidden=!batch?.captcha;
  const lines=[batch?.done?'Партия завершена.':batch?.enabled?'Партия запущена.':'Партия не запущена.'];
  if(batch?.amount)lines.push(`Запланировано: ${batch.completed||0} из ${batch.amount}.`);
  if(batch?.lastDate)lines.push('Последняя дата: '+new Date(batch.lastDate).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' (Москва).');
  if(batch?.captcha)lines.push('Решите CAPTCHA во вкладке VK и нажмите «ОК — продолжить».');
  else if(batch?.error)lines.push(batch.error);
  else if(batch?.running)lines.push('Создаю отложенные записи во вкладке VK…');
  status.textContent=lines.join('\n');
}
async function refresh(){try{render(await command({type:'batchStatus'}));}catch(error){status.textContent=error.message;}}
enable.onclick=async()=>{
  enable.disabled=true;
  try{render(await command({type:'batchStart',amount:Number(amount.value),intervalSeconds:Number(interval.value)}));}
  catch(error){status.textContent=error.message;enable.disabled=false;}
};
disable.onclick=async()=>{try{render(await command({type:'batchStop'}));}catch(error){status.textContent=error.message;}};
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
document.getElementById('diagnostics').onclick=async()=>{
  const data=await chrome.storage.local.get(['lastDiagnostic','batch','publicationAttempt']);
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const anchor=document.createElement('a');anchor.href=URL.createObjectURL(blob);
  anchor.download='tri-sloga-diagnostic.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(anchor.href),1000);
};
refresh();