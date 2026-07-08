"""
Pydantic schemas for Ministry model.
"""

from typing import Optional, List

from pydantic import BaseModel, ConfigDict, Field


class MinistryBase(BaseModel):
    """Base schema for Ministry."""

    name: str = Field(..., min_length=1, max_length=200, description="Full ministry name")
    short_name: str = Field(..., min_length=1, max_length=50)
    code: str = Field(..., min_length=1, max_length=20)
    description: Optional[str] = None
    parent_id: Optional[int] = None
    is_active: bool = True
    display_order: int = 0


class MinistryCreate(MinistryBase):
    """Schema for creating a Ministry."""

    pass


class MinistryUpdate(BaseModel):
    """Schema for updating a Ministry."""

    name: Optional[str] = Field(None, min_length=1, max_length=200)
    short_name: Optional[str] = Field(None, min_length=1, max_length=50)
    code: Optional[str] = Field(None, min_length=1, max_length=20)
    description: Optional[str] = None
    parent_id: Optional[int] = None
    is_active: Optional[bool] = None
    display_order: Optional[int] = None


class MinistryResponse(MinistryBase):
    """Schema for Ministry response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    children: List["MinistryResponse"] = []


# Update forward reference
MinistryResponse.model_rebuild()
