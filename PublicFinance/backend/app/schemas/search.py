"""
Pydantic schemas for Search functionality.
"""

from typing import Optional, List, Any, Dict
from decimal import Decimal

from pydantic import BaseModel, Field


class SearchQuery(BaseModel):
    """Schema for search query parameters."""

    q: str = Field(..., min_length=1, max_length=500, description="Search query string")
    
    # Filters
    fiscal_year_id: Optional[int] = None
    ministry_id: Optional[int] = None
    state_id: Optional[int] = None
    entity_type: Optional[str] = None  # budget, scheme, ministry, state, document
    
    # Pagination
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)
    
    # Sorting
    sort_by: Optional[str] = None
    sort_order: str = Field(default="desc", pattern="^(asc|desc)$")


class SearchResult(BaseModel):
    """Schema for a single search result."""

    id: int
    type: str  # budget, scheme, ministry, state, document
    title: str
    description: Optional[str] = None
    score: float = Field(ge=0)
    metadata: Dict[str, Any] = {}
    
    # Contextual data
    fiscal_year: Optional[str] = None
    ministry: Optional[str] = None
    state: Optional[str] = None
    amount: Optional[Decimal] = None


class SearchResponse(BaseModel):
    """Schema for search response."""

    query: str
    total_results: int
    page: int
    page_size: int
    total_pages: int
    results: List[SearchResult]
    
    # Facets for filtering
    facets: Optional[Dict[str, Any]] = None
    
    # Search metadata
    search_time_ms: float
