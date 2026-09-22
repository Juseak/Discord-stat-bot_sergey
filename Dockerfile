FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive
ENV PIPER_DATA_DIR=/opt/piper
ENV WHISPER_DIR=/opt/whisper.cpp

RUN apt-get update && apt-get install -y \
    ffmpeg \
    git \
    cmake \
    build-essential \
    python3 \
    python3-pip \
    python3-venv \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# -------------------------
# Whisper.cpp
# -------------------------

RUN git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git /opt/whisper.cpp

RUN cmake -S /opt/whisper.cpp \
    -B /opt/whisper.cpp/build \
    -DCMAKE_BUILD_TYPE=Release

RUN cmake --build /opt/whisper.cpp/build -j2

# Небольшая модель, чтобы Railway не тратил слишком много ресурсов
RUN /opt/whisper.cpp/models/download-ggml-model.sh base

# -------------------------
# Piper TTS
# -------------------------

RUN python3 -m pip install --break-system-packages piper-tts

RUN mkdir -p /opt/piper

RUN python3 -m piper.download_voices \
    --data-dir /opt/piper \
    ru_RU-dmitri-medium

# -------------------------
# Node.js bot
# -------------------------

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN mkdir -p /app/runtime

ENV NODE_ENV=production

CMD ["npm", "start"]
