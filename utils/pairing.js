// Shared in-memory pairing state for the bot and the HTTP portal.
const state = {
  status: 'idle', // 'idle' | 'requesting' | 'waiting_code' | 'paired' | 'error' | 'logged_out'
  code: null,
  formattedCode: null,
  phone: null,
  requestedAt: null,
  pairedAt: null,
  message: null,
};

function setIdle() {
  state.status = 'idle';
  state.code = null;
  state.formattedCode = null;
  state.message = null;
}

function setRequesting(phone) {
  state.status = 'requesting';
  state.phone = phone;
  state.code = null;
  state.formattedCode = null;
  state.message = null;
}

function setCode(code, phone) {
  state.code = code;
  state.formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
  state.phone = phone;
  state.requestedAt = new Date().toISOString();
  state.status = 'waiting_code';
  state.message = null;
}

function setPaired() {
  state.status = 'paired';
  state.pairedAt = new Date().toISOString();
  state.code = null;
  state.formattedCode = null;
  state.message = null;
}

function setError(message) {
  state.status = 'error';
  state.message = message;
}

function setLoggedOut() {
  state.status = 'logged_out';
  state.code = null;
  state.formattedCode = null;
  state.message =
    'Bot was logged out. Clear the auth/ folder (or Railway volume) and reload this page to re-pair.';
}

function get() {
  return { ...state };
}

module.exports = {
  setIdle,
  setRequesting,
  setCode,
  setPaired,
  setError,
  setLoggedOut,
  get,
};
