# Local Video Downloader

A RAM-efficient Chrome Extension for downloading videos.

## Structure
- `backend/`: Python server (`main.py`) using `yt-dlp`.
- `extension/`: Chrome Extension (Manifest V3).

## Quick Start
1.  **Backend**:
    ```bash
    pip install -r backend/requirements.txt
    python backend/main.py
    ```
2.  **Frontend**:
    - Load `extension/` folder as Unpacked Extension in Chrome.

## Downloads
Files are saved to `~/Downloads/VideoDL`.
