# -*- coding: utf-8 -*-
"""
Route les flux TV via un proxy HLS optionnel (window.OTV_PROXY).
- Ajoute proxyBase()/proxied() dans le module TV
- Enveloppe l'URL du flux au moment de la lecture
Sans window.OTV_PROXY -> comportement inchange (lecture directe).
"""
import io
APP = "/home/claude/index2.html"

def patch(old, new, label):
    s = io.open(APP, "r", encoding="utf-8").read()
    assert s.count(old) == 1, "[%s] ancre absente/multiple: %d" % (label, s.count(old))
    io.open(APP, "w", encoding="utf-8").write(s.replace(old, new, 1))
    print("OK", label)

# 1) helper proxy juste apres HLS_SRC
OLD1 = "  var HLS_SRC  = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';"
NEW1 = (OLD1 + "\n"
"  // Proxy HLS optionnel : contourne mixed-content/CORS des flux publics.\n"
"  // Definir window.OTV_PROXY = 'https://tv-proxy.xxx.sslip.io' (voir tv-proxy/).\n"
"  function proxyBase(){ try { return (global.OTV_PROXY || '').replace(/\\/+$/, ''); } catch(e){ return ''; } }\n"
"  function proxied(u){ var b = proxyBase(); return b ? (b + '/?u=' + encodeURIComponent(u)) : u; }")
patch(OLD1, NEW1, "TV/proxy-helper")

# 2) enveloppe l'URL a la lecture
patch("    var url = ch.url;",
      "    var url = proxied(ch.url);",
      "TV/proxy-url")

print("\nTermine.")
