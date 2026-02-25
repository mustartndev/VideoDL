document.addEventListener('DOMContentLoaded', async () => {
    const statusDiv = document.getElementById('connectionStatus');
    const messageDiv = document.getElementById('message');
    const logsDiv = document.getElementById('logs');
    const serverUrlInput = document.getElementById('serverUrl');
    const videoListDiv = document.getElementById('videoList');

    // Load saved URL
    const savedUrl = localStorage.getItem('backendUrl');
    if (savedUrl) serverUrlInput.value = savedUrl;

    let serverUrl = serverUrlInput.value.replace(/\/$/, "");
    let allDetectedVideos = new Set();
    let downloadInProgress = false;

    function log(msg) {
        logsDiv.innerHTML += `> ${msg}<br>`;
        logsDiv.scrollTop = logsDiv.scrollHeight;
    }

    async function checkBackend() {
        serverUrl = serverUrlInput.value.replace(/\/$/, "");
        localStorage.setItem('backendUrl', serverUrl);

        statusDiv.textContent = 'Checking...';
        statusDiv.className = 'status disconnected';

        try {
            const res = await fetch(`${serverUrl}/health`);
            if (res.ok) {
                statusDiv.textContent = 'Server Connected';
                statusDiv.className = 'status connected';
                log('Server active at ' + serverUrl);
            } else {
                throw new Error('Health check failed');
            }
        } catch (e) {
            statusDiv.textContent = 'Server Not Connected';
            statusDiv.className = 'status disconnected';
            log('Error: ' + e.message);
        }
    }

    // Polling Logic
    async function pollJob(jobId) {
        log(`Polling job ${jobId}...`);
        const interval = setInterval(async () => {
            try {
                const res = await fetch(`${serverUrl}/jobs/${jobId}`);
                if (!res.ok) {
                    if (res.status === 404) {
                        clearInterval(interval);
                        localStorage.removeItem('currentJobId');
                        downloadInProgress = false;
                        log('Job lost (server restart?). Please retry.');
                        renderVideos();
                        return;
                    }
                }

                const data = await res.json();

                if (data.status === 'processing' || data.status === 'pending') {
                    // Keep waiting
                }
                else if (data.status === 'done') {
                    clearInterval(interval);
                    localStorage.removeItem('currentJobId');
                    downloadInProgress = false;
                    renderVideos();

                    log(`Download URL: ${data.download_url}`);
                    const fullUrl = serverUrl + data.download_url;
                    chrome.downloads.download({ url: fullUrl });
                    messageDiv.textContent = 'Download Complete!';
                    messageDiv.style.color = 'green';
                }
                else if (data.status === 'error') {
                    clearInterval(interval);
                    localStorage.removeItem('currentJobId');
                    downloadInProgress = false;
                    renderVideos();
                    messageDiv.textContent = 'Error: ' + data.error;
                    log('Error: ' + data.error);
                }
            } catch (e) {
                log('Polling error: ' + e.message);
            }
        }, 2000);
    }

    async function startDownload(videoObj, btn) {
        downloadInProgress = true;
        btn.disabled = true;
        btn.textContent = 'Starting...';
        messageDiv.textContent = 'Requesting download...';

        try {
            const res = await fetch(`${serverUrl}/download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: videoObj.url,
                    headers: videoObj.headers || {}
                })
            });

            if (res.ok) {
                const data = await res.json();
                localStorage.setItem('currentJobId', data.job_id);
                log(`Job started: ${data.job_id}`);

                // UI feedback
                videoListDiv.innerHTML = '<div style="text-align:center; padding:20px; color:#555;">Download in progress...<br>You can close this popup.</div>';

                pollJob(data.job_id);
            } else {
                const err = await res.json();
                log(JSON.stringify(err));
                downloadInProgress = false;
                btn.disabled = false;
                btn.textContent = 'Download';
            }
        } catch (e) {
            log(e.message);
            downloadInProgress = false;
            btn.disabled = false;
            btn.textContent = 'Download';
        }
    }

    // Helper to score videos
    function getScore(url) {
        let score = 0;
        const lower = url.toLowerCase();
        // Priority to Master/Playlists
        if (lower.includes('.m3u8')) score += 10;
        if (lower.includes('master')) score += 5;
        if (lower.includes('playlist')) score += 5;
        if (lower.includes('index')) score += 2;

        // Downrank chunks
        if (lower.includes('chunk')) score -= 5;
        if (lower.includes('segment')) score -= 5;
        if (lower.includes('track')) score -= 5;
        return score;
    }

    // Render Video List
    function renderVideos() {
        videoListDiv.innerHTML = '';

        // 1. Convert to Array and Score
        let videos = Array.from(allDetectedVideos).map(v => ({
            ...v,
            score: getScore(v.url)
        }));

        const isYouTube = currentTabUrl.includes("youtube.com") || currentTabUrl.includes("youtu.be");
        if (isYouTube) {
            videos.unshift({
                url: currentTabUrl,
                headers: {},
                score: 100,
                isPage: true
            });
            videos = videos.filter(v => !v.url.includes("googlevideo.com") && !v.url.includes("videoplayback"));
        } else {
            // Deduplicate
            const unique = new Map();
            videos.forEach(v => unique.set(v.url, v));
            videos = Array.from(unique.values());
        }

        // 2. Sort by Score Descending
        videos.sort((a, b) => b.score - a.score);

        if (videos.length === 0) {
            const noVid = document.createElement('div');
            noVid.textContent = "No videos detected yet. Please play the video on the page.";
            noVid.style.padding = "10px";
            noVid.style.color = "#666";
            noVid.style.textAlign = "center";
            videoListDiv.appendChild(noVid);
            return;
        }

        // 3. Render Best Match
        const best = videos[0];
        const bestName = best.isPage ? "YouTube Page (Best Quality)" : (best.url.split('?')[0].split('/').pop() || "Best Match");
        addVideoItem(best, bestName, true);

        // 4. Render Others (Hidden)
        if (videos.length > 1) {
            const toggleCtn = document.createElement('div');
            toggleCtn.className = 'toggle-ctn';
            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'toggle-btn';
            toggleBtn.textContent = `Show ${videos.length - 1} other detected streams`;

            const hiddenDiv = document.createElement('div');
            hiddenDiv.className = 'hidden-videos';

            toggleBtn.onclick = () => {
                const hidden = hiddenDiv.style.display === 'none' || hiddenDiv.style.display === '';
                hiddenDiv.style.display = hidden ? 'block' : 'none';
                toggleBtn.textContent = hidden ? 'Hide others' : `Show ${videos.length - 1} other detected streams`;
            };

            toggleCtn.appendChild(toggleBtn);
            videoListDiv.appendChild(toggleCtn);

            for (let i = 1; i < videos.length; i++) {
                let name = videos[i].url.split('?')[0].split('/').pop();
                if (name.length > 30) name = name.substring(0, 30) + '...';
                if (!videos[i].isPage) addVideoItem(videos[i], name, false, hiddenDiv);
            }
            videoListDiv.appendChild(hiddenDiv);
        }
    }

    function addVideoItem(video, label, isBest, container = videoListDiv) {
        const item = document.createElement('div');
        item.className = 'video-item';
        if (isBest) item.classList.add('best-match');

        if (isBest) {
            const badgeq = document.createElement('div');
            badgeq.className = 'best-label';
            badgeq.textContent = 'RECOMMENDED';
            item.appendChild(badgeq);
        }

        const info = document.createElement('div');
        info.className = 'video-url';
        info.textContent = label || video.url;
        info.title = video.url;

        const btn = document.createElement('button');
        btn.className = 'dl-btn';
        btn.textContent = 'Download';
        if (downloadInProgress) btn.disabled = true;

        btn.onclick = () => startDownload(video, btn);

        item.appendChild(info);
        item.appendChild(btn);
        container.appendChild(item);
    }

    // Initialization
    // Check for existing pending job
    const storedJobId = localStorage.getItem('currentJobId');
    if (storedJobId) {
        log(`Resuming job: ${storedJobId}`);
        downloadInProgress = true;
        videoListDiv.innerHTML = '<div style="text-align:center; padding:20px; color:#555;">Download in progress...<br>Check logs for status.</div>';
        pollJob(storedJobId);
    }

    checkBackend();
    serverUrlInput.addEventListener('change', checkBackend);

    // Get Active Tab and Sniffed Data
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let currentTabUrl = "";
    if (tab) {
        currentTabUrl = tab.url;

        // 1. Sniffed Videos
        chrome.runtime.sendMessage({ action: "getSniffedVideos", tabId: tab.id }, (response) => {
            if (response && response.videos) {
                response.videos.forEach(v => allDetectedVideos.add(v));
                renderVideos();
                log(`Loaded ${response.videos.length} sniffed stream(s).`);
            }
        });

        // 2. Scan Frames
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                func: () => {
                    const items = [];
                    // Direct Videos
                    Array.from(document.getElementsByTagName('video')).forEach(v => {
                        if (v.src && v.src.startsWith('http')) items.push({ url: v.src });
                        Array.from(v.getElementsByTagName('source')).forEach(s => {
                            if (s.src && s.src.startsWith('http')) items.push({ url: s.src });
                        });
                    });
                    // Iframes
                    const knownProviders = ['youtube.com/embed', 'player.vimeo.com', 'wistia.com', 'dailymotion.com'];
                    Array.from(document.getElementsByTagName('iframe')).forEach(f => {
                        if (f.src && knownProviders.some(p => f.src.includes(p))) items.push({ url: f.src });
                    });
                    return items;
                }
            });
            if (results) {
                // merge results
                const items = results.flatMap(r => r.result || []);
                items.forEach(i => {
                    // Scripting doesn't get headers, assume empty
                    allDetectedVideos.add({ url: i.url, headers: {} });
                });
                renderVideos();
            }
        } catch (e) {
            console.log(e);
        }
    }
});
