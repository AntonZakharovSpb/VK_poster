"""Scheduling regression tests with mocked Chrome APIs; never contacts VK."""
import unittest
from pathlib import Path
from playwright.sync_api import sync_playwright

EXT = Path(__file__).parent / 'extension'


class SchedulerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(channel='chrome', headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def setUp(self):
        self.page = self.browser.new_page()
        self.page.route('**/*', lambda route: route.fulfill(body='<html><body>Offline fixture</body></html>'))
        self.page.goto('https://vk.ru/tri_sloga_band')
        self.page.add_script_tag(path=str(EXT/'config.js'))
        self.page.evaluate('''() => {
          window.store={}; window.calls=[]; window.alarms={}; window.listeners={};
          window.chrome={
            storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,store[k]])),
              set:async data=>Object.assign(store,data),remove:async key=>{delete store[key]}}},
            runtime:{onStartup:{addListener:fn=>listeners.startup=fn},onInstalled:{addListener:fn=>listeners.install=fn}},
            windows:{getAll:async()=>[{id:1,type:'normal'}],create:async opts=>{calls.push({type:'window',...opts});return {tabs:[{id:8}]};},onRemoved:{addListener:fn=>listeners.windowRemoved=fn},
              onCreated:{addListener:fn=>listeners.windowCreated=fn}},
            alarms:{get:async name=>alarms[name],create:async(name,data)=>{alarms[name]=data},
              clear:async name=>{delete alarms[name]},onAlarm:{addListener:fn=>listeners.alarm=fn}},
            tabs:{query:async()=>[{id:7,url:'https://vk.ru/tri_sloga_band',active:true}],
              update:async(id,opts)=>{calls.push({type:'tab',id,...opts});return {id}},
              create:async opts=>{calls.push({type:'create',...opts});return {id:8}},
              get:async()=>({status:'complete'}),sendMessage:async(id,msg)=>{calls.push({id,...msg});return {ok:true}}},
            scripting:{executeScript:async opts=>{calls.push({type:'script',...opts,func:undefined});return [{result:opts.func?.name==='resolveCommunity' ? {owner:'-220995299',path:'/tri_sloga_band',name:'Три Слога',origin:'https://vk.ru'} : true}]}},
            action:{setBadgeText:async data=>calls.push({type:'badge',...data}),setBadgeBackgroundColor:async()=>{}},
            notifications:{create:async(id,data)=>calls.push({...data,type:'notification',id}),clear:async()=>{},onClicked:{addListener:fn=>listeners.click=fn},
              onButtonClicked:{addListener:fn=>listeners.button=fn}}
          };
        }''')
        self.page.add_script_tag(path=str(EXT/'scheduler.js'))
        self.page.evaluate('serializedSchedule(async()=>{})')

    def tearDown(self):
        self.page.close()

    def enable(self, hours=2):
        return self.page.evaluate('(hours)=>scheduleCommand({type:"scheduleSet",intervalHours:hours},{})', hours)

    def test_enable_immediately_posts_reuses_tab_and_sets_interval(self):
        self.enable(3.5)
        calls = self.page.evaluate('calls')
        starts = [c for c in calls if c['type'] == 'start']
        self.assertEqual(len(starts), 1)
        self.assertTrue(starts[0]['automatic'])
        self.assertNotIn('quote', starts[0])
        self.assertEqual(starts[0]['id'], 7)
        self.assertFalse(any(c['type'] == 'create' for c in calls))
        remaining = self.page.evaluate('alarms[SCHEDULE_ALARM].when-Date.now()')
        self.assertAlmostEqual(remaining / 3600000, 3.5, places=3)
        self.enable(4)
        self.assertEqual(self.page.evaluate('calls.filter(c=>c.type==="start").length'), 1)

    def test_missing_tab_created_and_overlap_skipped(self):
        self.page.evaluate('chrome.tabs.query=async()=>[]')
        self.enable()
        self.assertEqual(self.page.evaluate('calls.find(c=>c.type==="create").url'), 'https://vk.ru/tri_sloga_band')
        self.page.evaluate('launchScheduledRun()')
        self.assertEqual(self.page.evaluate('calls.filter(c=>c.type==="start").length'), 1)

    def test_result_requires_matching_run_and_tab_then_next_alarm_posts(self):
        self.enable()
        self.page.evaluate('scheduleCommand({type:"scheduleResult",runId:store.scheduleRun.id,success:true},{tab:{id:99}})')
        self.assertTrue(self.page.evaluate('!!store.scheduleRun'))
        self.page.evaluate('scheduleCommand({type:"scheduleResult",runId:store.scheduleRun.id,success:true},{tab:{id:7}})')
        self.assertFalse(self.page.evaluate('!!store.scheduleRun'))
        self.assertTrue(self.page.evaluate('store.scheduleStatus.success'))
        self.page.evaluate('launchScheduledRun()')
        self.assertEqual(self.page.evaluate('calls.filter(c=>c.type==="start").length'), 2)

    def test_stop_cancels_alarms_and_running_content(self):
        self.enable()
        self.page.evaluate('scheduleCommand({type:"scheduleStop"},{})')
        self.assertFalse(self.page.evaluate('store.schedule.enabled'))
        self.assertEqual(self.page.evaluate('Object.keys(alarms)'), [])
        self.assertTrue(self.page.evaluate('calls.some(c=>c.type==="stop")'))
        self.page.evaluate('launchScheduledRun()')
        self.assertEqual(self.page.evaluate('calls.filter(c=>c.type==="start").length'), 1)

    def test_network_failure_notifies_and_pauses_until_fixed(self):
        self.page.evaluate('()=>{waitForCommunity=async()=>{throw Error("Network timeout")}}')
        self.enable()
        self.assertEqual(self.page.evaluate('calls.filter(c=>c.type==="start").length'), 0)
        self.assertIn('VPN', self.page.evaluate('calls.find(c=>c.type==="notification").message'))
        self.assertTrue(self.page.evaluate('store.schedule.enabled'))
        self.assertFalse(self.page.evaluate('!!alarms[SCHEDULE_ALARM]'))
        self.assertFalse(self.page.evaluate('!!store.scheduleRun'))
        self.assertTrue(self.page.evaluate('store.scheduleStatus.needsFix'))
        self.page.evaluate('restoreSchedule()')
        self.assertFalse(self.page.evaluate('!!alarms[SCHEDULE_ALARM]'))

    def test_network_error_page_does_not_count_as_loaded(self):
        self.page.evaluate('()=>{chrome.scripting.executeScript=async()=>{throw Error("Cannot access chrome-error page")}}')
        failed = self.page.evaluate('async()=>{try{await waitForCommunity(7,5);return false}catch{return true}}')
        self.assertTrue(failed)

    def test_restores_lost_alarm_without_immediate_duplicate(self):
        self.enable()
        self.page.evaluate('''async()=>{
          delete alarms[SCHEDULE_ALARM]; delete alarms[WATCHDOG_ALARM];
          await restoreSchedule(); await restoreSchedule();
        }''')
        self.assertEqual(self.page.evaluate('alarms[SCHEDULE_ALARM].when'), self.page.evaluate('store.schedule.nextRunAt'))
        self.assertEqual(self.page.evaluate('calls.filter(c=>c.type==="start").length'), 1)
        self.assertTrue(self.page.evaluate('!!alarms[WATCHDOG_ALARM]'))

    def test_uncertain_publish_blocks_automatic_retry(self):
        self.page.evaluate('store.publicationAttempt={status:"pending"}')
        self.enable()
        self.assertEqual(self.page.evaluate('calls.filter(c=>c.type==="start").length'), 0)
        self.assertIn('Предыдущая отправка', self.page.evaluate('store.scheduleStatus.error'))

    def test_stop_during_loading_prevents_late_start(self):
        self.page.evaluate('''async()=>{
          waitForCommunity=async()=>{await scheduleCommand({type:'scheduleStop'},{});};
        }''')
        self.enable()
        self.assertEqual(self.page.evaluate('calls.filter(c=>c.type==="start").length'), 0)

    def test_invalid_interval_rejected_without_enabling(self):
        for value in [0, -1, 0.1, 8761, 'bad']:
            result = self.page.evaluate('async hours=>{try{await scheduleCommand({type:"scheduleSet",intervalHours:hours},{});return false}catch{return true}}', value)
            self.assertTrue(result)
        self.assertFalse(self.page.evaluate('!!store.schedule'))

    def test_watchdog_reports_interrupted_run_and_does_not_republish(self):
        self.enable()
        self.page.evaluate('listeners.alarm({name:WATCHDOG_ALARM})')
        self.page.wait_for_function('!!store.scheduleStatus.error')
        self.assertFalse(self.page.evaluate('!!store.scheduleRun'))
        self.assertTrue(self.page.evaluate('calls.some(c=>c.type==="stop")'))
        self.assertEqual(self.page.evaluate('calls.filter(c=>c.type==="start").length'), 1)

    def test_background_routes_popup_settings_and_rejects_tab_settings(self):
        self.page.evaluate('''()=>{
          chrome.runtime.id='extension-fixture';
          chrome.runtime.onMessage={addListener:fn=>listeners.message=fn};
        }''')
        self.page.add_script_tag(path=str(EXT/'background.js'))
        result = self.page.evaluate('''async()=>{
          const send=(msg,sender)=>new Promise(resolve=>listeners.message(msg,sender,resolve));
          const enabled=await send({type:'scheduleSet',intervalHours:2},{id:chrome.runtime.id});
          const rejected=await send({type:'scheduleSet',intervalHours:1},
            {id:chrome.runtime.id,tab:{id:7},url:location.href});
          return {enabled:enabled.schedule.enabled,rejected:rejected.ok};
        }''')
        self.assertEqual(result, {'enabled': True, 'rejected': False})

    def test_browser_start_posts_immediately_and_resets_countdown(self):
        self.page.evaluate('''()=>{
          store.schedule={enabled:true,intervalHours:3,nextRunAt:Date.now()+9999999,generation:'old'};
          store.activeJob={expires:Date.now()+900000};
          store.scheduleRun={id:'old-run',tabId:7,expires:Date.now()+900000};
        }''')
        self.page.evaluate('browserStarted()')
        self.assertEqual(self.page.evaluate('calls.filter(c=>c.type==="start").length'), 1)
        self.assertFalse(self.page.evaluate('!!store.activeJob'))
        self.assertAlmostEqual(self.page.evaluate('(store.schedule.nextRunAt-Date.now())/3600000'),3,places=3)
        self.page.evaluate('browserStarted()')
        self.assertEqual(self.page.evaluate('calls.filter(c=>c.type==="start").length'), 1)

    def test_browser_start_does_not_enable_disabled_schedule(self):
        self.page.evaluate('store.schedule={enabled:false,intervalHours:3}')
        self.page.evaluate('browserStarted()')
        self.assertEqual(self.page.evaluate('calls.filter(c=>c.type==="start").length'), 0)

    def test_startup_and_due_alarm_do_not_launch_twice(self):
        self.enable()
        self.page.evaluate('browserStarted()')
        self.assertEqual(self.page.evaluate('calls.filter(c=>c.type==="start").length'), 1)

    def test_fixed_retries_once_refreshes_network_failure_and_resets_timer(self):
        self.page.evaluate('()=>{waitForCommunity=async()=>{throw Error("VK timeout")}}')
        self.enable()
        self.page.evaluate('()=>{waitForCommunity=async()=>{}}')
        self.page.evaluate('scheduleCommand({type:"scheduleRetry"},{})')
        self.assertEqual(self.page.evaluate('calls.filter(c=>c.type==="start").length'), 1)
        self.assertTrue(self.page.evaluate('calls.some(c=>c.type==="tab" && c.url===AZVK.defaults.communityUrl)'))
        self.assertAlmostEqual(self.page.evaluate('(store.schedule.nextRunAt-Date.now())/3600000'),2,places=3)
        self.assertTrue(self.page.evaluate('store.scheduleStatus.running'))

    def test_retry_cannot_silently_clear_uncertain_publication(self):
        self.page.evaluate('store.publicationAttempt={status:"pending"}')
        self.enable()
        self.page.evaluate('scheduleCommand({type:"scheduleRetry"},{})')
        self.assertEqual(self.page.evaluate('calls.filter(c=>c.type==="start").length'), 0)
        self.assertEqual(self.page.evaluate('store.publicationAttempt.status'), 'pending')
        self.page.evaluate('scheduleCommand({type:"scheduleRetry",confirmNoPost:true},{})')
        self.assertEqual(self.page.evaluate('calls.filter(c=>c.type==="start").length'), 1)

    def test_failed_retry_stays_paused_and_interval_change_cannot_resume(self):
        self.page.evaluate('()=>{waitForCommunity=async()=>{throw Error("Network failure")}}')
        self.enable()
        self.page.evaluate('scheduleCommand({type:"scheduleRetry"},{})')
        self.enable(5)
        self.assertTrue(self.page.evaluate('store.scheduleStatus.needsFix'))
        self.assertFalse(self.page.evaluate('!!alarms[SCHEDULE_ALARM]'))

    def test_browser_restart_preserves_failure_waiting_for_fixed(self):
        self.page.evaluate('''()=>{
          store.schedule={enabled:true,intervalHours:3,generation:'old',nextRunAt:null};
          store.scheduleStatus={needsFix:true,error:'VK unavailable'};
        }''')
        self.page.evaluate('browserStarted()')
        self.assertEqual(self.page.evaluate('calls.filter(c=>c.type==="start").length'), 0)
        self.assertTrue(self.page.evaluate('store.scheduleStatus.needsFix'))

    def test_closing_last_window_suspends_and_reopening_posts_immediately(self):
        self.enable()
        self.page.evaluate('''async()=>{
          chrome.windows.getAll=async()=>[];
          await browserWindowsClosed();
          await restoreSchedule();
          await launchScheduledRun();
        }''')
        self.assertFalse(self.page.evaluate('!!alarms[SCHEDULE_ALARM]'))
        self.assertEqual(self.page.evaluate('calls.filter(c=>c.type==="start").length'),1)
        self.page.evaluate('''async()=>{
          chrome.windows.getAll=async()=>[{id:2,type:'normal'}];
          listeners.windowCreated({type:'normal'});
        }''')
        self.page.wait_for_function('calls.filter(c=>c.type==="start").length===2')
        self.assertFalse(self.page.evaluate('!!store.browserClosed'))
        self.assertAlmostEqual(self.page.evaluate('(store.schedule.nextRunAt-Date.now())/3600000'),2,places=3)

    def test_closing_one_of_several_windows_does_not_restart_schedule(self):
        self.enable()
        self.page.evaluate('browserWindowsClosed()')
        self.assertFalse(self.page.evaluate('!!store.browserClosed'))
        self.assertTrue(self.page.evaluate('!!store.scheduleRun'))

    def test_fixed_notification_can_reopen_closed_browser_to_retry(self):
        self.page.evaluate('''()=>{
          store.schedule={enabled:true,intervalHours:2,generation:'old'};
          store.scheduleStatus={needsFix:true,loading:true,error:'VK timeout'};
          store.browserClosed=true;
          chrome.tabs.query=async()=>[];
          chrome.windows.getAll=async()=>[];
        }''')
        self.page.evaluate('scheduleCommand({type:"scheduleRetry"},{})')
        self.assertEqual(self.page.evaluate('calls.filter(c=>c.type==="normal" && c.url===AZVK.defaults.communityUrl).length'),1)
        self.assertFalse(self.page.evaluate('!!store.browserClosed'))
        self.assertEqual(self.page.evaluate('calls.filter(c=>c.type==="start").length'),1)


if __name__ == '__main__':
    unittest.main()
