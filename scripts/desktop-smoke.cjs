const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
app.whenReady().then(async()=>{
  const errors=[];
  const win=new BrowserWindow({width:1440,height:960,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
  win.webContents.on('console-message',(_event,level,message)=>{if(level===3)errors.push(message);});
  try{
    await win.loadURL(process.env.COLMENA_SMOKE_URL||'http://127.0.0.1:4317');
    await win.webContents.executeJavaScript('document.fonts.ready.then(()=>true)');
    const state=await win.webContents.executeJavaScript('({title:document.title,heading:document.querySelector("h1")?.textContent,buttons:document.querySelectorAll("button").length,overflow:document.documentElement.scrollWidth>innerWidth,nodeExposed:typeof require!=="undefined"})');
    const dir=path.join(__dirname,'../output/playwright');fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'electron-desktop.png'),(await win.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(dir,'electron-smoke.json'),JSON.stringify({...state,errors,version:process.versions.electron},null,2));
    if(!state.heading||state.nodeExposed||state.overflow||errors.length)throw Error('Native smoke failed');
    console.log(JSON.stringify({...state,errors,version:process.versions.electron}));app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
});
