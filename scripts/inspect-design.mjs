import {readFile, readdir} from 'node:fs/promises';
import {load} from 'cheerio';
for (const dir of process.argv.slice(2)) {
  const base = new URL('../references/designs/' + dir + '/', import.meta.url);
  const file = (await readdir(base)).find(f => f.endsWith('.dc.html'));
  const $ = load(await readFile(new URL(file, base), 'utf8'));
  $('svg, helmet, nav[aria-label="Navegación principal"]').remove();
  $('[style]').removeAttr('style');
  $('*').each((_, e) => {for (const key of Object.keys(e.attribs || {})) if (['aria-hidden', 'width', 'height', 'type'].includes(key)) $(e).removeAttr(key);});
  console.log('\n' + dir + ' ' + file + '\n' + $('x-dc').html() + '\nLOGIC\n' + $('script[data-dc-script]').text());
}
