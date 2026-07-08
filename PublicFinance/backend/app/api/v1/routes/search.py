"""
API routes for Search functionality.

Provides REST endpoints for full-text search across all public finance entities.
"""

from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.services.search import SearchService
from app.schemas.search import SearchQuery, SearchResponse

router = APIRouter(prefix="/search", tags=["Search"])


@router.get("", response_model=SearchResponse)
def search(
    q: str = Query(..., min_length=1, max_length=500, description="Search query string"),
    fiscal_year_id: Optional[int] = Query(None, description="Filter by fiscal year ID"),
    ministry_id: Optional[int] = Query(None, description="Filter by ministry ID"),
    state_id: Optional[int] = Query(None, description="Filter by state ID"),
    entity_type: Optional[str] = Query(None, description="Filter by entity type (budget, scheme, ministry, state, document)"),
    page: int = Query(default=1, ge=1, description="Page number"),
    page_size: int = Query(default=20, ge=1, le=100, description="Items per page"),
    sort_by: Optional[str] = Query(None, description="Field to sort by"),
    sort_order: str = Query(default="desc", pattern="^(asc|desc)$", description="Sort order"),
    db: Session = Depends(get_db),
):
    """
    Perform full-text search across all public finance entities.
    
    Searches through budgets, schemes, ministries, states, districts, and documents.
    Results are ranked by relevance using PostgreSQL full-text search.
    
    **Features:**
    - Full-text search with ranking
    - Filter by fiscal year, ministry, state, entity type
    - Pagination and sorting
    - Faceted search results
    - Search time metrics
    
    **Example:**
    ```
    GET /api/v1/search?q=education&entity_type=budget&page=1&page_size=10
    ```
    """
    try:
        search_service = SearchService(db=db)
        
        query_params = SearchQuery(
            q=q,
            fiscal_year_id=fiscal_year_id,
            ministry_id=ministry_id,
            state_id=state_id,
            entity_type=entity_type,
            page=page,
            page_size=page_size,
            sort_by=sort_by,
            sort_order=sort_order,
        )
        
        results = search_service.search(query_params)
        return results
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Search failed: {str(e)}"
        )


@router.get("/suggest", response_model=list[str])
def suggest(
    q: str = Query(..., min_length=1, max_length=100, description="Partial query for suggestions"),
    limit: int = Query(default=5, ge=1, le=20, description="Maximum number of suggestions"),
    db: Session = Depends(get_db),
):
    """
    Get search suggestions/autocomplete for a partial query.
    
    Returns matching titles and names from all entity types that start with the query.
    Useful for implementing search autocomplete functionality.
    
    **Example:**
    ```
    GET /api/v1/search/suggest?q=edu&limit=5
    Response: ["Education", "Education Ministry", "Higher Education"]
    ```
    """
    try:
        search_service = SearchService(db=db)
        suggestions = search_service.suggest(query=q, limit=limit)
        return suggestions
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Suggestions failed: {str(e)}"
        )
