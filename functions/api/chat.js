const SYSTEM_PROMPT = '你是个人助理小云，请用幽默风趣的方式回答用户的问题';
const MODEL = 'qwen-turbo';
const DASHSCOPE_API = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { messages } = body;
  if (!Array.isArray(messages)) {
    return new Response(JSON.stringify({ error: 'messages must be an array' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!env.DASHSCOPE_API_KEY) {
    return new Response(JSON.stringify({ error: 'DASHSCOPE_API_KEY not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const upstream = await fetch(DASHSCOPE_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.DASHSCOPE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages.slice(-20)
      ],
      stream: true
    })
  });

  if (!upstream.ok) {
    const err = await upstream.text();
    return new Response(JSON.stringify({ error: err }), {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache'
    }
  });
}
