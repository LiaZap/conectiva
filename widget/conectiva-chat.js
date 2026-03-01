/**
 * Conectiva Chat Widget — Script embeddable para o site da Conectiva Infor.
 *
 * Uso:
 *   <script src="https://seu-servidor:3000/widget/conectiva-chat.js"
 *           data-server="https://seu-servidor:3000"
 *           data-color="#2563eb"
 *           data-title="Conectiva Infor"
 *           data-greeting="Olá! Sou o assistente virtual da Conectiva Infor. Como posso ajudar?"
 *           data-position="right">
 *   </script>
 */

(function () {
  'use strict';

  // ── Configuração ─────────────────────────────────────
  const scriptTag = document.currentScript || document.querySelector('script[data-server]');
  const CONFIG = {
    server: (scriptTag && scriptTag.getAttribute('data-server')) || window.location.origin,
    color: (scriptTag && scriptTag.getAttribute('data-color')) || '#2563eb',
    title: (scriptTag && scriptTag.getAttribute('data-title')) || 'Conectiva Infor',
    greeting:
      (scriptTag && scriptTag.getAttribute('data-greeting')) ||
      'Olá! Sou o assistente virtual da Conectiva Infor. Como posso ajudar?',
    position: (scriptTag && scriptTag.getAttribute('data-position')) || 'right',
    placeholder: (scriptTag && scriptTag.getAttribute('data-placeholder')) || 'Digite sua mensagem...',
  };

  // Gerar ID único do visitante (persiste no localStorage)
  const STORAGE_KEY = 'conectiva_chat_visitor';
  let visitorId = null;
  try {
    visitorId = localStorage.getItem(STORAGE_KEY);
    if (!visitorId) {
      visitorId = 'vis-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      localStorage.setItem(STORAGE_KEY, visitorId);
    }
  } catch (_) {
    visitorId = 'vis-' + Math.random().toString(36).slice(2, 10);
  }

  // Estado
  let isOpen = false;
  let isLoading = false;
  let messages = [];
  let unreadCount = 0;

  // ── CSS ──────────────────────────────────────────────
  const posRight = CONFIG.position === 'right';

  const css = `
    #ccw-container * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }

    #ccw-fab {
      position: fixed; bottom: 24px; ${posRight ? 'right: 24px' : 'left: 24px'};
      width: 60px; height: 60px; border-radius: 50%;
      background: ${CONFIG.color}; color: #fff;
      border: none; cursor: pointer; z-index: 99999;
      box-shadow: 0 4px 20px rgba(0,0,0,0.25);
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    #ccw-fab:hover { transform: scale(1.08); box-shadow: 0 6px 28px rgba(0,0,0,0.3); }
    #ccw-fab svg { width: 28px; height: 28px; }

    #ccw-badge {
      position: absolute; top: -4px; right: -4px;
      background: #ef4444; color: #fff; font-size: 11px; font-weight: 700;
      width: 22px; height: 22px; border-radius: 50%;
      display: none; align-items: center; justify-content: center;
      border: 2px solid #fff;
    }
    #ccw-badge.show { display: flex; }

    #ccw-window {
      position: fixed; bottom: 96px; ${posRight ? 'right: 24px' : 'left: 24px'};
      width: 380px; max-width: calc(100vw - 32px);
      height: 520px; max-height: calc(100vh - 120px);
      background: #fff; border-radius: 16px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.2);
      z-index: 99998; overflow: hidden;
      display: flex; flex-direction: column;
      opacity: 0; transform: translateY(20px) scale(0.95);
      transition: opacity 0.25s, transform 0.25s;
      pointer-events: none;
    }
    #ccw-window.open { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }

    #ccw-header {
      background: ${CONFIG.color}; color: #fff; padding: 16px 20px;
      display: flex; align-items: center; gap: 12px; flex-shrink: 0;
    }
    #ccw-header-avatar {
      width: 40px; height: 40px; border-radius: 50%;
      background: rgba(255,255,255,0.2); display: flex;
      align-items: center; justify-content: center; flex-shrink: 0;
    }
    #ccw-header-avatar svg { width: 22px; height: 22px; }
    #ccw-header-info h3 { font-size: 15px; font-weight: 600; }
    #ccw-header-info p { font-size: 11px; opacity: 0.85; margin-top: 2px; }
    #ccw-close {
      margin-left: auto; background: none; border: none;
      color: #fff; cursor: pointer; padding: 4px; opacity: 0.8;
    }
    #ccw-close:hover { opacity: 1; }

    #ccw-messages {
      flex: 1; overflow-y: auto; padding: 16px;
      display: flex; flex-direction: column; gap: 10px;
      background: #f8fafc;
    }
    #ccw-messages::-webkit-scrollbar { width: 4px; }
    #ccw-messages::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }

    .ccw-msg {
      max-width: 82%; padding: 10px 14px; border-radius: 14px;
      font-size: 13.5px; line-height: 1.5; word-break: break-word;
      animation: ccw-slide 0.2s ease-out;
    }
    .ccw-msg-in {
      align-self: flex-start; background: #fff;
      border: 1px solid #e2e8f0; border-bottom-left-radius: 4px;
    }
    .ccw-msg-out {
      align-self: flex-end; background: ${CONFIG.color}; color: #fff;
      border-bottom-right-radius: 4px;
    }
    .ccw-msg-time {
      font-size: 10px; opacity: 0.6; margin-top: 4px;
    }
    .ccw-msg-out .ccw-msg-time { text-align: right; }

    .ccw-typing {
      align-self: flex-start; padding: 12px 16px;
      background: #fff; border: 1px solid #e2e8f0;
      border-radius: 14px; border-bottom-left-radius: 4px;
      display: flex; gap: 4px;
    }
    .ccw-typing span {
      width: 7px; height: 7px; background: #94a3b8;
      border-radius: 50%; animation: ccw-bounce 1.4s infinite;
    }
    .ccw-typing span:nth-child(2) { animation-delay: 0.2s; }
    .ccw-typing span:nth-child(3) { animation-delay: 0.4s; }

    #ccw-input-area {
      padding: 12px 16px; border-top: 1px solid #e2e8f0;
      display: flex; gap: 8px; align-items: center; background: #fff; flex-shrink: 0;
    }
    #ccw-input {
      flex: 1; border: 1px solid #e2e8f0; border-radius: 24px;
      padding: 10px 16px; font-size: 13.5px; outline: none;
      transition: border-color 0.2s;
    }
    #ccw-input:focus { border-color: ${CONFIG.color}; }
    #ccw-send {
      width: 40px; height: 40px; border-radius: 50%;
      background: ${CONFIG.color}; color: #fff; border: none;
      cursor: pointer; display: flex; align-items: center;
      justify-content: center; flex-shrink: 0;
      transition: opacity 0.2s;
    }
    #ccw-send:disabled { opacity: 0.4; cursor: default; }
    #ccw-send svg { width: 18px; height: 18px; }

    #ccw-powered {
      text-align: center; padding: 6px; font-size: 10px;
      color: #94a3b8; background: #fff; flex-shrink: 0;
    }

    @keyframes ccw-slide { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes ccw-bounce { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-6px); } }

    @media (max-width: 480px) {
      #ccw-window { bottom: 0; ${posRight ? 'right: 0' : 'left: 0'}; width: 100vw; height: 100vh; max-height: 100vh; border-radius: 0; }
      #ccw-fab { bottom: 16px; ${posRight ? 'right: 16px' : 'left: 16px'}; }
    }
  `;

  // ── SVG Icons ────────────────────────────────────────
  const ICON_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  const ICON_SEND = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
  const ICON_BOT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>';

  // ── Render ───────────────────────────────────────────
  function render() {
    // Inject CSS
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    // Container
    const container = document.createElement('div');
    container.id = 'ccw-container';

    // FAB button
    container.innerHTML = `
      <button id="ccw-fab" aria-label="Abrir chat">
        ${ICON_CHAT}
        <span id="ccw-badge">0</span>
      </button>
      <div id="ccw-window">
        <div id="ccw-header">
          <div id="ccw-header-avatar">${ICON_BOT}</div>
          <div id="ccw-header-info">
            <h3>${CONFIG.title}</h3>
            <p>Assistente virtual 24/7</p>
          </div>
          <button id="ccw-close" aria-label="Fechar">${ICON_X}</button>
        </div>
        <div id="ccw-messages"></div>
        <div id="ccw-input-area">
          <input id="ccw-input" type="text" placeholder="${CONFIG.placeholder}" autocomplete="off" />
          <button id="ccw-send" disabled aria-label="Enviar">${ICON_SEND}</button>
        </div>
        <div id="ccw-powered">Conectiva Infor &bull; Atendimento Inteligente</div>
      </div>
    `;

    document.body.appendChild(container);

    // Bindings
    document.getElementById('ccw-fab').addEventListener('click', toggleChat);
    document.getElementById('ccw-close').addEventListener('click', toggleChat);
    document.getElementById('ccw-send').addEventListener('click', sendMessage);

    const input = document.getElementById('ccw-input');
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    input.addEventListener('input', () => {
      document.getElementById('ccw-send').disabled = !input.value.trim();
    });
  }

  // ── Chat Toggle ──────────────────────────────────────
  function toggleChat() {
    isOpen = !isOpen;
    const win = document.getElementById('ccw-window');
    const fab = document.getElementById('ccw-fab');

    if (isOpen) {
      win.classList.add('open');
      fab.innerHTML = ICON_X + '<span id="ccw-badge">0</span>';
      unreadCount = 0;
      updateBadge();

      // Greeting na primeira abertura
      if (messages.length === 0) {
        addMessage('in', CONFIG.greeting);
      }

      setTimeout(() => document.getElementById('ccw-input').focus(), 300);
    } else {
      win.classList.remove('open');
      fab.innerHTML = ICON_CHAT + `<span id="ccw-badge" class="${unreadCount > 0 ? 'show' : ''}">${unreadCount}</span>`;
    }
  }

  // ── Mensagens ────────────────────────────────────────
  function addMessage(dir, text) {
    const now = new Date();
    const time = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const cls = dir === 'in' ? 'ccw-msg-in' : 'ccw-msg-out';

    messages.push({ dir, text, time });

    const msgArea = document.getElementById('ccw-messages');
    const div = document.createElement('div');
    div.className = `ccw-msg ${cls}`;

    // Converter newlines em <br> para mensagens do bot
    const safeText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    div.innerHTML = `<div>${safeText}</div><div class="ccw-msg-time">${time}</div>`;

    msgArea.appendChild(div);
    msgArea.scrollTop = msgArea.scrollHeight;

    if (dir === 'in' && !isOpen) {
      unreadCount++;
      updateBadge();
    }
  }

  function updateBadge() {
    const badge = document.getElementById('ccw-badge');
    if (!badge) return;
    badge.textContent = unreadCount;
    badge.className = unreadCount > 0 ? 'show' : '';
  }

  function showTyping() {
    const msgArea = document.getElementById('ccw-messages');
    const div = document.createElement('div');
    div.className = 'ccw-typing';
    div.id = 'ccw-typing-indicator';
    div.innerHTML = '<span></span><span></span><span></span>';
    msgArea.appendChild(div);
    msgArea.scrollTop = msgArea.scrollHeight;
  }

  function hideTyping() {
    const el = document.getElementById('ccw-typing-indicator');
    if (el) el.remove();
  }

  // ── Send ─────────────────────────────────────────────
  async function sendMessage() {
    const input = document.getElementById('ccw-input');
    const text = input.value.trim();
    if (!text || isLoading) return;

    // Mostrar mensagem do usuário
    addMessage('out', text);
    input.value = '';
    document.getElementById('ccw-send').disabled = true;

    // Loading state
    isLoading = true;
    showTyping();

    try {
      const res = await fetch(`${CONFIG.server}/webhook/site`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: visitorId,
          message: text,
          name: 'Visitante',
        }),
      });

      const data = await res.json();
      hideTyping();

      if (data.reply) {
        addMessage('in', data.reply);
      } else {
        addMessage('in', 'Desculpe, não consegui processar sua mensagem. Tente novamente.');
      }
    } catch (err) {
      hideTyping();
      addMessage('in', 'Desculpe, estou com dificuldades de conexão. Tente novamente em instantes.');
      console.error('[ConectivaChat] Erro:', err);
    }

    isLoading = false;
  }

  // ── Init ─────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
