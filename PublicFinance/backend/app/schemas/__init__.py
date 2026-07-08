"""
Pydantic schemas for API request/response validation.

This module defines all data transfer objects (DTOs) used in the API.
"""

from app.schemas.fiscal_year import FiscalYearCreate, FiscalYearUpdate, FiscalYearResponse
from app.schemas.ministry import MinistryCreate, MinistryUpdate, MinistryResponse
from app.schemas.state import StateCreate, StateUpdate, StateResponse, DistrictCreate, DistrictResponse
from app.schemas.budget import BudgetCreate, BudgetUpdate, BudgetResponse, BudgetAllocationResponse
from app.schemas.search import SearchQuery, SearchResponse, SearchResult

__all__ = [
    # Fiscal Year
    "FiscalYearCreate",
    "FiscalYearUpdate",
    "FiscalYearResponse",
    # Ministry
    "MinistryCreate",
    "MinistryUpdate",
    "MinistryResponse",
    # State
    "StateCreate",
    "StateUpdate",
    "StateResponse",
    "DistrictCreate",
    "DistrictResponse",
    # Budget
    "BudgetCreate",
    "BudgetUpdate",
    "BudgetResponse",
    "BudgetAllocationResponse",
    # Search
    "SearchQuery",
    "SearchResponse",
    "SearchResult",
]
