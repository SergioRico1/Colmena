const parts=location.hash.replace(/^#\/?/,'').split('/').filter(Boolean);
const pages={inbox:'Bandeja',missions:'Misiones',automations:'Automatizaciones',team:'Equipo',library:'Biblioteca',settings:'Ajustes'};
let page=pages[parts[0]]||'Main',args={};
if(parts[0]==='mission'&&parts[1]){page=({room:'Sala',debate:'Debate',live:'EnVivo'})[parts[2]]||'Mision';args={id:parts[1]};}
if(parts[0]==='chat'&&parts[1]){page='Chat';args={bot:parts[1]};}
if(parts[0]==='bot'&&parts[1]){page=parts[1]==='new'?'NuevoBot':'Bot';if(page==='Bot')args={bot:parts[1]};}
location.replace('/screens/'+page+'.dc.html'+(Object.keys(args).length?'?'+new URLSearchParams(args):''));
