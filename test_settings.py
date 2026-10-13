# Offline coverage for user-selected communities, artists, documents and persistence.
import unittest
from pathlib import Path
import test_extension
import test_batch

EXT=Path(__file__).parent/'extension'
CUSTOM={'communityUrl':'https://vk.ru/another_group','artist':'Другой артист','documentUrl':'https://docs.google.com/document/d/custom_doc/edit','noAudio':False,'noText':False,'textMode':'document','quoteReference':'','customText':'','documentInOrder':False}
COMMUNITY={'owner':'-123456','path':'/another_group','name':'Другое сообщество','origin':'https://vk.ru'}

class SettingsPageTests(unittest.TestCase):
    setUpClass=classmethod(test_extension.ExtensionTests.setUpClass.__func__)
    tearDownClass=classmethod(test_extension.ExtensionTests.tearDownClass.__func__)
    setUp=test_extension.ExtensionTests.setUp
    tearDown=test_extension.ExtensionTests.tearDown
    content=test_extension.ExtensionTests.content
    workflow_fixture=test_extension.ExtensionTests.workflow_fixture

    def test_fresh_popup_requires_community_instead_of_prefilling_tri_sloga(self):
        self.page.set_content((EXT/'popup.html').read_text(encoding='utf-8'))
        self.page.evaluate('''()=>{testStorage={};window.calls=[];chrome.storage.onChanged={addListener:()=>{}};
          chrome.runtime.sendMessage=async msg=>{calls.push(msg);return {ok:true};};}''')
        self.page.add_script_tag(path=str(EXT/'popup.js'))
        self.page.wait_for_function('settingsLoaded')
        self.assertEqual(self.page.locator('#communityUrl').input_value(),'')
        self.assertEqual(self.page.locator('#documentUrl').input_value(),'')
        self.assertEqual(self.page.locator('#artist').input_value(),'Три слога')
        self.page.locator('#enable').click()
        self.assertFalse(self.page.evaluate('calls.some(msg=>msg.type==="batchStart")'))
        self.assertIn('ссылку на сообщество',self.page.locator('#status').inner_text())

    def test_settings_normalize_shared_links_and_keep_default_artist(self):
        value={**CUSTOM,'communityUrl':'https://vk.com/club123456/?from=menu','artist':'  Другой   артист  ',
               'documentUrl':'https://docs.google.com/document/u/0/d/custom_doc/edit?usp=sharing#heading=h.1'}
        result=self.page.evaluate('value=>AZVK.normalizeSettings(value)',value)
        self.assertEqual(result,{**CUSTOM,'communityUrl':'https://vk.com/club123456'})
        self.assertEqual(self.page.evaluate('AZVK.defaults.artist'),'Три слога')
        self.assertEqual(self.page.evaluate('value=>AZVK.documentExport(value)',value),'https://docs.google.com/document/d/custom_doc/export?format=html')

    def test_invalid_targets_are_rejected_before_start(self):
        for key,value in [('communityUrl','https://example.com/club123'),('communityUrl','https://vk.ru/id123'),
                          ('communityUrl','https://vk.ru/wall-123_1'),('communityUrl','https://vk.ru/'),
                          ('artist',' '),('documentUrl','https://example.com/document/d/id/edit'),
                          ('documentUrl','https://docs.google.com/spreadsheets/d/id/edit')]:
            with self.subTest(key=key,value=value):
                error=self.page.evaluate('value=>{try{AZVK.normalizeSettings(value);return null}catch(e){return e.message}}',{**CUSTOM,key:value})
                self.assertTrue(error)

    def test_named_community_resolves_id_and_ignores_foreign_repost_media(self):
        self.content('''<h1 data-testid=group-name>Другое сообщество</h1><section data-testid=group_publish_block></section>
          <a href=/wall-123456?postponed=1>Отложенные</a><a href=/photo-220995299_1>Repost photo</a>
          <a href=/wall-999999_3>Repost</a>''')
        self.page.evaluate("history.replaceState(null,'','/another_group')")
        self.assertEqual(self.page.evaluate('url=>AZVK.resolveCommunity(url)',CUSTOM['communityUrl']),COMMUNITY)

    def test_numeric_link_accepts_empty_community_with_vanity_redirect(self):
        self.content('<h1 data-testid=group-name>Другое сообщество</h1><section data-testid=group_publish_block></section>')
        self.page.evaluate("history.replaceState(null,'','/another_group')")
        self.assertEqual(self.page.evaluate("AZVK.resolveCommunity('https://vk.ru/club123456')"),COMMUNITY)

    def test_wrong_or_ambiguous_community_stops_instead_of_reusing_old_owner(self):
        self.content('''<h1 data-testid=group-name>Другое сообщество</h1><section data-testid=group_publish_block></section>
          <a href=/wall-123456>Стена</a><a href=/wall-999999>Другая стена</a>''')
        self.page.evaluate("history.replaceState(null,'','/another_group')")
        for url in [CUSTOM['communityUrl'],'https://vk.ru/club111111','https://vk.ru/wrong_group']:
            error=self.page.evaluate('url=>{try{AZVK.resolveCommunity(url);return null}catch(e){return e.message}}',url)
            self.assertTrue(error)

    def test_media_and_author_checks_use_selected_community(self):
        self.content('''<a href=/photo-123456_1><img width=50 height=50 src=/photo.jpg></a>
          <a href=/photo-220995299_2><img width=50 height=50 src=/other.jpg></a>
          <div data-audio-id=-123456_3><span data-testid=MusicTrackRow_Title>Песня</span><span data-testid=MusicTrackRow_Authors>Другой артист</span></div>
          <div data-audio-id=-220995299_4><span data-testid=MusicTrackRow_Title>Другая</span></div>
          <div id=right><button data-testid=posting_author data-owner-id=-123456>Другое сообщество</button></div>
          <div id=wrong><button data-testid=posting_author data-owner-id=-220995299>Три Слога</button></div>''')
        self.page.evaluate('({settings,community})=>TriSloga.configure(settings,community)',{'settings':CUSTOM,'community':COMMUNITY})
        self.assertEqual(self.page.evaluate('TriSloga.photoCandidates().map(p=>p.id)'),['-123456_1'])
        self.assertEqual(self.page.evaluate('TriSloga.audioCandidates().map(p=>p.id)'),['-123456_3'])
        self.assertTrue(self.page.evaluate('TriSloga.authorVerified(document.getElementById("right"))'))
        self.assertFalse(self.page.evaluate('TriSloga.authorVerified(document.getElementById("wrong"))'))

    def test_custom_artist_matches_literal_names_collaborations_and_song_title(self):
        self.content('''<div id=picker><div data-audio-id=1_1><span data-testid=music-cell-title>Песня</span><span data-testid=music-cell-artists>Три слога</span></div>
          <div data-audio-id=1_2><span data-testid=music-cell-title>Другая</span><span data-testid=music-cell-artists>A+B (Live)</span></div>
          <div data-audio-id=1_3><span data-testid=music-cell-title>Песня</span><span data-testid=music-cell-artists>Гость, A+B (Live)</span></div></div>''')
        self.page.evaluate('settings=>{TriSloga.configure(settings,{owner:"-123456",path:"/another_group",name:"Другое сообщество"});TriSloga.state.songTitle="Песня"}',{**CUSTOM,'artist':'A+B (Live)'})
        self.assertEqual(self.page.evaluate('TriSloga.firstBandSearchAudio(document.getElementById("picker")).dataset.audioId'),'1_3')
        self.assertFalse(self.page.evaluate('TriSloga.artistMatches("A+B (Live)XYZ")'))

    def test_artist_names_with_delimiters_are_matched_literally(self):
        self.content('<div></div>')
        for artist,credit in [('AC/DC','Guest, AC/DC'),('Simon & Garfunkel','Simon & Garfunkel / Guest'),
                              ('A+B (Live)','Guest feat. A+B (Live)')]:
            with self.subTest(artist=artist):
                self.page.evaluate('value=>TriSloga.configure(value,{owner:"-123456",path:"/another_group",name:"Community"})',{**CUSTOM,'artist':artist})
                self.assertTrue(self.page.evaluate('credit=>TriSloga.artistMatches(credit)',credit))
                self.assertFalse(self.page.evaluate('credit=>TriSloga.artistMatches(credit)',artist+'XYZ'))

    def test_custom_target_complete_workflow_queries_custom_artist(self):
        self.workflow_fixture(custom=True)
        self.page.evaluate('''()=>{window.searchQueries=[];document.querySelector('[data-testid=posting_audio_search_audio_input]').oninput=e=>searchQueries.push(e.target.value)}''')
        result=self.page.evaluate('TriSloga.run({automatic:true,scheduleRunId:"custom"})')
        self.assertTrue(result['success'],result)
        self.assertEqual(self.page.evaluate('publishCount'),1)
        self.assertEqual(self.page.evaluate('searchQueries[0]'),'Другой артист Song')
        self.assertEqual(self.page.evaluate('TriSloga.state.photo.id'),'-123456_123')
        self.assertIn('Другое сообщество - Song',self.page.locator('#post').inner_text())

    def test_community_without_music_tab_uses_artist_search(self):
        self.workflow_fixture(custom=True)
        self.page.locator('[data-testid=group_tab_audios]').evaluate('el=>el.remove()')
        result=self.page.evaluate('TriSloga.run({automatic:true,scheduleRunId:"custom"})')
        self.assertTrue(result['success'],result)
        self.assertEqual(self.page.evaluate('TriSloga.state.audio.artist'),'Другой артист')

    def test_custom_queue_inspection_uses_its_owner_and_dates(self):
        self.content('''<div id=post-123456_1><span class=post_date>15 окт 2026 в 10:39</span><p>Новый текст</p></div>''')
        self.page.evaluate("history.replaceState(null,'','/wall-123456?postponed=1')")
        response=self.page.evaluate('''batch=>new Promise(resolve=>testListeners[0]({type:'inspectPending',batch,text:'Новый текст',date:1792049940000},{id:'test-extension'},resolve))''',{'id':'custom','settings':CUSTOM,'community':COMMUNITY})
        self.assertTrue(response['ok'],response)
        self.assertTrue(response['found'])
        self.assertEqual(response['latest'],1792049940000)

    def test_popup_saves_and_reopens_settings_and_includes_them_on_start(self):
        self.page.set_content((EXT/'popup.html').read_text(encoding='utf-8'))
        self.page.evaluate('''()=>{window.calls=[];chrome.storage.onChanged={addListener:()=>{}};
          chrome.runtime.sendMessage=async msg=>{calls.push(msg);
            if(msg.type==='settingsSave'){testStorage.settings=msg.settings;return {ok:true,settings:msg.settings};}
            return {ok:true,settings:testStorage.settings,batch:msg.type==='batchStart'?{enabled:true,settings:msg.settings}:undefined};};}''')
        self.page.add_script_tag(path=str(EXT/'popup.js'))
        for key,value in CUSTOM.items():
            if key == 'textMode': self.page.locator('#'+key).select_option(value)
            elif isinstance(value,str) and self.page.locator('#'+key).is_visible(): self.page.locator('#'+key).fill(value)
        self.page.locator('#saveSettings').click()
        self.assertEqual(self.page.evaluate('testStorage.settings'),CUSTOM)
        self.page.evaluate('settingsLoaded=false;refresh()')
        self.page.wait_for_function('document.getElementById("artist").value==="Другой артист"')
        self.page.locator('#enable').click()
        self.assertEqual(self.page.evaluate('calls.find(c=>c.type==="batchStart").settings'),CUSTOM)
        self.assertTrue(self.page.locator('#communityUrl').is_disabled())
        self.assertTrue(self.page.locator('#artist').is_disabled())
        self.assertTrue(self.page.locator('#documentUrl').is_disabled())

    def test_custom_community_scheduling_keeps_exact_dates_and_count(self):
        self.workflow_fixture=lambda: test_extension.ExtensionTests.workflow_fixture(self,custom=True)
        test_batch.BatchPageTests.scheduled_fixture(self)
        batch={'id':'custom','amount':2,'completed':0,'intervalSeconds':1,'settings':CUSTOM,'community':COMMUNITY}
        self.page.evaluate('batch=>TriSloga.runBatch(batch)',batch)
        saved=self.page.evaluate('savedPosts')
        self.assertEqual([p['timestamp'] for p in saved],[1798731000000,1798817400000])
        self.assertTrue(all('Другое сообщество - Song' in p['text'] for p in saved))
        self.assertEqual(self.page.evaluate('beginAttempts.length'),2)
        self.assertIsNone(self.page.evaluate('window.publishCount'))

    def test_music_fallback_keeps_selected_artist_when_reserve_is_from_another_artist(self):
        self.workflow_fixture(custom=True)
        self.page.evaluate("""({settings,community})=>{
          TriSloga.configure(settings,community);editor.hidden=false;
          TriSloga.state.composer={root:editor,editor:editor.querySelector('[contenteditable]'),modern:true};
          TriSloga.state.songTitle='Missing';
          TriSloga.state.audio={id:'-123456_999',title:'Reserve',artist:'Someone else'};
          window.queries=[];document.querySelector('[data-testid=posting_audio_search_audio_input]').oninput=e=>queries.push(e.target.value);
        }""",{'settings':CUSTOM,'community':COMMUNITY})
        self.page.evaluate('TriSloga.attachAudio()')
        self.assertEqual(self.page.evaluate('queries'),['Другой артист Missing','Другой артист'])
        self.assertEqual(self.page.evaluate('TriSloga.state.audio.artist'),'Другой артист')
        self.assertEqual(self.page.evaluate('TriSloga.state.sourceAudio.artist'),'Someone else')

    def test_document_fetch_uses_selected_source_and_batch_snapshot(self):
        self.page.evaluate('''()=>{window.fetched=[];window.fetch=async url=>{fetched.push(url);return new Response('<h1>Song</h1><p>Verse</p>',{status:200,headers:{'content-type':'text/html'}});};}''')
        self.page.add_script_tag(path=str(EXT/'background.js'))
        self.page.evaluate('settings=>{testStorage.settings=AZVK.defaults;testStorage.batch={id:"custom",enabled:true,tabId:7,settings}}',CUSTOM)
        result=self.page.evaluate('''()=>new Promise(resolve=>testListeners[0]({type:'lyrics',batchId:'custom'},{id:'test-extension',url:location.href,tab:{id:7}},resolve))''')
        self.assertTrue(result['ok'],result)
        self.assertEqual(self.page.evaluate('fetched'),['https://docs.google.com/document/d/custom_doc/export?format=html'])
        stale=self.page.evaluate('''()=>new Promise(resolve=>testListeners[0]({type:'lyrics',batchId:'wrong'},{id:'test-extension',url:location.href,tab:{id:7}},resolve))''')
        self.assertFalse(stale['ok'])
        self.assertEqual(self.page.evaluate('fetched.length'),1)

    def music_search_fixture(self,title,title_results,artist_results,random=0.99,artist='Три слога',fallback_results=None):
        self.content('''<div id=editor data-testid=posting_modal_box role=dialog>
          <div contenteditable=true></div><button onclick="picker.hidden=false">Музыка</button></div>
          <div id=picker role=dialog hidden><input data-testid=posting_audio_search_audio_input placeholder="Поиск музыки">
          <div id=rows></div><button id=done>Готово</button></div>''')
        self.page.evaluate('''options=>{
          window.queries=[];Math.random=()=>options.random;
          window.sentMessages=[];const send=chrome.runtime.sendMessage;
          chrome.runtime.sendMessage=async msg=>{sentMessages.push(msg);return send(msg);};
          TriSloga.configure({...fixtureSettings,artist:options.artist},{owner:'-220995299',path:'/tri_sloga_band',name:'Три Слога',origin:'https://vk.ru'});
          TriSloga.state.songTitle=options.title;
          TriSloga.state.audio={id:'-220995299_999',title:'Reserve title',artist:'Another artist'};
          TriSloga.state.audioSelectionVerified=null;
          TriSloga.state.composer={root:editor,editor:editor.querySelector('[contenteditable]'),modern:true};
          document.querySelector('[data-testid=posting_audio_search_audio_input]').oninput=e=>{
            queries.push(e.target.value);rows.replaceChildren();
            const results=e.target.value===options.artist ? options.artistResults : e.target.value==='Три слога' ? options.fallbackResults : options.titleResults;
            for(const [artist,title,id] of results){
              const row=document.createElement('div');row.dataset.testid='posting_audio_audio_track_row';
              if(id)row.dataset.audioId=id;
              row.innerHTML='<div data-testid=music-cell><span data-testid=music-cell-title></span><span data-testid=music-cell-artists></span><span>3:24</span></div><input data-testid=posting_audio_audio_track_selected_icon type=checkbox>';
              row.querySelector('[data-testid=music-cell-title]').textContent=title;
              row.querySelector('[data-testid=music-cell-artists]').textContent=artist;
              rows.append(row);
            }
          };
          done.onclick=()=>{
            const checked=rows.querySelectorAll('input:checked');if(checked.length!==1)throw Error('Select exactly one track');
            const row=checked[0].parentElement;
            const preview=document.createElement('div');preview.dataset.testid='posting_audio_select_audio_selected';
            for(const selector of ['[data-testid=music-cell-title]','[data-testid=music-cell-artists]'])preview.append(row.querySelector(selector).cloneNode(true));
            editor.append(preview);picker.hidden=true;
          };
        }''',{'title':title,'titleResults':title_results,'artistResults':artist_results,'random':random,'artist':artist,'fallbackResults':fallback_results or []})

    def test_matching_document_title_is_preferred_over_random_artist_tracks(self):
        self.music_search_fixture('Wanted',[['Other','Wanted','1_1'],['Три слога','Wanted','1_2'],['Три слога','Wanted (Live)','1_3']],[])
        self.page.evaluate('TriSloga.attachAudio()')
        self.assertEqual(self.page.evaluate('queries'),['Три слога Wanted'])
        self.assertEqual(self.page.evaluate('TriSloga.state.audio.id'),'1_2')

    def test_missing_title_chooses_random_matching_artist_track_and_ignores_reserve(self):
        self.music_search_fixture(None,[],[['Other','Foreign'],['Три слога','First'],['Три слога','Second']])
        self.page.evaluate('TriSloga.attachAudio()')
        self.assertEqual(self.page.evaluate('queries'),['Три слога'])
        self.assertEqual(self.page.evaluate('TriSloga.state.audio.title'),'Second')
        self.assertEqual(self.page.evaluate('TriSloga.audioAttachments(editor).length'),1)

    def test_failed_document_title_retries_artist_only_and_chooses_random_collaboration(self):
        self.music_search_fixture('Wanted',[['Друзья Тимофея','Wanted']],
          [['Other','Foreign'],['Три слога','First'],['Guest, Три слога','Second']])
        self.page.evaluate('TriSloga.attachAudio()')
        self.assertEqual(self.page.evaluate('queries'),['Три слога Wanted','Три слога'])
        self.assertEqual(self.page.evaluate('TriSloga.state.audio.title'),'Second')
        self.assertEqual(self.page.evaluate('TriSloga.state.audio.artist'),'Guest, Три слога')
        self.assertEqual(self.page.evaluate('TriSloga.audioAttachments(editor).length'),1)

    def test_no_artist_match_attaches_random_tri_sloga_track(self):
        self.music_search_fixture(None,[],[['Друзья Тимофея','First'],['Other','Second']],artist='Неверное имя',
                                  fallback_results=[['Три слога','First allowed'],['Три слога','Second allowed']])
        self.page.evaluate('TriSloga.attachAudio()')
        self.assertEqual(self.page.evaluate('queries'),['Неверное имя','Три слога'])
        self.assertEqual(self.page.evaluate('TriSloga.state.audio.title'),'Second allowed')
        self.assertEqual(self.page.evaluate('TriSloga.state.audio.artist'),'Три слога')
        self.assertTrue(self.page.evaluate('sentMessages.some(msg=>msg.type==="artistWarning")'))
        self.assertEqual(self.page.evaluate('TriSloga.audioAttachments(editor).length'),1)
        self.assertEqual(self.page.locator('input[type=checkbox]:checked').count(),1)

    def test_entirely_empty_music_search_stops_without_attaching_a_track(self):
        self.music_search_fixture('',[],[])
        error=self.page.evaluate('async()=>{try{await TriSloga.attachAudio()}catch(e){return e.message}}')
        self.assertIn('песни группы Три слога',error)
        self.assertEqual(self.page.locator('[data-testid=posting_audio_select_audio_selected]').count(),0)
        self.assertIsNone(self.page.evaluate('TriSloga.state.audioSelectionVerified'))

class SettingsBackgroundTests(unittest.TestCase):
    setUpClass=classmethod(test_batch.BatchBackgroundTests.setUpClass.__func__)
    tearDownClass=classmethod(test_batch.BatchBackgroundTests.tearDownClass.__func__)
    setUp=test_batch.BatchBackgroundTests.setUp
    tearDown=test_batch.BatchBackgroundTests.tearDown

    def custom_setup(self):
        self.page.evaluate('''({settings,community})=>{
          window.customSettings=settings;window.customCommunity=community;
          chrome.tabs.query=async()=>[{id:6,url:'https://vk.ru/tri_sloga_band',active:true},{id:7,url:settings.communityUrl,active:false}];
          const execute=chrome.scripting.executeScript;
          chrome.scripting.executeScript=async opts=>opts.func?.name==='resolveCommunity'?[{result:community}]:execute(opts);
        }''',{'settings':CUSTOM,'community':COMMUNITY})

    def test_batch_uses_custom_tab_queue_and_frozen_settings(self):
        self.custom_setup()
        self.page.evaluate('settings=>batchCommand({type:"batchStart",amount:2,intervalSeconds:1,settings},{})',CUSTOM)
        self.page.wait_for_function('calls.some(c=>c.type==="batchStart")')
        self.assertEqual(self.page.evaluate('calls.find(c=>c.type==="tab").id'),7)
        self.assertEqual(self.page.evaluate('calls.find(c=>c.type==="create").url'),'https://vk.ru/wall-123456?postponed=1')
        self.assertEqual(self.page.evaluate('calls.find(c=>c.type==="batchStart").batch.settings'),CUSTOM)
        self.page.evaluate('store.settings=AZVK.defaults;batchLaunch(store.batch.id)')
        self.page.wait_for_function('calls.filter(c=>c.type==="batchStart").length===2')
        self.assertEqual(self.page.evaluate('calls.filter(c=>c.type==="batchStart").at(-1).batch.settings'),CUSTOM)

    def test_settings_save_rejected_during_batch_and_persists_when_idle(self):
        self.page.evaluate('''()=>{chrome.runtime.id='fixture';chrome.runtime.onMessage={addListener:fn=>window.backgroundListener=fn};}''')
        self.page.add_script_tag(path=str(EXT/'background.js'))
        self.page.evaluate('store.batch={enabled:true};store.settings=AZVK.defaults')
        blocked=self.page.evaluate('''settings=>new Promise(resolve=>backgroundListener({type:'settingsSave',settings},{id:'fixture'},resolve))''',CUSTOM)
        self.assertFalse(blocked['ok'])
        self.assertEqual(self.page.evaluate('store.settings.artist'),'Три слога')
        self.page.evaluate('store.batch.enabled=false')
        saved=self.page.evaluate('''settings=>new Promise(resolve=>backgroundListener({type:'settingsSave',settings},{id:'fixture'},resolve))''',CUSTOM)
        self.assertTrue(saved['ok'],saved)
        self.assertEqual(self.page.evaluate('store.settings'),CUSTOM)

if __name__=='__main__': unittest.main()
