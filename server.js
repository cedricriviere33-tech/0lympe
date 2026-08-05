'use strict';
/**
 * Olympe TV — Proxy HLS
 * ---------------------------------------------------------------------------
 * Pourquoi : les flux .m3u8 publics ne sont pas lisibles direct en navigateur
 *   - mixed content : master en https -> variantes en http:// (bloqué)
 *   - CORS absent sur segments/variantes -> fetch hls.js bloqué
 *   - parfois UA/Referer requis
 * Ce proxy récupère le flux CÔTÉ SERVEUR (aucune de ces limites), réécrit les
 * manifestes pour que TOUT repasse par lui, et re-sert avec CORS *.
 *
 * Un seul endpoint :  GET /?u=<url upstream encodée>
 *   - si la réponse est un manifeste (.m3u8) -> réécriture des sous-URL
 *   - sinon (segments .ts/.aac/.m4s/.mp4/clés) -> passthrough streaming
 *
 * Sécurité : ALLOWLIST d'hôtes (sinon open-proxy / SSRF). Adaptez ALLOW_HOSTS.
 * Déploiement Coolify : voir README.md (service Node, port 8080).
 */

const http = require('http');
const { Readable } = require('stream');

const PORT = parseInt(process.env.PORT || '8080', 10);

// Hôtes autorisés (suffixes). Étendre si vous ajoutez des chaînes.
const ALLOW_HOSTS = (process.env.ALLOW_HOSTS ||
  [
    'akamaihd.net', 'akamaized.net',            // Arte, France24, BFM…
    'france24.com', 'ftven.fr', 'francetv.fr',  // France Médias Monde / France TV
    'cgtn.com',
    'tv5monde.com',
    'tntendirect.com',
    'wurl.com', 'samsung.wurl.com',             // Euronews (Rakuten)
    'nrjaudio.fm',
    'infomaniak.ch', 'ice.infomaniak.ch',
    'streamakaci.com',
    'canalplus-cdn.net', 'tf1.fr', 'sfr.net'
  ].join(',')
).split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);

// UA navigateur : beaucoup de CDN refusent un UA vide/curl.
const UA = process.env.UA ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const SELF = process.env.PUBLIC_BASE || '';   // ex "https://tv-proxy.xxx.sslip.io" (optionnel)
const TIMEOUT = parseInt(process.env.TIMEOUT_MS || '15000', 10);

function hostAllowed(u) {
  var h;
  try { h = new URL(u).hostname.toLowerCase(); } catch (e) { return false; }
  return ALLOW_HOSTS.some(function (suf) { return h === suf || h.endsWith('.' + suf); });
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
}

function selfBase(req) {
  if (SELF) return SELF.replace(/\/+$/, '');
  var proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  var host  = req.headers['x-forwarded-host'] || req.headers.host || ('localhost:' + PORT);
  return proto + '://' + host;
}

function isPlaylist(url, ctype, body) {
  if (/\.m3u8(\?|$)/i.test(url)) return true;
  if (ctype && /mpegurl|vnd\.apple\.mpegurl/i.test(ctype)) return true;
  if (body && body.slice(0, 7) === '#EXTM3U') return true;
  return false;
}

// Réécrit un manifeste : chaque URI (ligne nue ou URI="...") -> passe par le proxy.
function rewriteManifest(text, upstreamUrl, self) {
  var wrap = function (raw) {
    var abs;
    try { abs = new URL(raw, upstreamUrl).toString(); } catch (e) { return raw; }
    return self + '/?u=' + encodeURIComponent(abs);
  };
  return text.split('\n').map(function (line) {
    var l = line.replace(/\r$/, '');
    if (l === '') return line;
    if (l[0] === '#') {
      // Réécrit les attributs URI="..." (EXT-X-KEY / MEDIA / MAP / I-FRAME…)
      return l.replace(/URI="([^"]+)"/g, function (_m, uri) { return 'URI="' + wrap(uri) + '"'; });
    }
    // Ligne d'URI (variante ou segment)
    return wrap(l);
  }).join('\n');
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }

  var url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') { res.writeHead(200); return res.end('ok'); }

  var target = url.searchParams.get('u');
  if (!target) { res.writeHead(400); return res.end('missing ?u='); }
  if (!hostAllowed(target)) { res.writeHead(403); return res.end('host not allowed'); }

  var ctl = new AbortController();
  var to = setTimeout(function () { ctl.abort(); }, TIMEOUT);

  try {
    var upstream = await fetch(target, {
      redirect: 'follow',
      signal: ctl.signal,
      headers: {
        'User-Agent': UA,
        'Accept': '*/*',
        'Referer': (function () { try { return new URL(target).origin + '/'; } catch (e) { return ''; } })()
      }
    });

    var ctype = upstream.headers.get('content-type') || '';
    cors(res);

    // Manifeste -> on lit, on réécrit, on renvoie
    if (isPlaylist(target, ctype)) {
      var text = await upstream.text();
      if (isPlaylist(target, ctype, text)) {
        var out = rewriteManifest(text, upstream.url || target, selfBase(req));
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache');
        res.writeHead(upstream.status);
        return res.end(out);
      }
      // faux positif : renvoyer tel quel
      res.setHeader('Content-Type', ctype || 'application/octet-stream');
      res.writeHead(upstream.status);
      return res.end(text);
    }

    // Segment / clé : passthrough streaming
    res.setHeader('Content-Type', ctype || 'application/octet-stream');
    var len = upstream.headers.get('content-length'); if (len) res.setHeader('Content-Length', len);
    res.writeHead(upstream.status);
    if (upstream.body) { Readable.fromWeb(upstream.body).pipe(res); }
    else { res.end(); }
  } catch (e) {
    if (!res.headersSent) { cors(res); res.writeHead(502); }
    res.end('proxy error: ' + (e && e.message || e));
  } finally {
    clearTimeout(to);
  }
}

http.createServer(function (req, res) {
  handle(req, res).catch(function (e) {
    try { if (!res.headersSent) res.writeHead(500); res.end('err'); } catch (_e) {}
    console.error('[tv-proxy]', e && e.message);
  });
}).listen(PORT, function () {
  console.log('[tv-proxy] écoute sur :' + PORT + ' — hôtes autorisés :', ALLOW_HOSTS.join(', '));
});
