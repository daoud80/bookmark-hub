# Privacy

Bookmark Hub runs entirely inside your browser.

- **No servers.** The extension makes no network requests of its own and has no backend.
- **No tracking.** No analytics, no telemetry, no accounts, no ads.
- **No remote code.** Everything it runs is in this repository and ships inside the extension package.
- **Your bookmarks are read, never sent anywhere.** The extension reads your bookmarks through the browser's bookmarks API to draw the page. They are not copied, stored or transmitted.
- **Notes and settings stay local.** The notes you write and your settings (title, colour, and so on) are saved in the browser's local extension storage for the current profile. They are not synced and not uploaded. You can export them to a file yourself from the settings panel.
- **Site icons are supplied by your browser.** The extension asks the browser for each site's icon through the `favicon` permission. The extension itself never contacts the sites in your bookmarks. Where the browser gets an icon from is up to the browser, not this extension.

## Permissions

| Permission | Why it is needed |
| --- | --- |
| `bookmarks` | Read your bookmarks to show them, and notice when you add, move or delete one. The extension never creates, edits or deletes bookmarks. |
| `favicon` | Show each site's icon from the browser's cache. |
| `storage` | Save your notes and settings in this browser profile. |

The extension asks for no host permissions, so it cannot read or change any web page.

If something here ever changes, it will be changed in this file and noted in the release notes.
