"""Offline regressions for ordered document posts and complete queue loading."""
import unittest
from pathlib import Path
import test_extension
import test_batch
import test_settings

EXT=Path(__file__).parent/'extension'

class OrderAndQueueTests(unittest.TestCase):
    setUpClass=classmethod(test_extension.ExtensionTests.setUpClass.__func__)
    tearDownClass=classmethod(test_extension.ExtensionTests.tearDownClass.__func__)
    setUp=test_extension.ExtensionTests.setUp
    tearDown=test_extension.ExtensionTests.tearDown
    content=test_extension.ExtensionTests.content
    scheduled_fixture=test_batch.BatchPageTests.scheduled_fixture
    workflow_fixture=test_extension.ExtensionTests.workflow_fixture

    def test_ordered_document_cycles_verses_across_titles_and_resumes_at_checkpoint(self):
        self.content('<p>fixture</p>')
        self.page.evaluate('TriSloga.configure({...fixtureSettings,documentInOrder:true},{owner:"-220995299",path:"/tri_sloga_band",name:"Три Слога",origin:"https://vk.ru"})')
        html='<h1>Первая</h1><p>Первый куплет</p><p></p><p>Второй куплет</p><h2>Вторая</h2><p>Третий куплет</p>'
        values=self.page.evaluate('html=>Array.from({length:5},(_,i)=>TriSloga.chooseSongExcerpt(html,()=>{throw Error("Must not choose randomly")},i))',html)
        self.assertEqual([v['title'] for v in values],['Первая','Первая','Вторая','Первая','Первая'])
        self.assertEqual([v['text'].split('\n')[0] for v in values],['Первый куплет','Второй куплет','Третий куплет','Первый куплет','Второй куплет'])
        self.page.evaluate('TriSloga.state.batch={completed:2}')
        self.assertEqual(self.page.evaluate('html=>TriSloga.chooseSongExcerpt(html).title',html),'Вторая')

    def test_ordered_untitled_lists_sections_and_paragraphs(self):
        self.content('<p>fixture</p>')
        self.page.evaluate('TriSloga.configure({...fixtureSettings,documentInOrder:true},{owner:"-220995299",path:"/tri_sloga_band",name:"Три Слога",origin:"https://vk.ru"})')
        for body in ['<p>1. Первый</p><p>2. Второй</p>', '<p>- Первый</p><p>- Второй</p>',
                     '<p>Первый</p><p></p><p>Второй</p>', '<p>Первый</p><p>Второй</p>']:
            values=self.page.evaluate('html=>[0,1,2].map(i=>TriSloga.chooseSongExcerpt(html,()=>0.99,i))','<style>p{color:black}</style>'+body)
            self.assertEqual([v['text'].split('\n')[0] for v in values],['Первый','Второй','Первый'])

    def test_batch_posts_document_parts_in_order(self):
        self.scheduled_fixture()
        self.page.evaluate('''()=>{testStorage.settings={...fixtureSettings,documentInOrder:true,noAudio:true};
          const send=chrome.runtime.sendMessage;chrome.runtime.sendMessage=async msg=>msg.type==='lyrics'?
            {ok:true,html:'<h1>Песня</h1><p>Первый куплет</p><p></p><p>Второй куплет</p>'}:send(msg);}''')
        self.page.evaluate('''TriSloga.runBatch({id:'ordered',amount:3,completed:0,intervalSeconds:1,queueDate:1798644600000,
          settings:testStorage.settings,community:{owner:'-220995299',path:'/tri_sloga_band',name:'Три Слога',origin:'https://vk.ru'}})''')
        self.assertEqual(self.page.evaluate('savedPosts.map(p=>p.text.split("\\n")[0])'),['Первый куплет','Второй куплет','Первый куплет'])
        self.assertEqual(self.page.evaluate('progress.map(p=>p.completed)'),[1,2,3])

    def test_queue_scrolls_past_last_post_to_page_footer_and_waits_for_late_posts(self):
        self.content('''<h2>Отложенные посты 2</h2><div id=page_wall_posts><article data-testid=post style="height:300px">
          <time datetime="2026-10-18T16:38:00+03:00"></time>First page</article></div>
          <div style="height:2000px">Loading sentinel below posts</div>''')
        self.page.evaluate('''()=>{history.replaceState(null,'','/wall-220995299?postponed=1');window.loaded=false;
          window.addEventListener('scroll',()=>{
            if(loaded || window.scrollY+innerHeight<document.scrollingElement.scrollHeight-5)return;
            loaded=true;setTimeout(()=>page_wall_posts.insertAdjacentHTML('beforeend',
              '<article data-testid=post style="height:700px"><time datetime="2026-10-23T16:38:00+03:00"></time>Further down</article>'),3500);
          });}''')
        latest=self.page.evaluate('TriSloga.latestPendingDate()')
        self.assertEqual(latest,self.page.evaluate('Date.parse("2026-10-23T16:38:00+03:00")'))
        self.assertTrue(self.page.evaluate('loaded && TriSloga.state.queueScan.atBottom'))
        self.assertEqual(self.page.evaluate('TriSloga.state.queueScan.expectedCount'),2)

    def test_nested_queue_waits_for_loading_indicator_before_finishing(self):
        self.content('''<div id=list data-testid=scheduled-posts style="height:160px;overflow:auto">
          <article data-testid=post style="height:300px"><time datetime="2026-10-18T16:38:00+03:00"></time>First page</article>
          <div id=spinner role=progressbar hidden>Loading</div></div>''')
        self.page.evaluate('''()=>{history.replaceState(null,'','/wall-220995299?postponed=1');window.loaded=false;
          list.addEventListener('scroll',()=>{if(loaded || list.scrollTop+list.clientHeight<list.scrollHeight-5)return;
            loaded=true;spinner.hidden=false;setTimeout(()=>{
              list.insertAdjacentHTML('beforeend','<article data-testid=post><time datetime="2026-10-25T16:38:00+03:00"></time>Last page</article>');
              spinner.hidden=true;
            },6500);
          });}''')
        latest=self.page.evaluate('TriSloga.latestPendingDate()')
        self.assertEqual(latest,self.page.evaluate('Date.parse("2026-10-25T16:38:00+03:00")'))

    def test_popup_saves_order_flag_and_disables_it_without_text(self):
        self.page.set_content((EXT/'popup.html').read_text(encoding='utf-8'))
        self.page.evaluate('''()=>{window.calls=[];chrome.storage.onChanged={addListener:()=>{}};
          chrome.runtime.sendMessage=async msg=>{calls.push(msg);return {ok:true,settings:msg.settings||fixtureSettings};};}''')
        self.page.add_script_tag(path=str(EXT/'popup.js'))
        self.page.wait_for_function('settingsLoaded')
        self.page.locator('#documentInOrder').check()
        self.page.locator('#saveSettings').click()
        self.assertTrue(self.page.evaluate('calls.find(m=>m.type==="settingsSave").settings.documentInOrder'))
        self.page.locator('#noText').check()
        self.assertTrue(self.page.locator('#documentInOrder').is_disabled())
        self.assertIn('ТОЧНО',self.page.locator('label[for=artist]').inner_text())

class ArtistNotificationTests(unittest.TestCase):
    setUpClass=classmethod(test_batch.BatchBackgroundTests.setUpClass.__func__)
    tearDownClass=classmethod(test_batch.BatchBackgroundTests.tearDownClass.__func__)
    setUp=test_batch.BatchBackgroundTests.setUp
    tearDown=test_batch.BatchBackgroundTests.tearDown

    def test_artist_notification_once_per_batch_and_no_pause(self):
        self.page.evaluate('''()=>{chrome.runtime.id='fixture';chrome.runtime.onMessage={addListener:fn=>window.backgroundListener=fn};
          store.batch={id:'artist',enabled:true,running:true,tabId:7,settings:{...fixtureSettings,artist:'Wrong artist'}};}''')
        self.page.add_script_tag(path=str(EXT/'background.js'))
        for _ in range(2):
            result=self.page.evaluate('''()=>new Promise(resolve=>backgroundListener({type:'artistWarning',batchId:'artist',artist:'Wrong artist'},
              {id:'fixture',url:'https://vk.ru/tri_sloga_band',tab:{id:7}},resolve))''')
            self.assertTrue(result['ok'],result)
        self.assertEqual(self.page.evaluate('calls.filter(c=>c.type==="notification").length'),1)
        self.assertTrue(self.page.evaluate('store.batch.enabled && store.batch.running'))
        self.assertIn('Wrong artist',self.page.evaluate('store.batch.artistWarning'))
        result=self.page.evaluate('''()=>new Promise(resolve=>backgroundListener({type:'artistWarning',batchId:'stale',artist:'Wrong artist'},
          {id:'fixture',url:'https://vk.ru/tri_sloga_band',tab:{id:7}},resolve))''')
        self.assertFalse(result['ok'])

if __name__=='__main__':unittest.main()
