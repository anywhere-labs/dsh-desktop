FROM python:3.12-slim

WORKDIR /app
COPY server/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY server/app.py ./app.py
COPY server/vw_app ./vw_app

ENV VIDEO_WORKBENCH_STATE_DIR=/data/video-workbench
EXPOSE 8080
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
