"""
Revenue models for tracking government revenue sources and collections.
"""

from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    DECIMAL,
    Date,
    ForeignKey,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.fiscal_year import FiscalYear
    from app.models.state import State


class RevenueSource(Base, TimestampMixin):
    """
    Master table for revenue source categories.
    
    Examples:
        - Tax Revenue
        - Non-Tax Revenue
        - GST
        - Income Tax
        - Customs Duty
    """

    __tablename__ = "revenue_sources"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Hierarchy
    parent_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("revenue_sources.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    
    source_type: Mapped[str] = mapped_column(
        String(50),
        default="tax",  # tax, non_tax, capital_receipts, borrowings
    )
    
    is_active: Mapped[bool] = mapped_column(default=True, index=True)
    display_order: Mapped[int] = mapped_column(default=0)

    # Relationships
    parent: Mapped[Optional["RevenueSource"]] = relationship(
        "RevenueSource",
        remote_side=[id],
        back_populates="children",
    )
    children: Mapped[list["RevenueSource"]] = relationship(
        "RevenueSource",
        back_populates="parent",
    )
    revenues: Mapped[list["Revenue"]] = relationship("Revenue", back_populates="source")

    def __repr__(self) -> str:
        return f"<RevenueSource {self.name} ({self.code})>"


class Revenue(Base, TimestampMixin):
    """
    Actual revenue collection data.
    
    Tracks revenue collected by source, fiscal year, and optionally by state.
    """

    __tablename__ = "revenues"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    # Foreign keys
    fiscal_year_id: Mapped[int] = mapped_column(
        ForeignKey("fiscal_years.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_id: Mapped[int] = mapped_column(
        ForeignKey("revenue_sources.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    state_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("states.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    
    # Revenue amounts
    budget_estimate: Mapped[Decimal] = mapped_column(
        DECIMAL(20, 2),
        default=Decimal("0.00"),
    )
    revised_estimate: Mapped[Optional[Decimal]] = mapped_column(DECIMAL(20, 2))
    actual_collection: Mapped[Decimal] = mapped_column(
        DECIMAL(20, 2),
        default=Decimal("0.00"),
    )
    
    # Metadata
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    collection_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_audited: Mapped[bool] = mapped_column(default=False, index=True)
    
    # Relationships
    fiscal_year: Mapped["FiscalYear"] = relationship("FiscalYear", back_populates="revenues")
    source: Mapped["RevenueSource"] = relationship("RevenueSource", back_populates="revenues")
    state: Mapped[Optional["State"]] = relationship("State", back_populates="revenues")

    def __repr__(self) -> str:
        return f"<Revenue {self.source.code} {self.fiscal_year.name}: {self.actual_collection}>"

    @property
    def collection_percentage(self) -> Optional[float]:
        """Calculate collection against budget estimate."""
        if self.budget_estimate and self.budget_estimate > 0:
            return float((self.actual_collection / self.budget_estimate) * 100)
        return None
