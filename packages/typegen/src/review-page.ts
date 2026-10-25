export function reviewPage(token: string, nonce: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Saylo translation review</title><style nonce="${nonce}">
body{font:16px system-ui;margin:2rem;max-width:1100px;color:#18212f;background:#fafafa}button,input,textarea{font:inherit;padding:.55rem}button{cursor:pointer}button:disabled{cursor:default}header,nav{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}main{display:grid;grid-template-columns:minmax(220px,1fr) 2fr;gap:1.5rem;margin-top:1rem}#list{max-height:70vh;overflow:auto}#list button{display:block;width:100%;text-align:left;margin-bottom:.3rem}textarea{box-sizing:border-box;width:100%;min-height:8rem}pre{white-space:pre-wrap;overflow-wrap:anywhere}#status{white-space:pre-wrap}label{display:block;margin:.8rem 0}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #4464db}@media(max-width:650px){main{grid-template-columns:1fr}#list{max-height:30vh}}</style></head>
<body><header><h1>Translation review</h1><button id="reload">Refresh catalogs</button></header>
<p>Changes stay local. Saving a translation and approving it are separate actions.</p>
<label>Search <input id="search" type="search" placeholder="Key, source or translation"></label>
<p id="status" role="status" aria-live="polite"></p><main><nav id="list" aria-label="Translation tasks"></nav>
<section aria-label="Selected translation"><h2 id="identity">Select a message</h2><pre id="context"></pre>
<h3>Current source</h3><pre id="source"></pre><h3>Current translation</h3><pre id="original"></pre>
<label>Draft translation<textarea id="draft" disabled></textarea></label>
<label>Reviewer <input id="reviewer" value="Local operator" maxlength="200"></label>
<nav><button id="validate" disabled>Validate draft</button><button id="save" disabled>Save translation</button><button id="approve" disabled>Approve saved translation</button></nav>
<pre id="result" role="status" aria-live="polite"></pre></section></main>
<script nonce="${nonce}">
const token=${JSON.stringify(token)};
const element=id=>document.getElementById(id);
let state,selected,dirty=false,busy=false,generation=0;
async function request(path,body){
 const response=await fetch('/api/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const result=await response.json();if(!response.ok)throw Error(result.error||'Request failed');return result;
}
function controls(){for(const id of ['validate','save','approve'])element(id).disabled=busy||!selected;
 element('draft').disabled=busy||!selected;element('approve').disabled=busy||!selected||dirty||selected.originalTranslation===null;}
function select(row){if(dirty&&!confirm('Discard this unsaved draft?'))return;selected=row;dirty=false;
 element('identity').textContent=row.locale+' '+row.namespace+':'+row.id+' — '+row.status;
 element('context').textContent=JSON.stringify(row.context,null,2);element('source').textContent=row.source;
 element('original').textContent=row.originalTranslation===null?'Not translated':row.originalTranslation;
 element('draft').value=row.originalTranslation??'';element('result').textContent='';controls();}
async function load(){const requestId=++generation;
 try{const result=await request('state?q='+encodeURIComponent(element('search').value));if(requestId!==generation)return;
 state=result;selected=undefined;dirty=false;element('list').replaceChildren();
 element('status').textContent=result.total+' messages; showing '+result.rows.length+'. '+result.diagnostics.map(x=>x.code+': '+x.message).join('\\n');
 for(const row of result.rows){const button=document.createElement('button');button.textContent=row.locale+' '+row.namespace+':'+row.id+' — '+row.status;button.onclick=()=>select(row);element('list').append(button);}controls();
 }catch(error){element('status').textContent=String(error);}}
element('draft').oninput=()=>{dirty=true;controls();};
element('reload').onclick=()=>{if(!dirty||confirm('Discard this unsaved draft and refresh?'))void load();};
let searchTimer;element('search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{if(!dirty||confirm('Discard this unsaved draft and search?'))void load();},200);};
async function action(kind){if(!selected||busy)return;busy=true;controls();
 try{const result=await request(kind,{revision:state.revision,entry:{locale:selected.locale,namespace:selected.namespace,id:selected.id,translation:element('draft').value},reviewer:element('reviewer').value});
 element('result').textContent=JSON.stringify(result,null,2);
 if(kind!=='preview'&&!result.blocked){dirty=false;await load();}
 }catch(error){element('result').textContent=String(error)+'; refresh before retrying a stale draft.';}
 finally{busy=false;controls();}}
element('validate').onclick=()=>void action('preview');element('save').onclick=()=>void action('save');element('approve').onclick=()=>void action('approve');
addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
void load();
</script></body></html>`;
}
