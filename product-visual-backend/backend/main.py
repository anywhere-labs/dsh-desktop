from __future__ import annotations

from backend.app.core.runtime_bootstrap import configure_project_runtime

configure_project_runtime()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.api import routes_account, routes_attribution, routes_benchmark, routes_brand_data, routes_brand_strategy, routes_config, routes_dashboard, routes_edit, routes_external, routes_health, routes_hotspot, routes_live_clips, routes_liveclip_feedback, routes_material, routes_product_visual, routes_publish, routes_report, routes_script, routes_tasks, routes_topic, routes_trace, routes_video_generation, routes_video_matting
from backend.app.core.config import PROJECT_NAME, VERSION
from backend.app.core.customer_mode import liveclip_customer_route_whitelist_middleware
from backend.app.core.database import init_db
from backend.app.core.errors import unhandled_exception_handler
from backend.app.core.paths import ensure_dirs
from backend.app.services.api_settings_service import load_env_file

app = FastAPI(title=PROJECT_NAME, version=VERSION)
app.middleware("http")(liveclip_customer_route_whitelist_middleware)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"], allow_credentials=True)
app.add_exception_handler(Exception, unhandled_exception_handler)


@app.on_event("startup")
def startup() -> None:
    ensure_dirs()
    load_env_file()
    init_db()


for router in [
    routes_health.router,
    routes_account.router,
    routes_benchmark.router,
    routes_brand_strategy.router,
    routes_brand_data.router,
    routes_topic.router,
    routes_script.router,
    routes_material.router,
    routes_live_clips.router,
    routes_liveclip_feedback.router,
    routes_product_visual.router,
    routes_config.router,
    routes_edit.router,
    routes_publish.router,
    routes_report.router,
    routes_tasks.router,
    routes_attribution.router,
    routes_hotspot.router,
    routes_trace.router,
    routes_dashboard.router,
    routes_external.router,
    routes_video_generation.router,
    routes_video_matting.router,
]:
    app.include_router(router)
