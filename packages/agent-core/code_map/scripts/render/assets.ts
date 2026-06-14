// Static client assets: light theme CSS, the per-page search/nav script, the
// Code Map shell app, and the data bundles (file:// safe — assigned, not fetched).

import type { ReferenceRec, SourceFileRec, SymbolRec } from "../extract/model.js";

export function buildSearchData(symbols: SymbolRec[]): string {
  const entries = symbols
    .filter((s) => !s.container && s.kind !== "barrel-reexport")
    .map((s) => ({ n: s.name, k: s.kindTags[0] ?? s.kind, m: s.module, f: s.file, l: s.decl.line, h: `${s.name} ${s.kind} ${s.module}`.toLowerCase() }));
  return `window.__SEARCH__=${JSON.stringify(entries)};`;
}

export function buildCodeData(
  symbols: SymbolRec[],
  references: Record<string, ReferenceRec>,
  source: Record<string, SourceFileRec>,
): string {
  const compactSyms = symbols.map((s) => ({
    id: s.symbolId,
    name: s.name,
    kind: s.kind,
    tags: s.kindTags,
    vis: s.visibility,
    band: s.roleBand,
    bandRank: s.bandRank,
    visRank: s.visRank,
    file: s.file,
    line: s.decl.line,
    container: s.container,
    members: s.members,
    signature: s.signature,
  }));
  const files: Record<string, { isTest: boolean; lines: SourceFileRec["lines"] }> = {};
  for (const [k, v] of Object.entries(source)) files[k] = { isTest: v.isTest, lines: v.lines };
  return `window.__EOS__=${JSON.stringify({ files, symbols: compactSyms, refs: references })};`;
}

export const THEME_CSS = `
:root{
  --bg:#fbfcfd; --surface:#ffffff; --line:#e6e9ee; --line2:#eef1f5;
  --ink:#1c2530; --dim:#6b7785; --faint:#97a2af; --accent:#2563eb; --accent-soft:#eff4ff;
  --pub:#0a7d33; --mod:#9a6a00; --loc:#7a818b;
  --k:#7c3aed; --s:#0a7d33; --n:#b45309; --c:#8a94a2; --r:#be185d;
  --mono:"SFMono-Regular",ui-monospace,"JetBrains Mono",Menlo,Consolas,monospace;
  --sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--ink);font:14px/1.55 var(--sans)}
body.full{overflow:hidden}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
code{font-family:var(--mono);font-size:.92em}
.dim{color:var(--dim)} .num{color:var(--faint);font-variant-numeric:tabular-nums}

.topbar{display:flex;align-items:center;gap:16px;height:48px;padding:0 16px;background:var(--surface);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20}
.brand{font-weight:650;color:var(--ink)}.brand span{margin-left:7px;color:var(--faint);font-weight:400;font-size:12px}
.search{flex:1;max-width:520px;height:30px;padding:0 12px;border:1px solid var(--line);border-radius:8px;background:#fff;font:13px var(--sans);outline:none}
.search:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.tabs{display:flex;gap:4px;margin-left:auto}
.tab{padding:6px 12px;border-radius:7px;color:var(--dim);font-weight:500}
.tab:hover{background:var(--line2);text-decoration:none}
.tab.on{background:var(--accent-soft);color:var(--accent)}
.crumbs{padding:8px 18px;color:var(--dim);font-size:12.5px;background:var(--surface);border-bottom:1px solid var(--line2)}
.crumbs .sep{margin:0 7px;color:var(--faint)}
.foot{padding:14px 18px;color:var(--faint);font-size:12px;border-top:1px solid var(--line2)}

main{padding:0}
.cols{display:grid;grid-template-columns:1fr 300px;gap:28px;max-width:1180px;margin:0 auto;padding:24px 20px}
.col-rail h3{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--faint);margin:18px 0 8px}
h1{font-size:24px;margin:6px 0 14px}h2{font-size:17px;margin:26px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line2)}
.note{background:var(--accent-soft);border:1px solid #dbe6ff;border-radius:10px;padding:12px 14px;color:#33485f}
.prose{color:#2a3540}.prose.small{font-size:12.5px}
.prose table{border-collapse:collapse;width:100%;margin:10px 0;font-size:12.5px}
.prose th,.prose td{border:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top}
.prose th{background:var(--line2)}
.prose pre.md-code{background:#f6f8fb;border:1px solid var(--line);border-radius:8px;padding:11px 13px;overflow:auto;font-size:12px;line-height:1.55;margin:10px 0}
.prose pre.md-code code{color:#2a3540;font-size:12px}
.prose :not(pre)>code{background:var(--line2);border-radius:4px;padding:1px 4px}

.api-card{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px}
.api-grp h4{margin:0 0 6px;font-size:12px;color:var(--faint);text-transform:uppercase;letter-spacing:.04em}
.chip{display:inline-flex;align-items:center;gap:6px;background:var(--surface);border:1px solid var(--line);border-radius:7px;padding:3px 8px;margin:0 5px 5px 0;color:var(--ink);font-size:12.5px}
.chip:hover{border-color:var(--accent);text-decoration:none}
.mod-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
.mod-card{display:block;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px 16px;color:var(--ink)}
.mod-card:hover{border-color:var(--accent);text-decoration:none;box-shadow:0 2px 10px rgba(37,99,235,.06)}
.mod-card h3{margin:0 0 4px;font-size:15px}.mod-card .meta{font-size:12px;color:var(--dim)}.mod-card .dim{font-size:11px}
.stats{display:flex;flex-wrap:wrap;gap:12px;margin:14px 0 24px}
.stat{flex:1;min-width:118px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:13px 16px}
.stat b{display:block;font-size:25px;line-height:1.1;font-variant-numeric:tabular-nums}
.stat span{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--faint)}
.edges,.kv,.files{list-style:none;margin:0;padding:0;font-size:12.5px}
.edges li,.kv li,.files li{padding:3px 0;border-bottom:1px solid var(--line2)}
.kv b{float:right}.arrow{color:var(--faint)}

.kb{display:inline-block;min-width:15px;text-align:center;font-family:var(--mono);font-size:10px;background:var(--line2);color:var(--dim);border-radius:4px;padding:1px 4px;margin-right:6px}
.vis{font-size:10.5px;border-radius:4px;padding:1px 6px}
.v-pub{color:var(--pub);background:#eafaf0}.v-mod{color:var(--mod);background:#fdf6e6}.v-loc{color:var(--loc);background:var(--line2)}
table.sym,table.cov{border-collapse:collapse;width:100%;font-size:13px;margin:6px 0 18px}
table.sym td,table.sym th,table.cov td,table.cov th{border-bottom:1px solid var(--line2);padding:6px 8px;text-align:left;vertical-align:top}
table.sym th,table.cov th{color:var(--faint);font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.03em}
table.sym .sig code{color:var(--dim);font-size:11.5px}
.vis-h{font-size:13px;margin:18px 0 4px}
.pill{font-size:10px;border-radius:4px;padding:1px 6px;background:var(--line2);color:var(--dim)}.pill.e2e{background:#fdf6e6;color:var(--mod)}
.cov a{display:inline-block}.miss{color:var(--faint)}

/* ── Code Map shell ── */
.ide{display:grid;grid-template-columns:260px 1fr 300px;height:calc(100vh - 49px)}
.sidebar,.rail{background:var(--surface);overflow:auto}
.sidebar{border-right:1px solid var(--line)}.rail{border-left:1px solid var(--line);padding:0 12px 24px}
.side-h{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--faint);padding:10px 12px 6px;position:sticky;top:0;background:var(--surface)}
.tree{padding:0 6px 24px;font-size:13px}
.tree details{margin:0}.tree summary{cursor:pointer;padding:2px 6px;border-radius:5px;color:var(--ink);list-style:none}
.tree summary::-webkit-details-marker{display:none}
.tree summary::before{content:"▸";color:var(--faint);font-size:10px;margin-right:5px}
.tree details[open]>summary::before{content:"▾"}
.tree summary:hover{background:var(--line2)}
.tree-children{padding-left:13px;border-left:1px solid var(--line2);margin-left:7px}
.tf{display:block;padding:2px 6px;border-radius:5px;color:var(--ink);white-space:nowrap}
.tf:hover{background:var(--line2);text-decoration:none}.tf.on{background:var(--accent-soft);color:var(--accent)}
.viewer{overflow:auto;background:var(--surface)}
.viewer .empty{padding:40px;color:var(--faint)}
.vh{position:sticky;top:0;background:var(--surface);border-bottom:1px solid var(--line2);padding:8px 14px;font-size:12.5px;z-index:1}
.code{font-family:var(--mono);font-size:12.5px;line-height:1.6;padding:6px 0 60vh}
.ln{display:flex;scroll-margin-top:48px}
.ln.hot{background:#fff3cd;box-shadow:inset 3px 0 0 var(--accent)}
.ln.hot .gut{color:var(--accent);font-weight:600}
.guta{color:var(--faint);text-decoration:none}
.gut{display:inline-block;width:46px;text-align:right;padding-right:14px;color:var(--faint);user-select:none}
.gut:hover{color:var(--accent)}
.lc{white-space:pre;flex:1;padding-right:16px}
.t-k{color:var(--k)}.t-s{color:var(--s)}.t-n{color:var(--n)}.t-c{color:var(--c);font-style:italic}.t-r{color:var(--r)}
a.tok{color:inherit;border-bottom:1px dotted #bcd}
a.tok:hover{background:var(--accent-soft);text-decoration:none;border-bottom-color:var(--accent)}
.obed{margin-bottom:12px}.ob-h{font-size:11px;color:var(--faint);text-transform:uppercase;letter-spacing:.03em;margin:6px 0 2px}
.oi{display:block;padding:2px 6px;border-radius:5px;color:var(--ink);font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.oi:hover{background:var(--line2);text-decoration:none}.oi.on{background:var(--accent-soft);color:var(--accent)}
.oi.mem{padding-left:24px;color:var(--dim);font-size:12px}
.rf-h{margin:4px 0 8px}.rf-file{margin-bottom:8px}.rf-fn{font-size:12px;color:var(--dim);margin-bottom:2px}
.rf-l{display:block;padding:1px 8px;font-size:12px;color:var(--accent)}.rf-l:hover{background:var(--line2);text-decoration:none}

.page{max-width:1180px;margin:0 auto;padding:24px 20px}
.subtabs{margin-top:8px}
.subtabs>input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.subtabs>label{display:inline-block;padding:8px 16px;margin-right:6px;border:1px solid var(--line);border-bottom:none;border-radius:9px 9px 0 0;color:var(--dim);cursor:pointer;font-weight:550;font-size:13px}
.subtabs>label:hover{background:var(--line2)}
#ct-cov:checked~label[for="ct-cov"],#ct-e2e:checked~label[for="ct-e2e"]{background:var(--accent-soft);color:var(--accent)}
.covpanel{display:none;border-top:1px solid var(--line);padding-top:20px}
#ct-cov:checked~#p-cov,#ct-e2e:checked~#p-e2e{display:block}
.results{position:fixed;top:46px;left:50%;transform:translateX(-50%);width:min(640px,92vw);max-height:70vh;overflow:auto;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 12px 40px rgba(20,30,45,.16);z-index:50}
.r-item{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:7px 12px;border-bottom:1px solid var(--line2);color:var(--ink)}
.r-item:hover{background:var(--accent-soft);text-decoration:none}
.r-k{font-family:var(--mono);font-size:10px;color:var(--dim);background:var(--line2);border-radius:4px;padding:1px 5px}
.r-m{color:var(--faint);font-size:11px}.r-f{grid-column:2/4;color:var(--faint);font-size:11px;font-family:var(--mono)}
@media(max-width:900px){.cols{grid-template-columns:1fr}.ide{grid-template-columns:200px 1fr}.rail{display:none}}
`;

export const NAV_JS = `(function(){
  var data=window.__SEARCH__||[];var q=document.getElementById('q');var box=document.getElementById('results');
  if(!q||!box)return;var shell=q.getAttribute('data-shell');
  function esc(s){return String(s==null?'':s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
  function hide(){box.hidden=true;box.innerHTML='';}
  function run(){var v=q.value.trim().toLowerCase();if(!v){hide();return;}
    var hits=data.filter(function(d){return d.h.indexOf(v)>=0;});
    hits.sort(function(a,b){return (a.n.toLowerCase()===v?-1:0)-(b.n.toLowerCase()===v?-1:0)||a.n.length-b.n.length;});
    hits=hits.slice(0,40);if(!hits.length){hide();return;}
    box.innerHTML=hits.map(function(d){return '<a class="r-item" href="'+shell+'#/'+d.f+'~L'+d.l+'"><span class="r-k">'+esc(d.k)+'</span><b>'+esc(d.n)+'</b><span class="r-m">'+esc(d.m)+'</span><span class="r-f">'+esc(d.f)+':'+d.l+'</span></a>';}).join('');
    box.hidden=false;}
  q.addEventListener('input',run);
  document.addEventListener('keydown',function(e){if(e.key==='/'&&document.activeElement!==q){e.preventDefault();q.focus();}else if(e.key==='Escape'){hide();q.blur();}});
  document.addEventListener('click',function(e){if(e.target!==q&&!box.contains(e.target))hide();});
})();`;

export const APP_JS = `(function(){
  var D=window.__EOS__;if(!D)return;var files=D.files,symbols=D.symbols,refs=D.refs;
  var byId={},byFile={};
  symbols.forEach(function(s){byId[s.id]=s;(byFile[s.file]=byFile[s.file]||[]).push(s);});
  var viewer=document.getElementById('viewer'),outline=document.getElementById('outline'),refsEl=document.getElementById('refs');
  function el(t,c){var e=document.createElement(t);if(c)e.className=c;return e;}
  function esc(s){return String(s==null?'':s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
  function fileOrder(a,b){return a.bandRank-b.bandRank||a.visRank-b.visRank||a.line-b.line||a.name.localeCompare(b.name);}
  function parseHash(){var h=decodeURIComponent(location.hash.replace(/^#\\/?/,''));var line=null;var m=h.match(/^(.*)~L(\\d+)$/);if(m){h=m[1];line=parseInt(m[2],10);}return {file:h,line:line};}
  var currentFile=null;
  if('scrollRestoration' in history)history.scrollRestoration='manual';
  window.addEventListener('hashchange',route);route();
  function route(){
    var p=parseHash();if(!p.file||!files[p.file])return;
    if(p.file!==currentFile){renderFile(p.file);currentFile=p.file;setActiveTree(p.file);}
    gotoLine(p.file,p.line);
  }

  function renderFile(file){
    var rec=files[file];var pre=el('div','code');
    rec.lines.forEach(function(segs,idx){
      var ln=idx+1;var row=el('div','ln');row.id='L'+ln;
      var ga=el('a','guta');ga.href='#/'+file+'~L'+ln;var g=el('span','gut');g.textContent=ln;ga.appendChild(g);row.appendChild(ga);
      var code=el('span','lc');
      segs.forEach(function(seg){
        if(seg.target){var a=el('a','tok t-'+seg.c);a.textContent=seg.t;a.href='#/'+seg.target+(seg.line?'~L'+seg.line:'');if(seg.sym)a.setAttribute('data-sym',seg.sym);if(seg.sym&&byId[seg.sym])a.title=byId[seg.sym].signature||'';code.appendChild(a);}
        else{var sp=el('span','t-'+seg.c);sp.textContent=seg.t;code.appendChild(sp);}
      });
      row.appendChild(code);pre.appendChild(row);
    });
    var h=el('div','vh');h.innerHTML='<code>'+esc(file)+'</code> <span class="dim">'+rec.lines.length+' lines'+(rec.isTest?' · test':'')+'</span>';
    viewer.innerHTML='';viewer.appendChild(h);viewer.appendChild(pre);
    renderOutline(file);
  }

  function gotoLine(file,line){
    var ph=viewer.querySelector('.ln.hot');if(ph)ph.classList.remove('hot');
    var po=outline.querySelector('.oi.on');if(po)po.classList.remove('on');
    if(!line){refsEl.textContent='Select a symbol.';return;}
    var t=document.getElementById('L'+line);
    if(t){
      t.classList.add('hot');
      requestAnimationFrame(function(){requestAnimationFrame(function(){t.scrollIntoView({block:'center'});});});
    }
    var oa=outline.querySelector('.oi[data-line="'+line+'"]');if(oa)oa.classList.add('on');
    selectSymbolAtLine(file,line);
  }

  var BANDS=[['container','Containers'],['type','Types & Contracts'],['function','Functions & Values'],['helper','Helpers'],['reexport','Re-exports']];
  function renderOutline(file){
    outline.innerHTML='';var syms=(byFile[file]||[]).filter(function(s){return !s.container;});
    if(!syms.length){outline.innerHTML='<div class="dim">No top-level symbols.</div>';return;}
    BANDS.forEach(function(b){
      var items=syms.filter(function(s){return s.band===b[0];}).sort(fileOrder);if(!items.length)return;
      var grp=el('div','obed');var hd=el('div','ob-h');hd.textContent=b[1];grp.appendChild(hd);
      items.forEach(function(s){
        var a=el('a','oi');a.href='#/'+file+'~L'+s.line;a.setAttribute('data-line',s.line);
        a.innerHTML='<span class="kb">'+esc((s.tags&&s.tags[0])||s.kind)+'</span>'+esc(s.name);grp.appendChild(a);
        (s.members||[]).forEach(function(mid){var m=byId[mid];if(!m)return;var ma=el('a','oi mem');ma.href='#/'+file+'~L'+m.line;ma.setAttribute('data-line',m.line);ma.textContent=m.name;grp.appendChild(ma);});
      });
      outline.appendChild(grp);
    });
  }

  function selectSymbolAtLine(file,line){
    var s=(byFile[file]||[]).find(function(x){return x.line===line;});
    if(!s){refsEl.textContent='No symbol declared on this line.';return;}
    renderRefs(s);
  }
  function renderRefs(s){
    refsEl.innerHTML='';var head=el('div','rf-h');head.innerHTML='<b>'+esc(s.name)+'</b> <span class="dim">'+esc(s.kind)+'</span>';refsEl.appendChild(head);
    var r=refs[s.id];var list=r?r.references:[];
    if(!list.length){var d=el('div','dim');d.textContent='No references in package.';refsEl.appendChild(d);return;}
    var byf={};list.forEach(function(x){(byf[x.file]=byf[x.file]||[]).push(x);});
    Object.keys(byf).sort().forEach(function(f){
      var fg=el('div','rf-file');fg.innerHTML='<div class="rf-fn"><code>'+esc(f)+'</code> <span class="num">'+byf[f].length+'</span></div>';
      byf[f].forEach(function(x){var a=el('a','rf-l');a.href='#/'+f+'~L'+x.line;a.textContent='line '+x.line+(x.crossModule?' · cross-module':'')+(x.isWrite?' · write':'');fg.appendChild(a);});
      refsEl.appendChild(fg);
    });
  }
  function setActiveTree(file){
    var prev=document.querySelectorAll('.tf.on');for(var i=0;i<prev.length;i++)prev[i].classList.remove('on');
    var a=document.querySelector('.tf[data-path="'+file.replace(/"/g,'\\\\"')+'"]');
    if(a){a.classList.add('on');var p=a.parentElement;while(p){if(p.tagName==='DETAILS')p.open=true;p=p.parentElement;}a.scrollIntoView({block:'nearest'});}
  }
})();`;
