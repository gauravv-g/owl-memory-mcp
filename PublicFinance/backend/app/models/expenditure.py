"""
Expenditure models for tracking government spending.
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
    from app.models.ministry import Ministry
    from app.models.state import State


class ExpenditureCategory(Base, TimestampMixin):
    """
    Master table for expenditure categories.
    
    Examples:
        - Plan Expenditure
        - Non-Plan Expenditure
        - Capital Expenditure
        - Revenue Expenditure
        - Defense
        - Subsidies
    """

    __tablename__ = "expenditure_categories"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Hierarchy
    parent_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("expenditure_categories.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    
    category_type: Mapped[str] = mapped_column(
        String(50),
        default="revenue",  # revenue, capital, plan, non_plan
    )
    
    is_active: Mapped[bool] = mapped_column(default=True, index=True)
    display_order: Mapped[int] = mapped_column(default=0)

    # Relationships
    parent: Mapped[Optional["ExpenditureCategory"]] = relationship(
        "ExpenditureCategory",
        remote_side=[id],
        back_populates="children",
    )
    children: Mapped[list["ExpenditureCategory"]] = relationship(
        "ExpenditureCategory",
        back_populates="parent",
    )
    expenditures: Mapped[list["Expenditure"]] = relationship(
        "Expenditure",
        back_populates="category",
    )

    def __repr__(self) -> str:
        return f"<ExpenditureCategory {self.name} ({self.code})>"


class Expenditure(Base, TimestampMixin):
    """
    Actual expenditure data.
    
    Tracks government spending by ministry, category, fiscal year, and state.
    """

    __tablename__ = "expenditures"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    # Foreign keys
    fiscal_year_id: Mapped[int] = mapped_column(
        ForeignKey("fiscal_years.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    ministry_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("ministries.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    category_id: Mapped[int] = mapped_column(
        ForeignKey("expenditure_categories.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    state_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("states.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    
    # Expenditure amounts
    budget_estimate: Mapped[Decimal] = mapped_column(
        DECIMAL(20, 2),
        default=Decimal("0.00"),
    )
    revised_estimate: Mapped[Optional[Decimal]] = mapped_column(DECIMAL(20, 2))
    actual_expenditure: Mapped[Decimal] = mapped_column(
        DECIMAL(20, 2),
        default=Decimal("0.00"),
    )
    
    # Metadata
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    expenditure_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_audited: Mapped[bool] = mapped_column(default=False, index=True)
    
    # Relationships
    fiscal_year: Mapped["FiscalYear"] = relationship("FiscalYear", back_populates="expenditures")
    ministry: Mapped[Optional["Ministry"]] = relationship("Ministry", back_populates="expenditures")
    category: Mapped["ExpenditureCategory"] = relationship(
        "ExpenditureCategory",
        back_populates="expenditures",
    )
    state: Mapped[Optional["State"]] = relationship("State", back_populates="expenditures")

    def __repr__(self) -> str:
        return f"<Expenditure {self.category.code} {self.fiscal_year.name}: {self.actual_expenditure}>"

    @property
    def utilization_percentage(self) -> Optional[float]:
        """Calculate expenditure against budget estimate."""
        if self.budget_estimate and self.budget_estimate > 0:
            return float((self.actual_expenditure / self.budget_estimate) * 100)
        return None
