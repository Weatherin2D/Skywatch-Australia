/**
 * Intentionally do not boot the Blitzortung MQTT/WebSocket feed on every
 * Node runtime start — that kept Fluid instances warm (Active CPU) even with
 * zero traffic. Lightning starts lazily on the first `/api/weather/lightning`
 * (or storm-activity) request; the browser also has its own live client feed.
 */
export async function register() {
  /* no-op boot — see note above */
}
