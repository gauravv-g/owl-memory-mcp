"""
Pydantic schemas for State and District models.
"""

from typing import Optional, List

from pydantic import BaseModel, ConfigDict, Field


class StateBase(BaseModel):
    """Base schema for State."""

    name: str = Field(..., min_length=1, max_length=100)
    short_name: str = Field(..., min_length=1, max_length=50)
    code: str = Field(..., min_length=1, max_length=10)
    type: str = "state"  # state or union_territory
    capital: Optional[str] = None
    description: Optional[str] = None
    is_active: bool = True
    display_order: int = 0


class StateCreate(StateBase):
    """Schema for creating a State."""

    pass


class StateUpdate(BaseModel):
    """Schema for updating a State."""

    name: Optional[str] = Field(None, min_length=1, max_length=100)
    short_name: Optional[str] = Field(None, min_length=1, max_length=50)
    code: Optional[str] = Field(None, min_length=1, max_length=10)
    type: Optional[str] = None
    capital: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None
    display_order: Optional[int] = None


class StateResponse(StateBase):
    """Schema for State response."""

    model_config = ConfigDict(from_attributes=True)

    id: int


class DistrictBase(BaseModel):
    """Base schema for District."""

    name: str = Field(..., min_length=1, max_length=100)
    code: str = Field(..., min_length=1, max_length=20)
    state_id: int
    is_active: bool = True
    display_order: int = 0


class DistrictCreate(DistrictBase):
    """Schema for creating a District."""

    pass


class DistrictResponse(DistrictBase):
    """Schema for District response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    state: StateResponse
