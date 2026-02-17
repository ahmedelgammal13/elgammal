// Background service worker for the extension

chrome.runtime.onInstalled.addListener(() => {
  console.log("LinkedIn Helper extension installed.");
});
