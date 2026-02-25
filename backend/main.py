import os
import uuid
import subprocess
import uvicorn
import asyncio
import shutil
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from pathlib import Path

from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

# Setup ffmpeg path for local development (static_ffmpeg)
ffmpeg_dir = None
try:
    import static_ffmpeg
    static_ffmpeg.add_paths()
    _ffmpeg_path = shutil.which("ffmpeg")
    if _ffmpeg_path:
        ffmpeg_dir = str(Path(_ffmpeg_path).parent)
        print(f"[INIT] static_ffmpeg found, ffmpeg at: {ffmpeg_dir}")
except ImportError:
    print("[INIT] static_ffmpeg not found, assuming system ffmpeg is available (Docker/Cloud)")

app = FastAPI()

# Mount Static UI
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def read_index():
    return FileResponse('static/index.html')

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
DOWNLOAD_DIR = Path.home() / "Downloads" / "VideoDL"
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Mount the download directory so files can be downloaded via HTTP
app.mount("/files", StaticFiles(directory=DOWNLOAD_DIR), name="files")

# In-memory job store
jobs = {}

class DownloadRequest(BaseModel):
    url: str
    format: str = "best"
    headers: dict = {}


def get_subprocess_env():
    """Build environment dict that includes ffmpeg on PATH for the subprocess."""
    env = os.environ.copy()
    if ffmpeg_dir:
        env["PATH"] = ffmpeg_dir + os.pathsep + env.get("PATH", "")
    return env


async def process_download(job_id: str, url: str, headers: dict):
    """
    Background task to run yt-dlp and update job status.
    For YouTube URLs, uses browser cookies for authentication.
    """
    job_dir = DOWNLOAD_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    
    # Detect YouTube URLs
    is_youtube = any(domain in url.lower() for domain in [
        "youtube.com", "youtu.be", "youtube-nocookie.com"
    ])
    
    try:
        jobs[job_id]["status"] = "processing"
        jobs[job_id]["progress"] = "Starting download..."
        
        # Construct yt-dlp command
        # For non-YouTube: prefer H.264/AAC for compatibility
        # For YouTube: let yt-dlp pick best available format (less restrictive = fewer 403s)
        cmd = [
            "yt-dlp", 
            "-P", str(job_dir), 
            "--recode-video", "mp4",
            "--postprocessor-args", "VideoConvertor:-c:v libx264 -c:a aac -pix_fmt yuv420p",
            "--no-warnings",
            "--newline",
        ]
        
        if is_youtube:
            # YouTube-specific: use Chrome cookies, don't restrict formats too much
            cmd.extend([
                "--cookies-from-browser", "chrome",
                "--extractor-args", "youtube:player_client=default,-android_sdkless",
                "--force-ipv4",
                "--retries", "5",
                "--fragment-retries", "5",
                "--file-access-retries", "5",
                "--rm-cache-dir",
            ])
            jobs[job_id]["progress"] = "Authenticating with YouTube..."
            print(f"[Job {job_id}] YouTube detected, using Chrome cookies")
        else:
            # Non-YouTube: prefer H.264 for compatibility
            cmd.extend(["-S", "vcodec:h264,res,acodec:m4a"])
        
        # Append URL at end
        cmd.append(url)
        
        # Add headers if provided (from extension)
        if headers:
            for key, value in headers.items():
                cmd.extend(["--add-header", f"{key}:{value}"])

        print(f"[Job {job_id}] Running: {' '.join(cmd)}")

        # Run yt-dlp with ffmpeg-aware environment
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=get_subprocess_env()
        )
        
        # Read stdout line-by-line for progress
        stdout_lines = []
        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            decoded = line.decode().strip()
            if decoded:
                stdout_lines.append(decoded)
                print(f"[Job {job_id}] {decoded}")
                # Update progress with download percentage lines
                if "[download]" in decoded and "%" in decoded:
                    jobs[job_id]["progress"] = decoded
                elif "[Merger]" in decoded or "[VideoConvertor]" in decoded:
                    jobs[job_id]["progress"] = "Converting to MP4..."
                elif decoded.startswith("[download] Destination:"):
                    jobs[job_id]["progress"] = "Downloading..."
        
        # Wait for process to finish and capture stderr
        _, stderr = await proc.communicate()
        stderr_text = stderr.decode().strip() if stderr else ""
        
        if stderr_text:
            print(f"[Job {job_id}] STDERR:\n{stderr_text}")

        # Find the downloaded file
        files = [f for f in job_dir.glob("*") if f.is_file()]
        
        if not files:
            # If no files and process failed, report the error
            if proc.returncode != 0:
                error_msg = stderr_text or "Download failed with no output"
                raise Exception(error_msg)
            raise Exception("Download finished but no file found in job directory.")
        
        # Pick the largest file (in case of temp files)
        downloaded_file = max(files, key=lambda f: f.stat().st_size)
        filename = downloaded_file.name
        file_size_mb = downloaded_file.stat().st_size / (1024 * 1024)

        jobs[job_id]["status"] = "done"
        jobs[job_id]["filename"] = filename
        jobs[job_id]["progress"] = f"Complete! ({file_size_mb:.1f} MB)"
        print(f"[Job {job_id}] Done: {filename} ({file_size_mb:.1f} MB)")
        
    except Exception as e:
        jobs[job_id]["status"] = "error"
        jobs[job_id]["error"] = str(e)
        jobs[job_id]["progress"] = "Failed"
        print(f"[Job {job_id}] ERROR: {e}")


@app.get("/health")
def health_check():
    import importlib.metadata
    try:
        ytdlp_version = importlib.metadata.version("yt-dlp")
    except Exception:
        ytdlp_version = "unknown"
    
    ffmpeg_available = shutil.which("ffmpeg") is not None
    node_available = shutil.which("node") is not None
    
    # Check if POT provider is running
    pot_running = False
    try:
        import urllib.request
        req = urllib.request.urlopen("http://127.0.0.1:4416/", timeout=2)
        pot_running = req.status == 200
    except Exception:
        pass
    
    return {
        "status": "running",
        "download_dir": str(DOWNLOAD_DIR),
        "yt_dlp_version": ytdlp_version,
        "ffmpeg_available": ffmpeg_available,
        "node_available": node_available,
        "pot_provider_running": pot_running,
    }


@app.post("/download")
async def start_download(req: DownloadRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "pending", "progress": "Queued..."}
    
    background_tasks.add_task(process_download, job_id, req.url, req.headers)
    
    return {"job_id": job_id, "status": "started"}


@app.get("/jobs/{job_id}")
def get_job_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = jobs[job_id]
    response = {"status": job["status"]}
    
    # Always include progress text
    if "progress" in job:
        response["progress"] = job["progress"]
    
    if job["status"] == "done":
        response["download_url"] = f"/files/{job_id}/{job['filename']}"
    elif job["status"] == "error":
        response["error"] = job.get("error")
        
    return response


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
