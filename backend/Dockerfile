FROM python:3.11-slim

# 1. Install system deps: ffmpeg, Node.js (for POT provider), curl, git
RUN apt-get update && apt-get install -y \
    ffmpeg \
    nodejs \
    npm \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 2. Clone and build the bgutil POT provider (auto-generates YouTube PO tokens)
RUN git clone --single-branch --branch 1.2.2 \
    https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/pot-provider \
    && cd /opt/pot-provider/server \
    && npm ci \
    && npx tsc

# 3. Install Python dependencies
RUN pip install --no-cache-dir \
    fastapi \
    uvicorn \
    yt-dlp \
    aiofiles \
    bgutil-ytdlp-pot-provider

# 4. Upgrade yt-dlp to absolute latest (YouTube breaks old versions frequently)
RUN pip install --no-cache-dir --upgrade yt-dlp

# 5. Copy application code
COPY . .

# 6. Setup downloads folder
RUN mkdir -p /root/Downloads/VideoDL

# 7. Copy startup script
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# 8. Start both POT provider and the main app
ENV PORT=8080
CMD ["/app/start.sh"]
