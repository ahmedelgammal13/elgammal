// Content script for LinkedIn pages
// Detects save button clicks and extracts metadata across page types.
// Uses resilient selectors (aria-labels, data attributes, structural patterns)
// rather than brittle class names.

(function () {
  "use strict";

  const PREFIX = "[LinkedIn Helper]";
  const DEBOUNCE_MS = 600;
  let lastSaveTimestamp = 0;

  // ==========================================================================
  // Content-type detection
  // ==========================================================================

  /**
   * Infer content type from the current page URL.
   */
  function detectContentTypeFromUrl() {
    const path = window.location.pathname;

    if (/^\/jobs\/(view|collections|search|posting)/.test(path)) return "job";
    if (/^\/pulse\//.test(path)) return "article";
    if (/^\/posts\//.test(path)) return "article";
    if (/^\/learning\//.test(path)) return "course";
    if (/^\/feed\/?/.test(path)) return "post";
    if (/^\/in\/[^/]+\/(recent-activity|detail)/.test(path)) return "post";

    return "other";
  }

  /**
   * Infer content type by walking up from the element that was clicked to find
   * structural hints in ancestor elements.
   */
  function detectContentTypeFromContainer(element) {
    if (!element) return detectContentTypeFromUrl();

    // Job containers carry data-job-id or live under known landmark wrappers.
    if (
      element.closest("[data-job-id]") ||
      element.closest("[data-view-name*='job']")
    ) {
      return "job";
    }

    // Article / blog post URNs
    if (
      element.closest("[data-urn*='article']") ||
      element.closest("[data-urn*='blogPost']") ||
      element.closest("[data-urn*='newsletter']")
    ) {
      return "article";
    }

    // LinkedIn Learning
    if (
      element.closest("[data-urn*='learning']") ||
      element.closest("[data-resource-type='COURSE']") ||
      element.closest("[data-resource-type='VIDEO']")
    ) {
      return "course";
    }

    // Feed posts — activity / ugcPost URNs
    if (
      element.closest("[data-urn*='activity']") ||
      element.closest("[data-urn*='ugcPost']")
    ) {
      return "post";
    }

    return detectContentTypeFromUrl();
  }

  // ==========================================================================
  // Metadata extraction helpers
  // ==========================================================================

  function extractJobTitle() {
    // Job detail pages typically surface the title in a prominent heading.
    const heading = document.querySelector(
      "h1[class*='job'], h1[class*='top-card'], h1"
    );
    return heading ? heading.textContent.trim() : "";
  }

  function extractJobUrl() {
    const match = window.location.href.match(/(\/jobs\/view\/\d+)/);
    return match
      ? "https://www.linkedin.com" + match[1]
      : window.location.href;
  }

  function extractArticleTitle() {
    const heading = document.querySelector("article h1, h1");
    return heading ? heading.textContent.trim() : "";
  }

  function extractCourseTitle() {
    const heading = document.querySelector("h1");
    return heading ? heading.textContent.trim() : "";
  }

  /**
   * For feed posts the "title" is synthesised from the author name and a text
   * snippet. We walk up from the trigger element to find the enclosing post.
   */
  function extractPostText(trigger) {
    const post = trigger
      ? trigger.closest("[data-urn]")
      : null;

    if (!post) return "";

    // Author — look for the first anchor whose href points to a profile.
    const actorLink = post.querySelector(
      'a[href*="/in/"] span[dir="ltr"], a[href*="/company/"] span[dir="ltr"]'
    );
    const actorName = actorLink ? actorLink.textContent.trim() : "";

    // Text body — LinkedIn wraps post text in a span with dir="ltr" inside a
    // container with data-urn on the post level.
    const textContainer = post.querySelector(
      'span[dir="ltr"].break-words, [data-urn] [dir="ltr"]'
    );
    const snippet = textContainer
      ? textContainer.textContent.trim().slice(0, 120)
      : "";

    if (actorName && snippet) return actorName + ": " + snippet;
    if (actorName) return "Post by " + actorName;
    return snippet;
  }

  function extractPostUrl(trigger) {
    const post = trigger ? trigger.closest("[data-urn]") : null;

    if (post) {
      const urn = post.getAttribute("data-urn") || "";
      const activityMatch = urn.match(/urn:li:(activity|ugcPost):(\d+)/);
      if (activityMatch) {
        return (
          "https://www.linkedin.com/feed/update/urn:li:" +
          activityMatch[1] +
          ":" +
          activityMatch[2] +
          "/"
        );
      }
    }

    // Fall back to finding a permalink anchor inside the post.
    if (post) {
      const link = post.querySelector('a[href*="/feed/update/"]');
      if (link) return link.href.split("?")[0];
    }

    return window.location.href;
  }

  /**
   * Build a metadata object from the context surrounding a save action.
   */
  function extractMetadata(triggerElement) {
    const contentType = detectContentTypeFromContainer(triggerElement);
    const metadata = {
      contentType: contentType,
      url: window.location.href,
      title: "",
      detectedAt: new Date().toISOString(),
    };

    switch (contentType) {
      case "job":
        metadata.title = extractJobTitle();
        metadata.url = extractJobUrl();
        break;
      case "article":
        metadata.title = extractArticleTitle();
        break;
      case "course":
        metadata.title = extractCourseTitle();
        break;
      case "post":
        metadata.title = extractPostText(triggerElement);
        metadata.url = extractPostUrl(triggerElement);
        break;
      default:
        break;
    }

    // Final fallback: strip the LinkedIn suffix from document.title.
    if (!metadata.title) {
      metadata.title =
        document.title.replace(/\s*[|\u2013\u2014].*$/, "").trim() ||
        "Untitled";
    }

    return metadata;
  }

  // ==========================================================================
  // Save-button recognition
  // ==========================================================================

  /**
   * Walk a small ancestor chain from `el` and return the first element whose
   * aria-label or text content signals a *save* (not *unsave*) action.
   * Returns the matching element, or null.
   */
  function findSaveAnchor(el) {
    let current = el;
    for (let depth = 0; depth < 5 && current; depth++) {
      // --- aria-label ---------------------------------------------------
      const ariaLabel = (current.getAttribute("aria-label") || "").trim();
      if (/^save\b/i.test(ariaLabel)) return current;

      // --- data-control-name --------------------------------------------
      const controlName = current.getAttribute("data-control-name") || "";
      if (/save/i.test(controlName) && !/unsave/i.test(controlName)) {
        return current;
      }

      // --- role="menuitem" or button with exact "Save" text -------------
      const tag = current.tagName;
      const role = current.getAttribute("role");
      if (
        (tag === "BUTTON" ||
          tag === "LI" ||
          tag === "DIV" ||
          role === "menuitem" ||
          role === "option") &&
        /^\s*save\s*$/i.test(current.textContent)
      ) {
        return current;
      }

      current = current.parentElement;
    }
    return null;
  }

  /**
   * Returns true when `el` is (or is inside) an *unsave* button so we can
   * ignore those clicks.
   */
  function isUnsaveAction(el) {
    let current = el;
    for (let depth = 0; depth < 5 && current; depth++) {
      const ariaLabel = (current.getAttribute("aria-label") || "").toLowerCase();
      if (/unsave|saved/i.test(ariaLabel)) return true;
      if (/^\s*unsave\s*$/i.test(current.textContent)) return true;
      current = current.parentElement;
    }
    return false;
  }

  // ==========================================================================
  // Core handler — called by every detection strategy
  // ==========================================================================

  function handleSaveDetected(triggerElement, source) {
    const now = Date.now();
    if (now - lastSaveTimestamp < DEBOUNCE_MS) return;
    lastSaveTimestamp = now;

    const metadata = extractMetadata(triggerElement);

    console.log(PREFIX + " Save detected (" + source + ")", metadata);
    console.table({
      contentType: metadata.contentType,
      title: metadata.title,
      url: metadata.url,
      detectedAt: metadata.detectedAt,
    });

    // Forward to background service worker.
    try {
      chrome.runtime.sendMessage({
        type: "SAVE_DETECTED",
        payload: metadata,
      });
    } catch (err) {
      console.warn(PREFIX + " Could not message background:", err.message);
    }
  }

  // ==========================================================================
  // Strategy 1 — Click event delegation (capture phase)
  // ==========================================================================

  document.addEventListener(
    "click",
    function (event) {
      // Ignore unsave clicks.
      if (isUnsaveAction(event.target)) return;

      var anchor = findSaveAnchor(event.target);
      if (anchor) {
        handleSaveDetected(anchor, "click");
      }
    },
    true // capture phase — fires before LinkedIn's own handlers
  );

  // ==========================================================================
  // Strategy 2 — MutationObserver for aria-label flips & toast confirmations
  // ==========================================================================

  var observer = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var mutation = mutations[i];

      // 2a. Attribute change: aria-label toggling from "Save …" → "Unsave …"
      //     This is the strongest confirmation that a save actually succeeded.
      if (
        mutation.type === "attributes" &&
        mutation.attributeName === "aria-label"
      ) {
        var oldVal = (mutation.oldValue || "").toLowerCase();
        var newVal = (
          mutation.target.getAttribute("aria-label") || ""
        ).toLowerCase();

        if (
          /^save\b/.test(oldVal) &&
          !oldVal.includes("unsave") &&
          newVal.includes("unsave")
        ) {
          console.log(
            PREFIX + " Save confirmed via aria-label flip:",
            oldVal,
            "→",
            newVal
          );
          handleSaveDetected(mutation.target, "aria-label-flip");
        }
      }

      // 2b. New child nodes: look for toast/snackbar confirmations.
      if (mutation.type === "childList") {
        for (var j = 0; j < mutation.addedNodes.length; j++) {
          var node = mutation.addedNodes[j];
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          // LinkedIn renders save-confirmation toasts inside
          // `.artdeco-toast-item` elements.
          var toast =
            node.matches && node.matches(".artdeco-toast-item")
              ? node
              : node.querySelector
                ? node.querySelector(".artdeco-toast-item")
                : null;

          if (toast) {
            var toastText = toast.textContent.toLowerCase();
            if (
              toastText.includes("saved") &&
              !toastText.includes("unsaved") &&
              !toastText.includes("removed")
            ) {
              console.log(
                PREFIX + " Save confirmed via toast:",
                toast.textContent.trim()
              );
              // Toast confirmations don't have a clear trigger element, so
              // we pass null and let extractMetadata fall back to page-level
              // heuristics.
              handleSaveDetected(null, "toast");
            }
          }
        }
      }
    }
  });

  // Wait for body to be available (it should be by the time content scripts
  // run, but guard just in case).
  function startObserver() {
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", startObserver);
      return;
    }

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label"],
      attributeOldValue: true,
    });
  }

  startObserver();

  // ==========================================================================
  // Strategy 3 — Intercept dropdown menu items as they appear
  // ==========================================================================
  // LinkedIn lazily renders dropdown menus. A second MutationObserver watches
  // for newly-inserted menu items whose text is "Save" and attaches a one-shot
  // click listener so we catch saves even when the menu structure changes.

  var menuObserver = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var mutation = mutations[i];
      if (mutation.type !== "childList") continue;

      for (var j = 0; j < mutation.addedNodes.length; j++) {
        var node = mutation.addedNodes[j];
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        // Look for dropdown / popover containers.
        var menuItems = [];
        if (node.querySelectorAll) {
          menuItems = node.querySelectorAll(
            '[role="menuitem"], [role="option"], [data-control-name*="save"]'
          );
        }

        for (var k = 0; k < menuItems.length; k++) {
          var item = menuItems[k];
          var text = item.textContent.trim().toLowerCase();
          if (text === "save") {
            // Tag it so we don't attach duplicate listeners.
            if (item.dataset.lhSaveTracked) continue;
            item.dataset.lhSaveTracked = "true";

            item.addEventListener(
              "click",
              (function (capturedItem) {
                return function () {
                  if (!isUnsaveAction(capturedItem)) {
                    handleSaveDetected(capturedItem, "menu-item-click");
                  }
                };
              })(item)
            );

            console.debug(
              PREFIX + " Attached listener to new Save menu item",
              item
            );
          }
        }
      }
    }
  });

  function startMenuObserver() {
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", startMenuObserver);
      return;
    }

    menuObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  startMenuObserver();

  // ==========================================================================
  // Startup log
  // ==========================================================================

  console.log(
    PREFIX + " Content script loaded. Page type:",
    detectContentTypeFromUrl(),
    "| URL:",
    window.location.href
  );
})();
