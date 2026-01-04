"""HTTP client for communicating with Rust backend."""

from typing import Optional
import httpx

RUST_BRIDGE_URL = "http://127.0.0.1:8766"


async def get_frames(skip: int = 0, limit: int = 100) -> Optional[list[dict]]:
    """Fetch frames from Rust via HTTP bridge."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{RUST_BRIDGE_URL}/frames",
                json={"skip": skip, "limit": limit},
                timeout=30.0,
            )
            response.raise_for_status()
            data = response.json()
            return data.get("frames", [])
    except httpx.HTTPError as e:
        print(f"Error fetching frames: {e}")
        return None


async def get_frame_details(frame_num: int) -> Optional[dict]:
    """Fetch detailed frame info from Rust via HTTP bridge."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{RUST_BRIDGE_URL}/frame-details",
                json={"frame_num": frame_num},
                timeout=30.0,
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        print(f"Error fetching frame details: {e}")
        return None


async def check_filter(filter_str: str) -> bool:
    """Validate a Wireshark display filter via Rust bridge."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{RUST_BRIDGE_URL}/check-filter",
                json={"filter": filter_str},
                timeout=10.0,
            )
            response.raise_for_status()
            data = response.json()
            return data.get("valid", False)
    except httpx.HTTPError as e:
        print(f"Error checking filter: {e}")
        return False
