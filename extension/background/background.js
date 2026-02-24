// Background service worker for the extension
// Proxies storage operations for content scripts (which cannot use ES modules).

import {
  saveItem,
  getItems,
  getAllTags,
} from "../utils/storage.js";

chrome.runtime.onInstalled.addListener(() => {
  console.log("LinkedIn Helper extension installed.");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type, payload } = message;

  switch (type) {
    case "SAVE_ITEM":
      saveItem(payload)
        .then((item) => sendResponse({ data: item }))
        .catch((err) => sendResponse({ error: err.message }));
      return true; // keep channel open for async response

    case "GET_ITEMS":
      getItems(payload || {})
        .then((items) => sendResponse({ data: items }))
        .catch((err) => sendResponse({ error: err.message }));
      return true;

    case "GET_ALL_TAGS":
      getAllTags()
        .then((tags) => sendResponse({ data: tags }))
        .catch((err) => sendResponse({ error: err.message }));
      return true;

    case "SAVE_DETECTED":
      // Legacy — content script now drives the popup UI directly.
      console.log("[LinkedIn Helper] Save detected:", payload);
      break;

    default:
      break;
  }
});
