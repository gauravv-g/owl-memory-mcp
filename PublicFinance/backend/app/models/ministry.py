"""
Ministry model for tracking government ministries and departments.
"""

from typing import TYPE_CHECKING, Optional

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.budget import Budget
    from app.models.scheme import Scheme


class Ministry(Base, TimestampMixin):
    """
    Represents a government ministry or department.
    
    Examples:
        - Ministry of Finance
        - Ministry of Health and Family Welfare
        - Ministry of Education
    """

    __tablename__ = "ministries"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(200), unique=True, nullable=False, index=True)
    short_name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False, index=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Hierarchy
    parent_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("ministries.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    
    is_active: Mapped[bool] = mapped_column(default=True, index=True)
    display_order: Mapped[int] = mapped_column(default=0)

    # Relationships
    parent: Mapped[Optional["Ministry"]] = relationship(
        "Ministry",
        remote_side=[id],
        back_populates="children",
    )
    children: Mapped[list["Ministry"]] = relationship(
        "Ministry",
        back_populates="parent",
    )
    budgets: Mapped[list["Budget"]] = relationship("Budget", back_populates="ministry")
    schemes: Mapped[list["Scheme"]] = relationship("Scheme", back_populates="ministry")
    expenditures: Mapped[list["Expenditure"]] = relationship("Expenditure", back_populates="ministry")
    documents: Mapped[list["Document"]] = relationship("Document", back_populates="ministry")

    def __repr__(self) -> str:
        return f"<Ministry {self.name} ({self.code})>"

    @property
    def full_name(self) -> str:
        """Return full hierarchical name."""
        if self.parent:
            return f"{self.parent.name} > {self.name}"
        return self.name
