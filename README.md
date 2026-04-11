Warning: This process uses an Auth Cookie to log in to SKPORT.

1. Sign in to your Google account. If you don’t have one, please create it first.
2. Go to the [Google Apps Script](https://script.google.com/home/start) and select Apps Script.
3. Copy [main.gs](https://raw.githubusercontent.com/Fukki/-AKEF-SKPORT---Auto-claim-daily/refs/heads/main/main.js) and paste it into the editor.
4. Sign in to [SKPORT](https://www.skport.com/).
5. Find the cookie named "SK_OAUTH_CRED_KEY"
   Depending on the browser you are using:
   - In Firefox: Open F12 → Storage → Cookies
   - In Chrome: Open F12 → Application → Storage → Cookies
   - In Edge: Click the 🔒 icon in the address bar → Cookies and site data → Cookies
6. Copy the value of "SK_OAUTH_CRED_KEY" and paste it into profiles → cred in the editor.
7. Run the script. Google will ask for permissions and warn that the script is not secure because it uses authentication (yeah… obviously 😏). Click Advanced and proceed with the Unsafe option.
