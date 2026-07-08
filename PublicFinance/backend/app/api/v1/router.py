"""
API v1 Router - Aggregates all API v1 endpoints.

All routes for API version 1 are included here.
"""

from fastapi import APIRouter

# Import route modules
from app.api.v1.routes import search

api_router = APIRouter()

# Health check (defined in main.py, but can be moved here)
# api_router.include_router(health.router)

# Authentication routes
# api_router.include_router(auth.router, prefix="/auth", tags=["Authentication"])

# Budget routes
# api_router.include_router(budgets.router, prefix="/budgets", tags=["Budgets"])

# Revenue routes
# api_router.include_router(revenue.router, prefix="/revenue", tags=["Revenue"])

# Scheme routes
# api_router.include_router(schemes.router, prefix="/schemes", tags=["Schemes"])

# Search routes
api_router.include_router(search.router, prefix="/search", tags=["Search"])

# Entity routes
# api_router.include_router(ministries.router, prefix="/ministries", tags=["Ministries"])
# api_router.include_router(states.router, prefix="/states", tags=["States"])
# api_router.include_router(fiscal_years.router, prefix="/fiscal-years", tags=["Fiscal Years"])

# Document routes
# api_router.include_router(documents.router, prefix="/documents", tags=["Documents"])

# Export routes
# api_router.include_router(exports.router, prefix="/exports", tags=["Exports"])

# User routes
# api_router.include_router(users.router, prefix="/users", tags=["Users"])
