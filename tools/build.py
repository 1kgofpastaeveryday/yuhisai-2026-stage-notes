"""Build the two pages from content/*/NN-*.md into _site/.

Usage: python tools/build.py   (needs the `markdown` package; CI installs it)
"""
import html
import pathlib
import re
import shutil

import markdown
from markdown.extensions.toc import slugify_unicode

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / '_site'
# Search indexing stays off: owner decision 2026-11-10 (publish with noindex).
NOINDEX = True

# (content dir, output file, page title, short tab label)
PAGES = [
    ('guide', 'index.html', '小講堂でステージを担当する人へ', '手引き'),
    ('record', 'record.html', '雄飛祭2026 小講堂ステージの作業記録', '作業記録'),
    ('ai', 'ai.html', 'AIエージェントでステージを動かした記録', 'AIエージェントの記録'),
    ('downloads', 'downloads.html', 'ダウンロード', 'ダウンロード'),
]
FILES = ROOT / 'files'  # Downloadable files, published as-is under _site/files/
VENDOR_CSS = ROOT / 'tools/vendor/astryx/theme-neutral.css'

TEMPLATE = (ROOT / 'tools/template.html').read_text()


def render(section):
    files = sorted((ROOT / 'content' / section).glob('*.md'))
    source = '\n\n'.join(f.read_text() for f in files)
    md = markdown.Markdown(
        extensions=['tables', 'md_in_html', 'toc'],
        extension_configs={'toc': {'slugify': slugify_unicode, 'toc_depth': '2-3'}},
    )
    body = md.convert(source)
    return body, md.toc


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()
    for section, filename, title, _ in PAGES:
        body, toc = render(section)
        # The numbered items under 「最初に知っておくこと」 render as cards (style.css .lessons).
        body = re.sub(r'(<h2 id="最初に知っておくこと">.*?<ol)>', r'\1 class="lessons">', body, count=1, flags=re.S)
        current = ' aria-current="page"'
        nav = ''.join(
            f'<a href="{f}"{current if f == filename else ""}>{html.escape(label)}</a>'
            for _, f, _, label in PAGES
        )
        page = (TEMPLATE
                .replace('{{title}}', html.escape(title))
                .replace('{{robots}}', '<meta name="robots" content="noindex">' if NOINDEX else '')
                .replace('{{nav}}', nav)
                .replace('{{toc}}', toc)
                .replace('{{body}}', body))
        if re.search(r'\{\{\w+\}\}', page):
            raise SystemExit(f'{filename}: unfilled template slot')
        (OUT / filename).write_text(page)
    (OUT / 'style.css').write_text((ROOT / 'tools/style.css').read_text())
    (OUT / 'astryx-theme-neutral.css').write_text(VENDOR_CSS.read_text())
    shutil.copytree(FILES, OUT / 'files')
    (OUT / '.nojekyll').write_text('')
    check_links()
    print('built', sorted(p.name for p in OUT.iterdir()))


def check_links():
    """Fail the build when an internal link points at a missing page or heading id."""
    ids = {p.name: set(re.findall(r'id="([^"]+)"', p.read_text())) for p in OUT.glob('*.html')}
    broken = []
    for page in OUT.glob('*.html'):
        for href in re.findall(r'href="([^"#:]*)(?:#([^"]*))?"', page.read_text()):
            target, frag = href
            if target.startswith(('http', '//')) or target.endswith('.css'):
                continue
            if target.startswith('files/'):
                if not (OUT / target).is_file():
                    broken.append(f'{page.name}: {target}')
                continue
            name = page.name if target == '' else 'index.html' if target == './' else target
            if name not in ids or (frag and frag not in ids[name]):
                broken.append(f'{page.name}: {target}#{frag}')
    if broken:
        raise SystemExit('broken internal links:\n' + '\n'.join(broken))


if __name__ == '__main__':
    main()
