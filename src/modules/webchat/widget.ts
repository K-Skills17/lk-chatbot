/**
 * Returns the embeddable chat widget HTML/JS/CSS as a string.
 * Served at GET /api/webchat/:tenantId/widget.js
 *
 * The widget fetches /api/webchat/:tenantId/config to load per-tenant
 * branding (colors, header title, welcome message, position).
 */
export function getWidgetScript(tenantId: string, baseUrl: string): string {
  return `
(function() {
  if (window.__lkChatLoaded) return;
  window.__lkChatLoaded = true;

  var TENANT_ID = ${JSON.stringify(tenantId)};
  var BASE_URL  = ${JSON.stringify(baseUrl)};
  var SESSION_KEY = 'lk_chat_session_' + TENANT_ID;

  // ── Default config (overridden by server) ──────────────────
  var cfg = {
    primaryColor: '#2563eb',
    headerTitle: 'Chat',
    welcomeMessage: null,
    position: 'bottom-right',
    avatarUrl: null,
    bubbleIcon: 'chat'
  };

  // ── Helpers ────────────────────────────────────────────────
  function hexToRgba(hex, alpha) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function darken(hex, amount) {
    var r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amount);
    var g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amount);
    var b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amount);
    return '#' + [r, g, b].map(function(c) { return c.toString(16).padStart(2, '0'); }).join('');
  }

  var BUBBLE_ICONS = {
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>',
    message: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline>',
    help: '<circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line>'
  };

  // ── Build UI ──────────────────────────────────────────────
  function buildWidget() {
    var c = cfg.primaryColor;
    var posRight = cfg.position === 'bottom-right';

    // ── Styles ──────────────────────────────────────────────
    var css = document.createElement('style');
    css.textContent = \`
      #lk-chat-bubble {
        position: fixed; bottom: 20px; \${posRight ? 'right: 20px' : 'left: 20px'}; z-index: 99999;
        width: 60px; height: 60px; border-radius: 50%;
        background: \${c}; color: #fff; border: none; cursor: pointer;
        box-shadow: 0 4px 14px \${hexToRgba(c, 0.4)};
        display: flex; align-items: center; justify-content: center;
        transition: transform 0.2s, box-shadow 0.2s;
      }
      #lk-chat-bubble:hover { transform: scale(1.08); box-shadow: 0 6px 20px \${hexToRgba(c, 0.5)}; }
      #lk-chat-bubble svg { width: 28px; height: 28px; }

      #lk-chat-window {
        position: fixed; bottom: 90px; \${posRight ? 'right: 20px' : 'left: 20px'}; z-index: 99999;
        width: 380px; max-width: calc(100vw - 32px); height: 520px; max-height: calc(100vh - 120px);
        background: #fff; border-radius: 16px;
        box-shadow: 0 8px 30px rgba(0,0,0,0.18);
        display: none; flex-direction: column; overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      #lk-chat-window.open { display: flex; }

      #lk-chat-header {
        background: \${c}; color: #fff; padding: 16px 18px;
        font-size: 15px; font-weight: 600;
        display: flex; align-items: center; justify-content: space-between;
      }
      #lk-chat-header-left { display: flex; align-items: center; gap: 10px; }
      #lk-chat-avatar {
        width: 32px; height: 32px; border-radius: 50%;
        object-fit: cover; border: 2px solid rgba(255,255,255,0.3);
      }
      #lk-chat-header button {
        background: none; border: none; color: #fff; cursor: pointer;
        font-size: 20px; line-height: 1; padding: 0 0 0 8px;
      }

      #lk-chat-messages {
        flex: 1; overflow-y: auto; padding: 16px;
        display: flex; flex-direction: column; gap: 10px;
      }
      .lk-msg {
        max-width: 80%; padding: 10px 14px; border-radius: 14px;
        font-size: 14px; line-height: 1.45; word-wrap: break-word;
        white-space: pre-wrap;
      }
      .lk-msg a { color: inherit; text-decoration: underline; }
      .lk-msg-user {
        align-self: flex-end; background: \${c}; color: #fff;
        border-bottom-right-radius: 4px;
      }
      .lk-msg-bot {
        align-self: flex-start; background: #f1f5f9; color: #1e293b;
        border-bottom-left-radius: 4px;
      }
      .lk-msg-typing {
        align-self: flex-start; background: #f1f5f9; color: #94a3b8;
        border-bottom-left-radius: 4px; font-style: italic;
      }

      #lk-chat-input-bar {
        display: flex; flex-direction: column; border-top: 1px solid #e2e8f0; padding: 10px 12px; gap: 8px;
      }
      #lk-chat-input-row { display: flex; gap: 8px; align-items: flex-end; }
      #lk-chat-input {
        flex: 1; border: 1px solid #e2e8f0; border-radius: 10px;
        padding: 10px 14px; font-size: 14px; outline: none;
        font-family: inherit; resize: none; min-height: 20px; max-height: 80px;
      }
      #lk-chat-input:focus { border-color: \${c}; }
      #lk-chat-img-btn {
        background: none; border: 1px solid #e2e8f0; border-radius: 10px;
        padding: 0 10px; height: 42px; cursor: pointer; color: #94a3b8;
        display: flex; align-items: center; justify-content: center;
        transition: color 0.2s, border-color 0.2s;
      }
      #lk-chat-img-btn:hover { color: \${c}; border-color: \${c}; }
      #lk-chat-img-btn svg { width: 18px; height: 18px; }
      #lk-chat-send {
        background: \${c}; color: #fff; border: none; border-radius: 10px;
        padding: 0 16px; height: 42px; cursor: pointer; font-size: 14px; font-weight: 600;
        white-space: nowrap;
      }
      #lk-chat-send:hover { background: \${darken(c, 20)}; }
      #lk-chat-send:disabled { opacity: 0.5; cursor: default; }
      #lk-chat-img-preview {
        display: none; align-items: center; gap: 8px;
        background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;
        padding: 6px 10px; font-size: 12px; color: #64748b;
      }
      #lk-chat-img-preview.active { display: flex; }
      #lk-chat-img-preview img { width: 36px; height: 36px; object-fit: cover; border-radius: 4px; }
      #lk-chat-img-remove {
        background: none; border: none; color: #94a3b8; cursor: pointer;
        font-size: 16px; line-height: 1; padding: 0; margin-left: auto;
      }
      #lk-chat-img-remove:hover { color: #ef4444; }
      .lk-msg-img { max-width: 180px; border-radius: 8px; margin-bottom: 4px; display: block; }

      #lk-chat-powered {
        text-align: center; padding: 4px 0; font-size: 11px; color: #94a3b8;
        border-top: 1px solid #f1f5f9;
      }
      #lk-chat-powered a { color: #64748b; text-decoration: none; }
      #lk-chat-powered a:hover { text-decoration: underline; }

      @media (max-width: 480px) {
        #lk-chat-window {
          bottom: 0; right: 0; left: 0;
          width: 100%; height: 100vh; max-height: 100vh;
          border-radius: 0;
        }
        #lk-chat-bubble { bottom: 16px; \${posRight ? 'right: 16px' : 'left: 16px'}; }
      }
    \`;
    document.head.appendChild(css);

    // ── Chat Bubble ─────────────────────────────────────────
    var bubble = document.createElement('button');
    bubble.id = 'lk-chat-bubble';
    bubble.setAttribute('aria-label', 'Open chat');
    bubble.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (BUBBLE_ICONS[cfg.bubbleIcon] || BUBBLE_ICONS.chat) + '</svg>';
    document.body.appendChild(bubble);

    // ── Chat Window ─────────────────────────────────────────
    var avatarHtml = cfg.avatarUrl
      ? '<img id="lk-chat-avatar" src="' + cfg.avatarUrl + '" alt="avatar" />'
      : '';

    var win = document.createElement('div');
    win.id = 'lk-chat-window';
    win.innerHTML = \`
      <div id="lk-chat-header">
        <div id="lk-chat-header-left">
          \${avatarHtml}
          <span>\${cfg.headerTitle}</span>
        </div>
        <button id="lk-chat-close" aria-label="Close chat">&times;</button>
      </div>
      <div id="lk-chat-messages"></div>
      <div id="lk-chat-input-bar">
        <div id="lk-chat-img-preview">
          <img id="lk-chat-img-thumb" src="" alt="preview" />
          <span id="lk-chat-img-name"></span>
          <button id="lk-chat-img-remove" title="Remover imagem">&times;</button>
        </div>
        <div id="lk-chat-input-row">
          <button id="lk-chat-img-btn" title="Enviar imagem">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
          </button>
          <input type="file" id="lk-chat-file-input" accept="image/*" style="display:none" />
          <textarea id="lk-chat-input" placeholder="Digite sua mensagem..." autocomplete="off" rows="1"></textarea>
          <button id="lk-chat-send" disabled>Enviar</button>
        </div>
      </div>
      <div id="lk-chat-powered">Powered by <a href="https://lkdigital.odo.br" target="_blank" rel="noopener">LK Digital</a></div>
    \`;
    document.body.appendChild(win);

    var messagesDiv  = document.getElementById('lk-chat-messages');
    var input        = document.getElementById('lk-chat-input');
    var sendBtn      = document.getElementById('lk-chat-send');
    var imgBtn       = document.getElementById('lk-chat-img-btn');
    var fileInput    = document.getElementById('lk-chat-file-input');
    var imgPreview   = document.getElementById('lk-chat-img-preview');
    var imgThumb     = document.getElementById('lk-chat-img-thumb');
    var imgName      = document.getElementById('lk-chat-img-name');
    var imgRemove    = document.getElementById('lk-chat-img-remove');
    var sessionId    = localStorage.getItem(SESSION_KEY);
    var sending      = false;
    var welcomed     = false;
    var pendingImage = null; // { base64: string, mimeType: string, dataUrl: string, name: string }

    // ── Toggle ──────────────────────────────────────────────
    bubble.addEventListener('click', function() {
      win.classList.toggle('open');
      if (win.classList.contains('open')) {
        if (!sessionId) initSession();
        else if (!welcomed) showWelcome();
        input.focus();
      }
    });
    document.getElementById('lk-chat-close').addEventListener('click', function() {
      win.classList.remove('open');
    });

    // ── Input Handling ──────────────────────────────────────
    function updateSendBtn() {
      sendBtn.disabled = (!input.value.trim() && !pendingImage) || sending;
    }
    input.addEventListener('input', updateSendBtn);
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    sendBtn.addEventListener('click', send);

    // ── Image Handling ──────────────────────────────────────
    imgBtn.addEventListener('click', function() { fileInput.click(); });

    fileInput.addEventListener('change', function() {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) {
        alert('Imagem muito grande. Máximo 8MB.');
        fileInput.value = '';
        return;
      }
      var reader = new FileReader();
      reader.onload = function(e) {
        var dataUrl = e.target.result;
        var base64 = dataUrl.split(',')[1];
        pendingImage = { base64: base64, mimeType: file.type, dataUrl: dataUrl, name: file.name };
        imgThumb.src = dataUrl;
        imgName.textContent = file.name.length > 24 ? file.name.slice(0, 21) + '...' : file.name;
        imgPreview.classList.add('active');
        updateSendBtn();
      };
      reader.readAsDataURL(file);
      fileInput.value = '';
    });

    imgRemove.addEventListener('click', function() {
      pendingImage = null;
      imgPreview.classList.remove('active');
      imgThumb.src = '';
      updateSendBtn();
    });

    function addMessage(text, cls, imgDataUrl) {
      var div = document.createElement('div');
      div.className = 'lk-msg ' + cls;
      var html = '';
      if (imgDataUrl) {
        html += '<img class="lk-msg-img" src="' + imgDataUrl + '" alt="imagem enviada" />';
      }
      if (text) {
        html += text.replace(/(https?:\\/\\/[^\\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
      }
      div.innerHTML = html;
      messagesDiv.appendChild(div);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
      return div;
    }

    function showWelcome() {
      if (welcomed) return;
      welcomed = true;
      if (cfg.welcomeMessage && messagesDiv.children.length === 0) {
        addMessage(cfg.welcomeMessage, 'lk-msg-bot', null);
      }
    }

    function initSession() {
      fetch(BASE_URL + '/api/webchat/' + TENANT_ID + '/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId })
      })
      .then(function(r) {
        if (!r.ok) throw new Error('Session request failed: ' + r.status);
        return r.json();
      })
      .then(function(data) {
        if (!data.sessionId) throw new Error('No sessionId in response');
        sessionId = data.sessionId;
        localStorage.setItem(SESSION_KEY, sessionId);
        return fetch(BASE_URL + '/api/webchat/' + TENANT_ID + '/messages/' + sessionId);
      })
      .then(function(r) {
        if (!r.ok) return { messages: [] };
        return r.json();
      })
      .then(function(data) {
        if (data.messages && data.messages.length > 0) {
          welcomed = true;
          data.messages.forEach(function(m) {
            addMessage(m.content, m.role === 'user' ? 'lk-msg-user' : 'lk-msg-bot', null);
          });
        } else {
          showWelcome();
        }
      })
      .catch(function(err) {
        console.error('LK Chat: session init failed', err);
        addMessage('Não foi possível conectar ao assistente. Tente novamente.', 'lk-msg-bot', null);
      });
    }

    function send() {
      var text = input.value.trim();
      var image = pendingImage;
      if (!text && !image || sending) return;
      sending = true;
      sendBtn.disabled = true;
      input.value = '';

      // Clear image preview
      pendingImage = null;
      imgPreview.classList.remove('active');
      imgThumb.src = '';

      addMessage(text, 'lk-msg-user', image ? image.dataUrl : null);
      var typing = addMessage('Analisando...', 'lk-msg-typing');

      var payload = { sessionId: sessionId, text: text };
      if (image) {
        payload.imageBase64 = image.base64;
        payload.imageMimeType = image.mimeType;
      }

      fetch(BASE_URL + '/api/webchat/' + TENANT_ID + '/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        typing.remove();
        if (data.reply) {
          addMessage(data.reply, 'lk-msg-bot');
          if (data.sessionId) {
            sessionId = data.sessionId;
            localStorage.setItem(SESSION_KEY, sessionId);
          }
        } else if (data.error) {
          addMessage('Desculpe, ocorreu um erro. Tente novamente.', 'lk-msg-bot');
        }
      })
      .catch(function() {
        typing.remove();
        addMessage('Desculpe, não consegui conectar. Tente novamente.', 'lk-msg-bot');
      })
      .finally(function() {
        sending = false;
        updateSendBtn();
        input.focus();
      });
    }

    // Auto-init session on load if we already have one
    if (sessionId) initSession();
  }

  // ── Load config then build ────────────────────────────────
  fetch(BASE_URL + '/api/webchat/' + TENANT_ID + '/config')
    .then(function(r) { return r.ok ? r.json() : {}; })
    .then(function(data) {
      if (data.primaryColor) cfg.primaryColor = data.primaryColor;
      if (data.headerTitle)  cfg.headerTitle  = data.headerTitle;
      if (data.welcomeMessage) cfg.welcomeMessage = data.welcomeMessage;
      if (data.position)     cfg.position     = data.position;
      if (data.avatarUrl)    cfg.avatarUrl    = data.avatarUrl;
      if (data.bubbleIcon)   cfg.bubbleIcon   = data.bubbleIcon;
    })
    .catch(function() { /* use defaults */ })
    .then(function() { buildWidget(); });
})();
`;
}
