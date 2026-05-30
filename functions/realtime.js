const UPSTREAM_URL = 'wss://llm-z15n6tzu1sj058db.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/realtime';

export async function onRequest(context) {
  const { request, env, waitUntil } = context;

  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  if (!env.DASHSCOPE_API_KEY) {
    return new Response('API key not configured', { status: 500 });
  }

  // Connect to DashScope upstream WebSocket (API Key injected server-side)
  let upstreamWs;
  try {
    const resp = await fetch(UPSTREAM_URL, {
      headers: {
        'Upgrade': 'websocket',
        'Authorization': `Bearer ${env.DASHSCOPE_API_KEY}`
      }
    });
    upstreamWs = resp.webSocket;
    if (!upstreamWs) throw new Error('No WebSocket in upstream response');
    upstreamWs.accept();
  } catch (e) {
    return new Response('Upstream connection failed: ' + e.message, { status: 502 });
  }

  // Create client-facing WebSocket pair
  const { 0: clientWs, 1: serverWs } = new WebSocketPair();
  serverWs.accept();

  // Bidirectional proxy
  serverWs.addEventListener('message', e => {
    try { upstreamWs.send(e.data); } catch {}
  });
  upstreamWs.addEventListener('message', e => {
    try { serverWs.send(e.data); } catch {}
  });
  serverWs.addEventListener('close', e => {
    try { upstreamWs.close(e.code, e.reason); } catch {}
  });
  upstreamWs.addEventListener('close', e => {
    try { serverWs.close(e.code, e.reason); } catch {}
  });
  serverWs.addEventListener('error', () => { try { upstreamWs.close(); } catch {} });
  upstreamWs.addEventListener('error', () => { try { serverWs.close(); } catch {} });

  // Keep Worker alive until both sides close
  waitUntil(new Promise(resolve => {
    serverWs.addEventListener('close', resolve);
    upstreamWs.addEventListener('close', resolve);
  }));

  return new Response(null, { status: 101, webSocket: clientWs });
}
