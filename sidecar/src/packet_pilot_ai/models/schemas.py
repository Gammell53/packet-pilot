"""Pydantic schemas for API requests and responses."""

from pydantic import BaseModel
from typing import Optional, Literal


class CaptureContext(BaseModel):
    """Context about the current packet capture state."""
    selected_packet_id: Optional[int] = None
    selected_stream_id: Optional[int] = None
    visible_range: dict  # {"start": int, "end": int}
    current_filter: str = ""
    file_name: Optional[str] = None
    total_frames: int = 0


class ChatMessage(BaseModel):
    """A single chat message in the conversation."""
    id: str
    role: Literal["user", "assistant", "system"]
    content: str
    timestamp: int
    context: Optional[CaptureContext] = None


class AnalyzeRequest(BaseModel):
    """Request to analyze packets based on a user query."""
    query: str
    context: CaptureContext
    conversation_history: list[ChatMessage] = []
    model: Optional[str] = None  # Optional model override


class AnalyzeResponse(BaseModel):
    """Response from packet analysis."""
    message: str
    suggested_filter: Optional[str] = None
    suggested_action: Optional[Literal["apply_filter", "go_to_packet", "follow_stream"]] = None
    action_payload: Optional[dict] = None


class FilterRequest(BaseModel):
    """Request to generate a Wireshark display filter."""
    query: str
    context: CaptureContext


class FilterResponse(BaseModel):
    """Response with generated filter."""
    filter: str
    is_valid: bool
    explanation: str
