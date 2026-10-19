// Opens the hub page when the toolbar button is clicked.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('hub.html') });
});
