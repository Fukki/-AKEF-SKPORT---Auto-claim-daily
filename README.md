Warning: This process uses an Auth Cookie to log in to SKPORT.

Setup Guide:
1. Sign in to your Google account. If you don’t have one, please create it first.
2. Go to the [Google Apps Script](https://script.google.com/home/start) and select Apps Script.
3. Copy [main.gs](https://raw.githubusercontent.com/Fukki/-AKEF-SKPORT---Auto-claim-daily/refs/heads/main/main.js) and paste it into the editor.
4. Sign in to [SKPORT](https://www.skport.com/).
5. Find the cookie named "SK_OAUTH_CRED_KEY"
   Depending on the browser you are using:
   - In Firefox: Open F12 → Storage → Cookies
   - In Chrome: Open F12 → Application → Storage → Cookies
   - In Edge: Click the 🔒 icon in the address bar → Cookies and site data → Cookies
6. Copy the value of "SK_OAUTH_CRED_KEY" and paste it into "profiles" → "cred" in the editor.
7. Run the script. Google will ask for permissions and warn that the script is not secure because it uses authentication (yeah… obviously 😏). Click Advanced and proceed with the Unsafe option.

Automation Setup:
1. On the left sidebar, click the 🕝 Triggers (clock icon).
2. Click + Add Trigger at the bottom-right corner.
   - Choose which function to run → "main" (by default)
   - Choose which deployment should run → "Head" (by default)
   - Select event source → "Time-driven"
   - Select type of time based trigger → "Day timer"
   - Select time of day → Up to you ex "Midnight to 1 AM".

Note: The "Day timer" runs once at a random time within the selected window. For example, if you choose "Midnight to 1 AM", the script will run at a random time within that range and will generally run at a similar time in subsequent executions.
3. Once finished, click Save. Google will ask for permissions because the script uses authentication (well… no surprise there 😛). Click Advanced and proceed with the Unsafe option.

Discord Notification (Webhook)
1. Open Discord and create a channel for notifications (or use an existing one).
2. Select Edit Channel → Integrations → Webhooks → New Webhook.
3. Select the created webhook, set a name, then click "Copy Webhook URL".
4. Paste the URL into "discordApp" → "discordWebhook" in the editor, and don’t forget to set "notify" to true.
5. For "myDiscordID", go to Discord Settings, scroll down to Advanced, and enable Developer Mode.
6. In the bottom-left corner, click your profile icon and select Copy User ID.
7. Then paste it into discordApp → myDiscordID in the editor.
8. Save the changes or run the script again.
