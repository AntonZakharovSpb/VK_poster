"""Windows VK publisher. Browser selectors must be checked against the target community."""
import json
import os
import random
import re
import threading
import time
import tkinter as tk
from pathlib import Path
from tkinter import messagebox
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from html.parser import HTMLParser

HOME = Path(os.getenv('LOCALAPPDATA', str(Path.home()))) / 'TriSlogaPublisher'
HOME.mkdir(parents=True, exist_ok=True)
CONFIG = HOME / 'settings.json'
SOURCE = 'https://ru.wikiquote.org/wiki/Любовь'


def community_url(value):
    value = value.strip()
    if not value.startswith('https://'):
        value = 'https://' + value
    parsed = urlparse(value)
    if parsed.hostname not in ('vk.com', 'www.vk.com', 'vk.ru', 'www.vk.ru') or parsed.username or parsed.password or parsed.port or not re.fullmatch(r'/[A-Za-z0-9_.]+/?', parsed.path):
        raise ValueError('Укажите точную ссылку сообщества: https://vk.com/имя')
    host = parsed.hostname.removeprefix('www.')
    return 'https://' + host + '/' + parsed.path.strip('/')


class Quotes(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack, self.items = [], []

    def handle_starttag(self, tag, attrs):
        if tag == 'li':
            self.stack.append([])

    def handle_data(self, data):
        if self.stack:
            self.stack[-1].append(data)

    def handle_endtag(self, tag):
        if tag == 'li' and self.stack:
            text = re.sub(r'\[\d+\]', '', ''.join(self.stack.pop()))
            text = re.sub(r'\s+', ' ', text).strip()
            if 35 <= len(text) <= 240 and re.search(r'\b(?:любовь|счастье)\b', text, re.I):
                if not any(x in text for x in ('↑', 'ISBN', 'http', 'править')):
                    self.items.append(text)


def get_quote():
    from urllib.parse import quote
    req = Request(quote(SOURCE, safe=':/'), headers={'User-Agent': 'TriSlogaPublisher/1.0'})
    with urlopen(req, timeout=25) as response:
        parser = Quotes()
        parser.feed(response.read(2_000_000).decode('utf-8'))
    choices = list(set(parser.items))
    if not choices:
        raise RuntimeError('Источник цитат недоступен или не содержит подходящих цитат.')
    # Include a source because Wikiquote content is collaboratively licensed.
    return random.choice(choices) + '\n\nИсточник: ' + SOURCE


def unique_visible(locator, description='элемент'):
    matches = [x for x in locator.all() if x.is_visible()]
    if len(matches) != 1:
        raise RuntimeError(f'Не удалось определить {description}: найдено видимых элементов — {len(matches)}.')
    return matches[0]


def open_composer(page):
    create = page.get_by_test_id('group_publish_create_button')
    if create.count():
        unique_visible(create, 'кнопку «Создать»').click()
        # Some VK layouts present a creation menu before the editor.
        entry = page.get_by_role('menuitem', name=re.compile(r'^(Запись|Пост|Создать запись)$'))
        if any(x.is_visible() for x in entry.all()):
            unique_visible(entry, 'пункт создания записи').click()
    candidates = page.locator('#submit_post_box, [data-testid="post-composer"], [role="dialog"], .box_layout')
    containers = candidates.filter(has=page.get_by_role('button', name='Опубликовать', exact=True))
    containers.first.wait_for(state='visible', timeout=15000)
    composer = unique_visible(containers, 'редактор новой публикации')
    return composer


def post_editor(composer):
    # Never use a page-wide textbox: community walls also contain comment boxes.
    return unique_visible(composer.locator(
        '#post_field, [contenteditable="true"][role="textbox"]:not([aria-label*="коммент"])'
    ), 'текст новой публикации')


def attachment_button(composer, kind):
    name = re.compile(r'^(Фотография|Фото)$' if kind == 'photo' else r'^(Музыка|Аудиозапись)$')
    return unique_visible(composer.get_by_role('button', name=name), 'кнопку добавления вложения')


def pick_attachment(page, composer, kind, name, log):
    # Only select media inside a picker explicitly identifying the community.
    label = 'Фотография' if kind == 'photo' else 'Музыка'
    attachment_button(composer, kind).click()
    dialog = unique_visible(page.locator('[role="dialog"], .box_layout'))
    community = dialog.get_by_text(name, exact=True)
    unique_visible(community).click()
    page.wait_for_timeout(1000)
    if kind == 'photo':
        items = dialog.locator('[data-photo-id], .photos_choose_item')
    else:
        items = dialog.locator('.audio_row')
    choices = [x for x in items.all() if x.is_visible()]
    if not choices:
        raise RuntimeError(f'В разделе сообщества отсутствует {label.lower()} или изменился интерфейс.')
    chosen = random.choice(choices)
    if kind == 'audio':
        unique_visible(chosen.locator('.audio_row__action_add, [aria-label="Добавить"]')).click()
    else:
        chosen.click()
    done = dialog.get_by_role('button', name=re.compile(r'^(Прикрепить|Готово)$'))
    visible = [x for x in done.all() if x.is_visible()]
    if len(visible) == 1:
        visible[0].click()
    page.wait_for_timeout(1000)
    log(f'Выбрано: {label.lower()} из открытой части коллекции сообщества.')


def logged_in(page):
    # Positive account indicators; a public community page alone is not proof of login.
    account = page.locator('#l_pr, #top_profile_link, .TopNavBtn__profileImg, '
                           '[data-testid="header-profile"]')
    return any(item.is_visible() for item in account.all())


def ensure_login(page, settings, log, login_event, stop_event, set_waiting):
    settings.pop('login_ready', None)
    CONFIG.write_text(json.dumps(settings, ensure_ascii=False, indent=2), encoding='utf-8')
    if logged_in(page):
        log('Сохранённый вход в VK подтверждён.')
        return
    login_event.clear()
    set_waiting(True)
    log('Войдите в VK в открытом Chrome. После входа нажмите «Я вошёл в VK» в приложении.')
    try:
        while not stop_event.is_set():
            if page.is_closed():
                raise RuntimeError('Окно Chrome закрыто до завершения входа.')
            page.wait_for_timeout(250)
            if not login_event.is_set():
                continue
            login_event.clear()
            page.goto(settings['url'], wait_until='domcontentloaded', timeout=60000)
            try:
                page.locator('#l_pr, #top_profile_link, .TopNavBtn__profileImg, '
                             '[data-testid="header-profile"]').first.wait_for(state='visible', timeout=10000)
            except Exception:
                pass
            if logged_in(page):
                log('Вход в VK подтверждён.')
                return
            log('Вход пока не подтверждён. Завершите вход в Chrome и нажмите кнопку ещё раз.')
        raise RuntimeError('Работа остановлена при закрытии приложения.')
    finally:
        set_waiting(False)


def publish(settings, log, login_event, stop_event, set_waiting):
    from playwright.sync_api import sync_playwright
    quote = get_quote()
    log('Получена цитата из интернета. Открываю Chrome…')
    with sync_playwright() as pw:
        context = pw.chromium.launch_persistent_context(
            str(HOME / 'chrome-profile'), channel='chrome', headless=False,
            no_viewport=True, args=['--start-maximized'])
        page = context.pages[0] if context.pages else context.new_page()
        try:
            page.goto(settings['url'], wait_until='domcontentloaded', timeout=60000)
            ensure_login(page, settings, log, login_event, stop_event, set_waiting)
            page.wait_for_timeout(2000)
            title = unique_visible(page.locator('h1, .page_name').filter(
                has_text=re.compile(r'^\s*' + re.escape(settings['name']) + r'\s*$', re.I)), 'название сообщества')
            if title.inner_text().strip().casefold() != settings['name'].casefold():
                raise RuntimeError('Название открытого сообщества не совпадает с настройками.')
            log('Открываю редактор новой публикации через «Создать».')
            composer = open_composer(page)
            editor = post_editor(composer)
            editor.click()
            editor.fill(quote)
            pick_attachment(page, composer, 'photo', settings['name'], log)
            pick_attachment(page, composer, 'audio', settings['name'], log)
            # Require visible author identity in the composer, not just the page heading.
            author = composer.locator('.post_from_group, [data-testid="post-author"]')
            if settings['name'].casefold() not in unique_visible(author).inner_text().casefold():
                raise RuntimeError('Не удалось проверить публикацию от имени сообщества.')
            if composer.locator('.page_preview_photo, [data-attachment-type="photo"]').count() != 1:
                raise RuntimeError('Не удалось проверить прикреплённую фотографию.')
            if composer.locator('.audio_row, [data-attachment-type="audio"]').count() != 1:
                raise RuntimeError('Не удалось проверить прикреплённую песню.')
            # Record intent before clicking. Never automatically retry an uncertain publication.
            receipt = HOME / 'last-attempt.json'
            receipt.write_text(json.dumps({'time': time.time(), 'status': 'pending', 'url': settings['url'],
                                           'text': quote}, ensure_ascii=False), encoding='utf-8')
            unique_visible(composer.get_by_role('button', name='Опубликовать', exact=True)).click()
            page.wait_for_timeout(4000)
            posts = page.locator('.wall_item, [data-post-id]')
            if not any(quote.split('\n')[0] in p.inner_text() for p in posts.all() if p.is_visible()):
                raise RuntimeError('Публикация отправлена, но результат не подтверждён. Проверьте стену; не запускайте повторно.')
            receipt.write_text(json.dumps({'time': time.time(), 'status': 'published'}, ensure_ascii=False), encoding='utf-8')
            log('Публикация появилась на стене сообщества.')
        except Exception as e:
            log('Остановлено: ' + str(e))
            try:
                page.screenshot(path=str(HOME / 'last-error.png'))
                log('Снимок ошибки: ' + str(HOME / 'last-error.png'))
                # Local DOM snapshot helps update selectors without requesting credentials.
                (HOME / 'last-error.html').write_text(page.content(), encoding='utf-8')
            except Exception:
                pass
            log('Chrome оставлен открытым. Закройте Chrome или приложение, когда закончите.')
            while not stop_event.is_set() and any(not p.is_closed() for p in context.pages):
                try:
                    next(p for p in context.pages if not p.is_closed()).wait_for_timeout(250)
                except Exception:
                    break
        finally:
            context.close()


class App:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title('Три слога — публикация VK')
        self.root.geometry('650x440')
        self.settings = json.loads(CONFIG.read_text(encoding='utf-8')) if CONFIG.exists() else {}
        self.login = threading.Event()
        self.stop = threading.Event()
        self.root.protocol('WM_DELETE_WINDOW', self.close)
        tk.Label(self.root, text='Один запуск — одна публикация', font=('Segoe UI', 16)).pack(pady=12)
        tk.Label(self.root, text='Точная ссылка сообщества').pack()
        self.url = tk.Entry(self.root, width=65)
        self.url.insert(0, self.settings.get('url', 'https://vk.ru/tri_sloga_band'))
        self.url.pack(pady=5)
        tk.Label(self.root, text='Название сообщества (как в VK)').pack()
        self.name = tk.Entry(self.root, width=65)
        self.name.insert(0, self.settings.get('name', 'три слога'))
        self.name.pack(pady=5)
        self.start = tk.Button(self.root, text='Сохранить и опубликовать', command=self.run)
        self.start.pack(pady=10)
        self.login_button = tk.Button(self.root, text='Я вошёл в VK', command=self.login.set, state='disabled')
        self.login_button.pack()
        self.output = tk.Text(self.root, height=9, state='disabled', wrap='word')
        self.output.pack(padx=15, pady=10, fill='both', expand=True)
        if self.settings.get('url'):
            self.root.after(1000, self.run)

    def log(self, text):
        if self.stop.is_set():
            return
        def show():
            self.output.configure(state='normal')
            self.output.insert('end', text + '\n')
            self.output.see('end')
            self.output.configure(state='disabled')
        self.root.after(0, show)

    def close(self):
        self.stop.set()
        self.root.destroy()

    def set_waiting(self, waiting):
        if not self.stop.is_set():
            self.root.after(0, lambda: self.login_button.configure(state='normal' if waiting else 'disabled'))

    def run(self):
        try:
            self.settings.update(url=community_url(self.url.get()), name=self.name.get().strip())
            if not self.settings['name']:
                raise ValueError('Введите название сообщества.')
            receipt = HOME / 'last-attempt.json'
            if receipt.exists() and json.loads(receipt.read_text(encoding='utf-8'))['status'] == 'pending':
                if not messagebox.askyesno('Проверьте стену', 'Предыдущая попытка не подтверждена. Вы проверили стену и хотите создать НОВЫЙ пост?'):
                    return
            CONFIG.write_text(json.dumps(self.settings, ensure_ascii=False, indent=2), encoding='utf-8')
        except Exception as e:
            messagebox.showerror('Настройки', str(e))
            return
        self.start.configure(state='disabled')
        self.url.configure(state='disabled')
        self.name.configure(state='disabled')
        def worker():
            try:
                publish(self.settings, self.log, self.login, self.stop, self.set_waiting)
            except Exception as e:
                self.log('Остановлено: ' + str(e))
        threading.Thread(target=worker, daemon=False).start()


if __name__ == '__main__':
    App().root.mainloop()
