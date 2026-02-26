FROM python:3.12-slim

# Install system dependencies: ffmpeg + deno (for YouTube EJS signature solving)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Deno (required for YouTube signature challenge solving)
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh
ENV PATH="/usr/local/bin:${PATH}"

WORKDIR /app

# Install Python dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY backend/main.py .
COPY backend/static/ ./static/

# Create the downloads folder
RUN mkdir -p /root/Downloads/VideoDL

EXPOSE 8000

CMD ["python", "main.py"]
