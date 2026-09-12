from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
import torch
from hydra import compose, initialize_config_dir
from hydra.core.global_hydra import GlobalHydra
from omegaconf import open_dict
from PIL import Image
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor
from torchvision.transforms.functional import to_tensor

from cutie.inference.inference_core import InferenceCore
from cutie.model.cutie import CUTIE


def main() -> None:
    parser = argparse.ArgumentParser(description="Run SAM2 first-frame selection and Cutie propagation.")
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--x", type=float, required=True)
    parser.add_argument("--y", type=float, required=True)
    parser.add_argument("--sam2-checkpoint", type=Path, required=True)
    parser.add_argument("--cutie-root", type=Path, required=True)
    parser.add_argument("--cutie-weights", type=Path, required=True)
    parser.add_argument("--max-frames", type=int, default=0)
    args = parser.parse_args()

    device = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"
    args.output_dir.mkdir(parents=True, exist_ok=True)
    frames_dir = args.output_dir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(args.source))
    frames: list[np.ndarray] = []
    while True:
        ok, frame = cap.read()
        if not ok or (args.max_frames > 0 and len(frames) >= args.max_frames):
            break
        frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    cap.release()
    if not frames:
        raise RuntimeError("source video has no decodable frames")

    sam2 = build_sam2("configs/sam2/sam2_hiera_t.yaml", str(args.sam2_checkpoint), device=device, apply_postprocessing=False)
    predictor = SAM2ImagePredictor(sam2)
    predictor.set_image(frames[0])
    height, width = frames[0].shape[:2]
    points = np.array([[args.x * width, args.y * height]], dtype=np.float32)
    labels = np.array([1], dtype=np.int32)
    with torch.inference_mode():
        masks, scores, _ = predictor.predict(point_coords=points, point_labels=labels, multimask_output=True)
    first_mask = masks[int(np.argmax(scores))].astype(np.uint8)

    # SAM2 initializes Hydra at import time; Cutie has its own config root.
    # Reset only the process-local Hydra registry before switching projects.
    GlobalHydra.instance().clear()
    with initialize_config_dir(version_base="1.3.2", config_dir=str(args.cutie_root / "cutie/config")):
        cfg = compose(config_name="eval_config", overrides=["dataset=generic", "max_internal_size=240", "amp=false", "use_long_term=true", "mem_every=5"])
    with open_dict(cfg):
        cfg.weights = str(args.cutie_weights)
    cutie = CUTIE(cfg).to(device).eval()
    cutie.load_weights(torch.load(args.cutie_weights, map_location="cpu"))
    processor = InferenceCore(cutie, cfg=cfg)
    processor.max_internal_size = 240
    mask = torch.from_numpy(first_mask.astype(np.int64)).to(device)
    objects = [1]
    foreground_counts: list[int] = []
    with torch.inference_mode():
        for index, frame in enumerate(frames):
            image = to_tensor(Image.fromarray(frame)).to(device).float()
            output = processor.step(image, mask, objects=objects) if index == 0 else processor.step(image)
            mask = processor.output_prob_to_mask(output)
            mask_cpu = mask.cpu().numpy().astype(np.uint8)
            output_path = frames_dir / f"{index:06d}.png"
            Image.fromarray((mask_cpu > 0).astype(np.uint8) * 255).save(output_path)
            foreground_counts.append(int((mask_cpu > 0).sum()))

    summary = {
        "status": "ok",
        "device": device,
        "frames": len(frames),
        "width": width,
        "height": height,
        "sam2_score": float(scores.max()),
        "mask_dir": str(frames_dir),
        "foreground_pixels": foreground_counts,
        "empty_frame_indices": [index for index, count in enumerate(foreground_counts) if count == 0],
        "tracking_quality": "fail" if any(count == 0 for count in foreground_counts) else "pass",
        "preserve_original_pixels": True,
    }
    (args.output_dir / "tracking-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
