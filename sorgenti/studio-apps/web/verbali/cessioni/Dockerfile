FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-writer fonts-liberation default-jre-headless tesseract-ocr tesseract-ocr-ita tesseract-ocr-eng poppler-utils curl unzip ca-certificates && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir python-docx==1.2.0 pypdf==6.1.1
COPY verapdf-install.xml /tmp/verapdf-install.xml
RUN curl -fL --retry 3 https://software.verapdf.org/releases/verapdf-installer.zip -o /tmp/verapdf.zip && unzip -q /tmp/verapdf.zip -d /tmp/vera && java -jar /tmp/vera/*/verapdf-izpack-installer-*.jar /tmp/verapdf-install.xml && rm -rf /tmp/vera /tmp/verapdf.zip && /opt/verapdf/verapdf --version
WORKDIR /app
COPY domain.py extract.py documents.py server.py clause-defaults.json ./
ENV PYTHONUNBUFFERED=1
CMD ["python", "server.py"]
