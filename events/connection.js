const path = require('path');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  Browsers,
} = require('@whiskeysockets/baileys');

const fs = require('fs');

const config = require('../utils/config');
const pairing = require('../utils/pairing');
const stats = require('../utils/stats');

const AUTH_DIR = path.join(__dirname, '..', 'auth');

function clearAuth() {
  try {
    if (fs.existsSync(AUTH_DIR)) {
      for (const name of fs.readdirSync(AUTH_DIR)) {
        if (name === '.gitkeep') continue;
        const full = path.join(AUTH_DIR, name);
        try {
          fs.rmSync(full, { recursive: true, force: true });
        } catch {}
      }
    }
    console.log('[bot] Cleared auth folder for fresh pairing.');
  } catch (err) {
    console.error('[bot] Failed to clear auth folder:', err);
  }
}
const { handleMessages } = require('./messages');
const { handleGroupParticipantsUpdate } = require('./group');

const baileysLogger = pino({ level: 'silent' });

let currentSock = null;
let reconnectAttempts = 0;
let isStarting = false;

async function startBot() {
  if (isStarting) return currentSock;
  isStarting = true;

  try {
    const authPath = path.join(__dirname, '..', 'auth');
    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      logger: baileysLogger,
      printQRInTerminal: false,
      mobile: false,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
      },
      // Use a recognized WhatsApp Web client signature so WhatsApp accepts the
      // pairing request and labels the linked device as "Mac • Safari".
      browser: Browsers.macOS('Safari'),
      generateHighQualityLinkPreview: true,
      syncFullHistory: false,
      markOnlineOnConnect: true,
    });

    currentSock = sock;

    if (sock.authState.creds.registered) {
      // Existing session — bot will reconnect automatically.
      pairing.setIdle();
    } else {
      // No session yet — wait for the user to enter their number on /pair.
      pairing.setIdle();
      console.log('[bot] No saved session. Open  /pair  on your domain to link a phone.');
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'open') {
        reconnectAttempts = 0;
        pairing.setPaired();
        const me = sock.user?.id?.split(':')[0]?.split('@')[0] || null;
        stats.setPhone(me);
        stats.noteEvent(`Connected as +${me || '?'}`);
        console.log(`[bot] ✓ ${config.name} ${config.version} connected to WhatsApp.`);
        // Fetch group count once connected
        sock.groupFetchAllParticipating()
          .then((g) => stats.setGroupCount(Object.keys(g || {}).length))
          .catch(() => {});
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        if (loggedOut) {
          pairing.setLoggedOut();
          console.error('[bot] Logged out. Clearing auth and waiting for re-pair...');
          currentSock = null;
          isStarting = false;
          clearAuth();
          // Restart bot in clean state so /pair can immediately request a new code
          setTimeout(() => {
            pairing.setIdle();
            startBot().catch((e) => console.error('[bot] re-pair restart error:', e));
          }, 1500);
          return;
        }

        currentSock = null;
        isStarting = false;
        reconnectAttempts += 1;
        const delay = Math.min(30000, 2000 * reconnectAttempts);
        console.log(
          `[bot] Connection closed (code ${statusCode}). Reconnecting in ${delay}ms...`
        );
        setTimeout(() => {
          startBot().catch((e) => console.error('[bot] reconnect error:', e));
        }, delay);
      }
    });

    sock.ev.on('messages.upsert', async (payload) => {
      try {
        await handleMessages(sock, payload);
      } catch (err) {
        console.error('[bot] messages.upsert error:', err);
      }
    });

    sock.ev.on('group-participants.update', async (update) => {
      try {
        await handleGroupParticipantsUpdate(sock, update);
        // Refresh group count on membership changes
        sock.groupFetchAllParticipating()
          .then((g) => stats.setGroupCount(Object.keys(g || {}).length))
          .catch(() => {});
      } catch (err) {
        console.error('[bot] group-participants.update error:', err);
      }
    });

    return sock;
  } finally {
    isStarting = false;
  }
}

async function requestPairingCode(rawPhone) {
  const phone = (rawPhone || '').replace(/[^0-9]/g, '');
  if (!phone || phone.length < 7) {
    throw new Error('Enter a valid phone number with country code, e.g. 2349075928878.');
  }

  if (!currentSock) {
    // Try to start the bot if it isn't running yet
    await startBot();
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (!currentSock) {
    throw new Error('Bot is starting. Try again in a few seconds.');
  }

  if (currentSock.authState.creds.registered) {
    // Pairing was requested but we still have old creds. Clear and restart fresh.
    try { currentSock.end(undefined); } catch {}
    currentSock = null;
    clearAuth();
    pairing.setIdle();
    await startBot();
    await new Promise((r) => setTimeout(r, 1500));
    if (!currentSock) {
      throw new Error('Bot restarting. Try again in a few seconds.');
    }
  }

  pairing.setRequesting(phone);

  // Wait briefly for the underlying socket to be ready
  for (let i = 0; i < 30; i++) {
    const ws = currentSock.ws;
    const ready =
      ws?.readyState === 1 ||
      ws?.isOpen ||
      (typeof ws?.readyState === 'undefined');
    if (ready) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  try {
    const code = await currentSock.requestPairingCode(phone);
    const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
    pairing.setCode(code, phone);
    console.log('\n=================================================');
    console.log(`  ${config.name} — PAIRING CODE`);
    console.log(`  Phone : ${phone}`);
    console.log(`  CODE  : ${formatted}`);
    console.log('=================================================\n');
    return code;
  } catch (err) {
    const msg = err?.message || String(err);
    pairing.setError(msg);
    throw err;
  }
}

module.exports = { startBot, requestPairingCode };
