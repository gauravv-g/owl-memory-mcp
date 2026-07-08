"""
Fiscal Year model for tracking financial years in India.

India's fiscal year runs from April 1 to March 31.
"""

from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.budget import Budget
    from app.models.revenue import Revenue
    from app.models.expenditure import Expenditure


class FiscalYear(Base, TimestampMixin):
    """
    Represents a fiscal year (April 1 - March 31).
    
    Example: FY 2024-25 means April 1, 2024 to March 31, 2025
    """

    __tablename__ = "fiscal_years"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(9), unique=True, index=True, nullable=False)
    start_date: Mapped[date] = mapped_column(nullable=False, index=True)
    end_date: Mapped[date] = mapped_column(nullable=False, index=True)
    is_current: Mapped[bool] = mapped_column(default=False, index=True)
    is_active: Mapped[bool] = mapped_column(default=True, index=True)

    # Relationships
    budgets: Mapped[list["Budget"]] = relationship("Budget", back_populates="fiscal_year")
    revenues: Mapped[list["Revenue"]] = relationship("Revenue", back_populates="fiscal_year")
    expenditures: Mapped[list["Expenditure"]] = relationship("Expenditure", back_populates="fiscal_year")
    documents: Mapped[list["Document"]] = relationship("Document", back_populates="fiscal_year")

    __table_args__ = (
        UniqueConstraint("start_date", "end_date", name="uq_fiscal_year_dates"),
    )

    def __repr__(self) -> str:
        return f"<FiscalYear {self.name} ({self.start_date} to {self.end_date})>"

    @property
    def display_name(self) -> str:
        """Return human-readable fiscal year name."""
        return f"FY {self.name}"

    @classmethod
    def get_fiscal_year_name(cls, year: int) -> str:
        """
        Generate fiscal year name from starting year.
        
        Args:
            year: Starting year (e.g., 2024)
            
        Returns:
            Fiscal year name (e.g., "2024-25")
        """
        next_year = (year % 100) + 1
        return f"{year}-{next_year:02d}"
