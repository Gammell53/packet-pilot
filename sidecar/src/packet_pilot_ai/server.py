"""FastAPI server for PacketPilot AI sidecar."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import httpx

from . import __version__

# Global HTTP client for Rust bridge
rust_client: httpx.AsyncClient | None = None
RUST_BRIDGE_URL = "http://127.0.0.1:8766"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle - setup and teardown."""
    global rust_client
    rust_client = httpx.AsyncClient(base_url=RUST_BRIDGE_URL, timeout=30.0)
    yield
    await rust_client.aclose()


app = FastAPI(
    title="PacketPilot AI",
    description="AI-powered packet analysis assistant",
    version=__version__,
    lifespan=lifespan,
)

# Configure CORS for Tauri app
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "tauri://localhost",
        "https://tauri.localhost",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "version": __version__}


# Import and include routers
from .routes import analyze, filter as filter_route

app.include_router(analyze.router, tags=["analyze"])
app.include_router(filter_route.router, tags=["filter"])
