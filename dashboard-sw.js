/* Dashboard Gillot — SW minimal (offline shell) */
var C='dash-gillot-v1';
self.addEventListener('install',function(e){ self.skipWaiting(); });
self.addEventListener('activate',function(e){ e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch',function(e){
  var u=e.request.url;
  if(e.request.method!=='GET') return;
  e.respondWith(
    caches.open(C).then(function(cache){
      return cache.match(e.request).then(function(hit){
        var net=fetch(e.request).then(function(res){ try{ cache.put(e.request,res.clone()); }catch(_){} return res; }).catch(function(){ return hit; });
        return hit || net;
      });
    })
  );
});
