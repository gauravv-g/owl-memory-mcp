"""
Document model for storing metadata about budget documents and reports.
"""

from datetime import date
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Date, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.fiscal_year import FiscalYear
    from app.models.ministry import Ministry
    from app.models.state import State


class Document(Base, TimestampMixin):
    """
    Represents a government budget document or report.
    
    Examples:
        - Union Budget Speech
        - Annual Financial Statement
        - Demand for Grants
        - Economic Survey
        - CAG Audit Report
    """

    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    # Basic info
    title: Mapped[str] = mapped_column(String(500), nullable=False, index=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    document_type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )  # budget_speech, statement, report, circular, etc.
    
    # Foreign keys
    fiscal_year_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("fiscal_years.id", ondelete="SET NULL"),
        nullable=True,
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
    
    # File info
    file_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[Optional[int]] = mapped_column(nullable=True)  # in bytes
    mime_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    checksum: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)  # SHA-256
    
    # Metadata
    publication_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True, index=True)
    language: Mapped[str] = mapped_column(String(10), default="en")  # ISO 639-1
    page_count: Mapped[Optional[int]] = mapped_column(nullable=True)
    
    # Status
    is_public: Mapped[bool] = mapped_column(default=True, index=True)
    is_verified: Mapped[bool] = mapped_column(default=False, index=True)
    download_count: Mapped[int] = mapped_column(default=0)
    
    # Relationships
    fiscal_year: Mapped[Optional["FiscalYear"]] = relationship(
        "FiscalYear",
        back_populates="documents",
    )
    ministry: Mapped[Optional["Ministry"]] = relationship("Ministry", back_populates="documents")
    state: Mapped[Optional["State"]] = relationship("State", back_populates="documents")

    def __repr__(self) -> str:
        return f"<Document {self.title} ({self.document_type})>"
