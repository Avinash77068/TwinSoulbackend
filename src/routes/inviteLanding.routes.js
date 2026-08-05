const router = require('express').Router();
const InviteToken = require('../models/InviteToken');
const User = require('../models/User');

/**
 * Web fallback for invite links.
 *
 * If the app is installed, App Links / Universal Links intercept /i/<token> and
 * this page never renders. If it is NOT installed, this page is the whole
 * conversion surface — so it names the inviter, shows their note, and passes the
 * token to the store so it can be redeemed after install (deferred deep link).
 */

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const ANDROID_PKG = process.env.ANDROID_PACKAGE_NAME || 'com.twinsoul';
const IOS_APP_ID = process.env.IOS_APP_STORE_ID || '';
const PLAY_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PKG}`;
const APPSTORE_URL = IOS_APP_ID ? `https://apps.apple.com/app/id${IOS_APP_ID}` : 'https://apps.apple.com/';

router.get('/i/:token', async (req, res) => {
  const { token } = req.params;

  let inviterName = null;
  let note = '';
  let state = 'invalid';

  try {
    const invite = await InviteToken.findOne({ token });
    if (invite) {
      state = invite.invalidReason() || 'valid';
      const inviter = await User.findById(invite.inviterId).select('name nickname').lean();
      inviterName = inviter?.nickname || inviter?.name || null;
      note = invite.message || '';

      // Count the open so the inviter sees "your invite was opened".
      await InviteToken.updateOne(
        { _id: invite._id },
        {
          $inc: { openCount: 1 },
          ...(invite.openedAt ? {} : { $set: { openedAt: new Date() } }),
        }
      ).catch(() => {});
    }
  } catch (_) {
    state = 'invalid';
  }

  const headline =
    state === 'valid' && inviterName
      ? `${esc(inviterName)} invited you to TwinSoul`
      : state === 'valid'
        ? 'You have been invited to TwinSoul'
        : state === 'expired'
          ? 'This invite has expired'
          : state === 'used'
            ? 'This invite has already been used'
            : state === 'revoked'
              ? 'This invite was cancelled'
              : 'This invite is not valid';

  const sub =
    state === 'valid'
      ? 'A private space for just the two of you.'
      : 'Ask them to send you a new one.';

  res.status(state === 'valid' ? 200 : 410).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${headline}</title>
<style>
  :root { --bg:#fff5f9; --fg:#2b2230; --muted:#8a7f92; --accent:#ec4899; --card:#fff; --line:#f6e3ee; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#151019; --fg:#f4eff8; --muted:#a99cb5; --accent:#f472b6; --card:#201925; --line:#33293c; }
  }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--fg);
         font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; padding:24px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:22px;
          padding:36px 28px; max-width:420px; width:100%; text-align:center;
          box-shadow:0 12px 40px rgba(0,0,0,.07); }
  .mark { font-size:2.6rem; }
  h1 { font-size:1.35rem; margin:14px 0 6px; letter-spacing:-.01em; }
  p.sub { color:var(--muted); margin:0 0 22px; }
  blockquote { margin:0 0 22px; padding:14px 16px; background:var(--bg);
               border-left:3px solid var(--accent); border-radius:0 12px 12px 0;
               text-align:left; font-style:italic; }
  a.btn { display:block; padding:14px 18px; border-radius:14px; text-decoration:none;
          font-weight:600; margin-bottom:10px; background:var(--accent); color:#fff; }
  a.btn.alt { background:transparent; color:var(--fg); border:1px solid var(--line); }
  .hint { font-size:.8rem; color:var(--muted); margin-top:16px; }
</style></head><body>
<div class="card">
  <div class="mark">💞</div>
  <h1>${headline}</h1>
  <p class="sub">${sub}</p>
  ${state === 'valid' && note ? `<blockquote>${esc(note)}</blockquote>` : ''}
  ${state === 'valid' ? `
    <a class="btn" id="open" href="twinsoul://invite/${esc(token)}">Open in TwinSoul</a>
    <a class="btn alt" id="store" href="${PLAY_URL}">Get the app</a>
    <p class="hint">Already installed? Tap "Open in TwinSoul".</p>` : ''}
</div>
<script>
  (function () {
    var token = ${JSON.stringify(token)};
    // Preserve the token across install so it can be redeemed after signup.
    try { localStorage.setItem('twinsoul_pending_invite', token); } catch (e) {}

    var ua = navigator.userAgent || '';
    var isIOS = /iPad|iPhone|iPod/.test(ua);
    var store = document.getElementById('store');
    if (store && isIOS) store.href = ${JSON.stringify(APPSTORE_URL)};

    // Try the app first; if nothing takes over, the user stays on this page and
    // can tap through to the store themselves. No auto-redirect — silently
    // bouncing people to a store listing is a worse experience than a clear choice.
    var open = document.getElementById('open');
    if (open) {
      open.addEventListener('click', function () {
        setTimeout(function () { /* app did not open — leave the page as-is */ }, 1200);
      });
    }
  })();
</script>
</body></html>`);
});

module.exports = router;
