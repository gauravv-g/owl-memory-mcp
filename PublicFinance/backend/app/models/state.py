"""
State model for geographic divisions in India.
"""

from typing import TYPE_CHECKING, Optional

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.budget import Budget
    from app.models.expenditure import Expenditure
    from app.models.district import District


class State(Base, TimestampMixin):
    """
    Represents a state or union territory in India.
    
    Examples:
        - Maharashtra
        - Karnataka
        - Delhi (UT)
        - Puducherry (UT)
    """

    __tablename__ = "states"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    short_name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    code: Mapped[str] = mapped_column(String(10), unique=True, nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(20), default="state")  # state or union_territory
    capital: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    is_active: Mapped[bool] = mapped_column(default=True, index=True)
    display_order: Mapped[int] = mapped_column(default=0)

    # Relationships
    districts: Mapped[list["District"]] = relationship(
        "District",
        back_populates="state",
        cascade="all, delete-orphan",
    )
    budgets: Mapped[list["Budget"]] = relationship("Budget", back_populates="state")
    expenditures: Mapped[list["Expenditure"]] = relationship("Expenditure", back_populates="state")
    revenues: Mapped[list["Revenue"]] = relationship("Revenue", back_populates="state")
    documents: Mapped[list["Document"]] = relationship("Document", back_populates="state")

    def __repr__(self) -> str:
        return f"<State {self.name} ({self.code})>"
