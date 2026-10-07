const SCHEDULE_ALARM = 'tri-sloga-publish';
const WATCHDOG_ALARM = 'tri-sloga-watchdog';
const COMMUNITY_URL = 'https://vk.ru/tri_sloga_band';
const RUN_TIMEOUT = 15 * 60 * 1000;
let scheduleQueue = Promise.resolve();
let startupHandled = false;
let workerHasStartedRun = false;

function serializedSchedule(task) {
  const result = scheduleQueue.then(task);
  scheduleQueue = result.catch(() => {});
  return result;
}

async function notifyFailure(error, loading = false) {
  const message = loading
    ? `${error} Если включён VPN, отключите его и проверьте соединение. Затем нажмите «Исправлено — повторить».`
    : `Публикация остановлена: ${error}`;
  await chrome.action.setBadgeBackgroundColor({color: '#d93025'});
  await chrome.action.setBadgeText({text: '!'});
  try {
    await chrome.notifications.create('tri-sloga-error', {
      type: 'basic', iconUrl: 'icon.png', title: 'Три Слога — требуется внимание', message,
      priority: 2, buttons: [{title: 'Исправлено — повторить'}]
    });
  } catch { /* Popup status and toolbar badge remain available if OS notifications are disabled. */ }
}

async function restoreSchedule() {
  return serializedSchedule(async () => {
    const {schedule, scheduleRun, scheduleStatus, browserClosed} = await chrome.storage.local.get(['schedule', 'scheduleRun', 'scheduleStatus', 'browserClosed']);
    if (schedule?.enabled && !browserClosed && !scheduleStatus?.needsFix && !(await chrome.alarms.get(SCHEDULE_ALARM))) {
      await chrome.alarms.create(SCHEDULE_ALARM, {when: Math.max(Date.now() + 1000, schedule.nextRunAt)});
    }
    if (scheduleRun && !(await chrome.alarms.get(WATCHDOG_ALARM))) {
      await chrome.alarms.create(WATCHDOG_ALARM, {when: Math.max(Date.now() + 1000, scheduleRun.expires)});
    }
  });
}

async function findCommunityTab({refresh = false} = {}) {
  const tabs = await chrome.tabs.query({url: ['https://vk.ru/*', 'https://vk.com/*']});
  const matches = tab => /^https:\/\/(vk\.ru|vk\.com)\/tri_sloga_band\/?(?:[?#]|$)/.test(tab.url || '');
  const tab = tabs.find(t => t.active && matches(t)) || tabs.find(matches);
  if (tab) return chrome.tabs.update(tab.id, {active: true, ...(refresh ? {url: COMMUNITY_URL} : {})});
  if (!(await chrome.windows.getAll({windowTypes: ['normal']})).length) {
    const window = await chrome.windows.create({url: COMMUNITY_URL, type: 'normal'});
    const created = window.tabs?.[0];
    if (!created) throw new Error('Не удалось открыть вкладку VK.');
    return created;
  }
  return chrome.tabs.create({url: COMMUNITY_URL, active: true});
}

async function waitForCommunity(tabId, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') {
      try {
        const [probe] = await chrome.scripting.executeScript({target: {tabId}, func: () =>
          /^https:\/\/(vk\.ru|vk\.com)\/tri_sloga_band\/?(?:[?#]|$)/.test(location.href) &&
          !!document.body && document.body.innerText.trim().length > 30 &&
          !!document.querySelector('#top_profile_link,#l_pr,[data-testid="header-profile-menu-button"],#group_manage_menu_manage,.group_name,#login_form,input[type="password"],a[href*="login"]')
        });
        if (probe?.result) return;
      } catch { /* Includes Chrome's network error page; wait for a possible recovery. */ }
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('VK не загрузился за 45 секунд.');
}

async function finishScheduledRun(runId, result, tabId) {
  return serializedSchedule(async () => {
    const {scheduleRun, schedule, publicationAttempt} = await chrome.storage.local.get(['scheduleRun', 'schedule', 'publicationAttempt']);
    if (!scheduleRun || scheduleRun.id !== runId || (tabId !== undefined && tabId !== scheduleRun.tabId)) return {};
    await chrome.storage.local.remove('scheduleRun');
    await chrome.alarms.clear(WATCHDOG_ALARM);
    const needsFix = !result.success;
    await chrome.storage.local.set({scheduleStatus: {time: Date.now(), ...result, needsFix,
      uncertain: publicationAttempt?.status === 'pending'},
      ...(needsFix && schedule ? {schedule: {...schedule, nextRunAt: null}} : {})});
    if (needsFix) await chrome.alarms.clear(SCHEDULE_ALARM);
    if (result.success) await chrome.action.setBadgeText({text: ''});
    else await notifyFailure(result.error, result.loading);
    return {};
  });
}

async function launchScheduledRun(generation, {retry = false, confirmNoPost = false} = {}) {
  const run = await serializedSchedule(async () => {
    const {schedule, scheduleRun, activeJob, publicationAttempt, scheduleStatus, browserClosed} = await chrome.storage.local.get(['schedule', 'scheduleRun', 'activeJob', 'publicationAttempt', 'scheduleStatus', 'browserClosed']);
    if (!schedule?.enabled || (generation && schedule.generation !== generation)) return null;
    if (browserClosed) return null;
    if (scheduleStatus?.needsFix && !retry) return null;
    if (scheduleRun || activeJob?.expires > Date.now()) {
      if (retry) throw new Error('Предыдущая попытка ещё завершается. Дождитесь её остановки.');
      return null;
    }
    if (publicationAttempt?.status === 'pending' && confirmNoPost) await chrome.storage.local.remove('publicationAttempt');
    else if (publicationAttempt?.status === 'pending') {
      const error = 'Предыдущая отправка не подтверждена. Проверьте стену перед новой попыткой.';
      await chrome.storage.local.set({schedule: {...schedule, nextRunAt: null},
        scheduleStatus: {time: Date.now(), success: false, needsFix: true, uncertain: true, error}});
      await chrome.alarms.clear(SCHEDULE_ALARM);
      await notifyFailure(error);
      return null;
    }
    // Advance before opening VK: a restart never replays the same scheduled slot.
    const nextRunAt = Date.now() + schedule.intervalHours * 3600000;
    await chrome.storage.local.set({schedule: {...schedule, nextRunAt}});
    await chrome.alarms.create(SCHEDULE_ALARM, {when: nextRunAt});
    const run = {id: crypto.randomUUID(), generation: schedule.generation, expires: Date.now() + RUN_TIMEOUT,
      refresh: retry && !!scheduleStatus?.loading};
    workerHasStartedRun = true;
    await chrome.storage.local.set({scheduleRun: run, scheduleStatus: {time: Date.now(), running: true}});
    await chrome.notifications.clear('tri-sloga-error');
    await chrome.alarms.create(WATCHDOG_ALARM, {when: run.expires});
    return run;
  });
  if (!run) return;
  let loading = true;
  try {
    const tab = await findCommunityTab({refresh: run.refresh});
    const allowed = await serializedSchedule(async () => {
      const {schedule, scheduleRun} = await chrome.storage.local.get(['schedule', 'scheduleRun']);
      if (!schedule?.enabled || schedule.generation !== run.generation || scheduleRun?.id !== run.id) return false;
      await chrome.storage.local.set({scheduleRun: {...run, tabId: tab.id}});
      return true;
    });
    if (!allowed) return;
    await waitForCommunity(tab.id);
    loading = false;
    await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['content.js']});
    // Serialize dispatch with Stop so a pending load cannot start a job after disabling.
    await serializedSchedule(async () => {
      const {schedule, scheduleRun} = await chrome.storage.local.get(['schedule', 'scheduleRun']);
      if (!schedule?.enabled || schedule.generation !== run.generation || scheduleRun?.id !== run.id) return;
      const reply = await chrome.tabs.sendMessage(tab.id, {type: 'start', automatic: true, scheduleRunId: run.id});
      if (!reply?.ok) throw new Error(reply?.error || 'Не удалось запустить публикацию.');
    });
  } catch (error) { await finishScheduledRun(run.id, {success: false, error: error.message, loading}); }
}

async function scheduleCommand(message, sender) {
  if (message.type === 'scheduleRetry') {
    const {schedule, scheduleStatus, browserClosed} = await chrome.storage.local.get(['schedule', 'scheduleStatus', 'browserClosed']);
    if (!schedule?.enabled) throw new Error('Сначала включите автопубликацию.');
    if (!scheduleStatus?.needsFix) throw new Error('Нет остановленной попытки для повтора.');
    if (browserClosed) {
      await serializedSchedule(() => chrome.storage.local.remove('browserClosed'));
    }
    await launchScheduledRun(schedule.generation, {retry: true, confirmNoPost: message.confirmNoPost === true});
    return chrome.storage.local.get(['schedule', 'scheduleStatus']);
  }
  if (message.type === 'scheduleStatus') {
    return chrome.storage.local.get(['schedule', 'scheduleStatus']);
  }
  if (message.type === 'scheduleResult') {
    return finishScheduledRun(message.runId, {success: message.success === true, error: String(message.error || '')}, sender.tab.id);
  }
  if (message.type === 'scheduleStop') {
    return serializedSchedule(async () => {
      const {schedule, scheduleRun} = await chrome.storage.local.get(['schedule', 'scheduleRun']);
      await chrome.storage.local.set({schedule: {...schedule, enabled: false}, scheduleStatus: {time: Date.now(), stopped: true}});
      await chrome.alarms.clear(SCHEDULE_ALARM);
      await chrome.alarms.clear(WATCHDOG_ALARM);
      await chrome.storage.local.remove('scheduleRun');
      if (scheduleRun?.tabId) {
        try { await chrome.tabs.sendMessage(scheduleRun.tabId, {type: 'stop', scheduleRunId: scheduleRun.id}); } catch { /* Closed tab. */ }
      }
      return {};
    });
  }
  if (message.type === 'scheduleSet') {
    const hours = Number(message.intervalHours);
    if (!Number.isFinite(hours) || hours < 0.5 || hours > 8760) throw new Error('Укажите интервал от 0,5 до 8760 часов.');
    const {generation, startNow} = await serializedSchedule(async () => {
      const {schedule, scheduleRun, scheduleStatus} = await chrome.storage.local.get(['schedule', 'scheduleRun', 'scheduleStatus']);
      const startNow = !schedule?.enabled;
      if (startNow && scheduleRun) throw new Error('Предыдущая публикация ещё выполняется.');
      const generation = startNow ? crypto.randomUUID() : schedule.generation;
      const nextRunAt = !startNow && scheduleStatus?.needsFix ? null : Date.now() + hours * 3600000;
      await chrome.storage.local.set({schedule: {enabled: true, intervalHours: hours, nextRunAt, generation}});
      if (nextRunAt) await chrome.alarms.create(SCHEDULE_ALARM, {when: nextRunAt});
      if (startNow) await chrome.storage.local.set({scheduleStatus: {time: Date.now()}});
      return {generation, startNow};
    });
    if (startNow) await launchScheduledRun(generation);
    return chrome.storage.local.get(['schedule', 'scheduleStatus']);
  }
  throw new Error('Неизвестная команда расписания.');
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === SCHEDULE_ALARM) {
    chrome.storage.local.get('schedule').then(({schedule}) => {
      if (schedule?.enabled && schedule.nextRunAt <= Date.now() + 1000) return launchScheduledRun(schedule.generation);
    }).catch(console.error);
  }
  if (alarm.name === WATCHDOG_ALARM) {
    chrome.storage.local.get('scheduleRun').then(async ({scheduleRun}) => {
      if (!scheduleRun) return;
      if (scheduleRun.tabId) {
        try { await chrome.tabs.sendMessage(scheduleRun.tabId, {type: 'stop', scheduleRunId: scheduleRun.id}); } catch { /* Tab closed. */ }
      }
      await finishScheduledRun(scheduleRun.id, {success: false, error: 'Публикация прервана или превысила 15 минут. Проверьте вкладку VK и стену.'});
    }).catch(console.error);
  }
});
async function browserStarted() {
  if (startupHandled) return;
  startupHandled = true;
  const generation = await serializedSchedule(async () => {
    const {schedule, scheduleStatus} = await chrome.storage.local.get(['schedule', 'scheduleStatus']);
    // A due alarm can arrive before onStartup; keep the run already launched here.
    if (workerHasStartedRun) return null;
    await chrome.storage.local.remove('browserClosed');
    // Old page jobs cannot survive a full browser restart. Preserve uncertain sends.
    await chrome.storage.local.remove('scheduleRun');
    await chrome.storage.local.remove('activeJob');
    await chrome.alarms.clear(WATCHDOG_ALARM);
    if (!schedule?.enabled) return null;
    await chrome.alarms.clear(SCHEDULE_ALARM);
    if (scheduleStatus?.needsFix) return null;
    const generation = crypto.randomUUID();
    await chrome.storage.local.set({schedule: {...schedule, generation}});
    return generation;
  });
  if (generation) await launchScheduledRun(generation);
}
chrome.runtime.onStartup.addListener(() => browserStarted().catch(console.error));
async function browserWindowsClosed() {
  if ((await chrome.windows.getAll({windowTypes: ['normal']})).length) return;
  await serializedSchedule(async () => {
    // Recheck after queuing: a window might have reopened in the meantime.
    if ((await chrome.windows.getAll({windowTypes: ['normal']})).length) return;
    const {schedule} = await chrome.storage.local.get('schedule');
    startupHandled = false;
    workerHasStartedRun = false;
    await chrome.storage.local.set({browserClosed: true,
      ...(schedule ? {schedule: {...schedule, generation: crypto.randomUUID()}} : {})});
    await chrome.storage.local.remove('scheduleRun');
    await chrome.storage.local.remove('activeJob');
    await chrome.alarms.clear(SCHEDULE_ALARM);
    await chrome.alarms.clear(WATCHDOG_ALARM);
  });
}
chrome.windows.onRemoved.addListener(() => browserWindowsClosed().catch(console.error));
chrome.windows.onCreated.addListener(window => {
  if (window.type !== 'normal') return;
  chrome.storage.local.get('browserClosed').then(({browserClosed}) => {
    if (browserClosed) return browserStarted();
  }).catch(console.error);
});
chrome.runtime.onInstalled.addListener(() => restoreSchedule().catch(console.error));
chrome.notifications.onClicked.addListener(id => {
  if (id === 'tri-sloga-error') findCommunityTab().catch(console.error);
});
chrome.notifications.onButtonClicked.addListener((id, index) => {
  if (id === 'tri-sloga-error' && index === 0) {
    chrome.storage.local.get(['schedule', 'scheduleStatus']).then(({schedule, scheduleStatus}) => {
      if (schedule?.enabled && scheduleStatus?.needsFix) return scheduleCommand({type: 'scheduleRetry'}, {});
    }).catch(error => notifyFailure(error.message));
  }
});
restoreSchedule().catch(console.error);
