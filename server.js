const http=require('http'),fs=require('fs'),path=require('path'),{WebSocketServer}=require('ws');
const srv=http.createServer((q,r)=>fs.readFile(path.join(__dirname,'index.html'),(e,d)=>{r.writeHead(e?500:200,{'Content-Type':'text/html; charset=utf-8'});r.end(d||'error')}));
const wss=new WebSocketServer({server:srv});
const rooms={};
const HZ=['snake','spider','mummy','fire','rock'];
const TR=[1,2,3,4,5,5,7,7,9,11,11,13,14,15,17];
const ART=[5,7,8,10,12];
const shuf=a=>{for(let i=a.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[a[i],a[j]]=[a[j],a[i]]}return a};
const mkBase=()=>[...TR.map(v=>({k:'t',v})),...HZ.flatMap(h=>[1,2,3].map(()=>({k:'h',h})))];
function send(R){
  R.players.forEach(p=>{
    if(!p.ws||p.ws.readyState!==1)return;
    const over=R.phase==='over';
    p.ws.send(JSON.stringify({code:R.code,phase:R.phase,round:R.round,me:p.id,host:R.host,ev:R.ev,seen:R.seen,path:R.path,deck:R.deck.length,
      players:R.players.map(q=>({id:q.id,name:q.name,hand:q.hand,in:q.in,done:q.choice!==null||q.bot,arts:q.arts.length,off:!q.ws,
        tent:(over||q.id===p.id)?q.tent:null}))}));
  });
}
function ev(R,o){R.ev={n:(R.ev?.n||0)+1,...o}}
function startRound(R){
  R.round++;R.phase='decide';R.seen={};R.path=[];
  R.deck=shuf([...R.base.map(c=>({...c})),{k:'a',v:ART[R.round-1]}]);
  R.players.forEach(p=>{p.in=true;p.hand=0;p.choice=null});
  flip(R,true);
}
function endRound(R,bust){
  R.phase='between';
  setTimeout(()=>{ if(R.round>=5){R.phase='over';ev(R,{t:'over'});}else startRound(R);send(R)},bust?4200:3200);
}
function flip(R,first){
  const c=R.deck.pop(),live=R.players.filter(p=>p.in);
  if(c.k==='t'){const s=Math.floor(c.v/live.length);live.forEach(p=>p.hand+=s);c.left=c.v-s*live.length;c.share=s;R.path.push(c);ev(R,{t:'treasure',v:c.v,s});}
  else if(c.k==='a'){c.left=0;R.path.push(c);ev(R,{t:'artifact',v:c.v});}
  else{
    R.seen[c.h]=(R.seen[c.h]||0)+1;
    if(R.seen[c.h]>=2){ // บูม! ลบการ์ดซ้ำออกจากเกมถาวร
      const i=R.base.findIndex(x=>x.k==='h'&&x.h===c.h);if(i>=0)R.base.splice(i,1);
      live.forEach(p=>{p.hand=0;p.in=false});R.path.push(c);ev(R,{t:'bust',h:c.h});R.phase='bust';endRound(R,true);return;}
    R.path.push(c);ev(R,{t:'hazard',h:c.h});
  }
  R.phase='decide';R.players.forEach(p=>p.choice=null);
}
function check(R){
  if(R.phase!=='decide')return;
  const live=R.players.filter(p=>p.in);
  if(!live.every(p=>p.choice!==null||p.bot))return;
  const lv=live.filter(p=>p.choice==='leave'||(p.bot&&p.choice===null));
  const stay=live.filter(p=>!lv.includes(p));
  R.phase='reveal';
  if(lv.length){
    const k=lv.length;
    R.path.forEach(c=>{if(c.left>0){const s=Math.floor(c.left/k);lv.forEach(p=>p.tent+=s);c.left-=s*k;}});
    if(k===1){const sole=lv[0];R.path.filter(c=>c.k==='a').forEach(c=>{sole.tent+=c.v;sole.arts.push(c.v)});R.path=R.path.filter(c=>c.k!=='a');}
    lv.forEach(p=>{p.tent+=p.hand;p.hand=0;p.in=false});
  }
  ev(R,{t:'reveal',leave:lv.map(p=>p.name),stay:stay.map(p=>p.name)});send(R);
  setTimeout(()=>{ if(!stay.length){R.phase='between';ev(R,{t:'allhome'});send(R);endRound(R,false);}else{flip(R);send(R);check(R)} },2200);
}
wss.on('connection',ws=>{
  let R=null,me=null;
  ws.on('message',m=>{
    let d;try{d=JSON.parse(m)}catch{return}
    if(d.t==='join'){
      const code=String(d.room||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5)||Math.random().toString(36).slice(2,6).toUpperCase();
      R=rooms[code]||(rooms[code]={code,players:[],phase:'lobby',round:0,deck:[],path:[],seen:{},base:mkBase(),host:null,ev:null});
      const name=String(d.name||'นักสำรวจ').slice(0,14);
      me=R.players.find(p=>p.name===name&&!p.ws);
      if(me)me.ws=ws,me.bot=false;
      else{ if(R.phase!=='lobby'||R.players.length>=8)return ws.send(JSON.stringify({err:'ห้องเต็มหรือเกมเริ่มไปแล้ว'}));
        me={id:Math.random().toString(36).slice(2,8),name,ws,tent:0,hand:0,in:false,choice:null,arts:[],bot:false};R.players.push(me);if(!R.host)R.host=me.id;}
      send(R);
    }
    if(!R||!me)return;
    if(d.t==='start'&&R.phase==='lobby'&&R.host===me.id&&R.players.length>=2){startRound(R);send(R);check(R);}
    if(d.t==='choice'&&R.phase==='decide'&&me.in&&me.choice===null){me.choice=d.go?'go':'leave';send(R);check(R);}
  });
  ws.on('close',()=>{if(!R||!me)return;me.ws=null;
    if(R.phase==='lobby'){R.players=R.players.filter(p=>p!==me);if(R.host===me.id)R.host=R.players[0]?.id;}
    else{me.bot=true;check(R)}
    if(!R.players.some(p=>p.ws))delete rooms[R.code];else send(R);});
});
srv.listen(process.env.PORT||3000);
