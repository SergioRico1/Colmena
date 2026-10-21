async (page) => {
  const origin='http://127.0.0.1:57767';
  const routes=['','inbox','chat/nora','mission/6acfbf48-e017-42f0-b4a4-25103eff2493','mission/5aee6ccc-aadc-46b9-8c2f-6c03495f74d8/debate','mission/6acfbf48-e017-42f0-b4a4-25103eff2493/live','missions','mission/6acfbf48-e017-42f0-b4a4-25103eff2493/timeline','automations','team','newbot','bot/tomas','library','settings'];
  const issues=[],errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});
    for(let index=0;index<routes.length;index++){
      await page.goto(origin+'/#/'+routes[index]);
      await page.getByRole('heading',{level:1}).first().waitFor();
      await page.evaluate(()=>document.fonts.ready.then(()=>true));
      const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,heading:document.querySelector('h1')?.textContent,overflow:[...document.querySelectorAll('main button,main input,main select,main h1')].filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&(b.right>innerWidth+2||b.left<0);}).map(e=>e.textContent?.slice(0,60)||e.tagName)}));
      if(layout.scroll>width||layout.overflow.length)issues.push({route:routes[index],...layout});
      await page.screenshot({path:'output/playwright/screen-'+String(index+1).padStart(2,'0')+'-'+width+'.png',fullPage:true});
    }
  }
  console.log(JSON.stringify({screenshots:routes.length*2,issues,errors}));
}
