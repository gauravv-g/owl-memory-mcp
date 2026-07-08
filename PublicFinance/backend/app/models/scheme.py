"""
Scheme models for government welfare schemes and programs.
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
    from app.models.ministry import Ministry
    from app.models.state import State


class Scheme(Base, TimestampMixin):
    """
    Represents a government welfare scheme or program.
    
    Examples:
        - Mahatma Gandhi National Rural Employment Guarantee Act (MGNREGA)
        - Pradhan Mantri Awas Yojana (PMAY)
        - Ayushman Bharat
    """

    __tablename__ = "schemes"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    # Basic info
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    short_name: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Classification
    category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    sub_category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    sector: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    
    # Foreign keys
    ministry_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("ministries.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    
    # Timeline
    launch_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    end_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    is_active: Mapped[bool] = mapped_column(default=True, index=True)
    
    # Coverage
    is_central: Mapped[bool] = mapped_column(default=True)  # Central vs State scheme
    is_state_specific: Mapped[bool] = mapped_column(default=False)
    
    # Relationships
    ministry: Mapped[Optional["Ministry"]] = relationship("Ministry", back_populates="schemes")
    beneficiaries: Mapped[list["SchemeBeneficiary"]] = relationship(
        "SchemeBeneficiary",
        back_populates="scheme",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<Scheme {self.name} ({self.code})>"


class SchemeBeneficiary(Base, TimestampMixin):
    """
    Tracks beneficiary data for a scheme by state/district.
    
    Stores aggregated counts and amounts for privacy compliance.
    """

    __tablename__ = "scheme_beneficiaries"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    scheme_id: Mapped[int] = mapped_column(
        ForeignKey("schemes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    
    # Geographic scope
    state_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("states.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    district_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("districts.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    
    # Beneficiary data (aggregated)
    beneficiary_count: Mapped[int] = mapped_column(default=0)
    amount_disbursed: Mapped[Decimal] = mapped_column(
        DECIMAL(20, 2),
        default=Decimal("0.00"),
    )
    
    # Time period
    fiscal_year: Mapped[Optional[str]] = mapped_column(String(9), nullable=True, index=True)
    reporting_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Relationships
    scheme: Mapped["Scheme"] = relationship("Scheme", back_populates="beneficiaries")

    def __repr__(self) -> str:
        return f"<SchemeBeneficiary {self.scheme.code} - {self.beneficiary_count} beneficiaries>"
