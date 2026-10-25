# Google Search Console and Analytics: setup (human steps)

The app ships with a pretend Google (`GOOGLE_PROVIDER=mock`, the default). It works without any account and shows sample numbers. To read real data you need a Google Cloud OAuth client. This costs nothing.

1. Go to the Google Cloud console, create a project (or pick one).
2. Enable two APIs: **Google Search Console API** and **Google Analytics Data API**, plus **Google Analytics Admin API** (it lists the properties).
3. OAuth consent screen: choose **External**, fill in the app name, support email and your domain. Add these scopes: `.../auth/webmasters.readonly`, `.../auth/analytics.readonly`, `openid`, `email`. While the app is in **Testing** mode only the test users you add can connect; to let any agency connect, publish the app. Google reviews apps that use sensitive scopes, which can take days to weeks.
4. Credentials, Create credentials, **OAuth client ID**, type **Web application**. Add this authorised redirect URI exactly: `<APP_URL>/api/google/callback`. For local tests that is `http://localhost:3000/api/google/callback`.
5. Put the client id and secret in the server `.env`:
   ```
   GOOGLE_PROVIDER=google
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   ```
   `ENCRYPTION_KEY` must be set to a real random value of at least 32 characters: the Google tokens are encrypted with it. **Do not change it afterwards** without asking for a re-connect of every project, because the saved tokens could no longer be read.
6. Restart the stack. In a project, open the **Analytics** tab, press **Connect Google**, choose the account, and pick the Search Console site and the Analytics property.

Notes:

- Redirects go to `APP_URL` only. Sign in to the agency app on that address when you connect Google.
- A person can take back access at any time in their Google account. The next daily sync then marks the project as "needs to be connected again", and the page shows a message and a button.
- Tests never call Google. They use the pretend Google, and the real HTTP code is tested against a fake server (msw).
