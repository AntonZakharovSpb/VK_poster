const COMMUNITY = 'https://vk.ru/tri_sloga_band';
const status = document.getElementById('status');
const run = document.getElementById('run');
const automatic = document.getElementById('automatic');
const quote = document.getElementById('quote');

chrome.storage.local.get({automatic: true}).then(settings => { automatic.checked = settings.automatic; });
automatic.addEventListener('change', () => chrome.storage.local.set({automatic: automatic.checked}));

async function communityTab() {
  const tabs = await chrome.tabs.query({url: ['https://vk.ru/*', 'https://vk.com/*']});
  const isCommunity = tab => /^https:\/\/(vk\.ru|vk\.com)\/tri_sloga_band(?:[?#]|$)/.test(tab.url || '');
  const tab = tabs.find(t => t.active && isCommunity(t)) || tabs.find(isCommunity);
  if (tab) { await chrome.tabs.update(tab.id, {active: true}); return tab; }
  // Preserve other VK tabs and drafts; a new tab uses the same regular Chrome login.
  return chrome.tabs.create({url: COMMUNITY, active: true});
}

async function loaded(tabId) {
  for (let i = 0; i < 120; i++) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('VK загружается слишком долго. Откройте сообщество и попробуйте ещё раз.');
}

run.addEventListener('click', async () => {
  run.disabled = true;
  try {
    const custom = quote.value.trim();
    if (custom && !/(^|[^а-яё])(?:любовь|счастье)(?=$|[^а-яё])/iu.test(custom)) {
      throw new Error('Текст должен содержать слово «любовь» или «счастье».');
    }
    const tab = await communityTab();
    await loaded(tab.id);
    await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['content.js']});
    const response = await chrome.tabs.sendMessage(tab.id, {type: 'start', automatic: automatic.checked, quote: custom});
    if (!response?.ok) throw new Error(response?.error || 'Не удалось запустить публикацию.');
    status.textContent = 'Ход работы отображается в панели справа на странице VK.';
  } catch (error) { status.textContent = error.message; }
  finally { run.disabled = false; }
});

document.getElementById('photos').addEventListener('click', async () => {
  try { const tab = await communityTab(); await chrome.tabs.update(tab.id, {url: (tab.url || COMMUNITY).split('#')[0] + '#section=photos'}); }
  catch (error) { status.textContent = error.message; }
});

document.getElementById('diagnostics').addEventListener('click', async () => {
  const {lastDiagnostic} = await chrome.storage.local.get('lastDiagnostic');
  if (!lastDiagnostic) { status.textContent = 'Диагностика появится после запуска. Журнал также доступен в панели на странице VK.'; return; }
  const blob = new Blob([JSON.stringify(lastDiagnostic, null, 2)], {type: 'application/json'});
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob); anchor.download = 'tri-sloga-diagnostic.json'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
});
