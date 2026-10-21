async (page) => {
  const origin=new URL(page.url()).origin;
  const fixture=await(await page.request.get(origin+'/fixture')).json();
  const screens=[['01','Main',''],['02','Bandeja',''],['02b','EditarEnvio','?approval='+encodeURIComponent(fixture.send)],['03','Chat','?bot=bruno&id='+fixture.approval],['04','Sala','?id='+fixture.team],['05','Debate','?id='+fixture.debate],['05b','EnVivo','?id='+fixture.team],['06','Misiones',''],['07','Mision','?id='+fixture.team],['08-v2','Automatizaciones',''],['09','Equipo',''],['10-v2','NuevoBot',''],['10b','NuevoBotAjusta',''],['11','Bot','?bot=tomas'],['12','Biblioteca',''],['13','Ajustes',''],['13b','AjustesIA','']];
  const report=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.__resources={};});
  await page.setViewportSize({width:1440,height:1080});
  for(const [dir,name,query] of screens){
    let previous=errors.length;
    await page.goto(origin+'/design-reference/'+dir+'/'+name+'.dc.html');
    await page.locator('h1').waitFor();await page.evaluate(()=>document.fonts.ready);
    const ref=await page.locator('h1').first().boundingBox();
    await page.screenshot({path:'output/playwright/screen-'+name+'-original.png',fullPage:true,animations:'disabled'});
    await page.goto(origin+'/screens/'+name+'.dc.html'+query);
    await page.locator('h1').waitFor();await page.evaluate(()=>document.fonts.ready);
    await page.waitForFunction(()=>document.documentElement.dataset.colmenaReady==='true');
    const actual=await page.locator('h1').first().boundingBox();
    await page.screenshot({path:'output/playwright/screen-'+name+'-live.png',fullPage:true,animations:'disabled'});
    const controls=await page.locator('button,a[aria-disabled="true"]').evaluateAll(els=>els.map(e=>({label:e.getAttribute('aria-label')||e.innerText,disabled:e.disabled||e.getAttribute('aria-disabled')==='true',title:e.title})).filter(e=>e.disabled));
    const body=await page.locator('body').innerText();
    report.push({name,ref,actual,errors:errors.slice(previous),unresolved:body.includes('{{'),placeholder:body.match(/\[TU[^\]]*\]|\[PROVEEDOR[^\]]*\]/g),disabled:controls});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:'output/playwright/screen-'+name+'-mobile.png',fullPage:true});
    await page.setViewportSize({width:1440,height:1080});
  }
  return report;
}
