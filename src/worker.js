const SYSTEM_PROMPT = '你是个人助理小云，请用幽默风趣的方式回答用户的问题';
const MODEL = 'qwen-turbo';
const DASHSCOPE_API = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

const HTML = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>小云助理</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0d1117; color: #e6edf3; height: 100dvh;
      display: flex; flex-direction: column; overflow: hidden;
    }
    #header {
      background: #161b22; border-bottom: 1px solid #30363d;
      padding: 14px 20px; display: flex; align-items: center; gap: 10px;
      flex-shrink: 0;
    }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: #3fb950; flex-shrink: 0; }
    #header h1 { font-size: 17px; font-weight: 600; }
    #messages {
      flex: 1; overflow-y: auto; padding: 24px 16px;
      display: flex; flex-direction: column; gap: 18px;
    }
    #messages::-webkit-scrollbar { width: 6px; }
    #messages::-webkit-scrollbar-track { background: transparent; }
    #messages::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
    .welcome { text-align: center; color: #8b949e; margin: auto; padding: 20px; }
    .welcome h2 { font-size: 24px; margin-bottom: 8px; }
    .welcome p { font-size: 15px; }
    .msg { display: flex; gap: 10px; max-width: 780px; width: 100%; }
    .msg.user { align-self: flex-end; flex-direction: row-reverse; }
    .msg.assistant { align-self: flex-start; }
    .avatar {
      width: 30px; height: 30px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 13px; flex-shrink: 0; margin-top: 2px;
    }
    .user .avatar { background: #1f6feb; }
    .assistant .avatar { background: #21262d; border: 1px solid #30363d; }
    .bubble {
      background: #161b22; border: 1px solid #30363d;
      border-radius: 14px; padding: 11px 15px;
      line-height: 1.65; font-size: 15px;
      max-width: calc(100% - 42px);
      white-space: pre-wrap; word-break: break-word;
    }
    .user .bubble { background: #1f6feb; border-color: transparent; border-radius: 14px 4px 14px 14px; }
    .assistant .bubble { border-radius: 4px 14px 14px 14px; }
    .cursor {
      display: inline-block; width: 2px; height: 1em;
      background: #e6edf3; animation: blink 0.9s infinite;
      vertical-align: text-bottom; margin-left: 1px;
    }
    @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
    #input-area {
      background: #161b22; border-top: 1px solid #30363d;
      padding: 14px 16px; display: flex; gap: 10px;
      align-items: flex-end; flex-shrink: 0;
    }
    #input {
      flex: 1; background: #0d1117; border: 1px solid #30363d;
      border-radius: 12px; padding: 11px 14px; color: #e6edf3;
      font-size: 15px; resize: none; min-height: 44px; max-height: 180px;
      outline: none; font-family: inherit; line-height: 1.5;
    }
    #input:focus { border-color: #388bfd; }
    #input::placeholder { color: #484f58; }
    #send {
      background: #1f6feb; border: none; border-radius: 12px;
      width: 44px; height: 44px; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; transition: background 0.15s;
    }
    #send:hover:not(:disabled) { background: #388bfd; }
    #send:disabled { background: #21262d; cursor: not-allowed; }
    #send svg { fill: white; }
  </style>
</head>
<body>
  <div id="header">
    <div class="dot"></div>
    <h1>小云助理</h1>
  </div>
  <div id="messages">
    <div class="welcome" id="welcome">
      <h2>👋 你好，我是小云！</h2>
      <p>有什麼可以幫你的嗎？</p>
    </div>
  </div>
  <div id="input-area">
    <textarea id="input" placeholder="輸入訊息… (Enter 發送，Shift+Enter 換行)" rows="1"></textarea>
    <button id="send" title="發送">
      <svg width="18" height="18" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
    </button>
  </div>

  <script>
    const history = [];
    const msgsEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send');

    function appendMsg(role, text) {
      const welcome = document.getElementById('welcome');
      if (welcome) welcome.remove();
      const wrap = document.createElement('div');
      wrap.className = 'msg ' + role;
      const icon = role === 'user' ? '👤' : '🤖';
      wrap.innerHTML = '<div class="avatar">' + icon + '</div><div class="bubble"></div>';
      const bubble = wrap.querySelector('.bubble');
      bubble.textContent = text;
      msgsEl.appendChild(wrap);
      msgsEl.scrollTop = msgsEl.scrollHeight;
      return bubble;
    }

    async function send() {
      const text = inputEl.value.trim();
      if (!text || sendBtn.disabled) return;
      inputEl.value = '';
      autoResize();
      sendBtn.disabled = true;

      history.push({ role: 'user', content: text });
      appendMsg('user', text);

      const bubble = appendMsg('assistant', '');
      const cursor = document.createElement('span');
      cursor.className = 'cursor';
      bubble.appendChild(cursor);
      msgsEl.scrollTop = msgsEl.scrollHeight;

      let reply = '';
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\\n');
          buf = lines.pop();
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') continue;
            try {
              const delta = JSON.parse(raw).choices?.[0]?.delta?.content;
              if (delta) { reply += delta; bubble.textContent = reply; bubble.appendChild(cursor); }
            } catch {}
          }
          msgsEl.scrollTop = msgsEl.scrollHeight;
        }
      } catch (e) {
        reply = '⚠️ 發生錯誤：' + e.message;
        bubble.textContent = reply;
      }
      cursor.remove();
      if (!reply) bubble.textContent = '（無回應）';
      history.push({ role: 'assistant', content: reply });
      sendBtn.disabled = false;
      inputEl.focus();
    }

    function autoResize() {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + 'px';
    }

    sendBtn.addEventListener('click', send);
    inputEl.addEventListener('input', autoResize);
    inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    inputEl.focus();
  </script>
</body>
</html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Serve chat UI
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // Chat API endpoint
    if (url.pathname === '/api/chat' && request.method === 'POST') {
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
            ...messages.slice(-20)   // 最多保留最近 20 則避免超出 token 限制
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

    return new Response('Not Found', { status: 404 });
  }
};
