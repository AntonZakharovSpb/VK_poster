"""Browser regression tests; no network and no real VK publishing."""
import json
import os
import unittest
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).parent
EXT = ROOT / 'extension'


class ExtensionTests(unittest.TestCase):
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
        self.page.route('**/*', lambda route: route.fulfill(body='<html><body></body></html>', content_type='text/html'))
        self.page.goto('https://vk.ru/tri_sloga_band')
        self.page.evaluate('''() => {
          window.testStorage = {};
          window.testListeners = [];
          window.chrome = {runtime: {id:'test-extension', onMessage:{addListener(fn){testListeners.push(fn)}},
            sendMessage:async()=>({ok:true})}, storage:{local:{
              async get(keys){if(typeof keys==='string') return {[keys]:testStorage[keys]};
                if(!Array.isArray(keys)) return {...keys,...testStorage};
                return Object.fromEntries(keys.map(k=>[k,testStorage[k]]));},
              async set(data){Object.assign(testStorage,data)},
              async remove(keys){for(const k of Array.isArray(keys)?keys:[keys]) delete testStorage[k]}
            }}};
        }''')

    def tearDown(self):
        self.page.close()

    def content(self, html):
        self.page.set_content(html)
        self.page.add_script_tag(path=str(EXT/'content.js'))

    def test_only_community_photo_tab_media_is_selected(self):
        self.content('''
          <a href="/photo-220995299_123"><img width="50" height="50" src="https://sun1.vkuserphoto.ru/community.jpg"></a>
          <a href="/photo99_124"><img width="50" height="50" src="https://sun1.vkuserphoto.ru/personal.jpg"></a>
          <div data-testid="post"><a href="/photo-220995299_125"><img width="50" height="50" src="https://sun1.vkuserphoto.ru/wall.jpg"></a></div>
        ''')
        result = self.page.evaluate('TriSloga.photoCandidates()')
        self.assertEqual([p['id'] for p in result], ['-220995299_123'])

    def test_document_song_headings_and_blank_line_verses(self):
        self.content('<div></div>')
        html = '<p>Ignore preface</p><h1>Первая песня</h1><p>Строка 1</p><p>Строка 2</p><p>&nbsp;</p><p>Другой куплет<br>Ещё строка</p><h1>Вторая песня</h1><p>Весь текст без пустых строк</p><h1>Пустая</h1>'
        result = self.page.evaluate('(html)=>TriSloga.parseSongs(html)', html)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]['parts'], ['Строка 1\nСтрока 2','Другой куплет\nЕщё строка'])
        first=self.page.evaluate('(html)=>TriSloga.chooseSongExcerpt(html,()=>0)',html)
        self.assertEqual(first, {'title':'Первая песня','text':'Строка 1\nСтрока 2\n\nТри слога - Первая песня'})
        second=self.page.evaluate('(html)=>TriSloga.chooseSongExcerpt(html,()=>0.99)',html)
        self.assertEqual(second['text'],'Весь текст без пустых строк\n\nТри слога - Вторая песня')

    def test_song_matching_handles_versions_typos_and_unrelated_tracks(self):
        self.content('<div></div>')
        result=self.page.evaluate('''()=>{
          const audios=[{id:'1',title:'Другая песня'},{id:'2',title:'Много зла альбомная версия'}];
          return [TriSloga.matchingCommunityAudio(audios,'Много зла!')?.id,
            TriSloga.matchingCommunityAudio(audios,'Совершенно иной заголовок'),
            TriSloga.songSimilarity('Заснежье','Заснежие')>0];
        }''')
        self.assertEqual(result,['2',None,True])

    def test_document_without_song_headings_stops_instead_of_posting_login_page(self):
        self.content('<div></div>')
        result=self.page.evaluate('''()=>{try{TriSloga.chooseSongExcerpt('<p>Sign in</p>');return false}catch{return true}}''')
        self.assertTrue(result)

    def test_comment_box_is_not_a_post_editor(self):
        self.content('''
          <div data-testid="wall_comments_layout_root">
            <div role="textbox" contenteditable="true" aria-label="Написать комментарий">Existing comment</div>
            <button><span style="position:absolute;left:-10000px">Фотография</span></button>
            <button>Опубликовать</button>
          </div>''')
        self.assertEqual(self.page.evaluate('TriSloga.composerCandidates().length'), 0)

    def test_post_editor_is_scoped_to_publish_container(self):
        self.content('''
          <div contenteditable="true" aria-label="Написать комментарий">existing comment</div>
          <div role="dialog"><div role="textbox" contenteditable="true" aria-label="Текст публикации"></div><button>Опубликовать</button></div>
        ''')
        self.assertEqual(self.page.evaluate('TriSloga.composerCandidates().length'), 1)
        self.assertEqual(self.page.evaluate('TriSloga.composerCandidates()[0].editor.getAttribute("aria-label")'), 'Текст публикации')

    def test_creation_menu_opens_on_mouse_press_and_accepts_plain_span(self):
        self.content('''
          <button data-testid="group_publish_create_button" onmousedown="document.getElementById('menu').hidden=false">Создать</button>
          <div id="menu" role="dialog" data-testid="dropdownactionsheet" hidden>
            <div onclick="document.getElementById('menu').hidden=true;document.getElementById('editor').hidden=false"><span><span>Пост</span></span></div>
            <div><span>Пост в канал</span></div>
          </div>
          <div id="editor" role="dialog" data-testid="posting_modal_box" hidden>
            <div contenteditable="true" role="textbox" aria-label="Напишите что-нибудь..."></div><button>Далее</button>
          </div>''')
        self.assertTrue(self.page.evaluate('async()=>{const composer=await TriSloga.openComposer(); return composer.modern}'))
        self.assertTrue(self.page.locator('#editor').is_visible())

    def test_create_button_replaced_after_scroll_is_reacquired(self):
        self.content('''
          <button data-testid="group_publish_create_button" onclick="document.getElementById('editor').hidden=false">Создать</button>
          <div id="editor" role="dialog" data-testid="posting_modal_box" hidden>
            <div contenteditable="true" role="textbox"></div><button>Далее</button>
          </div>''')
        self.page.evaluate('''()=>{
          const create=document.querySelector('[data-testid="group_publish_create_button"]');
          create.scrollIntoView=function(){window.replaced=true;this.replaceWith(this.cloneNode(true))};
        }''')
        self.assertTrue(self.page.evaluate('async()=>{await TriSloga.openComposer();return window.replaced}'))

    def test_create_menu_can_depend_on_hover_before_click(self):
        self.content('''
          <button data-testid="group_publish_create_button" onmouseenter="window.hovered=true"
            onclick="if(window.hovered) document.getElementById('editor').hidden=false">Создать</button>
          <div id="editor" role="dialog" data-testid="posting_modal_box" hidden>
            <div contenteditable="true" role="textbox"></div><button>Далее</button>
          </div>''')
        self.assertTrue(self.page.evaluate('async()=>{await TriSloga.openComposer();return window.hovered}'))

    def test_modern_music_picker_uses_inner_dialog_checkbox_and_done(self):
        self.content('''
          <div id="editor" role="dialog" data-testid="posting_modal_box">
            <div contenteditable="true" role="textbox"></div>
            <button onclick="document.getElementById('wrapper').hidden=false">Музыка</button>
          </div>
          <div class="box_layout" id="wrapper" hidden>
            <div role="dialog" id="picker">
              <input data-testid="posting_audio_search_audio_input" placeholder="Поиск музыки">
              <div data-testid="posting_audio_audio_track_row">
                <div data-testid="music-cell"><span data-testid="music-cell-title">Заснежье</span>
                  <span data-testid="music-cell-artists">Три слога</span><span>4:04</span></div>
                <input type="checkbox" data-testid="posting_audio_audio_track_selected_icon">
              </div>
              <button data-testid="posting_audio_attach_audio_button" onclick="
                if(document.querySelector('input[type=checkbox]').checked){
                  document.getElementById('editor').insertAdjacentHTML('beforeend',
                    '<div data-testid=posting_audio_select_audio_selected><span data-testid=posting_audio_select_audio_selected_title>Заснежье</span><span>Три слога</span><button data-testid=posting_audio_unselect_audio>Удалить</button></div>');
                  document.getElementById('wrapper').hidden=true;}">Готово</button>
            </div>
          </div>''')
        self.page.evaluate('''()=>{
          TriSloga.state.audio={id:'-220995299_456239152',title:'Заснежье',artist:'Три слога',duration:'4:04'};
          TriSloga.state.composer={editor:document.querySelector('[contenteditable]'),root:document.getElementById('editor'),modern:true};
        }''')
        self.page.evaluate('async()=>{await TriSloga.attachAudio()}')
        self.assertFalse(self.page.locator('#wrapper').is_visible())
        self.assertTrue(self.page.locator('input[type="checkbox"]').is_checked())
        self.assertIn('Песня сообщества прикреплена',self.page.evaluate('TriSloga.state.logs.at(-1)'))

    def test_album_version_falls_back_to_first_search_result_and_verifies_attachment(self):
        self.content('''<div id="editor" data-testid="posting_modal_box" role="dialog">
          <div contenteditable="true"></div><button onclick="picker.hidden=false">Музыка</button></div>
          <div id="picker" role="dialog" hidden>
          <input data-testid="posting_audio_search_audio_input" placeholder="Поиск музыки"
            oninput="if(!this.value.includes('альбомная')) rows.hidden=false">
          <div id="rows" hidden>
          <div data-testid="posting_audio_audio_track_row" data-audio-id="-220995299_22">
            <span data-testid="music-cell-title">Много зла</span><span data-testid="music-cell-artists">Три слога</span><span>3:40</span><input type="checkbox">
          </div>
          <div data-testid="posting_audio_audio_track_row" data-audio-id="-220995299_23">
            <span data-testid="music-cell-title">Много зла (Single)</span><span data-testid="music-cell-artists">Три слога</span><span>3:45</span><input type="checkbox">
          </div></div>
          <button onclick="const row=document.querySelector('input[type=checkbox]:checked').parentElement;
            editor.insertAdjacentHTML('beforeend','<div data-testid=posting_audio_select_audio_selected><span>'+row.querySelector('[data-testid=music-cell-title]').textContent+'</span><span>Три слога</span></div>');picker.hidden=true;">Готово</button></div>''')
        self.page.evaluate('''()=>{
          TriSloga.state.audio={id:'-220995299_11',title:'Много зла альбомная версия',artist:'Три слога',duration:'4:04'};
          TriSloga.state.composer={editor:document.querySelector('[contenteditable]'),root:document.getElementById('editor'),modern:true};
        }''')
        self.page.evaluate('TriSloga.attachAudio()')
        self.assertEqual(self.page.evaluate('TriSloga.state.audio.id'), '-220995299_22')
        self.assertEqual(self.page.evaluate('TriSloga.state.sourceAudio.id'), '-220995299_11')
        self.assertEqual(self.page.evaluate('TriSloga.audioAttachments(document.getElementById("editor")).length'),1)
        self.assertEqual(self.page.locator('input[type=checkbox]:checked').count(),1)
        self.assertEqual(self.page.locator('[data-testid=posting_audio_search_audio_input]').input_value(),'Три слога Много зла')

    def test_duplicate_music_matches_choose_first_without_error(self):
        self.test_modern_music_picker_uses_inner_dialog_checkbox_and_done()
        # A fresh picker containing duplicate metadata must select one row only.
        self.page.evaluate('''()=>{
          document.querySelector('[data-testid=posting_audio_select_audio_selected]').remove();
          const row=document.querySelector('[data-testid=posting_audio_audio_track_row]');
          row.querySelector('input').checked=false;
          row.after(row.cloneNode(true));
        }''')
        self.page.evaluate('TriSloga.attachAudio()')
        self.assertEqual(self.page.locator('input[type=checkbox]:checked').count(),1)

    def test_final_song_summary_requires_verified_picker_selection(self):
        self.content('''<div id="root"><div data-testid="posting_audio_select_audio_selected">
          <span data-testid="posting_audio_select_audio_selected_title">Мастер Тай Чи</span><span>Три слога</span>
          <button data-testid="posting_audio_unselect_audio">Удалить</button>
          </div></div>''')
        result=self.page.evaluate('''()=>{
          const root=document.getElementById('root');
          TriSloga.state.audio={id:'-220995299_456239065',title:'Мастер Тай Чи',artist:'Три слога',duration:'4:05'};
          const unverified=TriSloga.audioAttachments(root).length;
          TriSloga.state.audioSelectionVerified=TriSloga.state.audio.id;
          const verified=TriSloga.audioAttachments(root).length;
          root.querySelector('[data-testid="posting_audio_select_audio_selected_title"]').textContent='Different song';
          return [unverified,verified,TriSloga.audioAttachments(root).length];
        }''')
        self.assertEqual(result,[0,1,0])

    def native_photo_fixture(self, change):
        self.content('''<div id="editor" role="dialog" data-testid="posting_modal_box">
          <div contenteditable="true"></div><button data-testid="posting_base_screen_next">Далее</button>
          <button data-testid="posting_base_screen_select_from_vk" onclick="photoPicker.hidden=false">Из VK</button>
          </div><div id="photoPicker" role="dialog" hidden>
          <button data-photo-id="-220995299_1">Выбрать фото</button></div>''')
        self.page.evaluate('''change=>{
          TriSloga.state.photo={id:'-220995299_1',image:'https://sun1.vkuserphoto.ru/tiny-thumbnail.jpg'};
          TriSloga.state.composer={root:document.getElementById('editor'),editor:document.querySelector('[contenteditable]'),modern:true};
          chrome.runtime.sendMessage=async msg=>{if(msg.type==='image') throw Error('Must not download');return {ok:true}};
          document.querySelector('[data-photo-id]').onclick=()=>{
            new Function(change)();document.getElementById('photoPicker').hidden=true;
          };
        }''',change)

    def test_native_photo_follows_replaced_editor_without_old_modal_testid(self):
        self.native_photo_fixture("document.getElementById('editor').outerHTML='<div id=replacement role=dialog><button data-testid=posting_base_screen_next>Далее</button><div class=page_preview_photo data-photo-id=-220995299_1>native photo</div></div>'")
        self.page.evaluate('TriSloga.attachPhoto()')
        self.assertTrue(self.page.evaluate('TriSloga.state.photoAttached'))
        self.assertEqual(self.page.evaluate('TriSloga.currentComposerRoot().id'),'replacement')
        self.assertFalse(self.page.evaluate('TriSloga.state.composer.root.isConnected'))
        self.assertEqual(self.page.evaluate('TriSloga.state.photoSelectionVerified'),'-220995299_1')

    def test_native_photo_reports_editor_disappearance(self):
        self.native_photo_fixture("document.getElementById('editor').remove()")
        error=self.page.evaluate('async()=>{try{await TriSloga.attachPhoto();return ""}catch(e){return e.message}}')
        self.assertIn('Редактор VK исчез',error)
        self.assertFalse(self.page.evaluate('!!TriSloga.state.photoAttached'))

    def test_native_photo_reports_vk_error_reason(self):
        self.native_photo_fixture("document.getElementById('editor').insertAdjacentHTML('beforeend','<div role=alert>Не удалось прикрепить фотографию</div>')")
        error=self.page.evaluate('async()=>{try{await TriSloga.attachPhoto();return ""}catch(e){return e.message}}')
        self.assertIn('VK не прикрепил фото: Не удалось прикрепить фотографию',error)
        self.assertFalse(self.page.evaluate('!!TriSloga.state.photoAttached'))

    def test_native_photo_opens_community_album_checks_selection_and_done(self):
        self.native_photo_fixture('')
        self.page.evaluate('''()=>{
          TriSloga.state.photo.albumUrl='https://vk.ru/album-220995299_7';
          const picker=document.getElementById('photoPicker');
          picker.innerHTML='<a id=album href=/album-220995299_7>Альбом</a>';
          document.getElementById('album').onclick=e=>{
            e.preventDefault();
            picker.innerHTML='<label data-photo-id=-220995299_1>Фото<input type=checkbox></label><button id=done>Готово</button>';
            document.getElementById('done').onclick=()=>{
              if(!picker.querySelector('input').checked) throw Error('No photo selected');
              document.getElementById('editor').insertAdjacentHTML('beforeend','<div class=page_preview_photo data-photo-id=-220995299_1>native photo</div>');
              picker.hidden=true;
            };
          };
        }''')
        self.page.evaluate('TriSloga.attachPhoto()')
        self.assertTrue(self.page.evaluate('TriSloga.state.photoAttached'))
        self.assertTrue(self.page.locator('#photoPicker input').is_checked())
        self.assertEqual(self.page.evaluate('TriSloga.state.photoSelectionVerified'),'-220995299_1')

    def test_native_photo_refuses_personal_photos_without_upload_fallback(self):
        self.native_photo_fixture('')
        self.page.evaluate('document.querySelector("[data-photo-id]").dataset.photoId="12345_1"')
        error=self.page.evaluate('async()=>{try{await TriSloga.attachPhoto();return ""}catch(e){return e.message}}')
        self.assertIn('не найдены альбомы сообщества',error)
        self.assertFalse(self.page.evaluate('!!TriSloga.state.photoAttached'))

    def test_native_photo_verification_rejects_wrong_explicit_photo_id(self):
        self.content('<div id=root><div class=page_preview_photo data-photo-id=-220995299_2>Wrong photo</div></div>')
        result=self.page.evaluate('''()=>{
          TriSloga.state.photo={id:'-220995299_1'};
          TriSloga.state.photoAttached=true;TriSloga.state.photoSelectionVerified='-220995299_1';
          return TriSloga.photoAttachments(document.getElementById('root')).length;
        }''')
        self.assertEqual(result,0)

    def test_final_photo_preview_requires_verified_native_selection(self):
        self.content('''<div id="root"><div data-testid="posting_preview_attachment_item">
          <img width="100" height="100" src="https://sun1.vkuserphoto.ru/selected.jpg"></div></div>''')
        result=self.page.evaluate('''()=>{
          const root=document.getElementById('root');
          const before=TriSloga.photoAttachments(root).length;
          TriSloga.state.photo={id:'-220995299_1'};
          TriSloga.state.photoAttached=true;
          TriSloga.state.photoSelectionVerified=TriSloga.state.photo.id;
          const after=TriSloga.photoAttachments(root).length;
          root.querySelector('[data-testid="posting_preview_attachment_item"]').insertAdjacentHTML('beforeend','<video></video>');
          return [before,after,TriSloga.photoAttachments(root).length];
        }''')
        self.assertEqual(result,[0,1,0])

    def test_modern_group_target_does_not_mistake_coauthors_for_author(self):
        self.content('''<div id="root" role="dialog" data-testid="posting_modal_box">
          <div data-testid="posting_coowners_cell">Пригласить соавторов</div>
          <button data-testid="posting_submit_button">Опубликовать</button></div>''')
        result=self.page.evaluate('''()=>{
          const root=document.getElementById('root'); TriSloga.state.composer={modern:true};
          const unknown=TriSloga.authorVerified(root);
          TriSloga.state.communityContext=true;
          const community=TriSloga.authorVerified(root);
          root.insertAdjacentHTML('beforeend','<div class="post_from_group">Personal profile</div>');
          return [unknown,community,TriSloga.authorVerified(root)];
        }''')
        self.assertEqual(result,[False,True,False])

    def test_music_metadata_match_requires_artist_duration_and_id_when_present(self):
        self.content('''<div id="row" data-testid="music-cell"><span data-testid="music-cell-title">Заснежье</span>
          <span data-testid="music-cell-artists">Три слога</span><span>4:04</span></div>''')
        result=self.page.evaluate('''()=>{
          const row=document.getElementById('row');
          const audio={id:'-220995299_456239152',title:'Заснежье',artist:'Три слога',duration:'4:04'};
          const correct=TriSloga.matchesAudio(row,audio);
          const wrongDuration=TriSloga.matchesAudio(row,{...audio,duration:'3:59'});
          const wrongArtist=TriSloga.matchesAudio(row,{...audio,artist:'Another artist'});
          row.dataset.audioId='999_1';
          return [correct,wrongDuration,wrongArtist,TriSloga.matchesAudio(row,audio)];
        }''')
        self.assertEqual(result,[True,False,False,False])

    def test_manual_create_fallback_continues_without_restarting_job(self):
        self.content('''
          <button data-testid="group_publish_create_button">Создать</button>
          <div id="menu" role="dialog" data-testid="dropdownactionsheet" hidden>
            <div onclick="document.getElementById('menu').hidden=true;document.getElementById('editor').hidden=false"><span>Пост</span></div>
          </div>
          <div id="editor" role="dialog" data-testid="posting_modal_box" hidden>
            <div contenteditable="true" role="textbox"></div><button>Далее</button>
          </div>''')
        self.page.evaluate('()=>{window.openOperation=TriSloga.openComposer()}')
        self.page.wait_for_function('TriSloga.state.logs.some(text=>text.includes("Нажмите «Создать»"))',timeout=10000)
        self.page.evaluate('document.getElementById("menu").hidden=false')
        self.assertTrue(self.page.evaluate('async()=>{await openOperation;return true}'))

    def test_saved_vk_snapshot_contains_real_community_audio(self):
        snapshot = Path(os.environ['LOCALAPPDATA'])/'TriSlogaPublisher/last-error.html'
        if not snapshot.exists():
            self.skipTest('No local VK snapshot')
        from html.parser import HTMLParser
        # Preserve relevant real audio markup only; never execute saved VK scripts.
        class Rows(HTMLParser):
            def __init__(self):
                super().__init__(); self.ids=[]
            def handle_starttag(self, tag, attrs):
                a=dict(attrs)
                if a.get('data-audio-id', '').startswith('-220995299_'):
                    self.ids.append(a['data-audio-id'])
        rows=Rows(); rows.feed(snapshot.read_text(encoding='utf-8'))
        self.assertGreater(len(rows.ids), 0)
        html=''.join(f'<div data-audio-id="{ident}"><span data-testid="MusicTrackRow_Title">Song</span></div>' for ident in rows.ids)
        self.content(html)
        result=self.page.evaluate('TriSloga.audioCandidates()')
        self.assertEqual({r['id'] for r in result}, set(rows.ids))

    def test_background_locks_and_uncertain_publish_do_not_retry(self):
        self.page.add_script_tag(path=str(EXT/'background.js'))
        result = self.page.evaluate('''async () => {
          const sender={id:'test-extension',url:location.href,tab:{id:7,url:location.href}};
          const send=message=>new Promise(resolve=>testListeners[0](message,sender,resolve));
          const claims=await Promise.all([send({type:'claim'}),send({type:'claim'})]);
          const jobId=claims.find(r=>r.ok).jobId;
          const start=await send({type:'beginPublish',jobId,photo:'-220995299_1',audio:'-220995299_2'});
          await send({type:'release',jobId});
          const retry=await send({type:'claim'});
          delete testStorage.publicationAttempt;
          const reset=await send({type:'claim'});
          return {successfulClaims:claims.filter(r=>r.ok).length,start:start.ok,retry:retry.ok,reset:reset.ok};
        }''')
        self.assertEqual(result, {'successfulClaims':1,'start':True,'retry':False,'reset':True})

    def test_background_rejects_photo_download_requests_without_fetching(self):
        self.page.add_script_tag(path=str(EXT/'background.js'))
        result = self.page.evaluate('''async()=>{
          window.fetch=()=>{throw Error('Must not download a photo')};
          return new Promise(resolve=>testListeners[0]({type:'image',url:'https://sun1.vkuserphoto.ru/photo.jpg'},
            {id:chrome.runtime.id,url:location.href,tab:{id:7,url:location.href}},resolve));
        }''')
        self.assertFalse(result['ok'])
        self.assertIn('Неизвестная команда',result['error'])

    def test_manifest_references_packaged_files(self):
        manifest=json.loads((EXT/'manifest.json').read_text(encoding='utf-8'))
        self.assertEqual(manifest['manifest_version'],3)
        for file in (manifest['background']['service_worker'],manifest['action']['default_popup'], 'content.js', 'popup.js', 'popup.css'):
            self.assertTrue((EXT/file).is_file(), file)

    def test_popup_only_sets_interval_and_enables_schedule(self):
        self.page.set_content((EXT/'popup.html').read_text(encoding='utf-8'))
        self.page.add_style_tag(path=str(EXT/'popup.css'))
        self.page.evaluate("""() => {
          window.calls=[];
          chrome.storage.onChanged={addListener:()=>{}};
          chrome.runtime.sendMessage=async msg=>{
            calls.push(msg);
            return {ok:true,schedule:{enabled:msg.type==='scheduleSet',intervalHours:msg.intervalHours||6,nextRunAt:Date.now()+3600000}};
          };
        }""")
        self.page.add_script_tag(path=str(EXT/'popup.js'))
        self.page.locator('#interval').fill('3.5')
        self.page.locator('#enable').click()
        self.page.wait_for_function("document.getElementById('status').textContent.includes('Следующая попытка')")
        calls=self.page.evaluate('calls')
        self.assertEqual(calls[-1], {'type':'scheduleSet','intervalHours':3.5})
        self.assertEqual(self.page.locator('input').count(),1)
        self.page.locator('#disable').click()
        self.page.wait_for_function("calls.some(c=>c.type==='scheduleStop')")

    def test_live_album_layout_with_overlay_link_uses_parent_image(self):
        self.page.set_content('''<div class="photos_row" data-id="-220995299_457239019"
          style="background-image:url(https://sun9-26.vkuserphoto.ru/community.jpg);width:185px;height:127px">
          <a href="/photo-220995299_457239019"></a></div>''')
        self.page.evaluate('''()=>{
          window.tabCalls=[];
          chrome.tabs={create:async opts=>{tabCalls.push(opts);return {id:12}},
            get:async()=>({status:'complete'}),remove:async id=>tabCalls.push({closed:id})};
          chrome.scripting={executeScript:async opts=>[{result:await opts.func()}]};
        }''')
        self.page.add_script_tag(path=str(EXT/'background.js'))
        result=self.page.evaluate('''async()=>{
          const sender={id:'test-extension',url:location.href,tab:{id:7,windowId:3,url:location.href}};
          const response=await new Promise(resolve=>testListeners[0]({type:'album',url:'https://vk.ru/album-220995299_293799855'},sender,resolve));
          return {response,calls:tabCalls};
        }''')
        self.assertTrue(result['response']['ok'])
        self.assertEqual(result['response']['photos'][0]['id'],'-220995299_457239019')
        self.assertEqual(result['response']['photos'][0]['image'],'https://sun9-26.vkuserphoto.ru/community.jpg')
        self.assertEqual(result['calls'][0]['active'],False)
        self.assertEqual(result['calls'][0]['windowId'],3)
        self.assertEqual(result['calls'][-1],{'closed':12})

    def test_complete_workflow_publishes_once_and_preserves_comments(self):
        self.content('''
          <a id="top_profile_link" href="/me">Profile</a>
          <h1 data-testid="group-name">Три Слога</h1><button data-testid="group_manage_menu_manage">Управление</button>
          <button data-testid="group_tab_photos">Фото</button>
          <button data-testid="group_tab_audios">Музыка</button>
          <button data-testid="group_tab_wall">Посты</button>
          <a href="/photo-220995299_123"><img width="50" height="50" src="https://sun1.vkuserphoto.ru/community.jpg"></a>
          <div data-audio-id="-220995299_456"><span data-testid="MusicTrackRow_Title">Song</span><span data-testid="MusicTrackRow_Authors">Три Слога</span></div>
          <div contenteditable="true" role="textbox" aria-label="Написать комментарий">untouched comment</div>
          <section data-testid="group_publish_block"><button data-testid="group_publish_create_button" onclick="document.getElementById('editor').hidden=false">Создать</button></section>
          <div id="editor" role="dialog" data-testid="posting_modal_box" hidden>
            <div data-testid="posting_coowners_cell">Пригласить соавторов</div>
            <div role="textbox" contenteditable="true" aria-label="Текст публикации"></div>
            <button data-testid="posting_base_screen_select_from_vk" onclick="document.getElementById('photoPicker').hidden=false">Из VK</button>
            <button onclick="document.getElementById('picker').hidden=false"><span style="position:absolute;left:-10000px">Музыка</span></button>
            <button data-testid="posting_base_screen_next" onclick="window.nextCount=(window.nextCount||0)+1;document.getElementById('publish').hidden=false;
              document.querySelector('.page_preview_photo').outerHTML='<div data-testid=posting_preview_attachment_item><img width=100 height=100 src=https://sun1.vkuserphoto.ru/uploaded.jpg></div>';this.remove()">Далее</button>
            <button id="publish" data-testid="posting_submit_button" hidden onclick="window.publishCount=(window.publishCount||0)+1;document.getElementById('post').textContent=this.parentElement.querySelector('[contenteditable]').innerText;this.parentElement.hidden=true">Опубликовать</button>
          </div>
          <div id="photoPicker" role="dialog" hidden>
            <button data-photo-id="-220995299_123" onclick="document.getElementById('editor').insertAdjacentHTML('beforeend','<div class=page_preview_photo data-photo-id=-220995299_123>photo attached</div>');this.parentElement.hidden=true">Фото из альбома</button>
          </div>
          <div id="picker" role="dialog" hidden>
            <div data-audio-id="-220995299_456"><button onclick="document.getElementById('editor').insertAdjacentHTML('beforeend',
              '<div data-testid=posting_audio_select_audio_selected><span data-testid=posting_audio_select_audio_selected_title>Song</span><span>Три Слога</span><button data-testid=posting_audio_unselect_audio>Удалить</button></div>');document.getElementById('picker').hidden=true">Добавить</button></div>
          </div>
          <article id="post" data-testid="post"></article>
        ''')
        self.page.evaluate('''() => {window.sentMessages=[];chrome.runtime.sendMessage=async msg=>{
          sentMessages.push(msg);
          if(msg.type==='claim') return {ok:true,jobId:'fixture'};
          if(msg.type==='lyrics') return {ok:true,html:'<h1>Song</h1><p>Первая строка песни.</p><p>Вторая строка песни.</p>'};
          if(msg.type==='image') return {ok:true,base64:btoa('fake fixture bytes'),mime:'image/jpeg'};
          return {ok:true};
        }}''')
        self.page.evaluate('''async()=>{await TriSloga.run({automatic:true,scheduleRunId:'scheduled-fixture'})}''')
        self.assertEqual(self.page.evaluate('window.publishCount'),1)
        self.assertFalse(self.page.evaluate('sentMessages.some(msg=>msg.type==="image")'))
        self.assertEqual(self.page.locator('input[type=file]').count(),0)
        posted=self.page.locator('#post').text_content()
        self.assertRegex(posted,r'^Первая строка песни\.\nВторая строка песни\.\n{2,3}Три слога - Song$')
        self.assertEqual(self.page.evaluate('window.nextCount'),1)
        self.assertEqual(self.page.get_by_role('textbox',name='Написать комментарий').inner_text(),'untouched comment')
        logs=self.page.evaluate('TriSloga.state.logs')
        self.assertIn('Пост опубликован',logs[-1])
        self.assertEqual(self.page.locator('#tri-sloga-extension-panel').count(),0)
        self.assertEqual(self.page.evaluate('sentMessages.find(m=>m.type==="scheduleResult")'),
                         {'type':'scheduleResult','runId':'scheduled-fixture','success':True})

    def test_scheduled_failure_reports_result_and_releases_job(self):
        self.content('<div>VK login required</div>')
        self.page.evaluate('''()=>{
          window.sentMessages=[];
          chrome.runtime.sendMessage=async msg=>{sentMessages.push(msg);return {ok:true,jobId:'fixture'}};
        }''')
        self.page.evaluate('TriSloga.run({automatic:true,scheduleRunId:"failed-fixture"})')
        result=self.page.evaluate('sentMessages.find(m=>m.type==="scheduleResult")')
        self.assertFalse(result['success'])
        self.assertIn('Войдите в VK', result['error'])
        self.assertTrue(self.page.evaluate('sentMessages.some(m=>m.type==="release")'))
        self.assertTrue(self.page.locator('#tri-sloga-extension-panel').is_visible())
        self.assertIn('Войдите в VK', self.page.locator('#tri-sloga-extension-panel').evaluate('el=>el.shadowRoot.querySelector("pre").textContent'))

    def test_popup_fixed_button_retries_failure_and_hides_after_retry(self):
        self.page.set_content((EXT/'popup.html').read_text(encoding='utf-8'))
        self.page.evaluate('''()=>{
          window.calls=[];
          chrome.storage.onChanged={addListener:()=>{}};
          chrome.runtime.sendMessage=async msg=>{
            calls.push(msg);
            return {ok:true,schedule:{enabled:true,intervalHours:3,nextRunAt:msg.type==='scheduleRetry'?Date.now()+10800000:null},
              scheduleStatus:msg.type==='scheduleRetry'?{running:true}:{needsFix:true,error:'VK не загрузился'}};
          };
        }''')
        self.page.add_script_tag(path=str(EXT/'popup.js'))
        self.page.locator('#fixed').wait_for(state='visible')
        self.assertIn('VK не загрузился', self.page.locator('#status').inner_text())
        self.page.locator('#fixed').click()
        self.page.locator('#fixed').wait_for(state='hidden')
        self.assertEqual(self.page.evaluate('calls.at(-1)'), {'type':'scheduleRetry','confirmNoPost':False})

    def test_stale_stop_message_does_not_cancel_new_scheduled_run(self):
        self.content('<div></div>')
        result = self.page.evaluate('''()=>{
          TriSloga.state.scheduleRunId='current'; TriSloga.state.stopped=false;
          testListeners[0]({type:'stop',scheduleRunId:'old'}, {id:chrome.runtime.id}, ()=>{});
          const staleStopped=TriSloga.state.stopped;
          testListeners[0]({type:'stop',scheduleRunId:'current'}, {id:chrome.runtime.id}, ()=>{});
          return {staleStopped,currentStopped:TriSloga.state.stopped};
        }''')
        self.assertEqual(result, {'staleStopped':False,'currentStopped':True})


if __name__=='__main__':
    unittest.main()
