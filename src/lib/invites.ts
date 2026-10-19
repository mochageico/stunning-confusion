// ============================================================================
// CIRCLE INVITE LINKS
// ----------------------------------------------------------------------------
// The shareable link is a small page on the project's Firebase Hosting site
// (hosting/join/index.html): it shows the code and an "Open in Scripture
// Memory" button that hands off to the app's own scheme,
// scripturememory://join?code=ABC123. The app handles both forms (see the
// deep-link effect in useAppState), joining straight away when signed in or
// remembering the code through sign-up when not.
//
// The old link pointed at scripturepacing.app, a domain nothing served.
// ============================================================================

export const INVITE_PAGE_URL = 'https://bustling-task-lpsvl.web.app/join';
export const APP_SCHEME = 'scripturememory';

export function buildInviteUrl(code: string): string {
  return `${INVITE_PAGE_URL}?code=${encodeURIComponent(code)}`;
}

/** The invite code in a link the app was opened with, if it's an invite. */
export function parseInviteCode(url: string | null | undefined): string | null {
  if (!url) return null;
  const isInvite = url.startsWith(`${APP_SCHEME}://join`) || url.startsWith(INVITE_PAGE_URL) || /[?&]join=/.test(url);
  if (!isInvite) return null;
  const match = url.match(/[?&](?:code|join)=([A-Za-z0-9_-]{3,32})/);
  return match ? match[1].toUpperCase() : null;
}
