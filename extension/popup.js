const status = document.getElementById('status');
const interval = document.getElementById('interval');
const enable = document.getElementById('enable');
const disable = document.getElementById('disable');
const fixed = document.getElementById('fixed');
let needsWallCheck = false;

async function command(data) {
  const reply = await chrome.runtime.sendMessage(data);
  if (!reply?.ok) throw new Error(reply?.error || 'Расширение не ответило.');
  return reply;
}
function render({schedule, scheduleStatus}) {
  const enabled = !!schedule?.enabled;
  if (schedule?.intervalHours) interval.value = schedule.intervalHours;
  enable.textContent = enabled ? 'Сохранить интервал' : 'Включить';
  disable.disabled = !enabled;
  fixed.hidden = !enabled || !scheduleStatus?.needsFix;
  needsWallCheck = !!scheduleStatus?.uncertain;
  const lines = [enabled ? 'Автопубликация включена.' : 'Автопубликация выключена.'];
  if (enabled && schedule.nextRunAt) lines.push('Следующая попытка: ' + new Date(schedule.nextRunAt).toLocaleString('ru-RU'));
  if (scheduleStatus?.running) lines.push('Создаю пост во вкладке VK…');
  else if (scheduleStatus?.success) lines.push('Последний пост опубликован: ' + new Date(scheduleStatus.time).toLocaleString('ru-RU'));
  else if (scheduleStatus?.error) lines.push('Последняя ошибка: ' + scheduleStatus.error);
  if (enabled && scheduleStatus?.needsFix) lines.push('Расписание приостановлено. Устраните причину и нажмите «Исправлено — повторить».');
  status.textContent = lines.join('\n');
}
async function refresh() {
  try { render(await command({type:'scheduleStatus'})); }
  catch (error) { status.textContent = error.message; }
}
enable.addEventListener('click', async () => {
  enable.disabled = true;
  disable.disabled = false;
  status.textContent = 'Сохраняю расписание и открываю VK…';
  try { render(await command({type:'scheduleSet', intervalHours:Number(interval.value)})); }
  catch (error) { status.textContent = error.message; }
  finally { enable.disabled = false; }
});
fixed.addEventListener('click', async () => {
  if (needsWallCheck && !confirm('Проверьте стену: предыдущий пост мог появиться. Вы подтверждаете, что его нет, и хотите создать новый?')) return;
  fixed.disabled = true;
  try { render(await command({type:'scheduleRetry', confirmNoPost:needsWallCheck})); }
  catch (error) { status.textContent = error.message; }
  finally { fixed.disabled = false; }
});
disable.addEventListener('click', async () => {
  try { await command({type:'scheduleStop'}); await refresh(); }
  catch (error) { status.textContent = error.message; }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.schedule || changes.scheduleStatus)) refresh();
});
document.getElementById('diagnostics').addEventListener('click', async () => {
  const {lastDiagnostic, schedule, scheduleStatus} = await chrome.storage.local.get(['lastDiagnostic','schedule','scheduleStatus']);
  const blob = new Blob([JSON.stringify({schedule, scheduleStatus, lastDiagnostic}, null, 2)], {type:'application/json'});
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob); anchor.download = 'tri-sloga-diagnostic.json'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
});
refresh();
