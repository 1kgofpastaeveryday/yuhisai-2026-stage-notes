const BASE = '/yuhisai/2026/dimmer';
const ALLOWED = new Set([`${BASE}/`, `${BASE}/app.js`, `${BASE}/style.css`, `${BASE}/ws`, `${BASE}/manifest.webmanifest`, `${BASE}/icon.png`]);
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === BASE) return Response.redirect(`${url.origin}${BASE}/`, 308);
    if (!ALLOWED.has(url.pathname) || !['GET','HEAD'].includes(request.method)) return new Response('Not found', {status:404});
    // Preserve the WebSocket upgrade response intact, including response.webSocket.
    const origin = new URL(url.pathname, 'https://<HOST>');
    return fetch(new Request(origin, request), {redirect:'manual'});
  }
};
