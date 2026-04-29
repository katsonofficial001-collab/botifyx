// Owner authentication for the admin panel.
const DEFAULT_OWNER_PASSWORD = '#jesusfuckingchrist#';

function getOwnerPassword() {
  return process.env.OWNER_PASSWORD || DEFAULT_OWNER_PASSWORD;
}

function isOwnerPasswordSet() {
  return !!getOwnerPassword();
}

function checkOwnerPassword(pw) {
  const expected = getOwnerPassword();
  if (!expected) return false;
  if (typeof pw !== 'string') return false;
  if (pw.length !== expected.length) return false;
  // constant-time comparison
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ pw.charCodeAt(i);
  }
  return mismatch === 0;
}

function requireOwner(req, res, next) {
  if (req.session?.owner) return next();
  return res.redirect('/admin/login');
}

module.exports = {
  isOwnerPasswordSet,
  checkOwnerPassword,
  requireOwner,
};
