// Live bot activity counters shared with the admin panel.
const startedAt = Date.now();

const state = {
  messagesReceived: 0,
  commandsHandled: 0,
  groupCount: 0,
  lastMessageAt: null,
  lastCommand: null,
  phone: null,
  recent: [], // last 20 events: { ts, kind, text }
};

function pushRecent(kind, text) {
  state.recent.unshift({ ts: new Date().toISOString(), kind, text });
  if (state.recent.length > 20) state.recent.length = 20;
}

module.exports = {
  startedAt,
  incMessage() {
    state.messagesReceived += 1;
    state.lastMessageAt = new Date().toISOString();
  },
  incCommand(name, from) {
    state.commandsHandled += 1;
    state.lastCommand = { name, from, at: new Date().toISOString() };
    pushRecent('command', `*${name} — from ${from}`);
  },
  noteEvent(text) {
    pushRecent('event', text);
  },
  setGroupCount(n) {
    state.groupCount = n;
  },
  setPhone(p) {
    state.phone = p;
  },
  get() {
    return {
      startedAt: new Date(startedAt).toISOString(),
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
      messagesReceived: state.messagesReceived,
      commandsHandled: state.commandsHandled,
      groupCount: state.groupCount,
      lastMessageAt: state.lastMessageAt,
      lastCommand: state.lastCommand,
      phone: state.phone,
      recent: state.recent.slice(),
    };
  },
};
