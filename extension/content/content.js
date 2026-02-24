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

  function detectContentTypeFromContainer(element) {
    if (!element) return detectContentTypeFromUrl();

    if (
      element.closest("[data-job-id]") ||
      element.closest("[data-view-name*='job']")
    ) {
      return "job";
    }

    if (
      element.closest("[data-urn*='article']") ||
      element.closest("[data-urn*='blogPost']") ||
      element.closest("[data-urn*='newsletter']")
    ) {
      return "article";
    }

    if (
      element.closest("[data-urn*='learning']") ||
      element.closest("[data-resource-type='COURSE']") ||
      element.closest("[data-resource-type='VIDEO']")
    ) {
      return "course";
    }

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
    var heading = document.querySelector(
      "h1[class*='job'], h1[class*='top-card'], h1"
    );
    return heading ? heading.textContent.trim() : "";
  }

  function extractJobUrl() {
    var match = window.location.href.match(/(\/jobs\/view\/\d+)/);
    return match
      ? "https://www.linkedin.com" + match[1]
      : window.location.href;
  }

  function extractArticleTitle() {
    var heading = document.querySelector("article h1, h1");
    return heading ? heading.textContent.trim() : "";
  }

  function extractCourseTitle() {
    var heading = document.querySelector("h1");
    return heading ? heading.textContent.trim() : "";
  }

  function extractPostText(trigger) {
    var post = trigger ? trigger.closest("[data-urn]") : null;
    if (!post) return "";

    var actorLink = post.querySelector(
      'a[href*="/in/"] span[dir="ltr"], a[href*="/company/"] span[dir="ltr"]'
    );
    var actorName = actorLink ? actorLink.textContent.trim() : "";

    var textContainer = post.querySelector(
      'span[dir="ltr"].break-words, [data-urn] [dir="ltr"]'
    );
    var snippet = textContainer
      ? textContainer.textContent.trim().slice(0, 120)
      : "";

    if (actorName && snippet) return actorName + ": " + snippet;
    if (actorName) return "Post by " + actorName;
    return snippet;
  }

  function extractPostUrl(trigger) {
    var post = trigger ? trigger.closest("[data-urn]") : null;

    if (post) {
      var urn = post.getAttribute("data-urn") || "";
      var activityMatch = urn.match(/urn:li:(activity|ugcPost):(\d+)/);
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

    if (post) {
      var link = post.querySelector('a[href*="/feed/update/"]');
      if (link) return link.href.split("?")[0];
    }

    return window.location.href;
  }

  function extractMetadata(triggerElement) {
    var contentType = detectContentTypeFromContainer(triggerElement);
    var metadata = {
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

  function findSaveAnchor(el) {
    var current = el;
    for (var depth = 0; depth < 5 && current; depth++) {
      var ariaLabel = (current.getAttribute("aria-label") || "").trim();
      if (/^save\b/i.test(ariaLabel)) return current;

      var controlName = current.getAttribute("data-control-name") || "";
      if (/save/i.test(controlName) && !/unsave/i.test(controlName)) {
        return current;
      }

      var tag = current.tagName;
      var role = current.getAttribute("role");
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

  function isUnsaveAction(el) {
    var current = el;
    for (var depth = 0; depth < 5 && current; depth++) {
      var ariaLabel = (
        current.getAttribute("aria-label") || ""
      ).toLowerCase();
      if (/unsave|saved/i.test(ariaLabel)) return true;
      if (/^\s*unsave\s*$/i.test(current.textContent)) return true;
      current = current.parentElement;
    }
    return false;
  }

  // ==========================================================================
  // Background messaging
  // ==========================================================================

  function sendToBackground(action, data) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(
        { type: action, payload: data },
        function (response) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response && response.error) {
            reject(new Error(response.error));
            return;
          }
          resolve(response ? response.data : null);
        }
      );
    });
  }

  // ==========================================================================
  // Toast notification
  // ==========================================================================

  function showToast(message, type) {
    var existing = document.querySelector(".lh-toast");
    if (existing) existing.remove();

    var toast = document.createElement("div");
    toast.className = "lh-toast lh-toast--" + type;

    var icon =
      type === "success"
        ? '<svg class="lh-toast__icon" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : '<svg class="lh-toast__icon" width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.5v4M8 10.5v1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

    toast.innerHTML = icon + '<span class="lh-toast__text"></span>';
    toast.querySelector(".lh-toast__text").textContent = message;
    document.body.appendChild(toast);

    // Trigger reflow then animate in.
    toast.offsetHeight; // eslint-disable-line no-unused-expressions
    toast.classList.add("lh-toast--visible");

    setTimeout(function () {
      toast.classList.remove("lh-toast--visible");
      setTimeout(function () {
        toast.remove();
      }, 300);
    }, 3000);
  }

  // ==========================================================================
  // Popup overlay
  // ==========================================================================

  var activePopup = null;

  function dismissPopup() {
    if (!activePopup) return;
    var el = activePopup;
    el.classList.remove("lh-backdrop--visible");
    setTimeout(function () {
      el.remove();
    }, 200);
    activePopup = null;
  }

  function positionPopup(popup, triggerElement) {
    if (!triggerElement || !triggerElement.getBoundingClientRect) {
      popup.style.position = "fixed";
      popup.style.top = "50%";
      popup.style.left = "50%";
      popup.style.transform = "translate(-50%, -50%)";
      return;
    }

    var rect = triggerElement.getBoundingClientRect();
    var popupWidth = 368;
    var popupEstHeight = 440;
    var gap = 8;

    var top = rect.bottom + gap;
    var left = rect.left;

    if (top + popupEstHeight > window.innerHeight) {
      top = Math.max(gap, rect.top - popupEstHeight - gap);
    }
    if (left + popupWidth > window.innerWidth) {
      left = window.innerWidth - popupWidth - gap;
    }
    if (left < gap) left = gap;

    popup.style.position = "fixed";
    popup.style.top = top + "px";
    popup.style.left = left + "px";
    popup.style.transform = "none";
  }

  // Build the inner HTML for the popup panel.
  function buildPopupHTML(metadata, isDuplicate) {
    var CONTENT_TYPES = ["article", "post", "course", "job", "other"];
    var options = CONTENT_TYPES.map(function (t) {
      var selected = t === metadata.contentType ? " selected" : "";
      return (
        '<option value="' +
        t +
        '"' +
        selected +
        ">" +
        t.charAt(0).toUpperCase() +
        t.slice(1) +
        "</option>"
      );
    }).join("");

    var duplicateWarning = isDuplicate
      ? '<div class="lh-popup__warning">' +
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1l7 13H1L8 1z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6v3M8 11v1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
        " This URL has already been saved.</div>"
      : "";

    return (
      '<div class="lh-popup__header">' +
      '<svg class="lh-popup__header-icon" width="18" height="18" viewBox="0 0 16 16" fill="none">' +
      '<path d="M3 2.5A1.5 1.5 0 014.5 1h7A1.5 1.5 0 0113 2.5v12l-5-3-5 3v-12z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
      "</svg>" +
      '<span class="lh-popup__header-text">Save to LinkedIn Helper</span>' +
      '<button class="lh-popup__close" id="lh-close" aria-label="Close">&times;</button>' +
      "</div>" +
      duplicateWarning +
      '<div class="lh-popup__body">' +
      '<label class="lh-popup__label" for="lh-title">Title</label>' +
      '<input class="lh-popup__input" id="lh-title" type="text" />' +
      '<label class="lh-popup__label" for="lh-type">Content Type</label>' +
      '<select class="lh-popup__select" id="lh-type">' +
      options +
      "</select>" +
      '<label class="lh-popup__label">Tags</label>' +
      '<div class="lh-popup__tags-wrap">' +
      '<div class="lh-popup__chips" id="lh-chips"></div>' +
      '<input class="lh-popup__tag-input" id="lh-tag-input" type="text" placeholder="Type and press Enter" />' +
      '<div class="lh-popup__autocomplete" id="lh-ac"></div>' +
      "</div>" +
      '<label class="lh-popup__label" for="lh-notes">Notes <span class="lh-popup__optional">(optional)</span></label>' +
      '<textarea class="lh-popup__textarea" id="lh-notes" rows="2" placeholder="Add a note\u2026"></textarea>' +
      "</div>" +
      '<div class="lh-popup__footer">' +
      '<button class="lh-popup__btn lh-popup__btn--cancel" id="lh-cancel">Cancel</button>' +
      '<button class="lh-popup__btn lh-popup__btn--save" id="lh-save">Save</button>' +
      "</div>"
    );
  }

  /**
   * Show the save-item popup near `triggerElement`.
   */
  async function showPopup(metadata, triggerElement) {
    // Only one popup at a time.
    if (activePopup) dismissPopup();

    // --- Pre-flight: duplicate check + existing tags (in parallel) --------
    var isDuplicate = false;
    var existingTags = [];
    try {
      var results = await Promise.all([
        sendToBackground("GET_ITEMS", {}),
        sendToBackground("GET_ALL_TAGS", {}),
      ]);
      isDuplicate = results[0].some(function (item) {
        return item.url === metadata.url;
      });
      existingTags = results[1] || [];
    } catch (e) {
      console.warn(PREFIX + " Pre-flight check failed:", e.message);
    }

    // --- Build DOM --------------------------------------------------------
    var backdrop = document.createElement("div");
    backdrop.className = "lh-backdrop";

    var popup = document.createElement("div");
    popup.className = "lh-popup";
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-label", "Save item");
    popup.innerHTML = buildPopupHTML(metadata, isDuplicate);

    // Set title value via property (safe for special chars).
    popup.querySelector("#lh-title").value = metadata.title;

    backdrop.appendChild(popup);
    document.body.appendChild(backdrop);
    activePopup = backdrop;

    positionPopup(popup, triggerElement);

    // Animate in.
    requestAnimationFrame(function () {
      backdrop.classList.add("lh-backdrop--visible");
    });

    // --- Tag chip state ---------------------------------------------------
    var tags = [];
    var chipsEl = popup.querySelector("#lh-chips");
    var tagInput = popup.querySelector("#lh-tag-input");
    var acEl = popup.querySelector("#lh-ac");

    function renderChips() {
      chipsEl.innerHTML = "";
      tags.forEach(function (t, idx) {
        var chip = document.createElement("span");
        chip.className = "lh-popup__chip";
        chip.textContent = t;

        var rm = document.createElement("button");
        rm.className = "lh-popup__chip-rm";
        rm.type = "button";
        rm.textContent = "\u00d7";
        rm.setAttribute("aria-label", "Remove tag " + t);
        rm.addEventListener("click", function () {
          tags.splice(idx, 1);
          renderChips();
          tagInput.focus();
        });
        chip.appendChild(rm);
        chipsEl.appendChild(chip);
      });
    }

    function addTag(val) {
      var clean = val.trim().toLowerCase().slice(0, 50);
      if (!clean || tags.includes(clean)) return;
      tags.push(clean);
      renderChips();
      tagInput.value = "";
      hideAC();
    }

    function showAC(filter) {
      var lower = filter.toLowerCase();
      var matches = existingTags
        .filter(function (t) {
          return (
            t.toLowerCase().startsWith(lower) &&
            !tags.includes(t.toLowerCase())
          );
        })
        .slice(0, 6);

      if (!matches.length) {
        hideAC();
        return;
      }

      acEl.innerHTML = "";
      matches.forEach(function (m) {
        var opt = document.createElement("div");
        opt.className = "lh-popup__ac-option";
        opt.textContent = m;
        opt.addEventListener("mousedown", function (e) {
          e.preventDefault(); // prevent input blur
          addTag(m);
        });
        acEl.appendChild(opt);
      });
      acEl.classList.add("lh-popup__autocomplete--visible");
    }

    function hideAC() {
      acEl.classList.remove("lh-popup__autocomplete--visible");
      acEl.innerHTML = "";
    }

    tagInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        addTag(tagInput.value);
      } else if (
        e.key === "Backspace" &&
        !tagInput.value &&
        tags.length > 0
      ) {
        tags.pop();
        renderChips();
      }
    });

    tagInput.addEventListener("input", function () {
      var v = tagInput.value.trim();
      if (v) {
        showAC(v);
      } else {
        hideAC();
      }
    });

    tagInput.addEventListener("blur", function () {
      setTimeout(hideAC, 150);
    });

    // --- Dismiss handlers -------------------------------------------------
    popup.querySelector("#lh-close").addEventListener("click", dismissPopup);
    popup.querySelector("#lh-cancel").addEventListener("click", dismissPopup);

    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) dismissPopup();
    });

    document.addEventListener(
      "keydown",
      function onEsc(e) {
        if (e.key === "Escape") {
          dismissPopup();
          document.removeEventListener("keydown", onEsc);
        }
      }
    );

    // --- Save handler -----------------------------------------------------
    popup.querySelector("#lh-save").addEventListener("click", async function () {
      var saveBtn = popup.querySelector("#lh-save");
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving\u2026";

      var title =
        popup.querySelector("#lh-title").value.trim() || "Untitled";
      var contentType = popup.querySelector("#lh-type").value;
      var notes = popup.querySelector("#lh-notes").value.trim();

      var item = {
        title: title,
        url: metadata.url,
        contentType: contentType,
        tags: tags.filter(function (t) {
          return t.length > 0;
        }),
        notes: notes || "",
      };

      try {
        await sendToBackground("SAVE_ITEM", item);
        dismissPopup();
        showToast("Saved to LinkedIn Helper!", "success");
        console.log(PREFIX + " Item saved:", item);
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save";
        showToast("Failed to save: " + err.message, "error");
        console.error(PREFIX + " Save failed:", err);
      }
    });

    // Focus the title input after the animation settles.
    setTimeout(function () {
      popup.querySelector("#lh-title").focus();
    }, 120);
  }

  // ==========================================================================
  // Core handler — called by every detection strategy
  // ==========================================================================

  function handleSaveDetected(triggerElement, source) {
    var now = Date.now();
    if (now - lastSaveTimestamp < DEBOUNCE_MS) return;
    lastSaveTimestamp = now;

    var metadata = extractMetadata(triggerElement);

    console.log(PREFIX + " Save detected (" + source + ")", metadata);
    console.table({
      contentType: metadata.contentType,
      title: metadata.title,
      url: metadata.url,
      detectedAt: metadata.detectedAt,
    });

    showPopup(metadata, triggerElement);
  }

  // ==========================================================================
  // Strategy 1 — Click event delegation (capture phase)
  // ==========================================================================

  document.addEventListener(
    "click",
    function (event) {
      // Ignore clicks inside our own popup.
      if (event.target.closest && event.target.closest(".lh-popup")) return;

      if (isUnsaveAction(event.target)) return;

      var anchor = findSaveAnchor(event.target);
      if (anchor) {
        handleSaveDetected(anchor, "click");
      }
    },
    true
  );

  // ==========================================================================
  // Strategy 2 — MutationObserver for aria-label flips & toast confirmations
  // ==========================================================================

  var observer = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var mutation = mutations[i];

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
            "\u2192",
            newVal
          );
          handleSaveDetected(mutation.target, "aria-label-flip");
        }
      }

      if (mutation.type === "childList") {
        for (var j = 0; j < mutation.addedNodes.length; j++) {
          var node = mutation.addedNodes[j];
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          // Skip nodes created by our own extension.
          if (
            node.classList &&
            (node.classList.contains("lh-toast") ||
              node.classList.contains("lh-backdrop"))
          ) {
            continue;
          }

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
              handleSaveDetected(null, "toast");
            }
          }
        }
      }
    }
  });

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

  var menuObserver = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var mutation = mutations[i];
      if (mutation.type !== "childList") continue;

      for (var j = 0; j < mutation.addedNodes.length; j++) {
        var node = mutation.addedNodes[j];
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

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
