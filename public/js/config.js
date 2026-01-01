// ==========================================================================
// ChitChat Frontend Configuration
// ==========================================================================
// Auto-detects environment based on hostname
// ==========================================================================

(function() {
  const host = window.location.hostname;
  
  // Production: Firebase → nginx load balancer
  if (host === 'chit-chat.web.app' || host === 'chit-chat.firebaseapp.com') {
    window.CHITCHAT_API_URL = 'http://161.118.201.185';
  }
  // Local development: same origin
  else {
    window.CHITCHAT_API_URL = '';
  }
})();
