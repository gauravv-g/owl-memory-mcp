"""
Base model classes and mixins for all database models.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import Column, DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """
    Base class for all SQLAlchemy models.
    
    All models should inherit from this class to ensure consistent
    behavior and metadata handling.
    """

    def to_dict(self) -> dict[str, Any]:
        """Convert model instance to dictionary."""
        return {
            column.name: getattr(self, column.name)
            for column in self.__table__.columns
        }


class TimestampMixin:
    """
    Mixin that adds created_at and updated_at timestamp columns.
    
    This mixin should be inherited along with Base for models that
    need automatic timestamp tracking.
    """

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
