import React, { useState, useEffect, useRef, memo } from 'react';
import { Globe } from 'lucide-react';

// ─── URL Detection ─────────────────────────────────────────────────────────────
const URL_REGEX = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/gi;

function extractUrls(text) {
  if (!text) return [];
  const matches = [...text.matchAll(new RegExp(URL_REGEX.source, 'gi'))];
  return [...new Set(matches.map(m => m[0]))];
}

// ─── Platform registry ────────────────────────────────────────────────────────
const KNOWN_PLATFORMS = {
  'youtube.com':       { name: 'YouTube',        color: '#FF0000', icon: 'https://www.youtube.com/favicon.ico' },
  'youtu.be':          { name: 'YouTube',        color: '#FF0000', icon: 'https://www.youtube.com/favicon.ico' },
  'instagram.com':     { name: 'Instagram',      color: '#E1306C', icon: 'https://www.instagram.com/favicon.ico' },
  'facebook.com':      { name: 'Facebook',       color: '#1877F2', icon: 'https://www.facebook.com/favicon.ico' },
  'fb.com':            { name: 'Facebook',       color: '#1877F2', icon: 'https://www.facebook.com/favicon.ico' },
  'fb.watch':          { name: 'Facebook',       color: '#1877F2', icon: 'https://www.facebook.com/favicon.ico' },
  'vimeo.com':         { name: 'Vimeo',          color: '#1AB7EA', icon: 'https://vimeo.com/favicon.ico' },
  'tiktok.com':        { name: 'TikTok',         color: '#010101', icon: 'https://www.tiktok.com/favicon.ico' },
  'netflix.com':       { name: 'Netflix',        color: '#E50914', icon: 'https://assets.nflxext.com/us/ffe/siteui/common/icons/nficon2016.ico' },
  'twitch.tv':         { name: 'Twitch',         color: '#9147FF', icon: 'https://www.twitch.tv/favicon.ico' },
  'disneyplus.com':    { name: 'Disney+',        color: '#113CCF', icon: 'https://www.disneyplus.com/favicon.ico' },
  'primevideo.com':    { name: 'Amazon Prime',   color: '#00A8E1', icon: 'https://www.primevideo.com/favicon.ico' },
  'amazon.com':        { name: 'Amazon',         color: '#FF9900', icon: 'https://www.amazon.com/favicon.ico' },
  'max.com':           { name: 'Max',            color: '#002BE7', icon: 'https://www.max.com/favicon.ico' },
  'apple.com':         { name: 'Apple TV+',      color: '#555555', icon: 'https://www.apple.com/favicon.ico' },
  'hulu.com':          { name: 'Hulu',           color: '#1CE783', icon: 'https://www.hulu.com/favicon.ico' },
  'paramountplus.com': { name: 'Paramount+',     color: '#0064FF', icon: 'https://www.paramountplus.com/favicon.ico' },
  'peacocktv.com':     { name: 'Peacock',        color: '#FF5800', icon: 'https://www.peacocktv.com/favicon.ico' },
  'dailymotion.com':   { name: 'Dailymotion',    color: '#00C5F9', icon: 'https://www.dailymotion.com/favicon.ico' },
  'kick.com':          { name: 'Kick',           color: '#53FC18', icon: 'https://kick.com/favicon.ico' },
  'wistia.com':        { name: 'Wistia',         color: '#54BBFF', icon: 'https://wistia.com/favicon.ico' },
  'onedrive.live.com': { name: 'OneDrive',       color: '#0078D4', icon: 'https://onedrive.live.com/favicon.ico' },
  'dropbox.com':       { name: 'Dropbox',        color: '#0061FF', icon: 'https://www.dropbox.com/favicon.ico' },
  'box.com':           { name: 'Box',            color: '#0061D5', icon: 'https://www.box.com/favicon.ico' },
  'mega.nz':           { name: 'MEGA',           color: '#D9272E', icon: 'https://mega.nz/favicon.ico' },
  'pcloud.com':        { name: 'pCloud',         color: '#20B2AA', icon: 'https://www.pcloud.com/favicon.ico' },
  'mediafire.com':     { name: 'MediaFire',      color: '#1DACD6', icon: 'https://www.mediafire.com/favicon.ico' },
  'drive.google.com':  { name: 'Google Drive',   color: '#4285F4', icon: 'https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png' },
  'proton.me':         { name: 'Proton Drive',   color: '#6D4AFF', icon: 'https://proton.me/favicon.ico' },
  'internxt.com':      { name: 'Internxt',       color: '#0072FF', icon: 'https://internxt.com/favicon.ico' },
  'yandex.com':        { name: 'Yandex Disk',    color: '#FC3F1D', icon: 'https://yandex.com/favicon.ico' },
  'tresorit.com':      { name: 'Tresorit',       color: '#3E8AFF', icon: 'https://tresorit.com/favicon.ico' },
  'sync.com':          { name: 'Sync.com',       color: '#007AFF', icon: 'https://www.sync.com/favicon.ico' },
  'twitter.com':       { name: 'X (Twitter)',    color: '#000000', icon: 'https://abs.twimg.com/favicons/twitter.3.ico' },
  'x.com':             { name: 'X (Twitter)',    color: '#000000', icon: 'https://abs.twimg.com/favicons/twitter.3.ico' },
  'linkedin.com':      { name: 'LinkedIn',       color: '#0A66C2', icon: 'https://www.linkedin.com/favicon.ico' },
  'reddit.com':        { name: 'Reddit',         color: '#FF4500', icon: 'https://www.reddit.com/favicon.ico' },
  'github.com':        { name: 'GitHub',         color: '#24292E', icon: 'https://github.com/favicon.ico' },
};

function getPlatformInfo(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    for (const [domain, info] of Object.entries(KNOWN_PLATFORMS)) {
      if (host === domain || host.endsWith('.' + domain)) return info;
    }
  } catch {
    return null;
  }
}

// ─── Platform-specific thumbnail extractors ────────────────────────────────────
const apiBase = () => import.meta.env.VITE_API_URL || '';
const proxy = (rawUrl) => `${apiBase()}/api/proxy-image?url=${encodeURIComponent(rawUrl)}`;

function getYouTubeId(url) {
  try {
    const p = new URL(url);
    if (p.hostname.includes('youtube.com')) return p.searchParams.get('v') || null;
    if (p.hostname === 'youtu.be') return p.pathname.slice(1).split('?')[0] || null;
    const m = p.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];
  } catch {
    return null;
  }
}

function getFacebookVideoId(url) {
  try {
    const p = new URL(url);
    const host = p.hostname.replace(/^www\./, '');
    if (!['facebook.com', 'fb.com', 'fb.watch'].some(d => host === d || host.endsWith('.' + d))) return null;
    // /videos/ID  |  /watch?v=ID  |  /share/v/ID  |  /reel/ID  |  /story.php?story_fbid=ID
    const patterns = [
      /\/videos\/(\d+)/,
      /\/reel\/(\d+)/,
      /\/share\/v\/([a-zA-Z0-9_-]+)/,
      /\/share\/([a-zA-Z0-9_-]+)/,
    ];
    for (const pat of patterns) {
      const m = p.pathname.match(pat);
      if (m) return m[1];
    }
    return p.searchParams.get('v') || p.searchParams.get('story_fbid') || null;
  } catch {
    return null;
  }
}

function getVimeoId(url) {
  try {
    const m = new URL(url).pathname.match(/\/(\d+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function getDailymotionId(url) {
  try {
    const m = new URL(url).pathname.match(/\/video\/([a-zA-Z0-9]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Returns a guaranteed-working thumbnail URL for known video platforms,
 * or null if not a recognized video platform.
 * YouTube/Dailymotion use our proxy; Vimeo uses their open oEmbed JSON API.
 */
function getPlatformThumbnail(url) {
  const ytId = getYouTubeId(url);
  if (ytId) return proxy(`https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`);

  const dmId = getDailymotionId(url);
  if (dmId) return proxy(`https://www.dailymotion.com/thumbnail/video/${dmId}`);

  // Vimeo & Facebook — we'll use a sidecar async fetch; return a sentinel
  const vimeoId = getVimeoId(url);
  if (vimeoId && url.includes('vimeo.com')) return `__vimeo__${vimeoId}`;

  const fbId = getFacebookVideoId(url);
  if (fbId) return null;

  return null;
}

// ─── LinkPreviewCard ───────────────────────────────────────────────────────────
const LinkPreviewCard = memo(({ url }) => {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [resolvedThumb, setResolvedThumb] = useState(null);
  const abortRef = useRef(null);

  const platform = getPlatformInfo(url);
  const accentColor = platform?.color || 'var(--accent-primary)';

  // Compute the direct thumbnail synchronously (YouTube, Dailymotion)
  const directThumb = getPlatformThumbnail(url);
  const isVimeoSentinel = directThumb?.startsWith('__vimeo__');
  const isFBSentinel    = directThumb?.startsWith('__facebook__');
  const hasDirectThumb  = directThumb && !isVimeoSentinel && !isFBSentinel;

  // Fetch OG preview + handle Vimeo/Facebook oEmbed thumbnails
  useEffect(() => {
    let cancelled = false;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const tasks = [
      // Task 1: OG metadata from our server
      fetch(`${apiBase()}/api/link-preview?url=${encodeURIComponent(url)}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        signal: controller.signal,
      })
        .then(r => r.json())
        .then(data => {
          if (!cancelled && !data.error) setPreview(data);
        })
        .catch(() => {}),
    ];

    // Task 2: Vimeo oEmbed — publicly accessible, no auth
    if (isVimeoSentinel) {
      const vimeoId = directThumb.replace('__vimeo__', '');
      tasks.push(
        fetch(`https://vimeo.com/api/v2/video/${vimeoId}.json`, { signal: controller.signal })
          .then(r => r.json())
          .then(data => {
            if (!cancelled && data?.[0]?.thumbnail_large) {
              setResolvedThumb(proxy(data[0].thumbnail_large));
            }
          })
          .catch(() => {})
      );
    }

    // Removed broken Facebook graph API call that requires access token

    Promise.allSettled(tasks).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; controller.abort(); };
  }, [url, directThumb, isVimeoSentinel]);

  // Best thumbnail: direct (YouTube/Dailymotion) > async resolved (Vimeo/FB) > OG image
  const thumbSrc = hasDirectThumb
    ? directThumb
    : (resolvedThumb || preview?.image || null);

  // ── Loading skeleton ──
  if (loading && !thumbSrc && !preview) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="link-preview-card loading">
        <div className="link-preview-skeleton">
          <div className="link-preview-skeleton-thumb" />
          <div className="link-preview-skeleton-body">
            <div className="link-preview-skeleton-line wide" />
            <div className="link-preview-skeleton-line" />
          </div>
        </div>
      </a>
    );
  }

  // ── Full card ──
  const title      = preview?.title || platform?.name || new URL(url).hostname;
  const siteName   = preview?.siteName || platform?.name || new URL(url).hostname;
  const favicon    = platform?.icon || preview?.favicon;
  const desc       = preview?.description;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="link-preview-card"
      style={{ '--lp-accent': accentColor }}
    >
      {thumbSrc && (
        <div className="link-preview-image-wrap">
          <img
            src={thumbSrc}
            alt={title}
            className="link-preview-image"
            onError={e => { e.target.closest('.link-preview-image-wrap').style.display = 'none'; }}
          />
        </div>
      )}
      <div className="link-preview-body">
        <div className="link-preview-site">
          {favicon
            ? <img src={favicon} alt="" className="link-preview-favicon" onError={e => { e.target.style.display = 'none'; }} />
            : <Globe size={12} style={{ flexShrink: 0 }} />
          }
          <span>{siteName}</span>
        </div>
        <p className="link-preview-title">{title}</p>
        {desc && <p className="link-preview-description">{desc}</p>}
      </div>
      <div className="link-preview-accent-bar" style={{ background: accentColor }} />
    </a>
  );
});

// ─── MessageWithLinks ──────────────────────────────────────────────────────────
export function MessageWithLinks({ content, renderText }) {
  if (!content) return null;

  const urls = extractUrls(content);

  // Mixed content: render text with clickable links, then preview cards below
  const rendered = [];
  let cursor = 0;
  const globalRegex = new RegExp(URL_REGEX.source, 'gi');
  let match;
  while ((match = globalRegex.exec(content)) !== null) {
    if (match.index > cursor) {
      const textChunk = content.slice(cursor, match.index);
      rendered.push(<span key={`t-${cursor}`}>{renderText ? renderText(textChunk) : textChunk}</span>);
    }
    rendered.push(
      <a
        key={`u-${match.index}`}
        href={match[0]}
        target="_blank"
        rel="noopener noreferrer"
        className="message-inline-link"
      >
        {match[0]}
      </a>
    );
    cursor = match.index + match[0].length;
  }
  if (cursor < content.length) {
    const textChunk = content.slice(cursor);
    rendered.push(<span key={`t-end-${cursor}`}>{renderText ? renderText(textChunk) : textChunk}</span>);
  }

  return (
    <>
      <p className="message-text">{rendered}</p>
      {urls.map(url => <LinkPreviewCard key={url} url={url} />)}
    </>
  );
}

export default LinkPreviewCard;
