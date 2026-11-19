# Deck Review for Chrome

1. Keep the updated Deck app open.
2. Open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and select this folder.
3. Pin **Deck Review** in Chrome's Extensions menu.
4. In Deck, right-click a live Codex or AGY session and choose **Set active for Browser Review**. Its row shows **Active**. Selecting another session replaces the previous target.
5. On your web app tab, press **Alt+X** (or click the extension icon) to open the movable toolbar. The extension connects to Deck automatically; no pairing code or side panel is needed.
6. Choose **Element** or **Region**, select the page area, write a comment and click **Save**. Click its numbered pin to edit it; **Cancel** removes that comment.
7. Click **Send** to submit this page's saved comments to the Active session. Deck pastes and submits immediately when that exact session is confirmed idle with an empty composer. A busy agent is rejected immediately; requests do not wait in a queue.

Drafts stay in Chrome while Deck is offline. If delivery cannot be confirmed, retrying keeps the original batch ID and never duplicates terminal input. Check the agent conversation before using **Dismiss delivery** to unlock the saved drafts. A restarted or replaced agent must be selected Active again.

The manifest includes a public Chrome key so Deck can recognize this extension during automatic connection. If updating an older unpacked installation changes its extension ID, load this folder again in `chrome://extensions`. Keep the old installation until any old drafts have been recovered.

Selection works on HTTP/HTTPS pages. Chrome internal pages, the Chrome Web Store, and cross-origin frame contents may restrict selection. Component/source hints depend on the app exposing development information; URL, selector, geometry and screenshots are the baseline.

This folder is an unpacked extension; it has not been published to the Chrome Web Store. Reload it in `chrome://extensions` after updating the files.
