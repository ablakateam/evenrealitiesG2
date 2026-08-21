/**
 * "Back to VOX" return address.
 *
 * The phone companion opens this dashboard by REPLACING its own WebView
 * (`location.href = ...`). The Even Realities app draws no browser chrome
 * around that WebView, so once we take over the page there is no Back
 * button, no swipe gesture and no address bar — the user is stranded in the
 * dashboard with no route back to the VOX assistant.
 *
 * So the companion passes its own URL as `?from=`, we stash it for the
 * session, and the app shell renders an explicit exit.
 *
 * Why not `history.back()`: by the time the user has navigated a few
 * dashboard pages, back() walks them through those pages one at a time
 * rather than leaving. The exit should be one tap from anywhere.
 */

const KEY = 'vox.return_to';

/** Only allow schemes a WebView will actually navigate to. */
function isSafeReturnUrl(raw: string): boolean {
  try {
    const u = new URL(raw, window.location.href);
    // http/https covers the dev server and any hosted companion build;
    // file:// and capacitor-style custom schemes are how a packed .ehpk
    // tends to be served. Anything else (javascript:, data:) is rejected.
    return ['http:', 'https:', 'file:', 'capacitor:', 'ionic:', 'app:'].includes(u.protocol);
  } catch {
    return false;
  }
}

/**
 * Lift `?from=` out of the URL into session storage, then strip it so it
 * doesn't ride along in every subsequent link or get bookmarked.
 */
export function captureReturnTo(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    const from = params.get('from');
    if (from && isSafeReturnUrl(from)) {
      sessionStorage.setItem(KEY, from);
    } else if (!sessionStorage.getItem(KEY) && document.referrer && isSafeReturnUrl(document.referrer)) {
      // Fallback: the companion may be an older build that predates ?from=.
      // The referrer is the page that navigated us here, which is it.
      const ref = new URL(document.referrer);
      if (ref.origin !== window.location.origin) sessionStorage.setItem(KEY, document.referrer);
    }
  } catch {
    // Private mode can throw on sessionStorage; a missing back button is a
    // far better outcome than a blank page.
  }
}

/** The stored return address, or null when the dashboard was opened directly. */
export function getReturnTo(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Leave the dashboard and go back to the VOX assistant. */
export function goBackToVox(): void {
  const url = getReturnTo();
  if (url) {
    window.location.href = url;
    return;
  }
  // Nothing stored — the least-surprising fallback is ordinary back.
  window.history.back();
}
