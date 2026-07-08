"""
District model - separate file for clarity.
"""

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.state import State


class District(Base, TimestampMixin):
    """
    Represents a district within a state in India.
    """

    __tablename__ = "districts"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False, index=True)
    
    state_id: Mapped[int] = mapped_column(
        ForeignKey("states.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    
    is_active: Mapped[bool] = mapped_column(default=True, index=True)
    display_order: Mapped[int] = mapped_column(default=0)

    # Relationships
    state: Mapped["State"] = relationship("State", back_populates="districts")

    def __repr__(self) -> str:
        return f"<District {self.name} ({self.state.short_name})>"

    @property
    def full_name(self) -> str:
        """Return full name with state."""
        return f"{self.name}, {self.state.name}"
