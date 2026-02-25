FROM python:3.9-slim

# Install system dependencies (ffmpeg is often needed by yt-dlp)
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/main.py .

# Create the downloads folder
RUN mkdir -p /root/Downloads/VideoDL

EXPOSE 8000

CMD ["python", "main.py"]
