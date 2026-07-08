FROM python:3.12-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY worker/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
ENV U2NET_HOME=/opt/rembg-models
ENV CLASSIFICATION_PROMPT_PATH=/prompts/clothing_classifier_prompt.txt
RUN mkdir -p ${U2NET_HOME} && python -c "from rembg import new_session; new_session('isnet-general-use'); new_session('u2net')"

COPY worker/app.py ./
COPY worker/prompts/clothing_classifier_prompt.txt /prompts/clothing_classifier_prompt.txt
EXPOSE 8080
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "1", "--timeout", "180", "app:http_app"]
