const express = require('express');
const path = require('path');
const fs = require('fs');

const {
  verifyUser,
  isExpired,
  loadUsers,
  addUser,
  removeUser,
  extendUser,
  listUsers,
} = require('../utils/access');
const pairing = require('../utils/pairing');
const stats = require('../utils/stats');
const { isOwnerPasswordSet, checkOwnerPassword, requireOwner } = require('../utils/owner');
const { requestPairingCode } = require('../events/connection');

const router = express.Router();

function loadView(name) {
  return fs.readFileSync(path.join(__dirname, 'views', `${name}.html`), 'utf8');
}

function render(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) =>
    vars[k] === undefined || vars[k] === null ? '' : String(vars[k])
  );
}

function errorHtml(message) {
  if (!message) return '';
  const escaped = String(message)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<div class="err">${escaped}</div>`;
}

// ─── Pairing portal ──────────────────────────────────────
router.get('/pair', (req, res) => {
  const html = loadView('pair').replace(
    '__DEFAULT_PHONE__',
    process.env.BOT_PHONE_NUMBER || ''
  );
  res.send(html);
});

router.get('/pair.json', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(pairing.get());
});

router.post('/pair', express.json(), async (req, res) => {
  try {
    const phone = (req.body?.phone || '').toString();
    await requestPairingCode(phone);
    res.json({ ok: true, state: pairing.get() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err?.message || String(err) });
  }
});

router.post('/pair/reset', (req, res) => {
  pairing.setIdle();
  res.json({ ok: true, state: pairing.get() });
});

// ─── Dashboard ───────────────────────────────────────────
router.get('/login', (req, res) => {
  res.send(render(loadView('login'), { error: errorHtml('') }));
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = verifyUser(username, password);
  if (!user) {
    return res.send(
      render(loadView('login'), {
        error: errorHtml('Invalid username or password.'),
      })
    );
  }
  if (isExpired(user)) {
    return res.send(
      render(loadView('login'), {
        error: errorHtml('Subscription expired. Contact the owner.'),
      })
    );
  }
  req.session.user = { username: user.username };
  res.redirect('/dashboard');
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

router.get('/dashboard', (req, res) => {
  if (!req.session?.user) return res.redirect('/login');
  const data = loadUsers();
  const user = data.users.find((u) => u.username === req.session.user.username);
  if (!user) {
    req.session.destroy(() => {});
    return res.redirect('/login');
  }
  const expired = isExpired(user);
  const status = expired ? 'Expired' : 'Active';
  const expiresAt = new Date(user.expiresAt).toLocaleString();
  const daysLeft = Math.max(
    0,
    Math.ceil((new Date(user.expiresAt).getTime() - Date.now()) / 86400000)
  );
  res.send(
    render(loadView('dashboard'), {
      username: user.username,
      status,
      statusClass: expired ? 'expired' : 'active',
      expiresAt,
      daysLeft,
    })
  );
});

// ─── Owner admin panel ───────────────────────────────────
router.get('/admin/login', (req, res) => {
  if (!isOwnerPasswordSet()) {
    return res
      .status(503)
      .send(
        render(loadView('admin-login'), {
          error: errorHtml('OWNER_PASSWORD is not set. Add it to your environment.'),
        })
      );
  }
  if (req.session?.owner) return res.redirect('/admin');
  res.send(render(loadView('admin-login'), { error: errorHtml('') }));
});

router.post('/admin/login', (req, res) => {
  const pw = (req.body?.password || '').toString();
  if (!isOwnerPasswordSet()) {
    return res.status(503).send(
      render(loadView('admin-login'), {
        error: errorHtml('OWNER_PASSWORD is not set on the server.'),
      })
    );
  }
  if (!checkOwnerPassword(pw)) {
    return res.send(
      render(loadView('admin-login'), {
        error: errorHtml('Wrong password.'),
      })
    );
  }
  req.session.owner = true;
  res.redirect('/admin');
});

router.get('/admin/logout', (req, res) => {
  if (req.session) delete req.session.owner;
  res.redirect('/admin/login');
});

router.get('/admin', requireOwner, (req, res) => {
  res.send(loadView('admin'));
});

router.get('/admin/stats.json', requireOwner, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    bot: stats.get(),
    pairing: pairing.get(),
  });
});

router.get('/admin/users.json', requireOwner, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ users: listUsers() });
});

router.post('/admin/users', express.json(), (req, res) => {
  if (!req.session?.owner) return res.status(401).json({ error: 'Unauthorized' });
  const { username, password, days } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required.' });
  }
  try {
    const u = addUser(String(username).trim(), String(password), parseInt(days, 10) || 30);
    res.json({ ok: true, user: { username: u.username, expiresAt: u.expiresAt } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/admin/users/:username/extend', express.json(), (req, res) => {
  if (!req.session?.owner) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const days = parseInt(req.body?.days, 10) || 30;
    const u = extendUser(req.params.username, days);
    res.json({ ok: true, user: { username: u.username, expiresAt: u.expiresAt } });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.delete('/admin/users/:username', (req, res) => {
  if (!req.session?.owner) return res.status(401).json({ error: 'Unauthorized' });
  try {
    removeUser(req.params.username);
    res.json({ ok: true });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

module.exports = router;
