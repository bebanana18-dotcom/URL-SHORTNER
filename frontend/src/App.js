import { useState, useCallback } from 'react';
import axios from 'axios';

const API = process.env.VITE_API_URL || 'http://short-url.abc-app.org';

// ─── CLIENT-SIDE URL VALIDATOR ───────────────────────────────────────────────
// Mirrors backend logic so we catch garbage before wasting a network request
const validateUrl = (url) => {
  if (!url || !url.trim()) {
    return { valid: false, reason: 'Please enter a URL.' };
  }

  const trimmed = url.trim();

  if (!/^https?:\/\//i.test(trimmed)) {
    return { valid: false, reason: 'URL must start with http:// or https://' };
  }

  try {
    const parsed = new URL(trimmed);
    if (!parsed.hostname || !parsed.hostname.includes('.')) {
      return { valid: false, reason: 'URL must have a valid domain (e.g. example.com).' };
    }
  } catch {
    return { valid: false, reason: 'That does not look like a valid URL.' };
  }

  if (trimmed.length > 2048) {
    return { valid: false, reason: 'URL is too long (max 2048 characters).' };
  }

  return { valid: true };
};

// ─── COPY HOOK ───────────────────────────────────────────────────────────────
const useCopy = () => {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for browsers that block clipboard API
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, []);

  return { copied, copy };
};

// ─── ICONS ───────────────────────────────────────────────────────────────────
const CopyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

const LinkIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
  </svg>
);

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [longUrl, setLongUrl]       = useState('');
  const [shortUrl, setShortUrl]     = useState('');
  const [isDuplicate, setDuplicate] = useState(false);
  const [inputError, setInputError] = useState('');
  const [apiError, setApiError]     = useState('');
  const [loading, setLoading]       = useState(false);
  const { copied, copy }            = useCopy();

  // Validate on every keystroke — show error only after first submit attempt
  const [submitted, setSubmitted] = useState(false);

  const handleChange = (e) => {
    const val = e.target.value;
    setLongUrl(val);
    if (submitted) {
      const v = validateUrl(val);
      setInputError(v.valid ? '' : v.reason);
    }
  };

  const handleShorten = async () => {
    setSubmitted(true);
    setApiError('');
    setShortUrl('');

    const validation = validateUrl(longUrl);
    if (!validation.valid) {
      setInputError(validation.reason);
      return;
    }

    setInputError('');
    setLoading(true);

    try {
      const res = await axios.post(`${API}/api/shorten`, {
        originalUrl: longUrl.trim(),
      });

      setShortUrl(res.data.shortUrl);
      setDuplicate(res.data.duplicate);

    } catch (err) {
      if (err.response?.status === 429) {
        setApiError('Too many requests. You have 3 seconds to reflect on your life choices.');
      } else if (err.response?.data?.error) {
        setApiError(err.response.data.error);
      } else {
        setApiError('Something went wrong. Is the backend running?');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleShorten();
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --bg: #0f0f11;
          --surface: #1a1a1f;
          --border: #2e2e36;
          --border-focus: #7c6af7;
          --accent: #7c6af7;
          --accent-dim: #3d3480;
          --text: #f0eff6;
          --muted: #7b7a8e;
          --success-bg: #0d2016;
          --success-border: #1a4731;
          --success-text: #4ade80;
          --error-bg: #1f0d0d;
          --error-border: #4b1818;
          --error-text: #f87171;
          --font-display: 'Syne', sans-serif;
          --font-mono: 'DM Mono', monospace;
        }

        body {
          background: var(--bg);
          color: var(--text);
          font-family: var(--font-display);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
        }

        .card {
          width: 100%;
          max-width: 520px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 20px;
          padding: 40px;
        }

        .badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: var(--accent-dim);
          color: #c4b8ff;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          padding: 4px 10px;
          border-radius: 20px;
          margin-bottom: 20px;
        }

        h1 {
          font-size: 32px;
          font-weight: 800;
          line-height: 1.15;
          margin-bottom: 8px;
          letter-spacing: -0.03em;
        }

        .subtitle {
          color: var(--muted);
          font-size: 14px;
          margin-bottom: 32px;
          line-height: 1.5;
        }

        .input-wrap {
          position: relative;
          margin-bottom: 6px;
        }

        .input-wrap svg {
          position: absolute;
          left: 14px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--muted);
          pointer-events: none;
        }

        input[type="url"] {
          width: 100%;
          padding: 13px 14px 13px 42px;
          font-family: var(--font-mono);
          font-size: 13px;
          background: var(--bg);
          color: var(--text);
          border: 1px solid var(--border);
          border-radius: 10px;
          outline: none;
          transition: border-color 0.15s;
        }

        input[type="url"]:focus {
          border-color: var(--border-focus);
        }

        input[type="url"].has-error {
          border-color: var(--error-text);
        }

        .field-error {
          font-size: 12px;
          color: var(--error-text);
          margin-bottom: 12px;
          padding-left: 4px;
          min-height: 18px;
        }

        button.shorten-btn {
          width: 100%;
          padding: 13px;
          font-family: var(--font-display);
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 0.01em;
          background: var(--accent);
          color: #fff;
          border: none;
          border-radius: 10px;
          cursor: pointer;
          transition: opacity 0.15s, transform 0.1s;
        }

        button.shorten-btn:hover:not(:disabled) { opacity: 0.88; }
        button.shorten-btn:active:not(:disabled) { transform: scale(0.98); }
        button.shorten-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .result-box {
          margin-top: 20px;
          background: var(--success-bg);
          border: 1px solid var(--success-border);
          border-radius: 12px;
          padding: 16px 18px;
          animation: fadeUp 0.2s ease;
        }

        .result-label {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--success-text);
          opacity: 0.7;
          margin-bottom: 8px;
        }

        .result-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .result-url {
          flex: 1;
          font-family: var(--font-mono);
          font-size: 14px;
          font-weight: 500;
          color: var(--success-text);
          word-break: break-all;
          text-decoration: none;
        }

        .result-url:hover { text-decoration: underline; }

        button.copy-btn {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 7px 12px;
          font-family: var(--font-display);
          font-size: 12px;
          font-weight: 600;
          background: transparent;
          color: var(--success-text);
          border: 1px solid var(--success-border);
          border-radius: 7px;
          cursor: pointer;
          transition: background 0.15s, color 0.15s;
          white-space: nowrap;
        }

        button.copy-btn:hover { background: var(--success-border); }
        button.copy-btn.copied { color: #fff; background: #166534; border-color: #166534; }

        .duplicate-note {
          font-size: 11px;
          color: var(--muted);
          margin-top: 8px;
          padding-left: 2px;
        }

        .error-box {
          margin-top: 16px;
          background: var(--error-bg);
          border: 1px solid var(--error-border);
          border-radius: 12px;
          padding: 14px 16px;
          font-size: 13px;
          color: var(--error-text);
          animation: fadeUp 0.2s ease;
        }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div className="card">
        <div className="badge">
          <LinkIcon />
          URL Shortener
        </div>

        <h1>Long URLs<br />die here.</h1>
        <p className="subtitle">Paste anything. Get something humans can actually share.</p>

        <div className="input-wrap">
          <LinkIcon />
          <input
            type="url"
            placeholder="https://ridiculously-long-url.com/path?with=params"
            value={longUrl}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            className={inputError ? 'has-error' : ''}
            autoFocus
          />
        </div>

        <div className="field-error">{inputError}</div>

        <button
          className="shorten-btn"
          onClick={handleShorten}
          disabled={loading}
        >
          {loading ? 'Shortening...' : 'Shorten URL'}
        </button>

        {shortUrl && (
          <div className="result-box">
            <div className="result-label">Your short URL</div>
            <div className="result-row">
              <a
                className="result-url"
                href={shortUrl}
                target="_blank"
                rel="noreferrer"
              >
                {shortUrl}
              </a>
              <button
                className={`copy-btn ${copied ? 'copied' : ''}`}
                onClick={() => copy(shortUrl)}
              >
                {copied ? <><CheckIcon /> Copied!</> : <><CopyIcon /> Copy</>}
              </button>
            </div>
            {isDuplicate && (
              <p className="duplicate-note">
                This URL was already shortened — returning the existing one.
              </p>
            )}
          </div>
        )}

        {apiError && (
          <div className="error-box">{apiError}</div>
        )}
      </div>
    </>
  );
}
