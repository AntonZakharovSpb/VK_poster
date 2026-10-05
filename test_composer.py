import unittest
from playwright.sync_api import sync_playwright
import app


class ComposerTests(unittest.TestCase):
    def test_new_post_controls_do_not_select_comment_controls(self):
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            try:
                page = browser.new_page()
                page.set_content('''
                    <div contenteditable="true" role="textbox" aria-label="Написать комментарий">existing comment</div>
                    <button data-testid="comment_upload_photo"><span>Фотография</span></button>
                    <button data-testid="group_publish_create_button" onclick="document.getElementById('composer').hidden=false">Создать</button>
                    <div role="dialog" id="composer" hidden>
                      <div contenteditable="true" role="textbox" aria-label="Текст публикации"></div>
                      <button id="photo" onclick="this.dataset.clicked='yes'"><span style="position:absolute;left:-10000px">Фотография</span><svg width="24" height="24"></svg></button>
                      <button>Опубликовать</button>
                    </div>''')
                composer = app.open_composer(page)
                app.post_editor(composer).fill('new post')
                app.attachment_button(composer, 'photo').click()
                self.assertEqual(page.locator('#photo').get_attribute('data-clicked'), 'yes')
                self.assertEqual(page.get_by_role('textbox', name='Написать комментарий').inner_text(), 'existing comment')
            finally:
                browser.close()


if __name__ == '__main__':
    unittest.main()
