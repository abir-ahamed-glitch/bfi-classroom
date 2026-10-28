import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Check, QrCode as QrIcon, Key } from 'lucide-react';

/**
 * Local Scannable Authenticator QR Code Component
 *
 * Security & UX features:
 * - Purely client-side canvas rendering (0 external network requests).
 * - Fixed high-contrast white card backdrop for camera readability in both Light and Dark modes.
 * - Monospace manual secret key display with 1-click clipboard copy fallback.
 * - Memory scrubbing: clears canvas on unmount to prevent memory/GPU retention.
 */
export default function AuthenticatorQRCode({ otpauthUri, secret, accountName = '' }) {
  const canvasRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const [qrError, setQrError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    const canvas = canvasRef.current;

    if (canvas && otpauthUri) {
      QRCode.toCanvas(
        canvas,
        otpauthUri,
        {
          width: 220,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#ffffff'
          },
          errorCorrectionLevel: 'M'
        },
        (error) => {
          if (error && isMounted) {
            console.error('Failed to render authenticator QR code:', error);
            setQrError('Failed to render QR code locally. Please use manual entry below.');
          }
        }
      );
    }

    return () => {
      isMounted = false;
      // Memory scrubbing: erase secret pixels from canvas
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }
    };
  }, [otpauthUri]);

  const handleCopySecret = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.replace(/\s+/g, ''));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      console.error('Failed to copy secret:', err);
    }
  };

  // Format secret with spaces every 4 characters for human readability
  const formattedSecret = secret
    ? secret.replace(/\s+/g, '').match(/.{1,4}/g)?.join(' ') || secret
    : '';

  return (
    <div className="flex flex-col items-center space-y-4">
      {/* QR Code Container - Pure White card for optical contrast in all themes */}
      <div className="bg-white p-4 rounded-2xl shadow-md border border-slate-200 flex flex-col items-center justify-center">
        {qrError ? (
          <div className="w-[220px] h-[220px] flex flex-col items-center justify-center text-center p-4 text-red-600 bg-red-50 rounded-xl">
            <QrIcon className="w-10 h-10 mb-2 opacity-60" />
            <p className="text-xs font-medium">{qrError}</p>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="rounded-lg block"
            aria-label={`Authenticator setup QR code for ${accountName}`}
          />
        )}
        <span className="text-[11px] text-slate-500 font-medium mt-2 flex items-center gap-1">
          <QrIcon className="w-3.5 h-3.5 text-slate-400" />
          Point your authenticator app camera here
        </span>
      </div>

      {/* Manual Entry Fallback */}
      {secret && (
        <div className="w-full max-w-sm bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-xl p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
            <span className="flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-amber-500" />
              Manual setup key
            </span>
            <button
              type="button"
              onClick={handleCopySecret}
              className="inline-flex items-center gap-1 text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium transition-colors"
              aria-label="Copy secret setup key"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-emerald-600 dark:text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-2 font-mono text-center text-xs tracking-wider text-slate-800 dark:text-slate-200 select-all break-all">
            {formattedSecret}
          </div>

          <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center leading-tight">
            Can't scan the QR code? Type this key into Google Authenticator, 1Password, or Authy.
          </p>
        </div>
      )}
    </div>
  );
}
