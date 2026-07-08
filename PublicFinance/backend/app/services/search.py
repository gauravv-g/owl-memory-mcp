"""
Search service for full-text search across all public finance entities.

Implements hybrid search with PostgreSQL full-text search and ranking.
Supports filtering, pagination, faceting, and multilingual search.
"""

from typing import Optional, List, Dict, Any, Tuple
from datetime import datetime
from decimal import Decimal
import re

from sqlalchemy import (
    select, 
    func, 
    or_, 
    and_, 
    text,
    union_all,
    alias
)
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.sql import column

from app.models.budget import Budget
from app.models.scheme import Scheme
from app.models.ministry import Ministry
from app.models.state import State
from app.models.district import District
from app.models.document import Document
from app.schemas.search import SearchQuery, SearchResult, SearchResponse


class SearchService:
    """
    Service for performing full-text search across all entities.
    
    Uses PostgreSQL full-text search with tsvector/tsquery for efficient
    ranking and relevance scoring. Supports filtering by fiscal year,
    ministry, state, and entity type.
    """
    
    # Entity types and their corresponding models
    ENTITY_MODELS = {
        'budget': Budget,
        'scheme': Scheme,
        'ministry': Ministry,
        'state': State,
        'district': District,
        'document': Document,
    }
    
    # Searchable fields per entity type
    SEARCH_FIELDS = {
        'budget': ['title', 'description', 'head_code', 'head_name'],
        'scheme': ['name', 'description', 'objectives'],
        'ministry': ['name', 'description'],
        'state': ['name', 'description'],
        'district': ['name'],
        'document': ['title', 'summary', 'content'],
    }
    
    def __init__(self, db: Session):
        """Initialize search service with database session."""
        self.db = db
    
    def search(self, query: SearchQuery) -> SearchResponse:
        """
        Perform full-text search across all entities.
        
        Args:
            query: Search query parameters including filters and pagination
            
        Returns:
            SearchResponse with results, facets, and metadata
        """
        start_time = datetime.now()
        
        # Build search query for each entity type
        all_results = []
        total_count = 0
        
        # Determine which entity types to search
        entity_types = [query.entity_type] if query.entity_type else list(self.ENTITY_MODELS.keys())
        
        for entity_type in entity_types:
            if entity_type not in self.ENTITY_MODELS:
                continue
                
            model = self.ENTITY_MODELS[entity_type]
            results, count = self._search_entity(
                model=model,
                entity_type=entity_type,
                search_query=query.q,
                fiscal_year_id=query.fiscal_year_id,
                ministry_id=query.ministry_id,
                state_id=query.state_id,
                page=query.page,
                page_size=query.page_size,
                sort_by=query.sort_by,
                sort_order=query.sort_order,
            )
            
            all_results.extend(results)
            if not query.entity_type:  # Only sum if searching all types
                total_count += count
        
        # Sort all results by score if multiple entity types
        if len(entity_types) > 1:
            all_results.sort(key=lambda x: x.score, reverse=True)
        
        # Apply pagination to combined results
        total_pages = (len(all_results) + query.page_size - 1) // query.page_size
        paginated_results = all_results[
            (query.page - 1) * query.page_size : query.page * query.page_size
        ]
        
        # Calculate search time
        end_time = datetime.now()
        search_time_ms = (end_time - start_time).total_seconds() * 1000
        
        # Generate facets
        facets = self._generate_facets(query.q) if not query.entity_type else None
        
        return SearchResponse(
            query=query.q,
            total_results=len(all_results),
            page=query.page,
            page_size=query.page_size,
            total_pages=total_pages,
            results=paginated_results,
            facets=facets,
            search_time_ms=search_time_ms,
        )
    
    def _search_entity(
        self,
        model: Any,
        entity_type: str,
        search_query: str,
        fiscal_year_id: Optional[int] = None,
        ministry_id: Optional[int] = None,
        state_id: Optional[int] = None,
        page: int = 1,
        page_size: int = 20,
        sort_by: Optional[str] = None,
        sort_order: str = "desc",
    ) -> Tuple[List[SearchResult], int]:
        """
        Search within a specific entity type.
        
        Uses PostgreSQL full-text search with tsvector.
        """
        # Build search query using PostgreSQL full-text search
        # Convert search terms to tsquery format
        search_terms = self._normalize_query(search_query)
        tsquery = " & ".join(search_terms)  # AND search
        
        # Build base query with full-text search
        searchable_fields = self.SEARCH_FIELDS.get(entity_type, [])
        if not searchable_fields:
            return [], 0
        
        # Create tsvector from searchable fields
        tsvector_expr = self._build_tsvector(model, searchable_fields)
        
        # Build filter conditions
        filters = []
        if fiscal_year_id and hasattr(model, 'fiscal_year_id'):
            filters.append(model.fiscal_year_id == fiscal_year_id)
        if ministry_id and hasattr(model, 'ministry_id'):
            filters.append(model.ministry_id == ministry_id)
        if state_id and hasattr(model, 'state_id'):
            filters.append(model.state_id == state_id)
        
        # Main search query with ranking
        stmt = select(
            model.id,
            func.ts_rank(tsvector_expr, func.plainto_tsquery('english', tsquery)).label('score'),
        ).where(
            tsvector_expr.op('@@')(func.plainto_tsquery('english', tsquery))
        )
        
        if filters:
            stmt = stmt.where(and_(*filters))
        
        # Get total count
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total_count = self.db.execute(count_stmt).scalar() or 0
        
        if total_count == 0:
            return [], 0
        
        # Execute search and get top results for this entity
        # Note: We fetch more than needed to properly sort across entities later
        limit = page_size * 3  # Fetch extra for cross-entity sorting
        stmt = stmt.order_by(
            text(f"score {'DESC' if sort_order == 'desc' else 'ASC'}")
        ).limit(limit)
        
        raw_results = self.db.execute(stmt).all()
        
        # Fetch full entities for the results
        result_ids = [r[0] for r in raw_results]
        entities = self.db.query(model).filter(model.id.in_(result_ids)).all()
        
        # Create SearchResult objects
        results = []
        entity_map = {e.id: e for e in entities}
        
        for row in raw_results:
            entity_id, score = row
            entity = entity_map.get(entity_id)
            if not entity:
                continue
            
            result = self._entity_to_search_result(entity, entity_type, score)
            if result:
                results.append(result)
        
        return results, total_count
    
    def _build_tsvector(self, model: Any, fields: List[str]) -> Any:
        """Build tsvector expression from multiple fields."""
        field_exprs = []
        title_field_obj = None
        
        for field in fields:
            if hasattr(model, field):
                col = getattr(model, field)
                # Coalesce NULL values to empty string
                field_exprs.append(func.coalesce(col, ''))
                
                # Track title/name field for weighting
                if field in ('title', 'name') and title_field_obj is None:
                    title_field_obj = func.coalesce(col, '')
        
        if not field_exprs:
            return func.to_tsvector('english', '')
        
        # Concatenate fields with weights
        # Title gets highest weight (A), description medium (B), others low (C)
        if title_field_obj is not None:
            title_expr = func.setweight(
                func.to_tsvector('english', title_field_obj),
                'A'
            )
            # Remove the original title field from list
            field_exprs = [f for f in field_exprs if f != title_field_obj]
            field_exprs.insert(0, title_expr)
        
        # Combine all fields
        combined = field_exprs[0]
        for expr in field_exprs[1:]:
            if isinstance(expr, str):
                combined = combined.op('||')(func.to_tsvector('english', expr))
            else:
                combined = combined.op('||')(expr)
        
        return combined
    
    def _normalize_query(self, query: str) -> List[str]:
        """Normalize and tokenize search query."""
        # Remove special characters except spaces
        cleaned = re.sub(r'[^\w\s]', ' ', query.lower())
        # Split into tokens and remove empty strings
        tokens = [t.strip() for t in cleaned.split() if t.strip()]
        # Remove very short tokens
        tokens = [t for t in tokens if len(t) >= 2]
        return tokens
    
    def _entity_to_search_result(
        self, 
        entity: Any, 
        entity_type: str, 
        score: float
    ) -> Optional[SearchResult]:
        """Convert entity instance to SearchResult."""
        try:
            # Extract common fields
            title = getattr(entity, 'title', None) or getattr(entity, 'name', None)
            description = getattr(entity, 'description', None)
            
            # Ensure we have a title
            if not title:
                title = f"{entity_type.title()} #{getattr(entity, 'id', 'unknown')}"
            
            # Extract contextual data
            fiscal_year = None
            ministry = None
            state = None
            amount = None
            
            if hasattr(entity, 'fiscal_year') and entity.fiscal_year:
                fiscal_year = entity.fiscal_year.name
            elif hasattr(entity, 'fiscal_year_id') and entity.fiscal_year_id:
                fiscal_year = f"FY-{entity.fiscal_year_id}"
            
            if hasattr(entity, 'ministry') and entity.ministry:
                ministry = entity.ministry.name
            elif hasattr(entity, 'ministry_id') and entity.ministry_id:
                ministry = f"Ministry-{entity.ministry_id}"
            
            if hasattr(entity, 'state') and entity.state:
                state = entity.state.name
            elif hasattr(entity, 'state_id') and entity.state_id:
                state = f"State-{entity.state_id}"
            
            if hasattr(entity, 'amount'):
                amount = entity.amount
            elif hasattr(entity, 'budget_amount'):
                amount = entity.budget_amount
            
            # Build metadata
            metadata = {
                'entity_type': entity_type,
                'id': getattr(entity, 'id', None),
            }
            
            # Add entity-specific metadata
            if hasattr(entity, 'head_code'):
                metadata['head_code'] = entity.head_code
            if hasattr(entity, 'objectives'):
                metadata['objectives'] = entity.objectives
            
            return SearchResult(
                id=getattr(entity, 'id', 0),
                type=entity_type,
                title=title,
                description=description,
                score=round(score, 4),
                metadata=metadata,
                fiscal_year=fiscal_year,
                ministry=ministry,
                state=state,
                amount=amount,
            )
        except Exception as e:
            # Log error but don't fail entire search
            print(f"Error converting entity {entity_type} to search result: {e}")
            return None
    
    def _generate_facets(self, search_query: str) -> Dict[str, Any]:
        """Generate facet counts for filtering."""
        facets = {
            'entity_types': {},
            'fiscal_years': [],
            'ministries': [],
            'states': [],
        }
        
        # Count results per entity type
        for entity_type in self.ENTITY_MODELS.keys():
            _, count = self._search_entity(
                model=self.ENTITY_MODELS[entity_type],
                entity_type=entity_type,
                search_query=search_query,
                page=1,
                page_size=1,  # We only need count
            )
            if count > 0:
                facets['entity_types'][entity_type] = count
        
        # TODO: Add facet counts for fiscal years, ministries, states
        # This would require additional queries with GROUP BY
        
        return facets
    
    def suggest(self, query: str, limit: int = 5) -> List[str]:
        """
        Get search suggestions/autocomplete for a partial query.
        
        Uses prefix matching on titles and names.
        """
        if len(query) < 2:
            return []
        
        suggestions = set()
        
        # Search across all entity types for prefix matches
        for entity_type, model in self.ENTITY_MODELS.items():
            title_field = 'title' if hasattr(model, 'title') else 'name'
            if not hasattr(model, title_field):
                continue
            
            stmt = select(getattr(model, title_field)).where(
                getattr(model, title_field).ilike(f"{query}%")
            ).limit(limit)
            
            results = self.db.execute(stmt).all()
            for (value,) in results:
                if value:
                    suggestions.add(value)
            
            if len(suggestions) >= limit:
                break
        
        return list(suggestions)[:limit]
