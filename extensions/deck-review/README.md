# Deck Review for Chrome

1. Keep the updated Deck app open.
2. Open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and select this folder.
3. Pin **Deck Review** in Chrome's Extensions menu.
4. In Deck, right-click a source folder and choose **Browser Extension**. Enter its two-minute code in the extension settings to pair.
5. On any web app tab, press **Alt+X** (or click the extension icon) to toggle the in-page review toolbar.
6. Choose **Element** or **Region**, click or drag on the page, and a floating comment box appears directly on the element.
7. Type your change request and hit **Ctrl+Enter** (or click **Save**). A numbered pin is placed on the page and saved as a draft.
8. Use the side panel (**Ctrl+Shift+Y**) anytime to view all drafts, choose target agents, and queue delivery to Deck.

Drafts stay in Chrome while Deck is offline. A delivery retry reuses its original batch ID. Check **Queue and delivery** before unlocking an unconfirmed batch's drafts. Disconnect the extension from Deck to revoke its connection.

Selection works on HTTP/HTTPS pages. Chrome internal pages, the Chrome Web Store, and cross-origin frame contents may restrict selection. Component/source hints depend on the app exposing development information; URL, selector, geometry and screenshots are the baseline.

This folder is an unpacked extension; it has not been published to the Chrome Web Store. Reload it in `chrome://extensions` after updating the files.
