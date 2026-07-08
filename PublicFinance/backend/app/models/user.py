"""
User model for authentication and user management.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class User(Base, TimestampMixin):
    """
    Represents a platform user.
    
    Supports multiple user types:
    - Citizens (general public)
    - Researchers/Academicians
    - Journalists
    - Government Officials
    - Administrators
    """

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    # Authentication
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    
    # Profile
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    
    # User type and role
    user_type: Mapped[str] = mapped_column(
        String(50),
        default="citizen",  # citizen, researcher, journalist, official, admin
        index=True,
    )
    role: Mapped[str] = mapped_column(String(50), default="user")  # user, moderator, admin
    
    # Preferences
    preferred_language: Mapped[str] = mapped_column(String(10), default="en")  # ISO 639-1
    timezone: Mapped[str] = mapped_column(String(50), default="Asia/Kolkata")
    
    # Status
    is_active: Mapped[bool] = mapped_column(default=True, index=True)
    is_verified: Mapped[bool] = mapped_column(default=False, index=True)
    is_superuser: Mapped[bool] = mapped_column(default=False)
    
    # Tracking
    last_login: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    login_count: Mapped[int] = mapped_column(default=0)
    
    # Additional info
    bio: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    organization: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    def __repr__(self) -> str:
        return f"<User {self.email} ({self.user_type})>"

    @property
    def is_authenticated(self) -> bool:
        """Check if user is authenticated."""
        return self.is_active and self.is_verified

    @property
    def display_name(self) -> str:
        """Return display name for the user."""
        return self.full_name or self.email.split("@")[0]
