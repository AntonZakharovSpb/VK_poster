import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import app


class Page:
    def __init__(self, authenticated=False):
        self.authenticated = authenticated
        self.navigation_count = 0

    def is_closed(self):
        return False

    def wait_for_timeout(self, milliseconds):
        pass

    def goto(self, *args, **kwargs):
        self.navigation_count += 1
        self.authenticated = True

    def locator(self, selector):
        return self

    @property
    def first(self):
        return self

    def wait_for(self, **kwargs):
        pass


class LoginTests(unittest.TestCase):
    def check_login(self, page, settings, event, stop, waiting):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(app, 'CONFIG', Path(directory) / 'settings.json'), \
                 patch.object(app, 'logged_in', side_effect=lambda p: p.authenticated):
                app.ensure_login(page, settings, lambda text: None, event, stop, waiting)

    def test_stale_saved_flag_still_requires_user_login(self):
        event, stop = threading.Event(), threading.Event()
        states = []
        page = Page()
        settings = {'url': 'https://vk.ru/tri_sloga_band', 'login_ready': True}
        def waiting(value):
            states.append(value)
            if value:
                self.assertFalse(page.authenticated)
                event.set()
        self.check_login(page, settings, event, stop, waiting)
        self.assertEqual(states, [True, False])
        self.assertEqual(page.navigation_count, 1)
        self.assertNotIn('login_ready', settings)

    def test_real_saved_session_does_not_require_button(self):
        page = Page(authenticated=True)
        states = []
        self.check_login(page, {'url': 'https://vk.ru/tri_sloga_band'},
                         threading.Event(), threading.Event(), states.append)
        self.assertEqual(states, [])
        self.assertEqual(page.navigation_count, 0)

    def test_premature_button_click_is_cleared(self):
        event, stop = threading.Event(), threading.Event()
        event.set()
        def waiting(value):
            if value:
                self.assertFalse(event.is_set())
                stop.set()
        with self.assertRaisesRegex(RuntimeError, 'закрытии'):
            self.check_login(Page(), {'url': 'https://vk.ru/tri_sloga_band'}, event, stop, waiting)


if __name__ == '__main__':
    unittest.main()
