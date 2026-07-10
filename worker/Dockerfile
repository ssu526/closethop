FROM python:3.12-slim

WORKDIR /app

COPY worker/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
ENV CLASSIFICATION_PROMPT_PATH=/prompts/clothing_classifier_prompt.txt

COPY worker/app.py ./
COPY worker/prompts/clothing_classifier_prompt.txt /prompts/clothing_classifier_prompt.txt
EXPOSE 8080
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "1", "--timeout", "180", "app:http_app"]
