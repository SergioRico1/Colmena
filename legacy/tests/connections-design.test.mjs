import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {load} from 'cheerio';

test('09b/09c bindings retain original inline styles and stylesheet; internal engine UI is removed', async () => {
  await import('../scripts/build-connections.mjs');
  for (const [dir, name] of [['09b', 'Connections'], ['09c', 'Permissions']]) {
    const original = load(await readFile(new URL('../references/designs/' + dir + '/' + name + '.dc.html', import.meta.url), 'utf8'));
    const html = await readFile(new URL('../public/connections/' + name + '.dc.html', import.meta.url), 'utf8');
    const built = load(html), styles = new Set(original('[style]').map((_, e) => original(e).attr('style')).get());
    for (const style of built('[style]').map((_, e) => built(e).attr('style')).get())
      assert.ok(styles.has(style.replace('; overflow-wrap: anywhere; white-space: pre-wrap', '')), style);
    assert.equal(built('style').text(), original('style').text());
    assert.ok(built('script[src="./bridge.js"]').length);
    assert.equal(built('x-dc').text().includes('Composio'), false);
    assert.equal(built('x-dc').text().includes('Cambiar clave'), false);
    assert.equal(built('x-dc').text().includes('ca_iZmO8Q4VtjMo'), false);
  }
});
