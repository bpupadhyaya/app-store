(function(){
var d=document,root=d.documentElement,B=root.getAttribute('data-base')||'./';
try{var t=localStorage.getItem('ei-theme');if(t)root.setAttribute('data-theme',t)}catch(e){}
var tb=d.getElementById('theme');if(tb)tb.addEventListener('click',function(){var cur=root.getAttribute('data-theme')||(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');var n=cur==='dark'?'light':'dark';root.setAttribute('data-theme',n);try{localStorage.setItem('ei-theme',n)}catch(e){}});
d.querySelectorAll('.shots').forEach(function(s){s.addEventListener('keydown',function(e){if(e.key==='ArrowRight')s.scrollBy({left:240,behavior:'smooth'});if(e.key==='ArrowLeft')s.scrollBy({left:-240,behavior:'smooth'})})});
if('serviceWorker' in navigator&&location.protocol!=='file:')navigator.serviceWorker.register(B+'sw.js').catch(function(){});
var feat=d.getElementById('featured'),rot=d.getElementById('rot');
if(feat&&rot){try{var cards=rot.content.children,n=cards.length,now=new Date(),day=Math.floor((Date.UTC(now.getFullYear(),now.getMonth(),now.getDate()))/864e5),i=day%n;if(String(day)!==feat.getAttribute('data-day')){feat.innerHTML='';feat.appendChild(cards[i].cloneNode(true))}}catch(e){}}
d.querySelectorAll('.share').forEach(function(b){b.addEventListener('click',function(){var u=b.getAttribute('data-url'),t=b.getAttribute('data-title');if(navigator.share){navigator.share({title:t,text:b.getAttribute('data-text'),url:u}).catch(function(){})}else if(navigator.clipboard){navigator.clipboard.writeText(u).then(function(){var o=b.textContent;b.textContent=window.SHARED||'Link copied';setTimeout(function(){b.textContent=o},1800)})}else{prompt('Copy link',u)}})});
var form=d.getElementById('sform');if(!form)return;
var input=d.getElementById('q'),out=d.getElementById('results'),ans=d.getElementById('answer'),IDX=null,SYN=null;
function load(){return IDX?Promise.resolve():fetch(B+'search-index.json').then(function(r){return r.json()}).then(function(m){SYN=m.synonyms;var a=[];for(var i=0;i<m.shards;i++)a.push(fetch(B+'search-index-'+i+'.json').then(function(r){return r.json()}));return Promise.all(a)}).then(function(p){IDX=[].concat.apply([],p)})}
function norm(s){return s.toLowerCase().replace(/[^a-z0-9 -]/g,' ').split(/\s+/).filter(Boolean)}
function lev(a,b){if(Math.abs(a.length-b.length)>1)return 9;var m=[],i,j;for(i=0;i<=a.length;i++)m[i]=[i];for(j=0;j<=b.length;j++)m[0][j]=j;for(i=1;i<=a.length;i++)for(j=1;j<=b.length;j++)m[i][j]=Math.min(m[i-1][j]+1,m[i][j-1]+1,m[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return m[a.length][b.length]}
function expand(w){var set={};set[w]=1;Object.keys(SYN).forEach(function(k){var g=[k].concat(SYN[k]);if(g.indexOf(w)>-1||g.some(function(x){return x.length>3&&w.length>3&&x.indexOf(w)===0}))g.forEach(function(x){set[x]=1})});return Object.keys(set)}
var STOP='a an the for to of me find show give some game games app apps that like with and in on my i want need something good best'.split(' ');
function tokMatch(tok,w,nofuzzy){if(tok===w)return 3;if(tok.indexOf(w)===0||(w.length>3&&tok.indexOf(w)>-1))return 2;if(!nofuzzy&&w.length>=4&&tok.length>=4&&lev(tok,w)<=1)return 1;return 0}
function score(app,words,likeApp){var s=0,why=[],fields=[[app.n,6,'name'],[app.t,3,'subtitle'],[app.g.join(' '),4,'tag'],[app.c.join(' '),3,'category'],[app.d,1,'description']];
words.forEach(function(w){var ex=expand(w),best=0,bw=null;ex.forEach(function(e,ei){fields.forEach(function(f){norm(f[0]).forEach(function(tok){var m=tokMatch(tok,e,ei>0);if(m){var v=m*f[1]*(ei===0?1:.6);if(v>best){best=v;bw={f:f[2],tok:tok,syn:ei>0}}}})})});s+=best;if(bw)why.push(bw.syn?'\u201c'+w+'\u201d \u2248 '+bw.f+' \u201c'+bw.tok+'\u201d':bw.f+' \u201c'+bw.tok+'\u201d')});
if(likeApp&&app.s!==likeApp.s){var shared=app.g.filter(function(x){return likeApp.g.indexOf(x)>-1}),sc=app.c.filter(function(x){return likeApp.c.indexOf(x)>-1});s+=shared.length*4+sc.length*8;if(shared.length||sc.length)why.push('like '+likeApp.n+': '+sc.concat(shared).slice(0,3).join(', '))}return{s:s,why:why}}
function run(q,nl){var words=norm(q),likeApp=null,kind=null;
var m=q.toLowerCase().match(/like\s+(.+)$/);if(m){var nm=norm(m[1]).join(' ');likeApp=IDX.filter(function(a){return norm(a.n).join(' ')===nm||norm(a.n).join(' ').indexOf(nm)>-1})[0]||null}
if(nl){if(/\bgames?\b/.test(q.toLowerCase()))kind='game';if(/\bapps?\b|tool|utility/.test(q.toLowerCase())&&!kind)kind='app';words=words.filter(function(w){return STOP.indexOf(w)<0});if(likeApp)words=words.filter(function(w){return norm(likeApp.n).indexOf(w)<0})}
var list=IDX.map(function(a){var r=score(a,words,likeApp);return{a:a,w:r.why,s:r.s+(kind&&a.k===kind?1:0)}}).filter(function(x){return x.s>(likeApp&&!words.length?0:0)&&(!kind||x.a.k===kind||x.s>6)}).sort(function(x,y){return y.s-x.s}).slice(0,60);
if(!words.length&&!likeApp)list=[];return{list:list.map(function(x){var o=Object.create(x.a);o.why=x.w;return o}),like:likeApp}}
function esc(s){return s.replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function tile(a){var ic=a.i?'<img class="icon" src="'+B+esc(a.i)+'" alt="" width="64" height="64" loading="lazy" decoding="async">':'<span class="icon" style="--a:'+esc(a.a||'#5b4be8')+'" aria-hidden="true">'+esc(a.n.charAt(0))+'</span>';return'<a class="tile" href="'+B+'app/'+esc(a.s)+'/">'+ic+'<span class="t"><b>'+esc(a.n)+'</b><small>'+esc(a.t)+'</small>'+(a.why&&a.why.length?'<em class="why">'+esc((window.WHY||'Matched')+': '+a.why.slice(0,2).join('; '))+'</em>':'')+'</span></a>'}
function askRemote(q){var ep=window.ASK_ENDPOINT;if(!ep)return Promise.reject();var c=new AbortController(),to=setTimeout(function(){c.abort()},4000);return fetch(ep,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:q,locale:'en'}),signal:c.signal}).then(function(r){clearTimeout(to);if(!r.ok)throw 0;return r.json()})}
function show(res,text){ans.hidden=!text;ans.textContent=text||'';out.innerHTML=res.length?res.map(tile).join(''):'<p>'+esc(window.NO_RESULTS||'Nothing matched.')+'</p>'}
function go(q,nl){q=q.trim();if(!q){out.innerHTML='';ans.hidden=true;return}load().then(function(){
 if(nl&&window.ASK_ENDPOINT){askRemote(q).then(function(j){var by={};IDX.forEach(function(a){by[a.s]=a});var r=(j.slugs||[]).map(function(s){return by[s]}).filter(Boolean);if(!r.length)throw 0;show(r,j.answer)}).catch(function(){var r=run(q,true);show(r.list,r.like?'Because you like '+r.like.n+':':'')});return}
 var r=run(q,nl);show(r.list,nl&&r.like?'Because you like '+r.like.n+':':'')})}
input.addEventListener('input',function(){go(input.value,false)});
form.addEventListener('submit',function(e){e.preventDefault();go(input.value,true);history.replaceState(null,'','?q='+encodeURIComponent(input.value))});
d.querySelectorAll('.sugg button').forEach(function(b){b.addEventListener('click',function(){input.value=b.textContent;go(b.textContent,true)})});
var p=new URLSearchParams(location.search).get('q');if(p){input.value=p;go(p,true)}
})();
