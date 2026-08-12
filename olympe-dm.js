/* ══════════════════════════════════════════════════════════════════════════
   OLYMPE-DM — Messagerie inter-dashboards (Gillot ⇄ Direction)
   • Réutilise la table Supabase partagée `public.messages`
     (colonnes : id, created_at, sender, kind['text'|'photo'|'voice'|'sos'], body, audio, deleted)
     → interopère avec l'app SOS et le Messenger d'Olympe (index2).
   • Texte + photo + vocal (push-to-talk), modification + suppression (soft-delete).
   • Alertes SOS (kind='sos') reçues et affichées en rouge + sirène sur les 2 dashboards.
   • Thème iOS dernière génération (bulles, verre dépoli, dark mode).
   • Chiffrement optionnel AES-GCM du texte (option encrypt:true) — désactivé par
     défaut pour rester compatible avec SOS et le Messenger existant.

   Montage :  OlympeDM.mount({ client, sender, title, encrypt })
     - client  : instance supabase-js authentifiée (sinon le module tente
                 window.parent.OlympeAuth.client() puis un client autonome).
     - sender  : nom affiché (ex 'Direction' ou pseudo agent).
     - title   : titre du panneau (def. 'Messagerie').
     - encrypt : true pour chiffrer le texte (def. false).
   API : OlympeDM.open(), .close(), .toggle(), .sendAlert(text), .unread()
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  if (global.OlympeDM) return;

  var CFG_DEFAULT = {
    url: 'https://eedvljmmvsxrcwhclfpg.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlZHZsam1tdnN4cmN3aGNsZnBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0OTgzMDcsImV4cCI6MjEwMDA3NDMwN30.Tmf3pchljBcjHpg5NzyJFA_gQPuYiKZqfwTjEYG5krA',
    email: 'gillot@0lympe.local', pass: 'gillot974'
  };

  var SB = null, _sender = 'Invité', _title = 'Messagerie', _encrypt = false;
  var _msgs = [], _byId = {}, _open = false, _unread = 0, _ready = false, _rec = null, _recBlob = [];

  /* ── utilitaires ── */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8); return v.toString(16); })); }
  function fmtT(iso) { try { return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  function scrollBottom() { var l = $('odm-list'); if (l) l.scrollTop = l.scrollHeight; }

  /* ── chiffrement AES-GCM (optionnel) ── */
  var ENC_MARK = '\u0001enc1:';
  var _keyPromise = null;
  function cryptoKey() {
    if (_keyPromise) return _keyPromise;
    var enc = new TextEncoder();
    _keyPromise = crypto.subtle.importKey('raw', enc.encode('olympe-dm-shared-2026'), { name: 'PBKDF2' }, false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: enc.encode('olympe-gillot-direction'), iterations: 100000, hash: 'SHA-256' },
          base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      });
    return _keyPromise;
  }
  function b64(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
  function unb64(str) { var s = atob(str), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  function encText(txt) {
    return cryptoKey().then(function (k) {
      var iv = crypto.getRandomValues(new Uint8Array(12));
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, new TextEncoder().encode(txt))
        .then(function (ct) { return ENC_MARK + b64(iv) + ':' + b64(ct); });
    });
  }
  function decText(body) {
    if (String(body).indexOf(ENC_MARK) !== 0) return Promise.resolve(body);
    var parts = body.slice(ENC_MARK.length).split(':');
    if (parts.length !== 2) return Promise.resolve('[message chiffré]');
    return cryptoKey().then(function (k) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(parts[0]) }, k, unb64(parts[1]))
        .then(function (pt) { return new TextDecoder().decode(pt); });
    }).catch(function () { return '[message chiffré]'; });
  }
  function looksEncrypted(b) { return String(b || '').indexOf(ENC_MARK) === 0; }

  /* ── sirène SOS (WebAudio) ── */
  function siren() {
    try {
      var ac = new (global.AudioContext || global.webkitAudioContext)();
      [0, 0.6, 1.2].forEach(function (t0) {
        var o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(760, ac.currentTime + t0);
        o.frequency.linearRampToValueAtTime(1180, ac.currentTime + t0 + 0.28);
        o.frequency.linearRampToValueAtTime(760, ac.currentTime + t0 + 0.55);
        g.gain.setValueAtTime(0.0001, ac.currentTime + t0);
        g.gain.exponentialRampToValueAtTime(0.5, ac.currentTime + t0 + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t0 + 0.55);
        o.connect(g); g.connect(ac.destination); o.start(ac.currentTime + t0); o.stop(ac.currentTime + t0 + 0.6);
      });
    } catch (e) {}
  }

  /* ── UI : injection du style + DOM ── */
  function injectCss() {
    if ($('odm-style')) return;
    var st = document.createElement('style'); st.id = 'odm-style';
    st.textContent = [
      '#odm-fab{position:fixed;right:18px;bottom:18px;z-index:100095;width:58px;height:58px;border-radius:50%;border:none;',
      'background:linear-gradient(160deg,#0A84FF,#0060DF);color:#fff;font-size:25px;cursor:pointer;box-shadow:0 10px 26px rgba(10,90,220,.45);',
      'display:flex;align-items:center;justify-content:center;transition:transform .18s ease}',
      '#odm-fab:active{transform:scale(.92)}',
      '#odm-fab .odm-badge{position:absolute;top:-3px;right:-3px;min-width:22px;height:22px;padding:0 5px;border-radius:11px;background:#FF3B30;',
      'color:#fff;font-size:12px;font-weight:800;display:none;align-items:center;justify-content:center;box-shadow:0 0 0 2px #fff}',
      '#odm-fab.has-unread .odm-badge{display:flex}',
      '#odm-panel{position:fixed;right:18px;bottom:86px;z-index:100096;width:min(400px,calc(100vw - 28px));height:min(620px,calc(100vh - 120px));',
      'background:rgba(248,249,251,.86);backdrop-filter:saturate(180%) blur(24px);-webkit-backdrop-filter:saturate(180%) blur(24px);',
      'border:.5px solid rgba(60,66,80,.16);border-radius:24px;box-shadow:0 30px 70px rgba(10,14,26,.45);display:none;flex-direction:column;overflow:hidden;',
      'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif;animation:odmPop .26s cubic-bezier(.2,.9,.3,1.2)}',
      '#odm-panel.on{display:flex}',
      '@keyframes odmPop{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:none}}',
      '.odm-head{padding:15px 16px 12px;display:flex;align-items:center;gap:10px;background:linear-gradient(180deg,rgba(255,255,255,.7),rgba(255,255,255,0));border-bottom:.5px solid rgba(60,66,80,.1)}',
      '.odm-head .odm-t{font-size:19px;font-weight:800;letter-spacing:-.02em;color:#0A1730;flex:1}',
      '.odm-head .odm-sub{font-size:11px;color:#8A93A3;font-weight:600}',
      '.odm-x{border:none;background:rgba(120,128,145,.14);color:#5B6472;width:30px;height:30px;border-radius:50%;font-size:16px;cursor:pointer}',
      '.odm-list{flex:1;overflow-y:auto;padding:14px 13px 8px;display:flex;flex-direction:column;gap:9px;-webkit-overflow-scrolling:touch}',
      '.odm-empty{margin:auto;color:#9AA2B1;font-size:13px;text-align:center;padding:20px}',
      '.odm-row{display:flex;flex-direction:column;max-width:80%}',
      '.odm-row.me{align-self:flex-end;align-items:flex-end}.odm-row.them{align-self:flex-start;align-items:flex-start}',
      '.odm-who{font-size:10.5px;color:#9AA2B1;font-weight:700;margin:0 8px 2px}',
      '.odm-bub{padding:9px 13px;border-radius:20px;font-size:14.5px;line-height:1.32;word-break:break-word;position:relative;box-shadow:0 1px 1px rgba(0,0,0,.05)}',
      '.odm-row.me .odm-bub{background:linear-gradient(160deg,#0A84FF,#0072F5);color:#fff;border-bottom-right-radius:7px}',
      '.odm-row.them .odm-bub{background:#E9E9EB;color:#1a1f2e;border-bottom-left-radius:7px}',
      '.odm-bub img{max-width:220px;border-radius:13px;display:block;cursor:zoom-in}',
      '.odm-bub.voice{display:flex;align-items:center;gap:9px;cursor:pointer;min-width:130px}',
      '.odm-bub.voice .pl{width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;font-size:14px;flex:0 0 auto}',
      '.odm-row.them .odm-bub.voice .pl{background:rgba(0,0,0,.1)}',
      '.odm-wave{flex:1;height:3px;border-radius:2px;background:currentColor;opacity:.5}',
      '.odm-bub.sos{background:linear-gradient(160deg,#FF453A,#D70015)!important;color:#fff!important;font-weight:800;border-radius:16px!important}',
      '.odm-meta{font-size:10px;color:#9AA2B1;margin:2px 9px 0}',
      '.odm-edited{font-style:italic;opacity:.7}',
      '.odm-act{font-size:11px;margin:1px 9px 0;color:#0A84FF;font-weight:700;cursor:pointer;user-select:none}',
      '.odm-act span{margin-left:9px}',
      '.odm-comp{padding:9px 10px calc(9px + env(safe-area-inset-bottom));display:flex;align-items:flex-end;gap:7px;border-top:.5px solid rgba(60,66,80,.1);background:rgba(255,255,255,.55)}',
      '.odm-comp textarea{flex:1;resize:none;max-height:96px;min-height:38px;border:1px solid rgba(60,66,80,.18);border-radius:19px;padding:9px 13px;font-family:inherit;font-size:14.5px;background:#fff;color:#1a1f2e;outline:none}',
      '.odm-ic{border:none;background:rgba(120,128,145,.12);width:38px;height:38px;border-radius:50%;font-size:18px;cursor:pointer;flex:0 0 auto;display:flex;align-items:center;justify-content:center}',
      '.odm-ic.rec{background:#FF3B30;color:#fff;animation:odmPulse 1s infinite}',
      '@keyframes odmPulse{0%,100%{box-shadow:0 0 0 0 rgba(255,59,48,.5)}50%{box-shadow:0 0 0 8px rgba(255,59,48,0)}}',
      '.odm-send{background:linear-gradient(160deg,#0A84FF,#0060DF);color:#fff}',
      '.odm-lb{position:fixed;inset:0;z-index:100099;background:rgba(0,0,0,.85);display:none;align-items:center;justify-content:center}',
      '.odm-lb.on{display:flex}.odm-lb img{max-width:94vw;max-height:90vh;border-radius:10px}',
      '@media (prefers-color-scheme:dark){',
      '#odm-panel{background:rgba(28,28,32,.82);border-color:rgba(255,255,255,.1)}',
      '.odm-head{background:linear-gradient(180deg,rgba(60,60,66,.5),transparent);border-color:rgba(255,255,255,.08)}',
      '.odm-head .odm-t{color:#fff}.odm-x{background:rgba(255,255,255,.14);color:#dfe3ea}',
      '.odm-row.them .odm-bub{background:#2C2C2E;color:#EDEDEF}',
      '.odm-comp{background:rgba(40,40,44,.6);border-color:rgba(255,255,255,.08)}',
      '.odm-comp textarea{background:#1C1C1E;color:#EDEDEF;border-color:rgba(255,255,255,.14)}',
      '.odm-ic{background:rgba(255,255,255,.12)}}'
    ].join('');
    document.head.appendChild(st);
  }

  function buildDom() {
    if ($('odm-fab')) return;
    var fab = document.createElement('button'); fab.id = 'odm-fab'; fab.type = 'button';
    fab.innerHTML = '💬<span class="odm-badge" id="odm-badge">0</span>';
    fab.addEventListener('click', toggle);
    var p = document.createElement('div'); p.id = 'odm-panel';
    p.innerHTML =
      '<div class="odm-head"><div style="flex:1"><div class="odm-t" id="odm-title">' + esc(_title) + '</div>'
      + '<div class="odm-sub" id="odm-who"></div></div><button class="odm-x" id="odm-close" type="button">✕</button></div>'
      + '<div class="odm-list" id="odm-list"><div class="odm-empty">Chargement…</div></div>'
      + '<div class="odm-comp">'
      + '<button class="odm-ic" id="odm-photo" type="button" title="Photo">📷</button>'
      + '<input type="file" id="odm-file" accept="image/*" capture="environment" style="display:none">'
      + '<button class="odm-ic" id="odm-mic" type="button" title="Maintenir pour un vocal">🎤</button>'
      + '<textarea id="odm-txt" rows="1" placeholder="Message…"></textarea>'
      + '<button class="odm-ic odm-send" id="odm-send" type="button" title="Envoyer">➤</button>'
      + '</div>';
    var lb = document.createElement('div'); lb.id = 'odm-lb'; lb.innerHTML = '<img alt="">';
    lb.addEventListener('click', function () { lb.classList.remove('on'); });
    document.body.appendChild(fab); document.body.appendChild(p); document.body.appendChild(lb);

    $('odm-close').addEventListener('click', close);
    $('odm-send').addEventListener('click', sendText);
    $('odm-txt').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); } });
    $('odm-txt').addEventListener('input', function () { this.style.height = 'auto'; this.style.height = Math.min(96, this.scrollHeight) + 'px'; });
    $('odm-photo').addEventListener('click', function () { $('odm-file').click(); });
    $('odm-file').addEventListener('change', onPhoto);
    // push-to-talk
    var mic = $('odm-mic');
    mic.addEventListener('mousedown', recStart); mic.addEventListener('touchstart', function (e) { e.preventDefault(); recStart(); }, { passive: false });
    ['mouseup', 'mouseleave'].forEach(function (ev) { mic.addEventListener(ev, recStop); });
    mic.addEventListener('touchend', function (e) { e.preventDefault(); recStop(); });
    // délégation actions + médias
    $('odm-list').addEventListener('click', onListClick);
  }

  /* ── rendu ── */
  function render() {
    var l = $('odm-list'); if (!l) return;
    var vis = _msgs.filter(function (m) { return !m.deleted; });
    if (!vis.length) { l.innerHTML = '<div class="odm-empty">Aucun message.<br>Écris, envoie une photo 📷 ou un vocal 🎤.</div>'; return; }
    l.innerHTML = vis.map(function (m) {
      var me = (m.sender === _sender);
      var inner;
      if (m.kind === 'sos') {
        inner = '<div class="odm-bub sos">🚨 ALERTE SOS' + (m.body ? '<div style="font-weight:600;font-size:12px;margin-top:4px">' + esc(m.body) + '</div>' : '') + '</div>';
      } else if (m.kind === 'photo') {
        inner = '<div class="odm-bub"><img src="' + esc(m.audio || '') + '" data-zoom="' + esc(m.audio || '') + '" alt="photo"></div>';
      } else if (m.kind === 'voice') {
        inner = '<div class="odm-bub voice" data-voice="' + esc(m.id) + '"><span class="pl">▶</span><span class="odm-wave"></span></div>';
      } else {
        inner = '<div class="odm-bub">' + esc(m._txt != null ? m._txt : m.body) + '</div>';
      }
      var acts = '';
      if (me && m.kind !== 'sos') {
        acts = '<div class="odm-act" data-id="' + esc(m.id) + '">'
          + (m.kind === 'text' ? '<span data-edit="' + esc(m.id) + '">Modifier</span>' : '')
          + '<span data-del="' + esc(m.id) + '">Supprimer</span></div>';
      }
      return '<div class="odm-row ' + (me ? 'me' : 'them') + '">'
        + (me ? '' : '<div class="odm-who">' + esc(m.sender || '—') + '</div>')
        + inner
        + '<div class="odm-meta">' + fmtT(m.created_at) + (m._edited ? ' · <span class="odm-edited">modifié</span>' : '') + '</div>'
        + acts + '</div>';
    }).join('');
    scrollBottom();
  }

  // Déchiffre les textes de façon asynchrone puis rerend
  function decodeThenRender() {
    var pend = _msgs.filter(function (m) { return m.kind === 'text' && m._txt == null; });
    if (!pend.length) { render(); return; }
    Promise.all(pend.map(function (m) {
      return decText(m.body).then(function (t) { m._txt = t; m._edited = m._edited || false; });
    })).then(render, render);
  }

  function onListClick(e) {
    var z = e.target.closest('[data-zoom]'); if (z) { var lb = $('odm-lb'); lb.querySelector('img').src = z.getAttribute('data-zoom'); lb.classList.add('on'); return; }
    var v = e.target.closest('[data-voice]'); if (v) { playVoice(v.getAttribute('data-voice'), v); return; }
    var ed = e.target.closest('[data-edit]'); if (ed) { editMsg(ed.getAttribute('data-edit')); return; }
    var dl = e.target.closest('[data-del]'); if (dl) { delMsg(dl.getAttribute('data-del')); return; }
  }

  function playVoice(id, el) {
    var m = _byId[id]; if (!m || !m.audio) return;
    try { var a = new Audio(m.audio); var pl = el.querySelector('.pl'); if (pl) pl.textContent = '⏸'; a.play(); a.onended = function () { if (pl) pl.textContent = '▶'; }; } catch (e) {}
  }

  /* ── envoi ── */
  function pushLocal(row) { _byId[row.id] = row; _msgs.push(row); _msgs.sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); }); }
  function insert(row, okMsg) {
    row.id = row.id || uuid(); row.sender = _sender; row.deleted = false; row.created_at = new Date().toISOString();
    if (row.kind === 'text') row._txt = row._plain != null ? row._plain : row.body;
    pushLocal(row); decodeThenRender();
    if (!SB || !_ready) return Promise.resolve();
    var out = { id: row.id, sender: row.sender, kind: row.kind, body: row.body, audio: row.audio || null, deleted: false, created_at: row.created_at };
    return SB.from('messages').insert(out).then(function (r) { if (r.error) console.warn('[OlympeDM] insert', r.error.message); });
  }
  function sendText() {
    var ta = $('odm-txt'); var v = (ta.value || '').trim(); if (!v) return; ta.value = ''; ta.style.height = 'auto';
    if (_encrypt) { encText(v).then(function (ct) { insert({ kind: 'text', body: ct, _plain: v }); }); }
    else { insert({ kind: 'text', body: v }); }
  }
  function onPhoto(input) {
    var f = input.target.files && input.target.files[0]; input.target.value = ''; if (!f) return;
    var img = new Image(), url = URL.createObjectURL(f);
    img.onload = function () {
      var mx = 1100, w = img.width, h = img.height;
      if (w > mx || h > mx) { if (w > h) { h = Math.round(h * mx / w); w = mx; } else { w = Math.round(w * mx / h); h = mx; } }
      var c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); URL.revokeObjectURL(url);
      insert({ kind: 'photo', body: '', audio: c.toDataURL('image/jpeg', 0.72) });
    };
    img.onerror = function () {}; img.src = url;
  }

  /* ── vocal (push-to-talk) ── */
  function recStart() {
    if (_rec) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      _recBlob = []; _rec = new MediaRecorder(stream);
      _rec.ondataavailable = function (e) { if (e.data && e.data.size) _recBlob.push(e.data); };
      _rec.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        var blob = new Blob(_recBlob, { type: _rec.mimeType || 'audio/webm' });
        if (blob.size < 400) { _rec = null; return; }
        var fr = new FileReader(); fr.onload = function () { insert({ kind: 'voice', body: '', audio: fr.result }); _rec = null; }; fr.readAsDataURL(blob);
      };
      _rec.start(); var mic = $('odm-mic'); if (mic) mic.classList.add('rec');
      // limite 30 s
      _rec._t = setTimeout(recStop, 30000);
    }).catch(function () {});
  }
  function recStop() {
    var mic = $('odm-mic'); if (mic) mic.classList.remove('rec');
    if (_rec && _rec.state !== 'inactive') { clearTimeout(_rec._t); try { _rec.stop(); } catch (e) { _rec = null; } }
  }

  /* ── modification / suppression ── */
  function editMsg(id) {
    var m = _byId[id]; if (!m || m.sender !== _sender) return;
    var cur = m._txt != null ? m._txt : m.body;
    var nv = prompt('Modifier le message :', cur); if (nv == null) return; nv = String(nv).trim(); if (!nv) return;
    function apply(body, plain) {
      m.body = body; m._txt = plain; m._edited = true; decodeThenRender();
      if (SB && _ready) SB.from('messages').update({ body: body }).eq('id', id).then(function (r) { if (r.error) console.warn('[OlympeDM] edit', r.error.message); });
    }
    if (_encrypt) encText(nv).then(function (ct) { apply(ct, nv); }); else apply(nv, nv);
  }
  function delMsg(id) {
    var m = _byId[id]; if (!m || m.sender !== _sender) return;
    if (!confirm('Supprimer ce message ?')) return;
    m.deleted = true; render();
    if (SB && _ready) SB.from('messages').update({ deleted: true }).eq('id', id).then(function (r) { if (r.error) console.warn('[OlympeDM] del', r.error.message); });
  }

  /* ── réception ── */
  function incoming(m, isUpdate) {
    if (!m || !m.id) return;
    var known = _byId[m.id];
    if (known) { for (var k in m) known[k] = m[k]; if (m.kind === 'text') known._txt = null; }
    else { _byId[m.id] = m; _msgs.push(m); _msgs.sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); }); }
    // notifications
    if (m.sender !== _sender && !isUpdate && !m.deleted) {
      if (m.kind === 'sos') { siren(); notify('🚨 ALERTE SOS', (m.sender || 'équipe') + (m.body ? ' — ' + m.body : '')); }
      if (!_open) { _unread++; updateBadge(); if (m.kind !== 'sos') notify(m.sender || 'Message', preview(m)); }
    }
    decodeThenRender();
  }
  function preview(m) { return m.kind === 'photo' ? '📷 Photo' : m.kind === 'voice' ? '🎤 Vocal' : looksEncrypted(m.body) ? '🔒 Message' : String(m.body || '').slice(0, 60); }
  function notify(title, body) {
    try {
      if (!('Notification' in global)) return;
      if (Notification.permission === 'granted') new Notification(title, { body: body });
      else if (Notification.permission !== 'denied') Notification.requestPermission();
    } catch (e) {}
  }
  function updateBadge() {
    var fab = $('odm-fab'), b = $('odm-badge'); if (!fab || !b) return;
    b.textContent = _unread > 99 ? '99+' : _unread; fab.classList.toggle('has-unread', _unread > 0);
  }

  /* ── data load + realtime ── */
  function loadFeed() {
    if (!SB) return;
    SB.from('messages').select('*').order('created_at', { ascending: true }).limit(80).then(function (r) {
      if (r.error) { console.warn('[OlympeDM] load', r.error.message); return; }
      (r.data || []).forEach(function (m) { if (!_byId[m.id]) { _byId[m.id] = m; _msgs.push(m); } else { for (var k in m) _byId[m.id][k] = m[k]; } });
      _msgs.sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
      decodeThenRender();
    });
  }
  function subscribe() {
    if (!SB) return;
    try {
      SB.channel('olympe-dm-feed')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, function (p) { incoming(p.new, false); })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, function (p) { incoming(p.new, true); })
        .subscribe();
    } catch (e) { console.warn('[OlympeDM] realtime', e); }
    // filet : rafraîchissement périodique
    setInterval(loadFeed, 15000);
  }

  /* ── acquisition client Supabase ── */
  function resolveClient(provided) {
    if (provided) return Promise.resolve(provided);
    try { if (global.parent && global.parent.OlympeAuth && global.parent.OlympeAuth.client) { var c = global.parent.OlympeAuth.client(); if (c) return Promise.resolve(c); } } catch (e) {}
    try { if (global.OlympeAuth && global.OlympeAuth.client) { var c2 = global.OlympeAuth.client(); if (c2) return Promise.resolve(c2); } } catch (e) {}
    // client autonome + connexion compte partagé (comme l'app SOS)
    try {
      if (global.supabase && global.supabase.createClient) {
        var sb = global.supabase.createClient(CFG_DEFAULT.url, CFG_DEFAULT.anonKey, { auth: { persistSession: true } });
        return sb.auth.signInWithPassword({ email: CFG_DEFAULT.email, password: CFG_DEFAULT.pass }).then(function () { return sb; }).catch(function () { return sb; });
      }
    } catch (e) {}
    return Promise.resolve(null);
  }

  /* ── API publique ── */
  function open() {
    _open = true; _unread = 0; updateBadge();
    var p = $('odm-panel'); if (p) p.classList.add('on');
    try { if ('Notification' in global && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {}
    scrollBottom();
  }
  function close() { _open = false; var p = $('odm-panel'); if (p) p.classList.remove('on'); }
  function toggle() { (_open ? close : open)(); }
  function unread() { return _unread; }
  function sendAlert(text) { return insert({ kind: 'sos', body: text || '' }, null); }

  function mount(opts) {
    opts = opts || {};
    _sender = opts.sender || _sender;
    _title = opts.title || _title;
    _encrypt = !!opts.encrypt;
    injectCss(); buildDom();
    var who = $('odm-who'); if (who) who.textContent = 'Vous : ' + _sender;
    var t = $('odm-title'); if (t) t.textContent = _title;
    resolveClient(opts.client).then(function (client) {
      SB = client; _ready = !!client;
      if (SB) { loadFeed(); subscribe(); }
      else { var l = $('odm-list'); if (l) l.innerHTML = '<div class="odm-empty">Hors-ligne — messagerie indisponible.</div>'; }
    });
    return OlympeDM;
  }

  var OlympeDM = { mount: mount, open: open, close: close, toggle: toggle, sendAlert: sendAlert, unread: unread,
    _internals: { encText: encText, decText: decText, incoming: incoming, render: render, state: function () { return { msgs: _msgs, unread: _unread, sender: _sender }; } } };
  global.OlympeDM = OlympeDM;
})(window);
