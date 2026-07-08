"""
Budget models for tracking government budgets and allocations.
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
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.fiscal_year import FiscalYear
    from app.models.ministry import Ministry
    from app.models.state import State


class Budget(Base, TimestampMixin):
    """
    Represents a budget entry for a ministry/state in a fiscal year.
    
    Tracks the total budget allocated to a ministry or state for a given
    fiscal year, including revised estimates and actual expenditures.
    """

    __tablename__ = "budgets"

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
    state_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("states.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    
    # Budget amounts (in INR - Indian Rupees)
    budget_estimate: Mapped[Decimal] = mapped_column(
        DECIMAL(20, 2),
        nullable=False,
        default=Decimal("0.00"),
    )
    revised_estimate: Mapped[Optional[Decimal]] = mapped_column(
        DECIMAL(20, 2),
        nullable=True,
    )
    actual_expenditure: Mapped[Optional[Decimal]] = mapped_column(
        DECIMAL(20, 2),
        nullable=True,
    )
    
    # Metadata
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_finalized: Mapped[bool] = mapped_column(default=False, index=True)
    
    # Relationships
    fiscal_year: Mapped["FiscalYear"] = relationship("FiscalYear", back_populates="budgets")
    ministry: Mapped[Optional["Ministry"]] = relationship("Ministry", back_populates="budgets")
    state: Mapped[Optional["State"]] = relationship("State", back_populates="budgets")
    allocations: Mapped[list["BudgetAllocation"]] = relationship(
        "BudgetAllocation",
        back_populates="budget",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        # Ensure unique budget per fiscal year + ministry/state combination
        UniqueConstraint(
            "fiscal_year_id",
            "ministry_id",
            "state_id",
            name="uq_budget_fiscal_ministry_state",
        ),
    )

    def __repr__(self) -> str:
        return f"<Budget {self.fiscal_year.name} - {self.ministry.name if self.ministry else self.state.name}>"

    @property
    def utilization_percentage(self) -> Optional[float]:
        """Calculate budget utilization percentage."""
        if self.budget_estimate and self.actual_expenditure:
            if self.budget_estimate > 0:
                return float((self.actual_expenditure / self.budget_estimate) * 100)
        return None


class BudgetAllocation(Base, TimestampMixin):
    """
    Represents a specific allocation within a budget.
    
    Breaks down budgets into specific categories, schemes, or programs.
    """

    __tablename__ = "budget_allocations"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    budget_id: Mapped[int] = mapped_column(
        ForeignKey("budgets.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    amount: Mapped[Decimal] = mapped_column(
        DECIMAL(20, 2),
        nullable=False,
        default=Decimal("0.00"),
    )
    
    category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    sub_category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Relationships
    budget: Mapped["Budget"] = relationship("Budget", back_populates="allocations")

    def __repr__(self) -> str:
        return f"<BudgetAllocation {self.name} ({self.amount})>"
