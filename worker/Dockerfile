FROM public.ecr.aws/lambda/python:3.12

COPY worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
ENV U2NET_HOME=/opt/rembg-models
ENV CLASSIFICATION_PROMPT_PATH=/prompts/clothing_classifier_prompt.txt
RUN mkdir -p ${U2NET_HOME} && python -c "from rembg import new_session; new_session('u2net')"

COPY worker/app.py .
COPY worker/prompts/clothing_classifier_prompt.txt /prompts/clothing_classifier_prompt.txt
CMD ["app.handler"]
