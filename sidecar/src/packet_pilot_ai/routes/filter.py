"""Filter endpoint for generating Wireshark display filters."""

from fastapi import APIRouter, HTTPException

from ..models.schemas import FilterRequest, FilterResponse
from ..services.ai_agent import generate_filter, AIServiceError

router = APIRouter()


@router.post("/filter", response_model=FilterResponse)
async def create_filter(request: FilterRequest) -> FilterResponse:
    """Generate a Wireshark display filter from natural language."""
    try:
        result = await generate_filter(
            query=request.query,
            context=request.context,
        )
        return result

    except AIServiceError as e:
        raise HTTPException(status_code=400, detail=e.user_message)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
