"""
Pydantic schemas for FiscalYear model.
"""

from datetime import date
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class FiscalYearBase(BaseModel):
    """Base schema for FiscalYear."""

    name: str = Field(..., min_length=7, max_length=9, description="Fiscal year name (e.g., '2024-25')")
    start_date: date
    end_date: date
    is_current: bool = False
    is_active: bool = True


class FiscalYearCreate(FiscalYearBase):
    """Schema for creating a FiscalYear."""

    pass


class FiscalYearUpdate(BaseModel):
    """Schema for updating a FiscalYear."""

    name: Optional[str] = Field(None, min_length=7, max_length=9)
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    is_current: Optional[bool] = None
    is_active: Optional[bool] = None


class FiscalYearResponse(FiscalYearBase):
    """Schema for FiscalYear response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    display_name: str
