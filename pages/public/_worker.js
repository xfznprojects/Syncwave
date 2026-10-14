// Stable, free pages.dev address. The Worker remains the sole app deployment.
// Forward the original Request to preserve same-origin APIs and WebSocket upgrades.
export default {
  fetch(request, env) {
    return env.SYNCWAVE.fetch(request);
  },
};
