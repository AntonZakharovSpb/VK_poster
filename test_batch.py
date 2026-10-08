"""Offline scheduling/CAPTCHA fixtures; never sends a post to real VK."""
import unittest
from pathlib import Path
import test_extension
import test_scheduler

EXT=Path(__file__).parent/'extension'


class BatchPageTests(unittest.TestCase):
    setUpClass=classmethod(test_extension.ExtensionTests.setUpClass.__func__)
    tearDownClass=classmethod(test_extension.ExtensionTests.tearDownClass.__func__)
    setUp=test_extension.ExtensionTests.setUp
    tearDown=test_extension.ExtensionTests.tearDown
    content=test_extension.ExtensionTests.content
    workflow_fixture=test_extension.ExtensionTests.workflow_fixture

    def test_dates_parse_moscow_year_rollover_and_invalid_dates(self):
        self.content('<div>Fixture</div>')
        values=self.page.evaluate('''()=>{
          const now=Date.parse('2026-10-08T12:00:00Z');
          return ['10 октября 2026 в 18:30','10 окт в 18:30','10.10.2026 18:30','завтра в 18:30','31.02.2026 18:30','завтра в 25:30']
            .map(text=>TriSloga.parsePostDate(text,now));
        }''')
        self.assertEqual(values[:3],[1791646200000]*3)
        self.assertEqual(values[3],1791559800000)
        self.assertEqual(values[4:],[None,None])

    def test_latest_date_scans_unsorted_and_lazily_loaded_posts(self):
        self.content('''<button onclick="list.hidden=false">Отложенные</button>
          <div id=list data-testid=scheduled-posts hidden style="height:100px;overflow:auto">
          <article data-testid=post style="height:200px"><time datetime="2026-10-12T18:00:00+03:00"></time>One</article>
          <article data-testid=post><time datetime="2026-10-10T18:00:00+03:00"></time>Two</article></div>''')
        self.page.evaluate('''()=>{let loaded=false;list.addEventListener('scroll',()=>{
          if(loaded)return;loaded=true;list.insertAdjacentHTML('beforeend','<article data-testid=post><time datetime="2026-10-15T18:00:00+03:00"></time>Later</article>');
        });}''')
        self.assertEqual(self.page.evaluate('TriSloga.latestPendingDate()'),1792076400000)

    def test_real_pending_wall_header_reads_timestamp_after_author(self):
        self.content('''<h2>Отложенные посты 2</h2><div class=wall_posts>
          <div id=post-220995299_1><div class=post_header><a>Три Слога</a><span class=post_date>8 окт 2026 в 22:39</span></div><p>test.</p><button>Опубликовать сейчас</button></div>
          <div id=post-220995299_2><div class=post_header><a>Три Слога</a><span class=post_date>7 окт 2026 в 22:39</span></div><p>Later in list</p></div></div>''')
        self.page.evaluate("history.replaceState(null,'','/wall-220995299?postponed=1')")
        self.assertEqual(self.page.evaluate('TriSloga.latestPendingDate()'),1791488340000)
        self.assertEqual(self.page.evaluate('TriSloga.scheduledPosts(document).length'),2)

    def test_inspection_message_reads_queue_and_checks_requested_post(self):
        self.content('''<div id=post-220995299_1><div class=post_header>Три Слога<span>8 окт 2026 в 22:39</span></div><p>test.</p></div>''')
        self.page.evaluate("history.replaceState(null,'','/wall-220995299?postponed=1')")
        response=self.page.evaluate('''()=>new Promise(resolve=>testListeners[0]({type:'inspectPending',batch:{id:'fixture'},text:'test.',date:1791488340000},{id:'test-extension'},resolve))''')
        self.assertTrue(response['ok'])
        self.assertTrue(response['found'])

    def test_empty_queue_is_explicit_and_unreadable_queue_stops(self):
        self.content('<button>Отложенные</button><div data-testid=scheduled-posts>Нет отложенных записей</div>')
        self.assertIsNone(self.page.evaluate('TriSloga.latestPendingDate()'))
        self.page.set_content('<button>Отложенные</button><div data-testid=scheduled-posts><article data-testid=post>No date</article></div>')
        error=self.page.evaluate('async()=>{try{await TriSloga.latestPendingDate()}catch(e){return e.message}}')
        self.assertIn('прочитать дату',error)

    def scheduled_fixture(self):
        self.workflow_fixture()
        self.page.evaluate('''()=>{
          window.savedPosts=[];window.progress=[];window.beginAttempts=[];
          const original=editor.innerHTML;
          document.querySelector('[data-testid=group_publish_create_button]').onclick=()=>{editor.innerHTML=original;editor.hidden=false;};
          editor.insertAdjacentHTML('beforeend','<button id=plan onclick="dateDialog.hidden=false">Запланировать</button>');
          // Preserve the plan button when the editor is recreated for the next post.
          document.querySelector('[data-testid=group_publish_create_button]').onclick=()=>{
            editor.innerHTML=original+'<button id=plan onclick="dateDialog.hidden=false">Запланировать</button>';editor.hidden=false;
          };
          document.body.insertAdjacentHTML('beforeend',`<button id=pending>Отложенные</button>
            <div id=pendingList data-testid=scheduled-posts><article data-testid=post><time datetime="2026-12-30T18:30:00+03:00"></time>Old</article></div>
            <div id=dateDialog role=dialog hidden><input type=date><input type=time><button id=confirmPlan>Запланировать</button></div>`);
          confirmPlan.onclick=()=>{
            const date=dateDialog.querySelector('[type=date]').value,time=dateDialog.querySelector('[type=time]').value;
            const text=editor.querySelector('[contenteditable]').innerText;
            const timestamp=Date.parse(`${date}T${time}:00+03:00`);
            savedPosts.push({timestamp,text,time:Date.now()});
            const post=document.createElement('article');post.dataset.testid='post';post.textContent=text;
            const stamp=document.createElement('time');stamp.dateTime=`${date}T${time}:00+03:00`;post.append(stamp);pendingList.append(post);
            dateDialog.hidden=true;editor.hidden=true;
          };
          const send=chrome.runtime.sendMessage;
          chrome.runtime.sendMessage=async msg=>{
            if(msg.type==='batchProgress') progress.push(msg);
            if(msg.type==='beginPublish') beginAttempts.push(msg);
            return send(msg);
          };
        }''')

    def test_batch_schedules_exact_amount_consecutive_days_and_waits(self):
        self.scheduled_fixture()
        self.page.evaluate("TriSloga.runBatch({id:'fixture',amount:3,completed:0,intervalSeconds:1})")
        saved=self.page.evaluate('savedPosts')
        self.assertEqual(len(saved),3)
        self.assertEqual([p['timestamp'] for p in saved],[1798731000000,1798817400000,1798903800000])
        self.assertEqual(self.page.evaluate('progress.map(p=>p.completed)'),[1,2,3])
        self.assertIsNone(self.page.evaluate('window.publishCount'))
        self.assertEqual(self.page.evaluate('beginAttempts.length'),3)
        self.assertGreaterEqual(saved[1]['time']-saved[0]['time'],1000)
        self.assertTrue(all('Три слога - Song' in p['text'] for p in saved))

    def test_captcha_requires_user_ok_and_visible_challenge_cannot_resume(self):
        self.content('<div id=captcha>Challenge</div>')
        self.page.evaluate('''()=>{
          TriSloga.state.batch={id:'b'};window.gateDone=false;
          TriSloga.captchaGate().then(()=>gateDone=true);
        }''')
        self.page.wait_for_timeout(300)
        self.assertFalse(self.page.evaluate('gateDone'))
        failed=self.page.evaluate('''()=>{let result;testListeners[0]({type:'captchaResume',batchId:'b'},{id:'test-extension'},r=>result=r);return result;}''')
        self.assertFalse(failed['ok'])
        self.page.evaluate('document.getElementById("captcha").remove()')
        self.page.wait_for_timeout(300)
        self.assertFalse(self.page.evaluate('gateDone'))
        self.page.evaluate("testListeners[0]({type:'captchaResume',batchId:'b'},{id:'test-extension'},()=>{})")
        self.page.wait_for_function('gateDone')

    def test_batch_captcha_between_posts_waits_for_explicit_ok(self):
        self.scheduled_fixture()
        self.page.evaluate('''()=>{
          const save=confirmPlan.onclick;
          confirmPlan.onclick=()=>{save();if(savedPosts.length===1){const captcha=document.createElement('div');captcha.id='captcha';captcha.textContent='Challenge';document.body.append(captcha);}};
          window.batchDone=false;
          TriSloga.runBatch({id:'fixture',amount:2,completed:0,intervalSeconds:1}).then(()=>batchDone=true);
        }''')
        self.page.wait_for_function('TriSloga.state.captchaPaused')
        self.assertEqual(self.page.evaluate('savedPosts.length'),1)
        self.page.evaluate('document.getElementById("captcha").remove()')
        self.page.wait_for_timeout(1200)
        self.assertEqual(self.page.evaluate('savedPosts.length'),1)
        self.page.evaluate("testListeners[0]({type:'captchaResume',batchId:'fixture'},{id:'test-extension'},()=>{})")
        self.page.wait_for_function('batchDone',timeout=25000)
        self.assertEqual(self.page.evaluate('savedPosts.length'),2)
        self.assertEqual(self.page.evaluate('progress.map(p=>p.completed)'),[1,2])

    def test_stop_unblocks_captcha_without_submitting(self):
        self.content('<div id=captcha>Challenge</div>')
        self.page.evaluate('''()=>{TriSloga.state.batch={id:'b'};
          TriSloga.captchaGate().catch(e=>window.stopError=e.message);}''')
        self.page.evaluate("testListeners[0]({type:'batchStop',batchId:'b'},{id:'test-extension'},()=>{})")
        self.page.wait_for_function('window.stopError')
        self.assertIn('Остановлено',self.page.evaluate('stopError'))


class BatchBackgroundTests(unittest.TestCase):
    setUpClass=classmethod(test_scheduler.SchedulerTests.setUpClass.__func__)
    tearDownClass=classmethod(test_scheduler.SchedulerTests.tearDownClass.__func__)
    tearDown=test_scheduler.SchedulerTests.tearDown

    def setUp(self):
        test_scheduler.SchedulerTests.setUp(self)
        self.page.add_script_tag(path=str(EXT/'batch.js'))

    def start(self,amount=3,interval=2):
        self.page.evaluate('(opts)=>batchCommand({type:"batchStart",...opts},{})',{'amount':amount,'intervalSeconds':interval})
        self.page.wait_for_function('calls.some(c=>c.type==="batchStart")')

    def test_settings_dispatch_and_checkpoints_finish_without_new_batch(self):
        self.start()
        self.assertEqual(self.page.evaluate('calls.find(c=>c.type==="batchStart").batch.amount'),3)
        self.assertFalse(self.page.evaluate('store.schedule.enabled'))
        self.page.evaluate("batchCommand({type:'batchProgress',batchId:store.batch.id,completed:1,lastDate:1798731000000},{tab:{id:7}})")
        self.assertEqual(self.page.evaluate('store.batch.completed'),1)
        self.page.evaluate("batchCommand({type:'batchProgress',batchId:store.batch.id,completed:2,lastDate:1798817400000},{tab:{id:7}})")
        self.page.evaluate("batchCommand({type:'batchProgress',batchId:store.batch.id,completed:3,lastDate:1798903800000},{tab:{id:7}})")
        self.assertTrue(self.page.evaluate('store.batch.done'))
        self.assertFalse(self.page.evaluate('store.batch.enabled'))

    def test_queue_inspection_uses_separate_tab_and_passes_latest_date(self):
        self.page.evaluate('''()=>{
          chrome.tabs.remove=async id=>calls.push({type:'remove',id});
          const send=chrome.tabs.sendMessage;
          chrome.tabs.sendMessage=async(id,msg)=>{
            if(msg.type==='inspectPending'){calls.push({id,...msg});return {ok:true,latest:1791488340000};}
            return send(id,msg);
          };
        }''')
        self.start()
        self.assertEqual(self.page.evaluate('calls.find(c=>c.type==="create").url'),'https://vk.ru/wall-220995299?postponed=1')
        self.assertEqual(self.page.evaluate('calls.find(c=>c.type==="batchStart").batch.queueDate'),1791488340000)
        self.assertEqual(self.page.evaluate('calls.find(c=>c.type==="remove").id'),8)

    def test_automatic_error_download_is_json_and_deduplicates_one_error(self):
        self.page.evaluate('''()=>{
          chrome.runtime.onMessage={addListener:()=>{}};
          chrome.downloads={download:async options=>{calls.push({type:'download',...options});return 1;}};
        }''')
        self.page.add_script_tag(path=str(EXT/'background.js'))
        self.page.evaluate("store.lastDiagnostic={logs:['failure'],stage:'read scheduled posts'};downloadDiagnostics('Failed','b')")
        self.page.evaluate("downloadDiagnostics('Failed','b')")
        self.assertEqual(self.page.evaluate('calls.filter(c=>c.type==="download").length'),1)
        data=self.page.evaluate("JSON.parse(decodeURIComponent(calls.find(c=>c.type==='download').url.split(',').slice(1).join(',')))")
        self.assertEqual(data['error'],'Failed')
        self.assertEqual(data['lastDiagnostic']['logs'],['failure'])
        self.assertFalse(self.page.evaluate('calls.find(c=>c.type==="download").saveAs'))

    def test_invalid_inputs_and_parallel_start_are_rejected(self):
        error=self.page.evaluate("async()=>{try{await batchCommand({type:'batchStart',amount:1.5,intervalSeconds:2},{})}catch(e){return e.message}}")
        self.assertIn('целое',error)
        self.start()
        error=self.page.evaluate("async()=>{try{await batchCommand({type:'batchStart',amount:1,intervalSeconds:2},{})}catch(e){return e.message}}")
        self.assertIn('текущую',error)

    def test_foreign_checkpoint_and_uncertain_retry_rejected(self):
        self.start()
        error=self.page.evaluate("async()=>{try{await batchCommand({type:'batchProgress',batchId:store.batch.id,completed:1,lastDate:1},{tab:{id:99}})}catch(e){return e.message}}")
        self.assertIn('Устаревший',error)
        self.page.evaluate("store.publicationAttempt={status:'pending'};store.batch.needsFix=true")
        error=self.page.evaluate("async()=>{try{await batchCommand({type:'batchResume'},{})}catch(e){return e.message}}")
        self.assertIn('Отложенные',error)

    def test_captcha_resume_sends_message_to_same_page_without_new_start(self):
        self.start()
        self.page.evaluate("batchCommand({type:'batchCaptcha',batchId:store.batch.id,paused:true},{tab:{id:7}})")
        self.assertTrue(self.page.evaluate('store.batch.captcha'))
        self.page.evaluate("batchCommand({type:'batchResume'},{})")
        self.assertEqual(self.page.evaluate('calls.filter(c=>c.type==="batchStart").length'),1)
        self.assertEqual(self.page.evaluate('calls.find(c=>c.type==="captchaResume").id'),7)

    def test_restart_pauses_batch_and_preserves_progress(self):
        self.start()
        self.page.evaluate('store.batch.completed=2;batchInterrupted()')
        self.assertEqual(self.page.evaluate('store.batch.completed'),2)
        self.assertTrue(self.page.evaluate('store.batch.needsFix'))
        self.assertFalse(self.page.evaluate('store.batch.running'))

    def test_confirmed_post_after_crash_is_counted_without_recreating_it(self):
        self.start(amount=1)
        self.page.evaluate("store.batch.needsFix=true;store.publicationAttempt={status:'published',batchId:store.batch.id,scheduledAt:1798731000000}")
        self.page.evaluate("batchCommand({type:'batchResume'},{})")
        self.assertTrue(self.page.evaluate('store.batch.done'))
        self.assertEqual(self.page.evaluate('store.batch.completed'),1)
        self.assertEqual(self.page.evaluate('calls.filter(c=>c.type==="batchStart").length'),1)
