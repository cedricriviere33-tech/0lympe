/* ═══════════════════════════════════════════════════════════════════════
   Olympe — Push Worker
   Écoute les nouveaux messages (Supabase Realtime) et envoie une
   notification push (Web Push / VAPID) à tous les appareils abonnés,
   sauf l'expéditeur du message.
   À déployer comme service sur Coolify (voir Dockerfile + .env).
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,     // clé "service_role" (secrète) — PAS l'anon key
  VAPID_PUBLIC,
  VAPID_PRIVATE,
  VAPID_SUBJECT = 'mailto:admin@olympe.local'
} = process.env;

for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_KEY, VAPID_PUBLIC, VAPID_PRIVATE })) {
  if (!v) { console.error('Variable d\'environnement manquante :', k); process.exit(1); }
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 20 } }
});

async function onMessage(m) {
  if (!m || m.deleted) return;
  const { data: subs, error } = await sb
    .from('push_subscriptions')
    .select('*')
    .neq('sender', m.sender || '');   // ne pas notifier l'expéditeur
  if (error) { console.error('lecture abonnements :', error.message); return; }
  if (!subs || !subs.length) return;

  const payload = JSON.stringify({
    title: '☎️ ' + (m.sender || 'Équipe'),
    body: m.kind === 'voice' ? '🎙 Message vocal' : (m.body || 'Nouveau message'),
    url: '/'
  });

  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload
      );
    } catch (err) {
      const code = err && err.statusCode;
      if (code === 404 || code === 410) {
        // abonnement expiré → on nettoie
        await sb.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
        console.log('abonnement expiré supprimé :', s.endpoint.slice(-24));
      } else {
        console.error('envoi push échoué :', code || (err && err.message));
      }
    }
  }));
}

function subscribe() {
  sb.channel('olympe-push-worker')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
        (p) => onMessage(p.new).catch((e) => console.error(e)))
    .subscribe((status) => {
      console.log('Realtime :', status);
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setTimeout(subscribe, 3000);   // reconnexion
      }
    });
}

console.log('Olympe push-worker démarré.');
subscribe();
// --- Serveur HTTP factice pour maintenir le conteneur éveillé sur Coolify ---
const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Olympe Worker is running OK\n');
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Worker HTTP keep-alive listening on port ${PORT}`);
});

