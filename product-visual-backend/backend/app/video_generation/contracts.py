from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import StrEnum
from typing import Any


class GenerationMode(StrEnum):
    PIXEL_PRESERVED_BACKGROUND_REPLACEMENT = "PIXEL_PRESERVED_BACKGROUND_REPLACEMENT"


class AssetRole(StrEnum):
    SOURCE_VIDEO = "SOURCE_VIDEO"
    ORIGINAL_AUDIO = "ORIGINAL_AUDIO"
    BACKGROUND_IMAGE = "BACKGROUND_IMAGE"
    BACKGROUND_VIDEO = "BACKGROUND_VIDEO"
    MASK_REFERENCE = "MASK_REFERENCE"


class BackgroundMode(StrEnum):
    UPLOAD = "UPLOAD"
    GENERATED_IMAGE = "GENERATED_IMAGE"
    SOLID_COLOR = "SOLID_COLOR"


@dataclass(frozen=True)
class ReplicaAsset:
    asset_id: str
    role: AssetRole
    uri: str
    mime_type: str
    byte_length: int | None = None
    sha256: str | None = None
    authorized: bool = False


@dataclass(frozen=True)
class ObjectSelection:
    object_id: str
    label: str
    frame_index: int
    x: float
    y: float
    selection_mode: str = "point"


@dataclass(frozen=True)
class OutputSpec:
    width: int = 1080
    height: int = 1920
    frame_rate: int = 30
    format: str = "mp4"


@dataclass(frozen=True)
class ReplicaTaskRequest:
    task_id: str
    source_video: ReplicaAsset
    background: ReplicaAsset | None = None
    background_mode: BackgroundMode = BackgroundMode.UPLOAD
    selections: tuple[ObjectSelection, ...] = ()
    prompt: str = ""
    output: OutputSpec = field(default_factory=OutputSpec)
    confirmed: bool = False
    approval_id: str = ""
    generation_mode: GenerationMode = GenerationMode.PIXEL_PRESERVED_BACKGROUND_REPLACEMENT

    def validate(self) -> list[str]:
        missing: list[str] = []
        if self.generation_mode is not GenerationMode.PIXEL_PRESERVED_BACKGROUND_REPLACEMENT:
            missing.append("unsupported_generation_mode")
        if self.source_video.role is not AssetRole.SOURCE_VIDEO:
            missing.append("source_video_role")
        if not self.source_video.authorized:
            missing.append("source_video_authorization")
        if self.background_mode is BackgroundMode.UPLOAD and self.background is None:
            missing.append("background_asset")
        if self.background is not None and not self.background.authorized:
            missing.append("background_authorization")
        if not self.selections:
            missing.append("object_selections")
        if not any(item.label.lower() == "person" for item in self.selections):
            missing.append("person_selection")
        if not self.confirmed:
            missing.append("operator_confirmation")
        if not self.approval_id.strip():
            missing.append("approval_id")
        if self.output.width <= 0 or self.output.height <= 0:
            missing.append("output_dimensions")
        return missing


@dataclass
class VideoReplicaTask:
    task_id: str
    status: str = "DRAFT"
    source_asset_id: str = ""
    background_asset_id: str = ""
    selected_object_ids: list[str] = field(default_factory=list)
    current_node: str = ""
    failure_reason: str = ""
    qa_report_id: str = ""
    artifacts: list[dict[str, Any]] = field(default_factory=list)
    history: list[dict[str, str]] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)
