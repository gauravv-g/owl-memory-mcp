"""
Public Finance Intelligence Platform - Backend Application

FastAPI backend serving the Public Finance Intelligence Platform.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from contextlib import asynccontextmanager

from app.core.config import settings
from app.api.v1.router import api_router
from app.db.session import init_db, close_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events."""
    # Startup
    await init_db()
    yield
    # Shutdown
    await close_db()


def create_application() -> FastAPI:
    """Create and configure the FastAPI application."""
    
    application = FastAPI(
        title=settings.PROJECT_NAME,
        description="API for Public Finance Intelligence Platform",
        version="1.0.0",
        docs_url="/api/v1/docs",
        redoc_url="/api/v1/redoc",
        openapi_url="/api/v1/openapi.json",
        lifespan=lifespan,
    )

    # CORS middleware
    if settings.BACKEND_CORS_ORIGINS:
        application.add_middleware(
            CORSMiddleware,
            allow_origins=[str(origin) for origin in settings.BACKEND_CORS_ORIGINS],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    # GZip compression
    application.add_middleware(GZipMiddleware, minimum_size=1000)

    # Include API router
    application.include_router(api_router, prefix=settings.API_V1_PREFIX)

    return application


# Create application instance
app = create_application()


@app.get("/health", tags=["Health"])
async def health_check():
    """Basic health check endpoint."""
    return {"status": "healthy"}


@app.get("/health/ready", tags=["Health"])
async def readiness_check():
    """Readiness check including dependencies."""
    # TODO: Add database and redis connectivity checks
    return {"status": "ready"}


@app.get("/health/live", tags=["Health"])
async def liveness_check():
    """Liveness check for Kubernetes."""
    return {"status": "alive"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True if settings.ENVIRONMENT == "development" else False,
    )
