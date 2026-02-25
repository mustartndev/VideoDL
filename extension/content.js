// Simple content script to detect video tags
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "countVideos" || request.action === "getVideos") {
        const videoTags = Array.from(document.getElementsByTagName('video'));
        const sources = [];

        videoTags.forEach(v => {
            if (v.src && v.src.startsWith('http')) {
                sources.push(v.src);
            }
            // Check for <source> children
            const childSources = Array.from(v.getElementsByTagName('source'));
            childSources.forEach(s => {
                if (s.src && s.src.startsWith('http')) {
                    sources.push(s.src);
                }
            });
        });

        // Unique URLs
        const uniqueSources = [...new Set(sources)];

        if (request.action === "countVideos") {
            sendResponse({ count: uniqueSources.length });
        } else {
            sendResponse({ videos: uniqueSources });
        }
    }
    // Must return true if we were async, but we are not.
});
