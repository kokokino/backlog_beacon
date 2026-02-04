/**
 * amazonCallback.js - OAuth callback handler for Amazon Games import
 *
 * Receives the authorization code from Amazon's OAuth redirect and
 * sends it back to the opener window via postMessage.
 */

import { WebApp } from 'meteor/webapp';

WebApp.connectHandlers.use('/sso/amazon-callback', (req, res) => {
  // Extract the authorization code from query params
  const authCode = req.query['openid.oa2.authorization_code'];
  const error = req.query['openid.error'];

  // Build an HTML page that sends the code back to the opener
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Amazon Games - Authorization</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: #1a1a2e;
      color: #eee;
    }
    .container {
      text-align: center;
      padding: 2rem;
      max-width: 400px;
    }
    .success { color: #4ade80; }
    .error { color: #f87171; }
    .code {
      background: #2d2d44;
      padding: 1rem;
      border-radius: 8px;
      word-break: break-all;
      font-family: monospace;
      margin: 1rem 0;
      font-size: 0.9rem;
    }
    button {
      background: #6366f1;
      color: white;
      border: none;
      padding: 0.75rem 1.5rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: 1rem;
    }
    button:hover { background: #4f46e5; }
    .note { font-size: 0.85rem; color: #888; margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="container">
    ${authCode ? `
      <h2 class="success">Authorization Successful</h2>
      <p>Sending code back to Backlog Beacon...</p>
      <div class="code" id="code">${authCode}</div>
      <p class="note">If this window doesn't close automatically, copy the code above and paste it in the import form.</p>
      <button onclick="copyCode()">Copy Code</button>
    ` : `
      <h2 class="error">Authorization Failed</h2>
      <p>${error || 'No authorization code received. Please try again.'}</p>
      <button onclick="window.close()">Close</button>
    `}
  </div>
  <script>
    ${authCode ? `
      // Try to send the code to the opener window
      if (window.opener) {
        window.opener.postMessage({
          type: 'amazon-auth-code',
          code: '${authCode}'
        }, window.location.origin);

        // Close after a short delay to ensure message is sent
        setTimeout(() => window.close(), 1500);
      }

      function copyCode() {
        navigator.clipboard.writeText('${authCode}');
        document.querySelector('button').textContent = 'Copied!';
      }
    ` : `
      // Auto-close on error after showing message
      setTimeout(() => window.close(), 5000);
    `}
  </script>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});
