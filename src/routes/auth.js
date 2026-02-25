/**
 * Authentication routes — login page, login handler, logout
 */
const express = require('express');
const config  = require('../config');
const { getSession, setSession, clearSession } = require('../utils/session');

const router = express.Router();

const LOGIN_HTML = (error = '') => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin Login — Webhook Forwarder</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0f172a;
    color: #e2e8f0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .card {
    width: 100%;
    max-width: 400px;
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 16px;
    padding: 2.5rem 2rem;
    box-shadow: 0 25px 50px rgba(0,0,0,.4);
    margin: 1rem;
  }
  .logo {
    text-align: center;
    margin-bottom: 2rem;
  }
  .logo-icon {
    font-size: 2.5rem;
    display: block;
    margin-bottom: .5rem;
  }
  .logo h1 {
    font-size: 1.3rem;
    font-weight: 700;
    background: linear-gradient(90deg, #60a5fa, #a78bfa);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .logo p {
    color: #64748b;
    font-size: .82rem;
    margin-top: .3rem;
  }
  .form-group {
    margin-bottom: 1.1rem;
  }
  label {
    display: block;
    font-size: .78rem;
    font-weight: 600;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: .05em;
    margin-bottom: .4rem;
  }
  input {
    width: 100%;
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 8px;
    color: #e2e8f0;
    font-size: .95rem;
    padding: .65rem .9rem;
    transition: border-color .15s;
    outline: none;
  }
  input:focus { border-color: #3b82f6; }
  input::placeholder { color: #475569; }
  .error-box {
    background: #450a0a44;
    border: 1px solid #7f1d1d;
    border-radius: 8px;
    color: #fca5a5;
    font-size: .83rem;
    padding: .65rem .9rem;
    margin-bottom: 1.2rem;
    display: flex;
    align-items: center;
    gap: .5rem;
  }
  button[type="submit"] {
    width: 100%;
    background: linear-gradient(135deg, #3b82f6, #6366f1);
    border: none;
    border-radius: 8px;
    color: #fff;
    font-size: .95rem;
    font-weight: 600;
    padding: .75rem;
    cursor: pointer;
    margin-top: .5rem;
    transition: opacity .15s, transform .1s;
  }
  button[type="submit"]:hover  { opacity: .9; }
  button[type="submit"]:active { transform: scale(.98); }
  .back-link {
    text-align: center;
    margin-top: 1.5rem;
    font-size: .8rem;
    color: #475569;
  }
  .back-link a { color: #60a5fa; text-decoration: none; }
  .back-link a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <span class="logo-icon">⚡</span>
    <h1>Webhook Forwarder</h1>
    <p>Admin Dashboard Login</p>
  </div>

  ${error ? `<div class="error-box">⚠ ${error}</div>` : ''}

  <form method="POST" action="/login">
    <div class="form-group">
      <label for="email">Email</label>
      <input type="email" id="email" name="email" placeholder="admin@example.com" required autocomplete="email">
    </div>
    <div class="form-group">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" placeholder="••••••••" required autocomplete="current-password">
    </div>
    <button type="submit">Sign In</button>
  </form>

  <div class="back-link"><a href="/">← Back to home</a></div>
</div>
</body>
</html>`;

router.get('/login', (req, res) => {
  if (getSession(req)) return res.redirect('/admin/stats/html');
  res.setHeader('Content-Type', 'text/html');
  res.send(LOGIN_HTML());
});

router.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  const { email, password } = req.body;

  const emailMatch    = email    === config.admin.email;
  const passwordMatch = password === config.admin.password;

  if (!emailMatch || !passwordMatch) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(401).send(LOGIN_HTML('Invalid email or password.'));
  }

  setSession(res, email);
  res.redirect('/admin/stats/html');
});

router.get('/logout', (req, res) => {
  clearSession(res);
  res.redirect('/login');
});

module.exports = router;
