/* ═══════════════════════════════════════════════════════════════════════════
 * 0LYMPE — Configuration Supabase & Push
 * ─────────────────────────────────────────────────────────────────────────── */
window.OLYMPE_CFG = {
  url:     'https://eedvljmmvsxrcwhclfpg.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlZHZsam1tdnN4cmN3aGNsZnBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0OTgzMDcsImV4cCI6MjEwMDA3NDMwN30.Tmf3pchljBcjHpg5NzyJFA_gQPuYiKZqfwTjEYG5krA',
  emailDomain: '0lympe.local',
  offlineQueue: true,
  pushDebounce: 800,
  debug: false,
  vapidPublicKey: 'BNNqDhvfF52-ZiZmyD_tIit2rF072cdUjXlWzhD8blt1DuRfwhr3tFVMmX-XdX4-vgRjeA-iUgbfeJeRHEVEG1k'
};

// Sécurité de rétrocompatibilité : si une autre partie du code cherche "OlympeConfig"
window.OlympeConfig = {
  vapidPublicKey: window.OLYMPE_CFG.vapidPublicKey
};
