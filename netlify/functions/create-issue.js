// Netlify Function: Create GitHub Issue
// Called when user submits feedback or brand request

const fetch = require('node-fetch');

// --- Abuse hardening -------------------------------------------------------
// This endpoint is public and unauthenticated, and every call opens an issue in
// a public repo, so everything below is about keeping that cheap to do once and
// expensive to do a thousand times.

// Size caps. Anything past these is abuse, not a person filling in a form.
const MAX_BODY_BYTES = 20000;
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_EMAIL_LENGTH = 254;
const MAX_METADATA_LENGTH = 1000;

// Labels the site actually sends (see labelMap in index.html and brands.html).
// Anything else is rejected rather than forwarded, so a caller cannot attach
// arbitrary labels to issues in the repo.
const ALLOWED_LABELS = ['bug', 'request', 'question'];

// Callers we accept: production, Netlify deploy/branch previews, and localhost
// for `netlify dev`.
const ALLOWED_HOSTNAMES = ['coolbags.info', 'www.coolbags.info', 'localhost', '127.0.0.1'];
const ALLOWED_HOSTNAME_SUFFIXES = ['.netlify.app'];

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

// Ceiling on how many IPs we track at once. Every call sweeps the whole map, so
// the sweep is O(tracked IPs) - without a cap, someone rotating source addresses
// makes the rate limiter itself the most expensive part of the request.
const RATE_LIMIT_MAX_TRACKED_IPS = 5000;

// Sliding window of request timestamps, keyed by client IP. Honest caveat: this
// lives in the memory of a single warm function instance. Netlify recycles
// instances and runs several in parallel, so a determined abuser only has to be
// routed to a cold one to get a fresh allowance. It is a speed bump against
// casual floods and double-submits, not a guarantee - real throttling needs the
// edge or shared storage.
const requestLog = new Map();

// `name` must be lowercase. Netlify lowercases incoming header names, but this
// does not lean on that: matching only the exact key would fail closed on a
// `Content-Type` sent with any other casing and take the whole form down. A
// non-string value reads as absent so no caller can make .toLowerCase() throw.
function getHeader(headers, name) {
  if (!headers) {
    return '';
  }
  const key = Object.keys(headers).find(header => header.toLowerCase() === name);
  const value = key === undefined ? '' : headers[key];
  return typeof value === 'string' ? value : '';
}

function hostnameOf(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch (error) {
    return '';
  }
}

function isAllowedHostname(hostname) {
  if (!hostname) {
    return false;
  }
  if (ALLOWED_HOSTNAMES.includes(hostname)) {
    return true;
  }
  return ALLOWED_HOSTNAME_SUFFIXES.some(suffix => hostname.endsWith(suffix));
}

// Browsers always send Origin on a cross-origin-capable POST and Referer on a
// same-origin one, so a request carrying neither did not come from the site.
function isAllowedCaller(headers) {
  const origin = getHeader(headers, 'origin');
  if (origin) {
    return isAllowedHostname(hostnameOf(origin));
  }
  const referer = getHeader(headers, 'referer');
  if (referer) {
    return isAllowedHostname(hostnameOf(referer));
  }
  return false;
}

function getClientIp(headers) {
  const netlifyIp = getHeader(headers, 'x-nf-client-connection-ip');
  if (netlifyIp) {
    return netlifyIp;
  }
  const forwardedFor = getHeader(headers, 'x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  return 'unknown';
}

function isRateLimited(ip) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  // Forget IPs whose window has fully expired so the map cannot grow forever
  for (const [key, timestamps] of requestLog) {
    const recent = timestamps.filter(time => time > windowStart);
    if (recent.length === 0) {
      requestLog.delete(key);
    } else {
      requestLog.set(key, recent);
    }
  }

  const hits = requestLog.get(ip) || [];

  // Stop recording once this IP is already over its allowance. Appending a
  // timestamp per request would let one flooder grow a single array without
  // bound - 50k requests in a window meant 50k stored timestamps, re-filtered
  // by the sweep above on every later request.
  if (hits.length >= RATE_LIMIT_MAX) {
    return true;
  }

  // At the ceiling, an unseen IP is simply not tracked. It gets the same
  // allowance it would have had anyway, and the sweep stays a fixed cost.
  if (!requestLog.has(ip) && requestLog.size >= RATE_LIMIT_MAX_TRACKED_IPS) {
    return false;
  }

  hits.push(now);
  requestLog.set(ip, hits);

  return false;
}

function isValidEmail(email) {
  // Deliberately loose - just enough to catch typos and to reject the newlines
  // and spaces that would let someone inject headers into the Mailgun call
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isWithinLength(value, maxLength) {
  return typeof value === 'string' && value.length <= maxLength;
}

function errorResponse(statusCode, message) {
  return {
    statusCode: statusCode,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      success: false,
      error: message
    })
  };
}

exports.handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return errorResponse(405, 'Method not allowed');
  }

  // Only accept calls that came from our own pages
  if (!isAllowedCaller(event.headers)) {
    return errorResponse(403, 'Requests must come from coolbags.info.');
  }

  // Only accept the content type the site actually sends
  const contentType = getHeader(event.headers, 'content-type').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    return errorResponse(415, 'Content-Type must be application/json.');
  }

  if (isRateLimited(getClientIp(event.headers))) {
    return errorResponse(429, 'Too many submissions. Please try again in a few minutes.');
  }

  // A missing body is a malformed request, not an oversized one. Measure the
  // real UTF-8 size too - String.length counts UTF-16 units, so a body of
  // astral characters is up to 4x larger on the wire than it looks here.
  if (typeof event.body !== 'string') {
    return errorResponse(400, 'Submission could not be read. Please try again.');
  }
  if (Buffer.byteLength(event.body, 'utf8') > MAX_BODY_BYTES) {
    return errorResponse(413, 'Submission is too large.');
  }

  // Parse form data - malformed JSON is the caller's mistake, not a server error
  let data;
  try {
    data = JSON.parse(event.body);
  } catch (parseError) {
    return errorResponse(400, 'Submission could not be read. Please try again.');
  }

  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return errorResponse(400, 'Submission could not be read. Please try again.');
  }

  const { type, title, description, email, label, browser, url } = data;

  // Validate everything we are about to forward to GitHub
  if (typeof title !== 'string' || title.trim() === '') {
    return errorResponse(400, 'A title is required.');
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return errorResponse(400, `Title must be ${MAX_TITLE_LENGTH} characters or fewer.`);
  }
  if (typeof description !== 'string' || description.trim() === '') {
    return errorResponse(400, 'A description is required.');
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return errorResponse(400, `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`);
  }
  if (email !== undefined && email !== null && email !== '') {
    if (!isWithinLength(email, MAX_EMAIL_LENGTH) || !isValidEmail(email)) {
      return errorResponse(400, 'Please provide a valid email address.');
    }
  }
  if (label !== undefined && label !== null && !ALLOWED_LABELS.includes(label)) {
    return errorResponse(400, 'Unknown label.');
  }
  for (const value of [type, browser, url]) {
    if (value !== undefined && value !== null && !isWithinLength(value, MAX_METADATA_LENGTH)) {
      return errorResponse(400, 'Submission details are too long.');
    }
  }

  try {
    // Build issue body with all info
    let issueBody = `${description}\n\n---\n\n`;

    // Add metadata
    issueBody += `**Submission Details:**\n`;
    issueBody += `- Type: ${type}\n`;
    issueBody += `- Email provided: ${email ? 'yes' : 'no'}\n`;
    if (browser) {
      issueBody += `- Browser: ${browser}\n`;
    }
    if (url) {
      issueBody += `- Page: ${url}\n`;
    }
    issueBody += `- Submitted: ${new Date().toISOString()}\n`;

    // Create GitHub issue via API
    const response = await fetch('https://api.github.com/repos/foundmonster/cool-bags/issues', {
      method: 'POST',
      headers: {
        'Authorization': `token ${process.env.GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify({
        title: title,
        body: issueBody,
        labels: [label || 'request']
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('GitHub API Error:', errorData);
      throw new Error(`GitHub API returned ${response.status}`);
    }

    const issue = await response.json();

// Send confirmation email for brand requests using Mailgun
    if (type === 'request' && email && process.env.MAILGUN_API_KEY) {
      try {
        // Extract brand name from title (remove "[Brand Request] " prefix)
        const brandName = title.replace('[Brand Request] ', '');

        // Simple plain text email
        const emailText = `Hi there!

Thanks for requesting ${brandName} to be added to Cool Bags!

We've created an issue to track this request:
${issue.html_url}
(Issue #${issue.number})

We're manually curating the catalog, so it may take a few weeks to add new brands. We'll send you an email when ${brandName} goes live!

Best regards,
Cool Bags Team

---
Cool Bags - The Complete Bag Database
Visit: https://coolbags.info`;

        // Mailgun API request
        const mailgunResponse = await fetch(`https://api.mailgun.net/v3/${process.env.MAILGUN_DOMAIN}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${Buffer.from(`api:${process.env.MAILGUN_API_KEY}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            from: `Cool Bags Team <noreply@${process.env.MAILGUN_DOMAIN}>`,
            to: email,
            subject: `We received your request for ${brandName}`,
            text: emailText,
            'h:Reply-To': 'hey@coolbags.info'
          })
        });

        if (mailgunResponse.ok) {
          const result = await mailgunResponse.json();
          console.log('Confirmation email sent successfully via Mailgun:', result.id);
        } else {
          const errorText = await mailgunResponse.text();
          console.error('Mailgun API error:', mailgunResponse.status, errorText);
        }

      } catch (emailError) {
        console.error('Mailgun email sending error:', emailError);
        // Don't fail the whole request if email fails
      }
    }

    // Return success with issue details
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        issueUrl: issue.html_url,
        issueNumber: issue.number,
        message: 'Feedback submitted successfully!'
      })
    };

  } catch (error) {
    console.error('Function Error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: 'Failed to submit feedback. Please try again or contact us directly.'
      })
    };
  }
};
