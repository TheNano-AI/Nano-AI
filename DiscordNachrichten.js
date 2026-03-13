/**
 * ============================================
 * 📡 DiscordNachrichten.js – Echtzeit Chat
 * ============================================
 * Lädt Nachrichten aus Datenbank & zeigt neue in Echtzeit an
 * Format: [Rank | Tarif] Name: Nachricht
 * 
 * 🔗 Einbinden in index.html:
 * <script src="https://thenano-ai.github.io/Nano-AI/DiscordNachrichten.js" defer></script>
 * ============================================
 */

// ============================================
// 🔧 KONFIGURATION – HIER ANPASSEN
// ============================================
const DISCORD_CHAT_CONFIG = {
    // 🔥 Firebase Config (kostenlos, Echtzeit, einfach)
    // → Hol dir deine Keys von: https://console.firebase.google.com/
    firebase: {
        apiKey: "DEINE_API_KEY",
        authDomain: "dein-projekt.firebaseapp.com",
        projectId: "dein-projekt-id",
        storageBucket: "dein-projekt.appspot.com",
        messagingSenderId: "123456789",
        appId: "1:123456789:web:abcdef123456"
    },
    
    // Firestore Collection Name
    collectionName: "community_messages",
    
    // Max Nachrichten die geladen werden
    maxMessages: 50,
    
    // Auto-Refresh Intervall (fallback wenn realtime nicht geht)
    fallbackPollInterval: 10000, // 10 Sekunden
    
    // UI Einstellungen
    ui: {
        containerId: "discord-messages-container",
        loadingText: "Lade Nachrichten...",
        errorText: "Fehler beim Laden der Nachrichten",
        emptyText: "Noch keine Nachrichten – sei der Erste! 💬",
        showTimestamps: true,
        showRankBadges: true,
        animationEnabled: true
    },
    
    // Nachricht filtern (optional)
    filters: {
        minMessageLength: 1,
        maxMessageLength: 500,
        allowedRanks: ["User", "Premium", "Pro", "Dev"], // oder null für alle
        profanityFilter: true // einfache Filterung
    }
};

// ============================================
// 📦 FIREBASE SDK – Dynamisch laden
// ============================================
let db = null;
let unsubscribe = null;
let messageCache = new Map();

/**
 * Firebase initialisieren
 */
async function initFirebase() {
    // Prüfen ob schon initialisiert
    if (db) return db;
    
    try {
        // Firebase SDKs dynamisch laden (kein Build-Step nötig)
        const [appMod, firestoreMod] = await Promise.all([
            import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js'),
            import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js')
        ]);
        
        const { initializeApp } = appMod;
        const { getFirestore, collection, query, orderBy, limit, onSnapshot, addDoc, serverTimestamp } = firestoreMod;
        
        // App initialisieren
        const app = initializeApp(DISCORD_CHAT_CONFIG.firebase);
        db = getFirestore(app);
        
        console.log('✅ Firebase verbunden');
        return db;
        
    } catch (error) {
        console.error('❌ Firebase Init Fehler:', error);
        // Fallback zu Polling
        startFallbackPolling();
        return null;
    }
}

// ============================================
// 📡 ECHTZEIT-LISTENER – Neue Nachrichten
// ============================================
function startRealtimeListener(onNewMessage, onError) {
    if (!db) {
        console.warn('⚠️ Firebase nicht verbunden, nutze Fallback');
        return startFallbackPolling(onNewMessage, onError);
    }
    
    const { collection, query, orderBy, limit, onSnapshot } = 
        window.firebase?.firestore || (() => {}); // Wird durch dynamischen Import gesetzt
    
    try {
        const q = query(
            collection(db, DISCORD_CHAT_CONFIG.collectionName),
            orderBy('timestamp', 'desc'),
            limit(DISCORD_CHAT_CONFIG.maxMessages)
        );
        
        // 🔥 Echtzeit-Subscription
        unsubscribe = onSnapshot(q, 
            (snapshot) => {
                snapshot.docChanges().forEach((change) => {
                    if (change.type === 'added') {
                        const data = change.doc.data();
                        const message = parseMessageData(data, change.doc.id);
                        
                        // Nur neue Nachrichten anzeigen (nicht beim initialen Load)
                        if (!messageCache.has(message.id)) {
                            console.log('🆕 Neue Nachricht:', message);
                            messageCache.set(message.id, message);
                            onNewMessage?.(message);
                        }
                    }
                });
            },
            (error) => {
                console.error('❌ Realtime Error:', error);
                onError?.(error);
                // Fallback aktivieren
                startFallbackPolling(onNewMessage, onError);
            }
        );
        
        console.log('🔗 Realtime-Listener aktiv');
        return true;
        
    } catch (error) {
        console.error('❌ Listener Setup Fehler:', error);
        return startFallbackPolling(onNewMessage, onError);
    }
}

/**
 * Fallback: Polling alle X Sekunden (wenn Echtzeit nicht geht)
 */
function startFallbackPolling(onNewMessage, onError) {
    console.log('🔄 Fallback-Polling aktiviert');
    
    let lastTimestamp = 0;
    
    const poll = async () => {
        try {
            // Simple fetch zu einem öffentlichen Endpoint
            // Option A: Firebase REST API
            // Option B: Eigener API-Endpoint
            // Option C: GitHub API (siehe Alternative unten)
            
            const response = await fetch(
                `https://firestore.googleapis.com/v1/projects/${DISCORD_CHAT_CONFIG.firebase.projectId}/databases/(default)/documents/${DISCORD_CHAT_CONFIG.collectionName}?orderBy=timestamp desc&limit=20`,
                { headers: { 'Content-Type': 'application/json' } }
            );
            
            if (!response.ok) throw new Error('Fetch failed');
            
            const data = await response.json();
            // ... Verarbeitung ähnlich wie bei onSnapshot
            
        } catch (error) {
            console.warn('⚠️ Polling Fehler:', error);
            onError?.(error);
        }
    };
    
    // Sofort laden + dann interval
    poll();
    return setInterval(poll, DISCORD_CHAT_CONFIG.fallbackPollInterval);
}

/**
 * Nachricht aus Datenbank-Format parsen
 */
function parseMessageData(data, docId) {
    return {
        id: data.id || docId,
        name: data.name || 'Unbekannt',
        rank: data.rank || 'User',
        message: data.message || '',
        formatted: data.formatted || `[${data.rank || 'User'} | ${getTarifName(data.rank)}] ${data.name}: ${data.message}`,
        timestamp: data.timestamp?.toDate?.() || new Date(data.timestamp || Date.now()),
        discordSent: data.discordSent || false,
        avatar: data.avatar || null
    };
}

/**
 * Rank zu Tarif-Name mapping
 */
function getTarifName(rank) {
    const map = { 'User': 'Free', 'Premium': 'Ultra', 'Pro': 'Nano Pro', 'Dev': 'Developer' };
    return map[rank] || rank;
}

// ============================================
// 🎨 UI FUNCTIONS – Nachrichten anzeigen
// ============================================

/**
 * Container im DOM finden oder erstellen
 */
function getOrCreateContainer() {
    let container = document.getElementById(DISCORD_CHAT_CONFIG.ui.containerId);
    
    if (!container) {
        container = document.createElement('div');
        container.id = DISCORD_CHAT_CONFIG.ui.containerId;
        container.className = 'discord-messages-container';
        container.innerHTML = `
            <div class="chat-header">
                <h3>💬 Community Chat</h3>
                <span class="status-indicator" title="Verbindungsstatus">🟡</span>
            </div>
            <div class="messages-list" id="messages-list"></div>
            <div class="chat-loading" id="chat-loading">${DISCORD_CHAT_CONFIG.ui.loadingText}</div>
            <div class="chat-empty" id="chat-empty" style="display:none">${DISCORD_CHAT_CONFIG.ui.emptyText}</div>
            <div class="chat-error" id="chat-error" style="display:none">${DISCORD_CHAT_CONFIG.ui.errorText}</div>
        `;
        // Styles injecten
        injectChatStyles();
    }
    
    return container;
}

/**
 * CSS Styles dynamisch injecten
 */
function injectChatStyles() {
    if (document.getElementById('discord-chat-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'discord-chat-styles';
    style.textContent = `
        .discord-messages-container {
            background: var(--bg-card, rgba(255,255,255,0.05));
            border: 1px solid var(--border, rgba(255,255,255,0.08));
            border-radius: var(--border-radius-lg, 25px);
            padding: 20px;
            backdrop-filter: blur(20px);
            max-width: 800px;
            margin: 20px auto;
        }
        .chat-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding-bottom: 15px;
            border-bottom: 1px solid var(--border);
            margin-bottom: 15px;
        }
        .chat-header h3 {
            margin: 0;
            font-size: 18px;
            font-weight: 600;
        }
        .status-indicator {
            font-size: 14px;
            transition: color 0.3s;
        }
        .status-indicator.online { color: #00ff88; }
        .status-indicator.offline { color: #ff6b6b; }
        .status-indicator.connecting { color: #ffd93d; }
        
        .messages-list {
            max-height: 400px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 10px;
            padding-right: 5px;
        }
        .messages-list::-webkit-scrollbar { width: 6px; }
        .messages-list::-webkit-scrollbar-thumb { 
            background: var(--primary, #0066ff); 
            border-radius: 3px; 
        }
        
        .message-card {
            background: rgba(255,255,255,0.03);
            border-radius: var(--border-radius-md, 15px);
            padding: 12px 15px;
            animation: ${DISCORD_CHAT_CONFIG.ui.animationEnabled ? 'messageSlide 0.3s ease' : 'none'};
            border-left: 3px solid var(--primary, #0066ff);
        }
        @keyframes messageSlide {
            from { opacity: 0; transform: translateX(-20px); }
            to { opacity: 1; transform: translateX(0); }
        }
        
        .message-header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 5px;
            font-size: 13px;
        }
        .rank-badge {
            padding: 3px 10px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }
        .rank-badge.User { background: rgba(255,255,255,0.1); color: var(--text-secondary); }
        .rank-badge.Premium { background: rgba(0,212,255,0.2); color: #00d4ff; }
        .rank-badge.Pro { background: rgba(0,255,136,0.2); color: #00ff88; }
        .rank-badge.Dev { background: rgba(138,43,226,0.2); color: #9b59b6; }
        
        .message-name { font-weight: 600; color: var(--text-primary); }
        .message-time { color: var(--text-muted); font-size: 11px; margin-left: auto; }
        
        .message-text {
            color: var(--text-secondary);
            line-height: 1.5;
            word-wrap: break-word;
        }
        .message-text a { color: var(--primary); text-decoration: none; }
        .message-text a:hover { text-decoration: underline; }
        
        .chat-loading, .chat-empty, .chat-error {
            text-align: center;
            padding: 20px;
            color: var(--text-muted);
            font-size: 14px;
        }
        .chat-error { color: #ff6b6b; }
        
        /* Mobile */
        @media (max-width: 600px) {
            .discord-messages-container { margin: 10px; padding: 15px; }
            .messages-list { max-height: 300px; }
        }
    `;
    document.head.appendChild(style);
}

/**
 * Einzelne Nachricht als HTML rendern
 */
function renderMessage(message) {
    const rankIcons = { 'User': '👤', 'Premium': '⭐', 'Pro': '🔥', 'Dev': '💻' };
    const time = DISCORD_CHAT_CONFIG.ui.showTimestamps 
        ? message.timestamp.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
        : '';
    
    const div = document.createElement('div');
    div.className = 'message-card';
    div.id = `msg-${message.id}`;
    div.innerHTML = `
        <div class="message-header">
            ${DISCORD_CHAT_CONFIG.ui.showRankBadges ? 
                `<span class="rank-badge ${message.rank}">${rankIcons[message.rank] || '👤'} ${message.rank}</span>` : ''}
            <span class="message-name">${escapeHtml(message.name)}</span>
            ${time ? `<span class="message-time">• ${time}</span>` : ''}
        </div>
        <div class="message-text">${formatMessageText(escapeHtml(message.message))}</div>
    `;
    
    return div;
}

/**
 * Nachrichtentext formatieren (Links, Emojis, etc.)
 */
function formatMessageText(text) {
    // URLs zu Links machen
    text = text.replace(
        /(https?:\/\/[^\s]+)/g, 
        '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    
    // Einfache Emoji-Shortcodes (optional)
    // text = text.replace(/:(\w+):/g, (match, emoji) => emojiMap[emoji] || match);
    
    return text;
}

/**
 * HTML-Escaping gegen XSS
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Nachricht zur UI hinzufügen (mit Animation)
 */
function addMessageToUI(message, prepend = true) {
    const container = document.getElementById('messages-list');
    if (!container) return;
    
    const msgEl = renderMessage(message);
    
    if (prepend) {
        container.insertBefore(msgEl, container.firstChild);
        // Scroll nach oben wenn neu
        if (container.scrollHeight > container.clientHeight) {
            container.scrollTop = 0;
        }
    } else {
        container.appendChild(msgEl);
    }
    
    // Leere-State ausblenden
    const emptyEl = document.getElementById('chat-empty');
    if (emptyEl) emptyEl.style.display = 'none';
}

/**
 * Mehrere Nachrichten laden und anzeigen
 */
function loadMessages(messages, clear = false) {
    const container = document.getElementById('messages-list');
    const emptyEl = document.getElementById('chat-empty');
    const loadingEl = document.getElementById('chat-loading');
    
    if (clear && container) {
        container.innerHTML = '';
        messageCache.clear();
    }
    
    if (loadingEl) loadingEl.style.display = 'none';
    
    if (!messages || messages.length === 0) {
        if (emptyEl) emptyEl.style.display = 'block';
        return;
    }
    
    if (emptyEl) emptyEl.style.display = 'none';
    
    // Nachrichten in umgekehrter Reihenfolge (älteste zuerst) für korrekte Anzeige
    [...messages].reverse().forEach(msg => {
        messageCache.set(msg.id, msg);
        addMessageToUI(msg, false); // append, nicht prepend
    });
}

/**
 * Status-Indikator aktualisieren
 */
function updateConnectionStatus(status) {
    const indicator = document.querySelector('.status-indicator');
    if (indicator) {
        indicator.className = `status-indicator ${status}`;
        indicator.title = {
            'online': 'Verbunden ✓',
            'offline': 'Getrennt ✗',
            'connecting': 'Verbinde...'
        }[status] || status;
    }
}

// ============================================
// 🚀 MAIN EXPORT – Öffentliche API
// ============================================

/**
 * Hauptfunktion: Chat initialisieren
 * @param {Object} options - Override Config
 * @param {Function} callbacks.onMessage - Callback bei neuer Nachricht
 * @param {Function} callbacks.onError - Callback bei Fehler
 */
async function initDiscordChat(options = {}, callbacks = {}) {
    // Config mergen
    const config = { ...DISCORD_CHAT_CONFIG, ...options };
    
    // Container bereitstellen
    const container = getOrCreateContainer();
    if (!document.getElementById(config.ui.containerId)) {
        // In Body appenden oder an spezifischer Stelle einfügen
        document.body.appendChild(container);
    }
    
    // Status: Connecting
    updateConnectionStatus('connecting');
    
    // Firebase initialisieren
    await initFirebase();
    
    // Initiale Nachrichten laden
    try {
        if (db) {
            const { collection, query, orderBy, limit, getDocs } = 
                window.firebase?.firestore || {};
            
            if (getDocs) {
                const q = query(
                    collection(db, config.collectionName),
                    orderBy('timestamp', 'desc'),
                    limit(config.maxMessages)
                );
                const snapshot = await getDocs(q);
                const messages = snapshot.docs.map(doc => 
                    parseMessageData(doc.data(), doc.id)
                ).filter(m => isValidMessage(m));
                
                loadMessages(messages, true);
                console.log(`📥 ${messages.length} Nachrichten geladen`);
            }
        }
    } catch (error) {
        console.warn('⚠️ Initial load failed:', error);
        document.getElementById('chat-error')?.style.setProperty('display', 'block');
    }
    
    // Realtime-Listener starten
    const realtimeActive = startRealtimeListener(
        (newMessage) => {
            if (isValidMessage(newMessage)) {
                addMessageToUI(newMessage, true);
                callbacks.onMessage?.(newMessage);
                
                // Optional: Desktop-Notification
                if (document.hidden && Notification.permission === 'granted') {
                    new Notification(`Neue Nachricht von ${newMessage.name}`, {
                        body: newMessage.message.substring(0, 100),
                        icon: '/NanoAI.png'
                    });
                }
            }
        },
        (error) => {
            console.error('❌ Chat Error:', error);
            updateConnectionStatus('offline');
            callbacks.onError?.(error);
        }
    );
    
    if (realtimeActive) {
        updateConnectionStatus('online');
        console.log('✅ DiscordChat initialisiert');
    }
    
    // Return API for external control
    return {
        addMessage: (msg) => addMessageToUI(msg, true),
        loadMore: () => { /* implement pagination if needed */ },
        destroy: () => unsubscribe?.(),
        getStatus: () => messageCache.size
    };
}

/**
 * Nachricht validieren (Filter)
 */
function isValidMessage(msg) {
    if (!msg?.message) return false;
    
    const { filters } = DISCORD_CHAT_CONFIG;
    
    if (msg.message.length < filters.minMessageLength) return false;
    if (msg.message.length > filters.maxMessageLength) return false;
    if (filters.allowedRanks && !filters.allowedRanks.includes(msg.rank)) return false;
    
    // Einfacher Profanity-Filter (kann erweitert werden)
    if (filters.profanityFilter) {
        const badWords = ['spam', 'scam']; // Erweitern nach Bedarf
        const lower = msg.message.toLowerCase();
        if (badWords.some(word => lower.includes(word))) return false;
    }
    
    return true;
}

/**
 * Nachricht an Datenbank senden (für Send-Formular)
 */
async function sendDiscordMessage({ name, rank, message, avatar }) {
    if (!db) {
        throw new Error('Database not connected');
    }
    
    const { collection, addDoc, serverTimestamp } = 
        window.firebase?.firestore || {};
    
    if (!addDoc) throw new Error('Firestore methods not available');
    
    const rankLabels = { 'User': 'Free', 'Premium': 'Ultra', 'Pro': 'Nano Pro', 'Dev': 'Developer' };
    const formatted = `[${rank} | ${rankLabels[rank] || rank}] ${name}: ${message}`;
    
    const docRef = await addDoc(collection(db, DISCORD_CHAT_CONFIG.collectionName), {
        name: name.trim(),
        rank: rank,
        message: message.trim(),
        formatted: formatted,
        avatar: avatar || null,
        timestamp: serverTimestamp(),
        discordSent: false,
        userAgent: navigator.userAgent,
        ipHash: await simpleHash(navigator.userAgent + Date.now()) // Privacy-friendly
    });
    
    // Optional: Auch direkt an Discord Webhook senden (via Backend-Proxy!)
    // await sendToDiscordWebhook(formatted, { name, rank, message });
    
    return { id: docRef.id, formatted };
}

/**
 * Einfacher Hash für Privacy (kein echter Hash!)
 */
async function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return 'h' + Math.abs(hash).toString(36).slice(0, 8);
}

/**
 * Discord Webhook via Proxy aufrufen (SICHER!)
 */
async function sendToDiscordWebhook(formattedMessage, metadata) {
    // ⚠️ NIEMALS Webhook-URL hier hardcoded!
    // Immer über eigenen Proxy-Server:
    const PROXY_URL = 'https://your-proxy.com/discord-webhook'; // ← Deine Proxy-URL
    
    const response = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            content: formattedMessage,
            username: 'nano.ai Chat',
            avatar_url: 'https://thenano-ai.github.io/Nano-AI/NanoAI.png',
            embeds: [{
                color: 0x0066ff,
                fields: [
                    { name: '👤 Nutzer', value: `\`${metadata.name}\``, inline: true },
                    { name: '🎫 Tarif', value: `\`${metadata.rank}\``, inline: true }
                ],
                timestamp: new Date().toISOString()
            }]
        })
    });
    
    if (!response.ok) {
        throw new Error(`Webhook error: ${response.status}`);
    }
    
    return await response.json();
}

// ============================================
// 🌍 GLOBAL EXPORT für Browser
// ============================================
window.DiscordChat = {
    init: initDiscordChat,
    send: sendDiscordMessage,
    config: DISCORD_CHAT_CONFIG,
    version: '1.0.0'
};

// Auto-init wenn Data-Attribute vorhanden
document.addEventListener('DOMContentLoaded', () => {
    const autoInit = document.querySelector('[data-discord-chat-auto]');
    if (autoInit) {
        initDiscordChat();
    }
});

console.log('📡 DiscordNachrichten.js geladen – v1.0.0');
