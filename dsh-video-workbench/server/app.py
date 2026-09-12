"""Compatibility entrypoint. The implementation lives in vw_app modules."""
from vw_app.api import create_app
from vw_app.providers import LibTvCliAdapter, extract_output_url

app = create_app()

__all__ = ["app", "create_app", "extract_output_url", "LibTvCliAdapter"]
