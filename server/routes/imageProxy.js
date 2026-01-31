/**
 * imageProxy.js - Server-side CORS proxy for cover images
 *
 * Provides a fallback when CORS headers haven't propagated to B2 CDN edge nodes.
 * Uses true streaming (zero RAM buffering) via Node.js pipe.
 */

import { WebApp } from 'meteor/webapp';

// Rate limiting state (simple in-memory, per-instance)
const rateLimits = new Map();
const RATE_LIMIT = 50; // requests per second per IP
const RATE_WINDOW = 1000; // 1 second

function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimits.get(ip) || { count: 0, resetAt: now + RATE_WINDOW };

  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + RATE_WINDOW;
  }

  record.count++;
  rateLimits.set(ip, record);

  return record.count <= RATE_LIMIT;
}

// Clean up stale rate limit entries periodically (every 60 seconds)
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimits.entries()) {
    if (now > record.resetAt + RATE_WINDOW) {
      rateLimits.delete(ip);
    }
  }
}, 60000);

WebApp.connectHandlers.use('/api/image-proxy', async (req, res) => {
  const url = req.query.url;

  if (!url) {
    res.writeHead(400);
    res.end('Missing url parameter');
    return;
  }

  // Validate URL (only allow known domains)
  // Using .backblazeb2.com to match any B2 region (us-west-004, us-east-005, etc.)
  // localhost/127.0.0.1 included for developer testing
  const allowed = ['images.igdb.com', '.backblazeb2.com', 'localhost', '127.0.0.1'];
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    res.writeHead(400);
    res.end('Invalid URL');
    return;
  }

  const isAllowed = allowed.some(domain => {
    if (domain.startsWith('.')) {
      return parsed.hostname.endsWith(domain);
    }
    return parsed.hostname === domain;
  });

  if (!isAllowed) {
    res.writeHead(403);
    res.end('Domain not allowed');
    return;
  }

  // Rate limit by IP
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
  if (!checkRateLimit(clientIp)) {
    res.writeHead(429);
    res.end('Rate limit exceeded');
    return;
  }

  // Log for monitoring
  console.log(`[image-proxy] CORS fallback for ${url} from ${clientIp}`);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      res.writeHead(response.status);
      res.end(`Upstream error: ${response.status}`);
      return;
    }

    // Set response headers
    const contentType = response.headers.get('content-type') || 'image/webp';
    const contentLength = response.headers.get('content-length');

    const headers = {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400' // 24 hour cache
    };

    if (contentLength) {
      headers['Content-Length'] = contentLength;
    }

    res.writeHead(200, headers);

    // TRUE STREAMING: Pipe directly from fetch to response
    // Node.js Readable.fromWeb converts fetch body to Node stream
    const { Readable } = await import('stream');
    const nodeStream = Readable.fromWeb(response.body);
    nodeStream.pipe(res);

  } catch (error) {
    if (error.name === 'AbortError') {
      res.writeHead(504);
      res.end('Upstream timeout');
    } else {
      console.error('[image-proxy] Error:', error.message);
      res.writeHead(500);
      res.end('Proxy error');
    }
  }
});
