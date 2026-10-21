import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {load} from 'cheerio';

test('all 17 screens retain original stylesheets and original logic, with explicit runtime bindings',async()=>{
  const {screens}=await import('../scripts/build-screens.mjs');
  const declarations=style=>new Map(style.split(';').map(x=>{const i=x.indexOf(':');return [x.slice(0,i).trim(),x.slice(i+1).trim()];}).filter(([k,v])=>k&&v));
  for(const [name,dir] of Object.entries(screens)){
    const source=load(await readFile(new URL('../references/designs/'+dir+'/'+name+'.dc.html',import.meta.url),'utf8'));
    const html=await readFile(new URL('../public/screens/'+name+'.dc.html',import.meta.url),'utf8'),built=load(html);
    assert.equal(built('style').text(),source('style').text(),name+' stylesheet');
    assert.ok(built('script[data-dc-script]').text().startsWith(source('script[data-dc-script]').text().replace('class Component extends DCLogic','class OriginalComponent extends DCLogic')),name+' original logic');
    const originals=source('[style]').map((_,e)=>declarations(source(e).attr('style'))).get();
    for(const e of built('[style]').toArray()){
      const stable=[...declarations(built(e).attr('style'))].filter(([k,v])=>!v.includes('{{')&&!['white-space','overflow-wrap'].includes(k));
      assert.ok(originals.some(o=>stable.every(([k,v])=>o.get(k)===v)),name+': unsupported new static style '+built(e).attr('style'));
    }
    assert.equal(built('h1').length,1,name+' heading');
    assert.ok(built('script[src="./bridge.js"]').length,name+' bridge');
    assert.ok(!/\bon[A-Z][a-z]+=/g.test(html),name+' duplicate event attribute case');
  }
});
