// Background Service Worker to sniff media URLs

// Store detected videos: Map<TabId, Map<Url, Headers>>
// Using Map<Url, Headers> to deduplicate by URL but keep headers
const detectedVideos = new Map();

// Clear data when a tab is updated/loaded
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading') {
        detectedVideos.delete(tabId);
        chrome.action.setBadgeText({ tabId, text: "" });
    }
});

// Clear data when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
    detectedVideos.delete(tabId);
});

// Network Listener to Capture Headers
chrome.webRequest.onSendHeaders.addListener(
    (details) => {
        const { tabId, url, method, requestHeaders } = details;
        if (tabId < 0 || method !== 'GET') return;

        // Filter for common media extensions and patterns
        const isMedia = /\.(m3u8|mp4|flv|mov|webm)(\?|$)/i.test(url) ||
            url.includes('videoplayback') ||
            url.includes('manifest');

        // Filter OUT common segment patterns to reduce noise
        const isSegment = /\.(ts|m4s|mbn)(\?|$)/i.test(url) ||
            /seg-\d+/.test(url) ||
            /fragment/.test(url);

        if (isMedia && !isSegment) {
            if (!detectedVideos.has(tabId)) {
                detectedVideos.set(tabId, new Map());
            }

            // Extract useful headers
            const headers = {};
            if (requestHeaders) {
                requestHeaders.forEach(h => {
                    if (['Referer', 'Cookie', 'User-Agent', 'Origin'].includes(h.name)) {
                        headers[h.name] = h.value;
                    }
                });
            }

            const videoMap = detectedVideos.get(tabId);
            videoMap.set(url, headers);

            // Update badge text
            chrome.action.setBadgeText({ tabId, text: String(videoMap.size) });
            chrome.action.setBadgeBackgroundColor({ tabId, color: '#FF0000' });
        }
    },
    { urls: ["<all_urls>"] },
    ["requestHeaders", "extraHeaders"]
);

// Message Handler for Popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getSniffedVideos") {
        const tabId = request.tabId;
        const videoMap = detectedVideos.get(tabId);
        const videos = [];

        if (videoMap) {
            videoMap.forEach((headers, url) => {
                videos.push({ url, headers });
            });
        }
        sendResponse({ videos });
    }
});
