"""
Unit tests for Search functionality.

Tests cover search service, API endpoints, and edge cases.
"""

import pytest
from unittest.mock import Mock, MagicMock, patch
from sqlalchemy.orm import Session

from app.services.search import SearchService
from app.schemas.search import SearchQuery, SearchResult


class TestSearchService:
    """Test cases for SearchService."""

    @pytest.fixture
    def mock_db(self):
        """Create a mock database session."""
        return Mock(spec=Session)

    @pytest.fixture
    def search_service(self, mock_db):
        """Create SearchService instance with mock DB."""
        return SearchService(db=mock_db)

    def test_normalize_query_basic(self, search_service):
        """Test query normalization with basic input."""
        result = search_service._normalize_query("education budget")
        assert "education" in result
        assert "budget" in result
        assert len(result) == 2

    def test_normalize_query_removes_special_chars(self, search_service):
        """Test that special characters are removed."""
        result = search_service._normalize_query("education@#$ budget!!!")
        assert "education" in result
        assert "budget" in result

    def test_normalize_query_removes_short_tokens(self, search_service):
        """Test that tokens shorter than 2 chars are removed."""
        result = search_service._normalize_query("a an the education")
        assert "education" in result
        assert "a" not in result
        assert "an" in result  # 2 chars
        assert "the" in result

    def test_normalize_query_empty(self, search_service):
        """Test normalization of empty/special-only string."""
        result = search_service._normalize_query("@#$%")
        assert result == []

    def test_search_basic(self, search_service, mock_db):
        """Test basic search functionality."""
        # Mock database responses
        mock_db.execute.return_value.scalar.return_value = 0  # No results
        
        query = SearchQuery(q="test")
        result = search_service.search(query)
        
        assert result.query == "test"
        assert result.total_results == 0
        assert result.results == []
        assert result.page == 1
        assert result.page_size == 20
        assert result.search_time_ms >= 0

    def test_search_with_filters(self, search_service, mock_db):
        """Test search with filters applied."""
        mock_db.execute.return_value.scalar.return_value = 0
        
        query = SearchQuery(
            q="education",
            fiscal_year_id=1,
            ministry_id=5,
            state_id=10,
            entity_type="budget"
        )
        result = search_service.search(query)
        
        assert result.query == "education"
        # Should only search budget entity type
        assert result.total_results == 0

    def test_search_pagination(self, search_service, mock_db):
        """Test search pagination parameters."""
        mock_db.execute.return_value.scalar.return_value = 0
        
        query = SearchQuery(
            q="test",
            page=3,
            page_size=50
        )
        result = search_service.search(query)
        
        assert result.page == 3
        assert result.page_size == 50

    def test_suggest_basic(self, search_service, mock_db):
        """Test search suggestions."""
        # Mock database to return some suggestions
        mock_result = Mock()
        mock_result.all.return_value = [("Education",), ("Education Ministry",)]
        mock_db.execute.return_value = mock_result
        
        result = search_service.suggest(query="edu", limit=5)
        
        assert isinstance(result, list)
        # May be empty if no matches in mock, but should not error

    def test_suggest_short_query(self, search_service):
        """Test that suggestions require minimum 2 char query."""
        result = search_service.suggest(query="e", limit=5)
        assert result == []

    def test_entity_to_search_result_budget(self, search_service):
        """Test conversion of Budget entity to SearchResult."""
        mock_entity = Mock()
        mock_entity.id = 1
        mock_entity.title = "Education Budget 2024"
        mock_entity.description = "Budget for education sector"
        mock_entity.fiscal_year = None
        mock_entity.fiscal_year_id = 1
        mock_entity.ministry = None
        mock_entity.ministry_id = 5
        mock_entity.state = None
        mock_entity.state_id = 10
        mock_entity.amount = 1000000.00
        mock_entity.head_code = "EDU001"
        
        result = search_service._entity_to_search_result(
            entity=mock_entity,
            entity_type="budget",
            score=0.95
        )
        
        assert result is not None
        assert result.id == 1
        assert result.type == "budget"
        assert result.title == "Education Budget 2024"
        assert result.score == 0.95
        assert result.amount == 1000000.00
        assert result.metadata['head_code'] == "EDU001"

    def test_entity_to_search_result_ministry(self, search_service):
        """Test conversion of Ministry entity to SearchResult."""
        mock_entity = Mock()
        mock_entity.id = 5
        mock_entity.name = "Ministry of Education"
        mock_entity.description = "Responsible for education policy"
        
        result = search_service._entity_to_search_result(
            entity=mock_entity,
            entity_type="ministry",
            score=0.85
        )
        
        assert result is not None
        assert result.id == 5
        assert result.type == "ministry"
        assert result.title == "Ministry of Education"

    def test_entity_to_search_result_handles_exception(self, search_service):
        """Test that exceptions in entity conversion are handled gracefully."""
        mock_entity = Mock()
        # Make getattr fail
        type(mock_entity).id = property(lambda self: (_ for _ in ()).throw(Exception("Test")))
        
        result = search_service._entity_to_search_result(
            entity=mock_entity,
            entity_type="budget",
            score=0.5
        )
        
        assert result is None  # Should return None on error


class TestSearchQuerySchema:
    """Test cases for SearchQuery Pydantic schema."""

    def test_valid_query(self):
        """Test valid search query creation."""
        query = SearchQuery(q="education budget")
        assert query.q == "education budget"
        assert query.page == 1
        assert query.page_size == 20
        assert query.sort_order == "desc"

    def test_query_min_length(self):
        """Test that query requires minimum length."""
        with pytest.raises(Exception):
            SearchQuery(q="")

    def test_query_max_length(self):
        """Test that query has maximum length limit."""
        with pytest.raises(Exception):
            SearchQuery(q="a" * 501)

    def test_invalid_sort_order(self):
        """Test that sort_order must be asc or desc."""
        with pytest.raises(Exception):
            SearchQuery(q="test", sort_order="invalid")

    def test_page_size_limits(self):
        """Test page_size validation."""
        # Too small
        with pytest.raises(Exception):
            SearchQuery(q="test", page_size=0)
        
        # Too large
        with pytest.raises(Exception):
            SearchQuery(q="test", page_size=101)
        
        # Valid
        query = SearchQuery(q="test", page_size=50)
        assert query.page_size == 50


class TestSearchResultSchema:
    """Test cases for SearchResult Pydantic schema."""

    def test_minimal_result(self):
        """Test SearchResult with minimal required fields."""
        result = SearchResult(
            id=1,
            type="budget",
            title="Test Budget",
            score=0.9
        )
        assert result.id == 1
        assert result.type == "budget"
        assert result.title == "Test Budget"
        assert result.score == 0.9
        assert result.description is None
        assert result.metadata == {}

    def test_full_result(self):
        """Test SearchResult with all fields populated."""
        from decimal import Decimal
        
        result = SearchResult(
            id=1,
            type="scheme",
            title="Education Scheme",
            description="A scheme for education",
            score=0.95,
            metadata={"key": "value"},
            fiscal_year="2024-25",
            ministry="Ministry of Education",
            state="Maharashtra",
            amount=Decimal("1000000.00")
        )
        
        assert result.fiscal_year == "2024-25"
        assert result.ministry == "Ministry of Education"
        assert result.state == "Maharashtra"
        assert result.amount == Decimal("1000000.00")

    def test_score_validation(self):
        """Test that score must be non-negative."""
        with pytest.raises(Exception):
            SearchResult(
                id=1,
                type="budget",
                title="Test",
                score=-0.5
            )
