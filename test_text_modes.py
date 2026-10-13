"""Offline coverage of text sources, attribution and settings migration."""
import json
import unittest
from pathlib import Path
import test_extension
import test_settings

EXT = Path(__file__).parent / 'extension'
QUOTE = '''<h1 id=firstHeading>Дружба</h1><div class=mw-parser-output>
<table class=q><tr class=q-text><td>•</td><td>Дружба помогает жить.<sup>[1]</sup></td></tr>
<tr class=q-author><td></td><td>— <a>Автор Один</a>, Книга</td></tr></table>
<table class=q><tr class=q-text><td></td><td>Без автора</td></tr></table>
<table class=q><tr class=q-text><td></td><td>Ещё текст</td></tr>
<tr class=q-author><td></td><td>— Неизвестный автор</td></tr></table></div>'''

class TextModeTests(unittest.TestCase):
    setUpClass = classmethod(test_extension.ExtensionTests.setUpClass.__func__)
    tearDownClass = classmethod(test_extension.ExtensionTests.tearDownClass.__func__)
    setUp = test_extension.ExtensionTests.setUp
    tearDown = test_extension.ExtensionTests.tearDown
    content = test_extension.ExtensionTests.content
    workflow_fixture = test_extension.ExtensionTests.workflow_fixture

    def configure(self, **settings):
        value = {**test_settings.CUSTOM, **settings}
        self.page.evaluate('value=>TriSloga.configure(value.settings,value.community)',
                           {'settings':value,'community':test_settings.COMMUNITY})

    def test_manual_text_preserves_lines_and_uses_community_footer_without_fetch(self):
        self.content('<p>fixture</p>')
        self.configure(textMode='manual', customText='Первая строка\nВторая строка',documentUrl='')
        self.page.evaluate('()=>{chrome.runtime.sendMessage=()=>{throw Error("Unexpected fetch")};}')
        text = self.page.evaluate('TriSloga.preparePostText()')
        self.assertEqual(text,'Первая строка\nВторая строка\n\nДругое сообщество')
        self.assertEqual(text,self.page.evaluate('TriSloga.preparePostText()'))

    def test_quotes_filter_unknown_authors_unrelated_text_and_untrusted_sources(self):
        self.content('<p>fixture</p>')
        value={'html':QUOTE,'url':'https://ru.wikiquote.org/wiki/Дружба','reference':'дружба'}
        quotes=self.page.evaluate('v=>TriSloga.parseQuotes(v.html,v.url,v.reference)',value)
        self.assertEqual(len(quotes),1)
        self.assertEqual(quotes[0]['author'],'Автор Один')
        self.assertEqual(quotes[0]['text'],'Дружба помогает жить.')
        for overrides in [{'reference':'музыка'},{'url':'https://example.com/wiki/Дружба'}]:
            self.assertEqual(self.page.evaluate('v=>TriSloga.parseQuotes(v.html,v.url,v.reference)',{**value,**overrides}),[])

    def test_quote_search_fallback_and_attribution(self):
        self.content('<p>fixture</p>')
        self.configure(textMode='quote',quoteReference='дружба',documentUrl='')
        self.page.evaluate('''html=>{window.quoteCalls=[];chrome.runtime.sendMessage=async msg=>{
          quoteCalls.push(msg);return {ok:true,pages:msg.search?[{url:'https://ru.wikiquote.org/wiki/Friends',html}]:[]};};}''',QUOTE)
        text=self.page.evaluate('TriSloga.preparePostText()')
        self.assertIn('— Автор Один',text)
        self.assertTrue(text.endswith('Источник: https://ru.wikiquote.org/wiki/Friends'))
        self.assertEqual(self.page.evaluate('quoteCalls.map(m=>m.search)'),[False,True])
        self.assertNotIn('Другое сообщество',text)

    def test_no_quote_fails_without_inventing_one(self):
        self.content('<p>fixture</p>')
        self.configure(textMode='quote',quoteReference='дружба',documentUrl='')
        self.page.evaluate('chrome.runtime.sendMessage=async()=>({ok:true,pages:[]})')
        error=self.page.evaluate('async()=>{try{await TriSloga.preparePostText()}catch(e){return e.message}}')
        self.assertIn('Не найдена цитата',error)

    def test_plain_export_document_footer_has_no_title(self):
        self.content('<p>fixture</p>')
        self.configure()
        self.assertEqual(self.page.evaluate('TriSloga.chooseSongExcerpt("<style>p{color:black}</style><p>Просто текст</p>",()=>0)'),
                         {'title':'','text':'Просто текст\n\nДругое сообщество'})

    def test_selected_text_source_validation_and_migration(self):
        for mode, field, text in [('quote','quoteReference','дружба'),('manual','customText','Мой текст')]:
            value={**test_settings.CUSTOM,'documentUrl':'','textMode':mode,field:text}
            self.assertEqual(self.page.evaluate('v=>AZVK.normalizeSettings(v).textMode',value),mode)
            value[field]=''
            self.assertTrue(self.page.evaluate('v=>{try{AZVK.normalizeSettings(v)}catch(e){return e.message}}',value))
            value['noText']=True
            self.assertTrue(self.page.evaluate('v=>AZVK.normalizeSettings(v).noText',value))
        old={k:v for k,v in test_settings.CUSTOM.items() if k not in ['textMode','customText','quoteReference']}
        self.assertEqual(self.page.evaluate('v=>AZVK.normalizeSettings(v).textMode',old),'document')

    def test_background_quotes_use_frozen_topic_and_reject_stale_batch(self):
        self.page.evaluate('''()=>{testStorage.settings={...fixtureSettings,textMode:'quote',quoteReference:'wrong'};
          testStorage.batch={id:'quotes',enabled:true,tabId:7,settings:{...fixtureSettings,textMode:'quote',quoteReference:'дружба'}};
          window.fetched=[];window.fetch=async url=>{fetched.push(url);return new Response('<p>fixture</p>',{status:200});};}''')
        self.page.add_script_tag(path=str(EXT/'background.js'))
        result=self.page.evaluate('''()=>new Promise(resolve=>testListeners[0]({type:'quotes',batchId:'quotes',quoteReference:'ignored'},
          {id:'test-extension',url:location.href,tab:{id:7}},resolve))''')
        self.assertTrue(result['ok'],result)
        self.assertIn('%D0%B4%D1%80%D1%83%D0%B6%D0%B1%D0%B0',self.page.evaluate('fetched[0]'))
        result=self.page.evaluate('''()=>new Promise(resolve=>testListeners[0]({type:'quotes',batchId:'old'},
          {id:'test-extension',url:location.href,tab:{id:7}},resolve))''')
        self.assertFalse(result['ok'])
        self.assertEqual(self.page.evaluate('fetched.length'),1)

    def test_background_search_uses_only_wikiquote_article_links(self):
        self.page.evaluate('''()=>{testStorage.settings={...fixtureSettings,textMode:'quote',quoteReference:'дружба'};
          window.fetched=[];window.fetch=async url=>{fetched.push(url);return new Response(url.includes('Special:Search')?
            '<div class="mw-search-result-heading"><a href="https://evil.example/wiki/Test">Bad</a></div>'+ 
            '<div class="mw-search-result-heading"><a href="/wiki/Friends">Good</a></div>':'<p>fixture</p>',{status:200});};}''')
        self.page.add_script_tag(path=str(EXT/'background.js'))
        result=self.page.evaluate('''()=>new Promise(resolve=>testListeners[0]({type:'quotes',search:true},
          {id:'test-extension',url:location.href,tab:{id:7}},resolve))''')
        self.assertTrue(result['ok'],result)
        self.assertEqual([p['url'] for p in result['pages']],['https://ru.wikiquote.org/wiki/Friends'])
        self.assertEqual(self.page.evaluate('fetched.length'),2)
        self.assertIn('fulltext=1',self.page.evaluate('fetched[0]'))

    def test_manual_and_quote_modes_complete_post_without_fetching_document(self):
        for mode in ['manual','quote']:
            with self.subTest(mode=mode):
                if mode=='quote':
                    self.tearDown();self.setUp()
                self.workflow_fixture(custom=True)
                self.page.evaluate('''({mode,html})=>{testStorage.settings={...testStorage.settings,textMode:mode,
                  customText:'Мой текст',quoteReference:'дружба',documentUrl:'',noAudio:true};
                  const send=chrome.runtime.sendMessage;chrome.runtime.sendMessage=async msg=>{
                    if(msg.type==='lyrics')throw Error('Unexpected document fetch');
                    if(msg.type==='quotes')return {ok:true,pages:[{url:'https://ru.wikiquote.org/wiki/Friends',html}]};
                    return send(msg);
                  };}''',{'mode':mode,'html':QUOTE})
                result=self.page.evaluate('TriSloga.run({automatic:true,scheduleRunId:"text-fixture"})')
                self.assertTrue(result['success'],result)
                text=self.page.locator('#post').inner_text()
                self.assertIn('Мой текст' if mode=='manual' else 'Автор Один',text)
                self.assertIn('Другое сообщество' if mode=='manual' else 'https://ru.wikiquote.org/wiki/Friends',text)

    def test_popup_switches_modes_disables_fields_and_saves_selected_source(self):
        self.page.set_content((EXT/'popup.html').read_text(encoding='utf-8'))
        self.page.evaluate('''()=>{chrome.storage.onChanged={addListener:()=>{}};window.calls=[];
          chrome.runtime.sendMessage=async msg=>{calls.push(msg);return {ok:true,settings:msg.settings};};}''')
        self.page.add_script_tag(path=str(EXT/'popup.js'))
        self.page.wait_for_function('settingsLoaded')
        self.page.locator('#communityUrl').fill('https://vk.ru/club123')
        self.page.locator('#textMode').select_option('manual')
        self.assertTrue(self.page.locator('#documentFields').is_hidden())
        self.page.locator('#customText').fill('Мой текст')
        self.page.locator('#saveSettings').click()
        self.page.wait_for_function('calls.some(m=>m.type==="settingsSave")')
        self.assertEqual(self.page.evaluate('calls.find(m=>m.type==="settingsSave").settings.customText'),'Мой текст')
        self.page.locator('#noText').check()
        self.assertTrue(self.page.locator('#customText').is_disabled())
        self.assertTrue(self.page.locator('#textMode').is_disabled())
        self.assertEqual(self.page.locator('#version').inner_text(),'v'+json.loads((EXT/'manifest.json').read_text(encoding='utf-8'))['version'])

if __name__ == '__main__':
    unittest.main()
