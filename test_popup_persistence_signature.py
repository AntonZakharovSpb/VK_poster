"""Offline popup lifecycle, default artist and optional signature coverage."""
import re
import unittest
from pathlib import Path
import test_batch
import test_extension
import test_settings
import test_text_modes

EXT=Path(__file__).parent/'extension'

class LinkPersistenceTests(unittest.TestCase):
    setUpClass=classmethod(test_batch.BatchBackgroundTests.setUpClass.__func__)
    tearDownClass=classmethod(test_batch.BatchBackgroundTests.tearDownClass.__func__)
    tearDown=test_batch.BatchBackgroundTests.tearDown

    def setUp(self):
        test_batch.BatchBackgroundTests.setUp(self)
        self.page.evaluate('''()=>{chrome.runtime.id='fixture';chrome.runtime.onMessage={addListener:fn=>window.backgroundListener=fn};
          const get=chrome.storage.local.get;chrome.storage.local.get=async keys=>{await new Promise(r=>setTimeout(r,50));return get(keys);};
          store.settings={...AZVK.defaults};}''')
        self.page.add_script_tag(path=str(EXT/'background.js'))

    def open_popup(self):
        html=re.sub(r'<script\b[^>]*>[\s\S]*?</script>','',(EXT/'popup.html').read_text(encoding='utf-8'))
        self.page.evaluate('''({html,script})=>{
          const frame=document.createElement('iframe');frame.id='popupFrame';frame.name='popup';frame.style='width:420px;height:900px';
          frame.onload=()=>{
            const win=frame.contentWindow;win.AZVK=AZVK;
            win.chrome={runtime:{sendMessage:msg=>new Promise(resolve=>backgroundListener(msg,{id:'fixture'},resolve))},
              storage:{onChanged:{addListener:()=>{}}}};
            const tag=win.document.createElement('script');tag.textContent=script;win.document.body.append(tag);
          };frame.srcdoc=html;document.body.append(frame);
        }''',{'html':html,'script':(EXT/'popup.js').read_text(encoding='utf-8')})
        self.page.wait_for_function('document.getElementById("popupFrame")?.contentWindow?.document.getElementById("version")?.textContent.startsWith("v")')
        frame=self.page.frame(name='popup')
        frame.wait_for_function('settingsLoaded')
        return frame

    def test_pasted_links_survive_immediate_popup_close_without_save_button(self):
        frame=self.open_popup()
        frame.locator('#communityUrl').fill('https://vk.ru/new_group')
        self.page.evaluate('popupFrame.remove()')
        self.page.wait_for_function('store.settings.communityUrl==="https://vk.ru/new_group"')
        self.assertEqual(self.page.evaluate('store.settings.documentUrl'),'')
        frame=self.open_popup()
        self.assertEqual(frame.locator('#communityUrl').input_value(),'https://vk.ru/new_group')
        frame.locator('#documentUrl').fill('https://docs.google.com/document/d/new_document/edit')
        self.page.evaluate('popupFrame.remove()')
        self.page.wait_for_function('store.settings.documentUrl.includes("new_document")')
        frame=self.open_popup()
        self.assertEqual(frame.locator('#communityUrl').input_value(),'https://vk.ru/new_group')
        self.assertEqual(frame.locator('#documentUrl').input_value(),'https://docs.google.com/document/d/new_document/edit')

    def test_cleared_link_stays_empty_and_partial_link_does_not_reset_other_settings(self):
        self.page.evaluate('store.settings={...fixtureSettings,extraSignature:"Saved signature",artist:"Saved artist"}')
        frame=self.open_popup()
        frame.locator('#communityUrl').fill('https://vk.ru/')
        frame.locator('#documentUrl').fill('')
        self.page.evaluate('popupFrame.remove()')
        self.page.wait_for_function('store.settings.communityUrl==="https://vk.ru/" && store.settings.documentUrl===""')
        self.assertEqual(self.page.evaluate('store.settings.artist'),'Saved artist')
        self.assertEqual(self.page.evaluate('store.settings.extraSignature'),'Saved signature')

    def test_patch_is_popup_only_and_cannot_modify_active_batch_or_unrelated_fields(self):
        for message,sender in [
            ({'type':'settingsPatch','settings':{'artist':'Other'}},{'id':'fixture'}),
            ({'type':'settingsPatch','settings':{'communityUrl':'https://vk.ru/new_group'}},{'id':'fixture','tab':{'id':7}}),
        ]:
            reply=self.page.evaluate('v=>new Promise(resolve=>backgroundListener(v.message,v.sender,resolve))',{'message':message,'sender':sender})
            self.assertFalse(reply['ok'])
        self.page.evaluate('store.batch={enabled:true,settings:fixtureSettings}')
        reply=self.page.evaluate('''()=>new Promise(resolve=>backgroundListener({type:'settingsPatch',settings:{communityUrl:'https://vk.ru/new_group'}},
          {id:'fixture'},resolve))''')
        self.assertFalse(reply['ok'])
        self.assertEqual(self.page.evaluate('store.settings.communityUrl'),'')

class SignatureAndArtistTests(unittest.TestCase):
    setUpClass=classmethod(test_extension.ExtensionTests.setUpClass.__func__)
    tearDownClass=classmethod(test_extension.ExtensionTests.tearDownClass.__func__)
    setUp=test_extension.ExtensionTests.setUp
    tearDown=test_extension.ExtensionTests.tearDown
    content=test_extension.ExtensionTests.content
    workflow_fixture=test_extension.ExtensionTests.workflow_fixture

    def configure(self,**changes):
        self.page.evaluate('v=>TriSloga.configure(v.settings,v.community)',
                           {'settings':{**test_settings.CUSTOM,**changes},'community':test_settings.COMMUNITY})

    def test_empty_artist_defaults_only_when_audio_is_enabled(self):
        for artist in ['', '   ']:
            self.assertEqual(self.page.evaluate('v=>AZVK.normalizeSettings(v).artist',{**test_settings.CUSTOM,'artist':artist}),'Три слога')
        self.assertEqual(self.page.evaluate('v=>AZVK.normalizeSettings(v).artist',{**test_settings.CUSTOM,'artist':'','noAudio':True}),'')

    def test_signature_appends_after_existing_footer_in_all_text_modes(self):
        self.content('<p>fixture</p>')
        self.page.evaluate('''html=>{chrome.runtime.sendMessage=async msg=>msg.type==='lyrics'?
          {ok:true,html:'<h1>Название</h1><p>Текст документа</p>'}:
          {ok:true,pages:[{url:'https://ru.wikiquote.org/wiki/Friends',html}]};}''',test_text_modes.AUTHORED_QUOTE)
        for mode,changes in [('manual',{'customText':'Мой текст'}),('document',{}),('quote',{'quoteReference':'дружба'})]:
            with self.subTest(mode=mode):
                self.configure(textMode=mode,extraSignature='',**changes)
                original=self.page.evaluate('TriSloga.preparePostText()')
                self.configure(textMode=mode,extraSignature='  Дополнительная подпись\nВторая строка  ',**changes)
                result=self.page.evaluate('TriSloga.preparePostText()')
                self.assertEqual(result,original+'\n\nДополнительная подпись\nВторая строка')
                self.configure(textMode=mode,extraSignature='   ',**changes)
                self.assertEqual(self.page.evaluate('TriSloga.preparePostText()'),original)

    def test_empty_artist_and_signature_work_in_complete_post(self):
        self.workflow_fixture()
        self.page.evaluate('testStorage.settings={...fixtureSettings,artist:"",extraSignature:"Моя подпись"}')
        result=self.page.evaluate('TriSloga.run({automatic:true,scheduleRunId:"signature"})')
        self.assertTrue(result['success'],result)
        self.assertEqual(self.page.evaluate('TriSloga.state.audio.artist').lower(),'три слога')
        self.assertTrue(self.page.locator('#post').text_content().endswith('Моя подпись'))

    def test_signature_field_saves_and_disables_with_no_text(self):
        self.page.set_content((EXT/'popup.html').read_text(encoding='utf-8'))
        self.page.evaluate('''()=>{window.calls=[];chrome.storage.onChanged={addListener:()=>{}};
          chrome.runtime.sendMessage=async msg=>{calls.push(msg);return {ok:true,settings:msg.settings||fixtureSettings};};}''')
        self.page.add_script_tag(path=str(EXT/'popup.js'))
        self.page.wait_for_function('settingsLoaded')
        self.page.locator('#extraSignature').fill('Моя подпись')
        self.page.locator('#saveSettings').click()
        self.assertEqual(self.page.evaluate('calls.find(m=>m.type==="settingsSave").settings.extraSignature'),'Моя подпись')
        self.page.locator('#noText').check()
        self.assertTrue(self.page.locator('#extraSignature').is_disabled())

if __name__=='__main__':unittest.main()
