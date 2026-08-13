(function(){
'use strict';
if (window.__rfInit) return;
window.__rfInit = true;

/* ══════════ Générateur Code128 (Set A) — validé round-trip contre douchette Honeywell ══════════ */
var RF_C128 = ["212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212","112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131","311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121","313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111","314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212","124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113","114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112"];
function rfValA(o){ if(o<=31) return o+64; if(o<=95) return o-32; return -1; }
function rfC128svg(data, mod, h, quiet){
  mod = mod || 2; h = h || 68; quiet = (quiet==null ? 10 : quiet);
  var vals=[103], i, v;
  for(i=0;i<data.length;i++){ v = rfValA(data.charCodeAt(i)); if(v<0) return null; vals.push(v); }
  var sum = vals[0];
  for(i=1;i<vals.length;i++){ sum += vals[i]*i; }
  vals.push(sum % 103); vals.push(106);
  var widths=""; for(i=0;i<vals.length;i++){ widths += RF_C128[vals[i]]; }
  var total=0; for(i=0;i<widths.length;i++){ total += parseInt(widths.charAt(i),10); }
  total += 2*quiet;
  var W = total*mod, x = quiet*mod, bar=true, rects="", wm;
  for(i=0;i<widths.length;i++){
    wm = parseInt(widths.charAt(i),10)*mod;
    if(bar){ rects += '<rect x="'+x+'" y="0" width="'+wm+'" height="'+h+'"/>'; }
    x += wm; bar = !bar;
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+h+'" viewBox="0 0 '+W+' '+h+'" shape-rendering="crispEdges"><rect x="0" y="0" width="'+W+'" height="'+h+'" fill="#fff"/><g fill="#000">'+rects+'</g></svg>';
}

/* ══════════ Commandes Honeywell 1911i vérifiées (User Guide officiel Xenon/Granit) ══════════ */
/* Préfixe menu = SYN M CR (ASCII 22,77,13) ; stockage non-volatile = '.' */
var RF_PFX = '\x16M\x0D';
var RF_BC = [
  { key:'cont',   cmd:RF_PFX+'PAPSPN.',  mn:'PAPSPN',  emoji:'⚡', titre:'Rafale continue',   sous:'Streaming Presentation — la douchette lit en continu, sans gâchette. Idéal posée face aux sacs.' },
  { key:'stand',  cmd:RF_PFX+'TRGSSW1.', mn:'TRGSSW1', emoji:'📡', titre:'Rafale sur socle',   sous:'In-Stand Sensor — rafale auto quand la douchette est sur son support, manuelle dès qu\'on la reprend en main.' },
  { key:'manual', cmd:RF_PFX+'PAPHHF.',  mn:'PAPHHF',  emoji:'🔙', titre:'Retour manuel',      sous:'Manual Trigger — lecture uniquement en appuyant sur la gâchette. Annule tous les modes auto.' }
];

/* ══════════ État rafale logicielle ══════════ */
var rf = { on:false, flushTimer:null, blurTimer:null };
var scanInput = document.getElementById('scan-input');

function rfDashActive(){
  var p = document.getElementById('tab-dashboard');
  return !!(p && p.classList.contains('active'));
}
function rfModalOpen(){
  var m = document.getElementById('rf-modal');
  return !!(m && m.classList.contains('rf-open'));
}
function rfRefocus(){
  if(rf.on && scanInput && rfDashActive() && !rfModalOpen()){
    try { scanInput.focus({preventScroll:true}); } catch(e){ try{ scanInput.focus(); }catch(e2){} }
  }
}
function rfFlush(){
  if(!scanInput) return;
  var v = (scanInput.value || '').replace(/[\r\n]/g,'').trim();
  if(v){ scanInput.value=''; if(typeof addSac==='function') addSac(v); }
}

/* ══════════ Toggle rafale logicielle ══════════ */
function rfSet(on){
  rf.on = !!on;
  var btn = document.getElementById('rf-toggle');
  if(btn){
    btn.classList.toggle('rf-active', rf.on);
    btn.setAttribute('aria-pressed', rf.on ? 'true' : 'false');
    var lab = document.getElementById('rf-toggle-lab');
    if(lab) lab.textContent = rf.on ? 'RAFALE : ON' : 'RAFALE : OFF';
  }
  if(typeof showToast==='function'){
    showToast(rf.on ? '⚡ Rafale appli ON — champ toujours prêt' : 'Rafale appli OFF', rf.on ? '#0F7A3C' : '#8894A8');
  }
  if(rf.on) rfRefocus();
}
function rfToggle(){ rfSet(!rf.on); }

/* ══════════ Écouteurs (flush inactivité pour scans sans Entrée + verrou focus) ══════════ */
if(scanInput){
  scanInput.addEventListener('input', function(){
    if(!rf.on) return;
    if(rf.flushTimer) clearTimeout(rf.flushTimer);
    rf.flushTimer = setTimeout(rfFlush, 150);
  });
  scanInput.addEventListener('blur', function(){
    if(!rf.on) return;
    if(rf.blurTimer) clearTimeout(rf.blurTimer);
    rf.blurTimer = setTimeout(rfRefocus, 180);
  });
}
document.addEventListener('click', function(e){
  if(!rf.on) return;
  var t = e.target;
  if(t && t.closest && (t.closest('#rf-bar') || t.closest('#rf-modal'))) return;
  setTimeout(rfRefocus, 30);
});
document.addEventListener('keydown', function(e){
  if(e.key === 'F2'){ e.preventDefault(); rfToggle(); }
});

/* ══════════ Centre de configuration douchette (modale + barcodes) ══════════ */
function rfBuildModal(){
  if(document.getElementById('rf-modal')) return;
  var ov = document.createElement('div');
  ov.id = 'rf-modal';
  ov.className = 'rf-modal';
  var cards = '';
  for(var i=0;i<RF_BC.length;i++){
    var b = RF_BC[i];
    var svg = rfC128svg(b.cmd, 2, 70) || '<div class="rf-err">Code indisponible</div>';
    cards +=
      '<div class="rf-card" id="rf-card-'+b.key+'">'+
        '<div class="rf-card-head"><span class="rf-emo">'+b.emoji+'</span><div><div class="rf-card-titre">'+b.titre+'</div><div class="rf-card-sous">'+b.sous+'</div></div></div>'+
        '<div class="rf-bc">'+svg+'</div>'+
        '<div class="rf-cmd">cmd&nbsp;: <code>'+b.mn+'</code></div>'+
      '</div>';
  }
  ov.innerHTML =
    '<div class="rf-sheet" role="dialog" aria-label="Configuration douchette Honeywell">'+
      '<div class="rf-sheet-top">'+
        '<div class="rf-sheet-title">🔫 Douchette Honeywell 1911i — Mode Rafale</div>'+
        '<button type="button" class="rf-x" id="rf-close" aria-label="Fermer">✕</button>'+
      '</div>'+
      '<p class="rf-intro">Mains-libres = <b>2 réglages</b>. ①&nbsp;Côté appli (verrou de focus, bouton ⚡). ②&nbsp;Côté douchette : <b>flashe l\'un des codes ci-dessous</b> directement depuis cet écran. Les commandes sont issues du guide officiel Honeywell.</p>'+
      '<div class="rf-sync">'+
        '<button type="button" class="rf-syncbtn rf-syncgo" id="rf-sync-on">⚡ Activer Rafale continue <span>(appli + code à flasher)</span></button>'+
        '<button type="button" class="rf-syncbtn rf-syncoff" id="rf-sync-off">🔙 Repasser en manuel</button>'+
      '</div>'+
      '<div class="rf-cards">'+cards+'</div>'+
      '<div class="rf-foot">'+
        '<button type="button" class="rf-print" id="rf-print">🖨️ Imprimer les codes</button>'+
        '<span class="rf-hint">Astuce : garde la douchette à ~10&nbsp;cm de l\'écran, luminosité à fond.</span>'+
      '</div>'+
    '</div>';
  document.body.appendChild(ov);

  var close = document.getElementById('rf-close');
  if(close) close.addEventListener('click', rfCloseModal);
  ov.addEventListener('click', function(e){ if(e.target === ov) rfCloseModal(); });
  var syncOn = document.getElementById('rf-sync-on');
  if(syncOn) syncOn.addEventListener('click', function(){
    rfSet(true);
    rfHighlight('cont');
    if(typeof showToast==='function') showToast('⚡ Flashe le code ① avec la douchette pour finir', '#0F7A3C');
  });
  var syncOff = document.getElementById('rf-sync-off');
  if(syncOff) syncOff.addEventListener('click', function(){
    rfSet(false);
    rfHighlight('manual');
    if(typeof showToast==='function') showToast('🔙 Flashe le code ③ pour remettre la douchette en manuel', '#8894A8');
  });
  var prn = document.getElementById('rf-print');
  if(prn) prn.addEventListener('click', rfPrint);
}
function rfHighlight(key){
  for(var i=0;i<RF_BC.length;i++){
    var c = document.getElementById('rf-card-'+RF_BC[i].key);
    if(c) c.classList.remove('rf-hot');
  }
  var el = document.getElementById('rf-card-'+key);
  if(el){ el.classList.add('rf-hot'); el.scrollIntoView({behavior:'smooth', block:'center'}); }
}
function rfOpenModal(){
  rfBuildModal();
  var m = document.getElementById('rf-modal');
  if(m) m.classList.add('rf-open');
}
function rfCloseModal(){
  var m = document.getElementById('rf-modal');
  if(m) m.classList.remove('rf-open');
  rfRefocus();
}
function rfPrint(){
  var parts = '';
  for(var i=0;i<RF_BC.length;i++){
    var b = RF_BC[i];
    var svg = rfC128svg(b.cmd, 3, 90) || '';
    parts += '<div class="p"><h2>'+b.emoji+' '+b.titre+'</h2><p>'+b.sous+'</p>'+svg+'<div class="c">'+b.mn+'</div></div>';
  }
  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Codes douchette Honeywell 1911i</title>'+
    '<style>body{font-family:Segoe UI,Arial,sans-serif;padding:24px;color:#111}h1{font-size:18px}.p{margin:22px 0;padding:16px;border:1px solid #ccc;border-radius:10px;page-break-inside:avoid}.p h2{font-size:15px;margin:0 0 4px}.p p{font-size:12px;color:#555;margin:0 0 10px}.c{font-family:monospace;font-size:12px;color:#333;margin-top:6px}</style></head>'+
    '<body><h1>Honeywell Granit 1911i — Codes de configuration Rafale</h1>'+parts+'<script>window.onload=function(){window.print();};<\/script></body></html>';
  var w = window.open('', '_blank');
  if(w){ w.document.open(); w.document.write(html); w.document.close(); }
  else if(typeof showToast==='function'){ showToast('Popup bloquée — autorise les fenêtres pour imprimer', '#C62828'); }
}

/* ══════════ Barre flottante (⚡ + 🔫) ══════════ */
function rfBuildBar(){
  if(document.getElementById('rf-bar')) return;
  var bar = document.createElement('div');
  bar.id = 'rf-bar';
  bar.innerHTML =
    '<button type="button" id="rf-toggle" class="rf-pill" aria-pressed="false" title="Rafale appli (F2)"><span class="rf-ico">⚡</span><span id="rf-toggle-lab">RAFALE : OFF</span></button>'+
    '<button type="button" id="rf-config" class="rf-pill rf-pill-cfg" title="Configurer la douchette"><span class="rf-ico">🔫</span><span>Douchette</span></button>';
  document.body.appendChild(bar);
  var t = document.getElementById('rf-toggle');
  if(t) t.addEventListener('click', rfToggle);
  var c = document.getElementById('rf-config');
  if(c) c.addEventListener('click', rfOpenModal);
}

/* ══════════ Styles ══════════ */
function rfInjectCSS(){
  if(document.getElementById('rf-style')) return;
  var s = document.createElement('style');
  s.id = 'rf-style';
  s.textContent =
    '#rf-bar{position:fixed;right:16px;bottom:16px;display:flex;gap:10px;z-index:9000}'+
    '.rf-pill{display:inline-flex;align-items:center;gap:8px;padding:11px 16px;border-radius:999px;border:1px solid #C5D4F0;background:#FFFFFF;color:#1A1A2E;font-size:13px;font-weight:800;letter-spacing:.3px;cursor:pointer;box-shadow:0 4px 16px rgba(15,42,90,.16);transition:transform .12s,box-shadow .12s,background .12s}'+
    '.rf-pill:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(15,42,90,.22)}'+
    '.rf-pill:active{transform:translateY(0)}'+
    '.rf-ico{font-size:15px;line-height:1}'+
    '.rf-pill-cfg{background:#F3F7FF}'+
    '#rf-toggle.rf-active{background:linear-gradient(135deg,#12A150,#0F7A3C);color:#fff;border-color:#0F7A3C;box-shadow:0 6px 22px rgba(15,122,60,.4)}'+
    '.rf-modal{position:fixed;inset:0;background:rgba(12,20,40,.42);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;z-index:9500;padding:18px}'+
    '.rf-modal.rf-open{display:flex}'+
    '.rf-sheet{width:min(560px,100%);max-height:88vh;overflow:auto;background:#FBFDFF;border:1px solid #E1EAF7;border-radius:20px;box-shadow:0 24px 70px rgba(10,25,60,.35);padding:18px 18px 16px}'+
    '.rf-sheet-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px}'+
    '.rf-sheet-title{font-size:16px;font-weight:900;color:#0F2A5A}'+
    '.rf-x{width:34px;height:34px;border-radius:50%;border:1px solid #E1EAF7;background:#fff;color:#5A6A85;font-size:15px;cursor:pointer;line-height:1}'+
    '.rf-x:hover{background:#F0F4FA}'+
    '.rf-intro{font-size:12.5px;line-height:1.5;color:#43506B;margin:6px 0 12px}'+
    '.rf-sync{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px}'+
    '.rf-syncbtn{flex:1 1 auto;padding:12px 14px;border-radius:12px;border:none;font-size:13px;font-weight:800;cursor:pointer}'+
    '.rf-syncbtn span{font-weight:600;opacity:.85;font-size:11px;display:block}'+
    '.rf-syncgo{background:linear-gradient(135deg,#12A150,#0F7A3C);color:#fff}'+
    '.rf-syncoff{background:#EEF2F8;color:#3A4761}'+
    '.rf-syncbtn:hover{filter:brightness(1.05)}'+
    '.rf-cards{display:flex;flex-direction:column;gap:12px}'+
    '.rf-card{border:1px solid #E4ECF8;border-radius:14px;padding:12px;background:#fff;transition:box-shadow .15s,border-color .15s}'+
    '.rf-card.rf-hot{border-color:#12A150;box-shadow:0 0 0 3px rgba(18,161,80,.18)}'+
    '.rf-card-head{display:flex;gap:10px;align-items:flex-start;margin-bottom:10px}'+
    '.rf-emo{font-size:20px;line-height:1}'+
    '.rf-card-titre{font-size:14px;font-weight:800;color:#16233D}'+
    '.rf-card-sous{font-size:11.5px;color:#5A6A85;line-height:1.45;margin-top:2px}'+
    '.rf-bc{background:#fff;border-radius:8px;text-align:center;padding:6px 4px;overflow:auto}'+
    '.rf-bc svg{max-width:100%;height:auto}'+
    '.rf-cmd{font-size:11px;color:#8894A8;text-align:center;margin-top:6px}'+
    '.rf-cmd code{background:#F0F4FA;padding:1px 6px;border-radius:5px;color:#3A4761;font-weight:700}'+
    '.rf-foot{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:14px;padding-top:12px;border-top:1px solid #EDF1F7}'+
    '.rf-print{padding:9px 14px;border-radius:10px;border:1px solid #C5D4F0;background:#fff;color:#0F2A5A;font-size:12.5px;font-weight:700;cursor:pointer}'+
    '.rf-print:hover{background:#F3F7FF}'+
    '.rf-hint{font-size:11px;color:#8894A8}'+
    '.rf-err{color:#C62828;font-size:12px;text-align:center;padding:10px}'+
    '@media print{#rf-bar{display:none}}';
  document.head.appendChild(s);
}

/* ══════════ Init ══════════ */
function rfInit(){
  rfInjectCSS();
  rfBuildBar();
}
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', rfInit);
} else {
  rfInit();
}
})();
