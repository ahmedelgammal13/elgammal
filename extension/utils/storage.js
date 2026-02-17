// Utility module for Chrome storage operations

const STORAGE_KEY = "linkedin_helper_items";

function generateUUID() {
  return crypto.randomUUID();
}

async function _getAll() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || [];
}

async function _setAll(items) {
  await chrome.storage.local.set({ [STORAGE_KEY]: items });
}

/**
 * Stores a new item with an auto-generated UUID and timestamp.
 * @param {Object} item - The item to save (should include tags, contentType, etc.)
 * @returns {Object} The saved item with id and createdAt fields.
 */
export async function saveItem(item) {
  if (!item || typeof item !== "object") {
    throw new Error("saveItem requires a valid object");
  }

  const newItem = {
    ...item,
    id: generateUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const items = await _getAll();
  items.push(newItem);
  await _setAll(items);
  return newItem;
}

/**
 * Retrieves items with optional filtering.
 * @param {Object} [filters] - Optional filters.
 * @param {string[]} [filters.tags] - Filter by tags (items matching ANY of these tags).
 * @param {string} [filters.contentType] - Filter by contentType (exact match).
 * @param {string} [filters.search] - Filter by keyword (case-insensitive substring search across string fields).
 * @returns {Object[]} Array of matching items.
 */
export async function getItems(filters = {}) {
  let items = await _getAll();

  if (filters.tags && filters.tags.length > 0) {
    items = items.filter(
      (item) =>
        Array.isArray(item.tags) &&
        filters.tags.some((tag) => item.tags.includes(tag))
    );
  }

  if (filters.contentType) {
    items = items.filter((item) => item.contentType === filters.contentType);
  }

  if (filters.search) {
    const keyword = filters.search.toLowerCase();
    items = items.filter((item) =>
      Object.values(item).some(
        (val) => typeof val === "string" && val.toLowerCase().includes(keyword)
      )
    );
  }

  return items;
}

/**
 * Updates an existing item by id.
 * @param {string} id - The UUID of the item to update.
 * @param {Object} updates - Fields to merge into the existing item.
 * @returns {Object} The updated item.
 */
export async function updateItem(id, updates) {
  if (!id) {
    throw new Error("updateItem requires an id");
  }
  if (!updates || typeof updates !== "object") {
    throw new Error("updateItem requires a valid updates object");
  }

  const items = await _getAll();
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) {
    throw new Error(`Item not found: ${id}`);
  }

  items[index] = {
    ...items[index],
    ...updates,
    id: items[index].id,
    createdAt: items[index].createdAt,
    updatedAt: new Date().toISOString(),
  };

  await _setAll(items);
  return items[index];
}

/**
 * Deletes an item by id.
 * @param {string} id - The UUID of the item to delete.
 * @returns {boolean} True if the item was found and deleted.
 */
export async function deleteItem(id) {
  if (!id) {
    throw new Error("deleteItem requires an id");
  }

  const items = await _getAll();
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) {
    throw new Error(`Item not found: ${id}`);
  }

  items.splice(index, 1);
  await _setAll(items);
  return true;
}

/**
 * Returns all unique tags across all stored items.
 * @returns {string[]} Sorted array of unique tags.
 */
export async function getAllTags() {
  const items = await _getAll();
  const tagSet = new Set();
  for (const item of items) {
    if (Array.isArray(item.tags)) {
      for (const tag of item.tags) {
        tagSet.add(tag);
      }
    }
  }
  return [...tagSet].sort();
}

/**
 * Exports all items in the specified format.
 * @param {"json"|"csv"} format - Export format.
 * @returns {string} The exported data as a string.
 */
export async function exportData(format = "json") {
  const items = await _getAll();

  if (format === "json") {
    return JSON.stringify(items, null, 2);
  }

  if (format === "csv") {
    if (items.length === 0) {
      return "";
    }

    const allKeys = new Set();
    for (const item of items) {
      for (const key of Object.keys(item)) {
        allKeys.add(key);
      }
    }
    const columns = [...allKeys].sort();

    const escapeCSV = (val) => {
      if (val === null || val === undefined) return "";
      const str = typeof val === "object" ? JSON.stringify(val) : String(val);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    const header = columns.map(escapeCSV).join(",");
    const rows = items.map((item) =>
      columns.map((col) => escapeCSV(item[col])).join(",")
    );

    return [header, ...rows].join("\n");
  }

  throw new Error(`Unsupported export format: ${format}`);
}
