"""
Pydantic schemas for Budget models.
"""

from decimal import Decimal
from typing import Optional, List

from pydantic import BaseModel, ConfigDict, Field


class BudgetBase(BaseModel):
    """Base schema for Budget."""

    fiscal_year_id: int
    ministry_id: Optional[int] = None
    state_id: Optional[int] = None
    budget_estimate: Decimal = Field(default=Decimal("0.00"), ge=0)
    revised_estimate: Optional[Decimal] = None
    actual_expenditure: Optional[Decimal] = None
    currency: str = "INR"
    notes: Optional[str] = None
    is_finalized: bool = False


class BudgetCreate(BudgetBase):
    """Schema for creating a Budget."""

    pass


class BudgetUpdate(BaseModel):
    """Schema for updating a Budget."""

    fiscal_year_id: Optional[int] = None
    ministry_id: Optional[int] = None
    state_id: Optional[int] = None
    budget_estimate: Optional[Decimal] = Field(None, ge=0)
    revised_estimate: Optional[Decimal] = None
    actual_expenditure: Optional[Decimal] = None
    currency: Optional[str] = None
    notes: Optional[str] = None
    is_finalized: Optional[bool] = None


class BudgetAllocationBase(BaseModel):
    """Base schema for BudgetAllocation."""

    name: str = Field(..., min_length=1, max_length=200)
    code: Optional[str] = Field(None, max_length=50)
    description: Optional[str] = None
    amount: Decimal = Field(default=Decimal("0.00"), ge=0)
    category: Optional[str] = Field(None, max_length=100)
    sub_category: Optional[str] = None
    currency: str = "INR"
    notes: Optional[str] = None


class BudgetAllocationCreate(BudgetAllocationBase):
    """Schema for creating a BudgetAllocation."""

    budget_id: int


class BudgetAllocationResponse(BudgetAllocationBase):
    """Schema for BudgetAllocation response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    budget_id: int


class BudgetResponse(BudgetBase):
    """Schema for Budget response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    utilization_percentage: Optional[float] = None
    allocations: List[BudgetAllocationResponse] = []
