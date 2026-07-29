/* ═══════════════════════════════════════════════════════════════════════
   Olympe — Push Worker (robuste pour Coolify)
   Écoute les nouveaux messages (Supabase Realtime) et envoie une
   notification push (Web Push / VAPID) à tous les appareils abonnés,
   sauf l'expéditeur du message.
   - Serveur de santé HTTP : garde le process vivant + health check Coolify.
   - Si une variable manque : message clair dans les logs (pas de crash-loop).
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

const http = require('http');
const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

let state = 'démarrage';

// ── Serveur de santé (port attendu par Coolify + garde le worker en vie) ──
const PORT = process.env.PORT || 3000;
http.createServer(function (req, res) {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('olympe push-worker — ' + state + '\n');
}).listen(PORT, function () { console.log('Serveur de santé sur le port ' + PORT); });

// Ne jamais crasher sur une erreur asynchrone isolée
process.on('unhandledRejection', function (e) { console.error('unhandledRejection:', (e && e.message) || e); });
process.on('uncaughtException',  function (e) { console.error('uncaughtException:',  (e && e.message) || e); });

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  VAPID_PUBLIC,
  VAPID_PRIVATE,
  VAPID_SUBJECT = 'mailto:admin@olympe.local'
} = process.env;

// Vérif des variables — SANS quitter (pour que le message reste visible dans les logs)
const missing = Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_KEY, VAPID_PUBLIC, VAPID_PRIVATE })
  .filter(function (e) { return !e[1]; }).map(function (e) { return e[0]; });

if (missing.length) {
  state = 'ERREUR : variables manquantes → ' + missing.join(', ');
  console.error('❌ Variables absentes AU RUNTIME : ' + missing.join(', '));
  console.error('   → Dans Coolify, définis-les comme variables d\'environnement disponibles À L\'EXÉCUTION');
  console.error('     (pas uniquement « Build Variable »). Puis redéploie.');
} else {
  start();
}

function start() {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  } catch (e) {
    state = 'ERREUR VAPID : ' + ((e && e.message) || e);
    console.error('❌ Clés VAPID invalides :', (e && e.message) || e);
    return;
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  async function onMessage(m) {
    if (!m || m.deleted) return;
    const res = await sb.from('push_subscriptions').select('*').neq('sender', m.sender || '');
    if (res.error) { console.error('lecture abonnements :', res.error.message); return; }
    const subs = res.data || [];
    if (!subs.length) return;

    const payload = JSON.stringify({
      title: '☎️ ' + (m.sender || 'Équipe'),
      body: m.kind === 'voice' ? '🎙 Message vocal' : (m.body || 'Nouveau message'),
      url: '/'
    });

    await Promise.all(subs.map(async function (s) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      } catch (err) {
        const code = err && err.statusCode;
        if (code === 404 || code === 410) {
          await sb.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
          console.log('abonnement expiré supprimé');
        } else {
          console.error('envoi push échoué :', code || (err && err.message));
        }
      }
    }));
  }

  function subscribe() {
    sb.channel('olympe-push-worker')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
          function (p) { onMessage(p.new).catch(function (e) { console.error(e); }); })
      .subscribe(function (status) {
        state = 'realtime : ' + status;
        console.log('Realtime :', status);
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setTimeout(subscribe, 3000);
      });
  }

  console.log('Olympe push-worker démarré.');
  subscribe();
}
