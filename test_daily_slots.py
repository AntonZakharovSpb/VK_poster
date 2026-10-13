"""Offline coverage for daily slots and submission without per-post queue checks."""
import unittest
from pathlib import Path
import test_extension
import test_batch

EXT=Path(__file__).parent/'extension'

class DailySlotTests(unittest.TestCase):
    setUpClass=classmethod(test_extension.ExtensionTests.setUpClass.__func__)
    tearDownClass=classmethod(test_extension.ExtensionTests.tearDownClass.__func__)
    setUp=test_extension.ExtensionTests.setUp
    tearDown=test_extension.ExtensionTests.tearDown
    content=test_extension.ExtensionTests.content
    workflow_fixture=test_extension.ExtensionTests.workflow_fixture
    scheduled_fixture=test_batch.BatchPageTests.scheduled_fixture

    def test_daily_schedule_validates_limits_and_midnight_formula(self):
        valid={'postsPerDay':3,'startTime':'09:00','innerIntervalHours':2}
        self.assertEqual(self.page.evaluate('v=>AZVK.normalizePostingSchedule(v)',valid),valid)
        for change in [{'postsPerDay':0},{'postsPerDay':13},{'postsPerDay':1.5},{'startTime':'24:00'},
                       {'startTime':'09:61'},{'innerIntervalHours':0},{'innerIntervalHours':24},
                       {'innerIntervalHours':0.333},{'postsPerDay':3,'startTime':'18:00'},
                       {'postsPerDay':2,'startTime':'20:00','innerIntervalHours':2}]:
            with self.subTest(change=change):
                self.assertTrue(self.page.evaluate('v=>{try{AZVK.normalizePostingSchedule(v)}catch(e){return e.message}}',{**valid,**change}))
        self.assertEqual(self.page.evaluate('AZVK.normalizePostingSchedule({postsPerDay:12,startTime:"09:00",innerIntervalHours:0.5}).postsPerDay'),12)

    def test_slots_start_next_day_and_handle_partial_days_and_year_rollover(self):
        values=self.page.evaluate('''()=>{
          const settings={postsPerDay:3,startTime:'09:00',innerIntervalHours:2};
          const plan=AZVK.postingPlan(Date.parse('2026-12-30T18:30:00+03:00'),settings);
          return Array.from({length:5},(_,i)=>new Date(AZVK.postingSlot(plan,i)).toISOString());
        }''')
        self.assertEqual(values,['2026-12-31T06:00:00.000Z','2026-12-31T08:00:00.000Z','2026-12-31T10:00:00.000Z',
                                 '2027-01-01T06:00:00.000Z','2027-01-01T08:00:00.000Z'])

    def test_empty_queue_uses_tomorrow_in_moscow_and_selected_start_time(self):
        value=self.page.evaluate('''()=>new Date(AZVK.postingPlan(null,{postsPerDay:1,startTime:'10:15',innerIntervalHours:1},
          {},Date.parse('2026-10-13T22:00:00Z')).startAt).toISOString()''')
        self.assertEqual(value,'2026-10-15T07:15:00.000Z')

    def test_resume_keeps_remaining_slots_in_same_day(self):
        values=self.page.evaluate('''()=>{
          const settings={postsPerDay:3,startTime:'09:00',innerIntervalHours:2};
          const plan=AZVK.postingPlan(Date.parse('2026-10-18T18:30:00+03:00'),settings);
          const lastDate=AZVK.postingSlot(plan,1);
          const resumed=AZVK.postingPlan(lastDate,settings,{postingPlan:plan,completed:2,lastDate});
          return [2,3].map(i=>new Date(AZVK.postingSlot(resumed,i)).toISOString());
        }''')
        self.assertEqual(values,['2026-10-19T10:00:00.000Z','2026-10-20T06:00:00.000Z'])

    def test_external_queue_posts_rebase_remaining_batch_to_next_day(self):
        values=self.page.evaluate('''()=>{
          const settings={postsPerDay:3,startTime:'09:00',innerIntervalHours:2};
          const plan=AZVK.postingPlan(Date.parse('2026-10-18T18:30:00+03:00'),settings);
          const resumed=AZVK.postingPlan(Date.parse('2026-10-22T18:30:00+03:00'),settings,
            {postingPlan:plan,completed:2,lastDate:AZVK.postingSlot(plan,1)});
          return [2,3].map(i=>new Date(AZVK.postingSlot(resumed,i)).toISOString());
        }''')
        self.assertEqual(values,['2026-10-23T06:00:00.000Z','2026-10-23T08:00:00.000Z'])

    def test_batch_uses_daily_slots_and_never_checks_queue_after_submission(self):
        self.scheduled_fixture()
        self.page.evaluate('''()=>{testStorage.settings={...fixtureSettings,postsPerDay:3,startTime:'09:00',innerIntervalHours:2,noAudio:true};
          pending.onclick=()=>{throw Error('Must not reopen scheduled posts')};
          const confirm=confirmPlan.onclick;confirmPlan.onclick=()=>{confirm();pendingList.replaceChildren();};
          const send=chrome.runtime.sendMessage;chrome.runtime.sendMessage=async msg=>{
            if(msg.type==='pendingInspect')throw Error('Must not verify each scheduled post');return send(msg);
          };}''')
        self.page.evaluate('''TriSloga.runBatch({id:'daily',amount:5,completed:0,intervalSeconds:1,queueDate:1798644600000,
          settings:testStorage.settings,community:{owner:'-220995299',path:'/tri_sloga_band',name:'Три Слога',origin:'https://vk.ru'}})''')
        values=self.page.evaluate('savedPosts.map(p=>new Date(p.timestamp).toISOString())')
        self.assertEqual(values,['2026-12-31T06:00:00.000Z','2026-12-31T08:00:00.000Z','2026-12-31T10:00:00.000Z',
                                 '2027-01-01T06:00:00.000Z','2027-01-01T08:00:00.000Z'])
        self.assertEqual(self.page.evaluate('progress.map(p=>p.completed)'),[1,2,3,4,5])
        self.assertEqual(self.page.evaluate('beginAttempts.length'),5)
        self.assertEqual(self.page.evaluate('TriSloga.state.verification.method'),'editor-closed')

    def test_visible_vk_error_does_not_count_closed_editor_as_success(self):
        self.scheduled_fixture()
        self.page.evaluate('''()=>{testStorage.settings={...fixtureSettings,noAudio:true};window.submitCount=0;
          confirmPlan.onclick=()=>{submitCount++;dateDialog.hidden=true;editor.hidden=true;
            const error=document.createElement('div');error.setAttribute('role','alert');error.textContent='Ошибка: время уже занято';document.body.append(error);};}''')
        self.page.evaluate('''TriSloga.runBatch({id:'error',amount:2,completed:0,intervalSeconds:1,queueDate:1798644600000,
          settings:testStorage.settings,community:{owner:'-220995299',path:'/tri_sloga_band',name:'Три Слога',origin:'https://vk.ru'}})''')
        self.assertEqual(self.page.evaluate('submitCount'),1)
        self.assertEqual(self.page.evaluate('progress.length'),0)
        self.assertFalse(self.page.evaluate('sentMessages.some(msg=>msg.type==="completePublish")'))
        self.assertIn('время уже занято',self.page.evaluate('sentMessages.find(msg=>msg.type==="batchError").error'))

    def test_popup_previews_daily_slots_persists_timing_and_rejects_midnight(self):
        self.page.set_content((EXT/'popup.html').read_text(encoding='utf-8'))
        self.page.evaluate('''()=>{window.calls=[];chrome.storage.onChanged={addListener:()=>{}};
          chrome.runtime.sendMessage=async msg=>{calls.push(msg);return {ok:true,settings:msg.settings||fixtureSettings};};}''')
        self.page.add_script_tag(path=str(EXT/'popup.js'))
        self.page.wait_for_function('settingsLoaded')
        self.page.locator('#postsPerDay').select_option('3')
        self.page.locator('#startTime').fill('09:00')
        self.page.locator('#innerIntervalHours').fill('2')
        self.assertIn('09:00, 11:00, 13:00',self.page.locator('#schedulePreview').inner_text())
        self.page.locator('#saveSettings').click()
        self.assertEqual(self.page.evaluate('calls.find(m=>m.type==="settingsSave").settings.postsPerDay'),3)
        self.assertEqual(self.page.evaluate('calls.find(m=>m.type==="settingsSave").settings.startTime'),'09:00')
        self.page.locator('#startTime').fill('18:00')
        self.page.locator('#enable').click()
        self.assertFalse(self.page.evaluate('calls.some(m=>m.type==="batchStart")'))
        self.assertIn('меньше 24:00',self.page.locator('#status').inner_text())
        self.assertNotIn('Песни — заголовки',self.page.locator('body').inner_text())

class DailyBackgroundTests(unittest.TestCase):
    setUpClass=classmethod(test_batch.BatchBackgroundTests.setUpClass.__func__)
    tearDownClass=classmethod(test_batch.BatchBackgroundTests.tearDownClass.__func__)
    setUp=test_batch.BatchBackgroundTests.setUp
    tearDown=test_batch.BatchBackgroundTests.tearDown

    def test_initial_queue_check_persists_plan_before_starting_batch(self):
        self.page.evaluate('''()=>{const send=chrome.tabs.sendMessage;chrome.tabs.sendMessage=async(id,msg)=>
          msg.type==='inspectPending'?(calls.push({id,...msg}),{ok:true,latest:Date.parse('2026-10-18T16:38:00+03:00')}):send(id,msg);}''')
        self.page.evaluate('''batchCommand({type:'batchStart',amount:5,intervalSeconds:1,
          settings:{...fixtureSettings,postsPerDay:3,startTime:'09:00',innerIntervalHours:2}}, {})''')
        self.page.wait_for_function('calls.some(c=>c.type==="batchStart")')
        self.assertEqual(self.page.evaluate('calls.filter(c=>c.type==="inspectPending").length'),1)
        self.assertEqual(self.page.evaluate('new Date(store.batch.postingPlan.startAt).toISOString()'),'2026-10-19T06:00:00.000Z')
        self.assertEqual(self.page.evaluate('calls.find(c=>c.type==="batchStart").batch.postingPlan.postsPerDay'),3)

if __name__=='__main__':unittest.main()
