"""Offline regression coverage for optional post content and the excluded track."""
import unittest
from pathlib import Path
import test_extension
import test_batch
import test_settings

EXT=Path(__file__).parent/'extension'

class OptionalContentTests(unittest.TestCase):
    setUpClass=classmethod(test_extension.ExtensionTests.setUpClass.__func__)
    tearDownClass=classmethod(test_extension.ExtensionTests.tearDownClass.__func__)
    setUp=test_extension.ExtensionTests.setUp
    tearDown=test_extension.ExtensionTests.tearDown
    content=test_extension.ExtensionTests.content
    workflow_fixture=test_extension.ExtensionTests.workflow_fixture
    scheduled_fixture=test_batch.BatchPageTests.scheduled_fixture
    music_search_fixture=test_settings.SettingsPageTests.music_search_fixture

    def test_disabled_fields_are_optional_but_enabled_fields_still_required(self):
        value={'communityUrl':'https://vk.ru/club123','artist':'','documentUrl':'','noAudio':True,'noText':True}
        self.assertEqual(self.page.evaluate('value=>AZVK.normalizeSettings(value)',value),{**value,'textMode':'document','quoteReference':'','customText':''})
        for flag in ['noAudio','noText']:
            with self.subTest(flag=flag):
                error=self.page.evaluate('value=>{try{AZVK.normalizeSettings(value);return null}catch(e){return e.message}}',{**value,flag:False})
                self.assertTrue(error)

    def test_popup_flags_disable_fields_save_restore_and_allow_empty_document(self):
        self.page.set_content((EXT/'popup.html').read_text(encoding='utf-8'))
        self.page.evaluate('''()=>{window.calls=[];testStorage={};chrome.storage.onChanged={addListener:()=>{}};
          chrome.runtime.sendMessage=async msg=>{calls.push(msg);
            if(msg.type==='settingsSave'){testStorage.settings=msg.settings;return {ok:true,settings:msg.settings};}
            return {ok:true,settings:testStorage.settings};};}''')
        self.page.add_script_tag(path=str(EXT/'popup.js'))
        self.page.wait_for_function('settingsLoaded')
        self.assertEqual(self.page.locator('#communityUrl').input_value(),'')
        self.assertEqual(self.page.locator('#documentUrl').input_value(),'')
        self.assertIn('для прикрепленных треков',self.page.locator('label[for=artist]').inner_text())
        self.assertEqual(self.page.locator('.artist-default').inner_text(),'по умолчанию группа Три слога')
        self.page.locator('#communityUrl').fill('https://vk.ru/club123')
        self.page.locator('#noAudio').check()
        self.page.locator('#noText').check()
        self.assertTrue(self.page.locator('#artist').is_disabled())
        self.assertTrue(self.page.locator('#documentUrl').is_disabled())
        self.page.locator('#saveSettings').click()
        self.assertTrue(self.page.evaluate('testStorage.settings.noAudio && testStorage.settings.noText'))
        self.assertTrue(self.page.locator('#saveSettings').is_enabled())
        self.page.evaluate('settingsLoaded=false;refresh()')
        self.page.wait_for_function('document.getElementById("noText").checked')
        self.page.locator('#noAudio').uncheck()
        self.page.locator('#noText').uncheck()
        self.assertTrue(self.page.locator('#artist').is_enabled())
        self.assertTrue(self.page.locator('#documentUrl').is_enabled())

    def test_scheduled_posts_support_all_audio_and_text_flag_combinations(self):
        for no_audio,no_text in [(False,False),(True,False),(False,True),(True,True)]:
            with self.subTest(noAudio=no_audio,noText=no_text):
                # Each combination uses a fresh offline page and fixture.
                if self.page: self.page.close()
                test_extension.ExtensionTests.setUp(self)
                self.scheduled_fixture()
                self.page.evaluate('''flags=>{
                  testStorage.settings={...fixtureSettings,...flags};
                  if(flags.noText)testStorage.settings.documentUrl='';
                  const send=chrome.runtime.sendMessage;
                  chrome.runtime.sendMessage=async msg=>{
                    if(msg.type==='pendingInspect'){
                      sentMessages.push(msg);return {ok:true,found:savedPosts.some(post=>post.timestamp===msg.date && (msg.verifyDateOnly || post.text.includes(msg.text)))};
                    }
                    return send(msg);
                  };
                }''',{'noAudio':no_audio,'noText':no_text})
                self.page.evaluate('''TriSloga.runBatch({id:'optional',amount:1,completed:0,intervalSeconds:1,queueDate:1798644600000,
                  settings:testStorage.settings,community:{owner:'-220995299',path:'/tri_sloga_band',name:'Три Слога',origin:'https://vk.ru'}})''')
                self.assertEqual(self.page.evaluate('savedPosts.map(post=>post.timestamp)'),[1798731000000])
                self.assertEqual(self.page.evaluate('sentMessages.some(msg=>msg.type==="lyrics")'),not no_text)
                self.assertEqual(self.page.evaluate('savedPosts[0].text===""'),no_text)
                self.assertEqual(self.page.evaluate('beginAttempts[0].audio===null'),no_audio)
                self.assertEqual(self.page.evaluate('sentMessages.find(msg=>msg.type==="pendingInspect").verifyDateOnly'),no_text)
                self.assertFalse(self.page.evaluate('progress[0].unconfirmed'))
                self.assertEqual(self.page.evaluate('TriSloga.state.photo.id'),'-220995299_123')
                self.assertIsNone(self.page.evaluate('window.publishCount'))

    def test_textless_queue_inspection_checks_date_without_text_match(self):
        self.content('<div id=post-220995299_1><span class=post_date>15 окт 2026 в 10:39</span></div>')
        self.page.evaluate("history.replaceState(null,'','/wall-220995299?postponed=1')")
        for date,found in [(1792049940000,True),(1792136340000,False)]:
            response=self.page.evaluate('''date=>new Promise(resolve=>testListeners[0]({type:'inspectPending',verifyDateOnly:true,date,
              batch:{id:'optional',settings:{...fixtureSettings,noText:true,documentUrl:''},community:{owner:'-220995299',path:'/tri_sloga_band',name:'Три Слога',origin:'https://vk.ru'}}},{id:'test-extension'},resolve))''',date)
            self.assertTrue(response['ok'],response)
            self.assertEqual(response['found'],found)

    def test_excluded_track_is_not_selected_for_document_title(self):
        self.music_search_fixture('Не кота бот',[['Три слога','Не кота бот']],
          [['Три слога','Не кота бот'],['Три слога','Allowed']])
        self.page.evaluate('TriSloga.attachAudio()')
        self.assertEqual(self.page.evaluate('queries'),['Три слога Не кота бот','Три слога'])
        self.assertEqual(self.page.evaluate('TriSloga.state.audio.title'),'Allowed')

    def test_excluded_track_and_versions_are_removed_from_random_selection(self):
        self.music_search_fixture(None,[],[['Три слога','Allowed'],['Guest, ТРИ СЛОГА','НЕ КОТА БОТ (Live)']])
        self.page.evaluate('TriSloga.attachAudio()')
        self.assertEqual(self.page.evaluate('TriSloga.state.audio.title'),'Allowed')

    def test_excluded_track_is_skipped_when_taking_first_search_result(self):
        self.music_search_fixture(None,[],[['Три слога','Не кота бот'],['Other','First allowed'],['Other','Second']])
        self.page.evaluate('TriSloga.attachAudio()')
        self.assertEqual(self.page.evaluate('TriSloga.state.audio.title'),'First allowed')
        self.assertEqual(self.page.evaluate('TriSloga.audioAttachments(editor).length'),1)

if __name__=='__main__': unittest.main()
