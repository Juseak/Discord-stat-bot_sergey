const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  AttachmentBuilder,
  ActivityType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const {
  joinVoiceChannel,
  VoiceConnectionStatus,
  EndBehaviorType,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType,
} = require("@discordjs/voice");

const prism = require("prism-media");
const { GoogleGenAI } = require("@google/genai");
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// ============================================================
// CONFIG
// ============================================================

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!DISCORD_TOKEN) {
  console.error("ERROR: DISCORD_TOKEN не найден");
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error("ERROR: CLIENT_ID не найден");
  process.exit(1);
}

if (!GUILD_ID) {
  console.error("ERROR: GUILD_ID не найден");
  process.exit(1);
}

if (!GEMINI_API_KEY) {
  console.error("ERROR: GEMINI_API_KEY не найден");
  process.exit(1);
}

// ============================================================
// AI
// ============================================================

const AI_MODEL = "gemini-3.5-flash-lite";

const gemini = new GoogleGenAI({
  apiKey: GEMINI_API_KEY,
});

// ============================================================
// PATHS
// ============================================================

const ROOT_DIR = __dirname;

const STATS_FILE = path.join(ROOT_DIR, "stats.json");
const TEMPLATE_FILE = path.join(ROOT_DIR, "template.png");
const FONT_FILE = path.join(ROOT_DIR, "font.ttf");

const RUNTIME_DIR =
  process.env.RUNTIME_DIR || path.join(ROOT_DIR, "runtime");

const WHISPER_BIN =
  process.env.WHISPER_BIN ||
  "/opt/whisper.cpp/build/bin/whisper-cli";

const WHISPER_MODEL =
  process.env.WHISPER_MODEL ||
  "/opt/whisper.cpp/models/ggml-base.bin";

const PIPER_DATA_DIR =
  process.env.PIPER_DATA_DIR || "/opt/piper";

const PIPER_VOICE =
  process.env.PIPER_VOICE || "ru_RU-dmitri-medium";

fs.mkdirSync(RUNTIME_DIR, { recursive: true });

// ============================================================
// CLIENT
// ============================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences,
  ],
});

// ============================================================
// STATS
// ============================================================

let stats = {
  users: {},
};

if (fs.existsSync(STATS_FILE)) {
  try {
    stats = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));

    if (!stats.users || typeof stats.users !== "object") {
      stats.users = {};
    }
  } catch (error) {
    console.error("Ошибка чтения stats.json:", error);
    stats = {
      users: {},
    };
  }
}

function saveStats() {
  try {
    fs.writeFileSync(
      STATS_FILE,
      JSON.stringify(stats, null, 2),
      "utf8"
    );
  } catch (error) {
    console.error("Ошибка сохранения stats.json:", error);
  }
}

function ensureUser(userId, username = "Unknown") {
  if (!stats.users[userId]) {
    stats.users[userId] = {
      username,
      messages: 0,
      voiceSeconds: 0,
      discordSeconds: 0,
      gamingSeconds: 0,
      gamingGame: null,

      voiceJoinedAt: null,
      discordActiveAt: null,
      gamingActiveAt: null,
    };
  }

  stats.users[userId].username = username;

  return stats.users[userId];
}

// ============================================================
// DAILY RESET
// ============================================================

function dailyReset() {
  const now = Date.now();

  for (const user of Object.values(stats.users)) {
    user.messages = 0;
    user.voiceSeconds = 0;
    user.discordSeconds = 0;
    user.gamingSeconds = 0;
    user.gamingGame = null;

    if (user.voiceJoinedAt) {
      user.voiceJoinedAt = now;
    }

    if (user.discordActiveAt) {
      user.discordActiveAt = now;
    }

    if (user.gamingActiveAt) {
      user.gamingActiveAt = now;
    }
  }

  saveStats();

  console.log("Статистика сброшена");
}

let lastResetDate = new Date().toDateString();

setInterval(() => {
  const currentDate = new Date().toDateString();

  if (currentDate !== lastResetDate) {
    lastResetDate = currentDate;
    dailyReset();
  }
}, 60 * 1000);

// ============================================================
// STATS SESSION UPDATE
// ============================================================

function updateActiveTime(user) {
  const now = Date.now();

  if (user.voiceJoinedAt) {
    user.voiceSeconds += Math.max(
      0,
      Math.floor((now - user.voiceJoinedAt) / 1000)
    );

    user.voiceJoinedAt = now;
  }

  if (user.discordActiveAt) {
    user.discordSeconds += Math.max(
      0,
      Math.floor((now - user.discordActiveAt) / 1000)
    );

    user.discordActiveAt = now;
  }

  if (user.gamingActiveAt) {
    user.gamingSeconds += Math.max(
      0,
      Math.floor((now - user.gamingActiveAt) / 1000)
    );

    user.gamingActiveAt = now;
  }
}

// ============================================================
// MESSAGES
// ============================================================

client.on("messageCreate", (message) => {
  if (!message.guild) return;
  if (message.author.bot) return;

  const user = ensureUser(
    message.author.id,
    message.author.username
  );

  updateActiveTime(user);

  user.messages++;

  saveStats();
});

// ============================================================
// VOICE STATS
// ============================================================

client.on("voiceStateUpdate", (oldState, newState) => {
  if (!newState.guild) return;

  const member = newState.member;

  if (!member || member.user.bot) return;

  const user = ensureUser(
    member.id,
    member.user.username
  );

  const wasInVoice = !!oldState.channelId;
  const isInVoice = !!newState.channelId;

  if (!wasInVoice && isInVoice) {
    user.voiceJoinedAt = Date.now();
  }

  if (wasInVoice && !isInVoice) {
    updateActiveTime(user);
    user.voiceJoinedAt = null;
  }

  saveStats();
});

// ============================================================
// PRESENCE / GAMING STATS
// ============================================================

function getGamingActivity(presence) {
  if (!presence) return null;

  const activity = presence.activities.find(
    (activity) => activity.type === ActivityType.Playing
  );

  return activity || null;
}

client.on("presenceUpdate", (oldPresence, newPresence) => {
  if (!newPresence || !newPresence.guild) return;

  const member = newPresence.member;

  if (!member || member.user.bot) return;

  const user = ensureUser(
    member.id,
    member.user.username
  );

  const activity = getGamingActivity(newPresence);

  if (activity) {
    if (!user.gamingActiveAt) {
      user.gamingActiveAt = Date.now();
    }

    user.gamingGame = activity.name;
  } else {
    if (user.gamingActiveAt) {
      updateActiveTime(user);
      user.gamingActiveAt = null;
    }

    user.gamingGame = null;
  }

  saveStats();
});

// ============================================================
// DISCORD ONLINE ACTIVITY
// ============================================================

client.on("presenceUpdate", (oldPresence, newPresence) => {
  if (!newPresence || !newPresence.guild) return;

  const member = newPresence.member;

  if (!member || member.user.bot) return;

  const user = ensureUser(
    member.id,
    member.user.username
  );

  const status = newPresence.status;

  const active =
    status === "online" ||
    status === "idle" ||
    status === "dnd";

  if (active) {
    if (!user.discordActiveAt) {
      user.discordActiveAt = Date.now();
    }
  } else {
    if (user.discordActiveAt) {
      updateActiveTime(user);
      user.discordActiveAt = null;
    }
  }

  saveStats();
});

// ============================================================
// PERIODIC STATS SAVE
// ============================================================

setInterval(() => {
  for (const user of Object.values(stats.users)) {
    updateActiveTime(user);
  }

  saveStats();
}, 30 * 1000);

// ============================================================
// STATS IMAGE
// ============================================================

if (fs.existsSync(FONT_FILE)) {
  try {
    GlobalFonts.registerFromPath(FONT_FILE, "BotFont");
  } catch (error) {
    console.error("Ошибка загрузки шрифта:", error);
  }
}

function formatSeconds(seconds) {
  seconds = Math.max(0, Math.floor(seconds || 0));

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}ч ${minutes}м`;
  }

  if (minutes > 0) {
    return `${minutes}м ${secs}с`;
  }

  return `${secs}с`;
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();

  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(
    x + width,
    y,
    x + width,
    y + radius
  );

  ctx.lineTo(x + width, y + height - radius);

  ctx.quadraticCurveTo(
    x + width,
    y + height,
    x + width - radius,
    y + height
  );

  ctx.lineTo(x + radius, y + height);

  ctx.quadraticCurveTo(
    x,
    y + height,
    x,
    y + height - radius
  );

  ctx.lineTo(x, y + radius);

  ctx.quadraticCurveTo(
    x,
    y,
    x + radius,
    y
  );

  ctx.closePath();
}

async function createStatsImage(member) {
  const width = 1536;
  const height = 1536;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  if (fs.existsSync(TEMPLATE_FILE)) {
    const template = await loadImage(TEMPLATE_FILE);
    ctx.drawImage(template, 0, 0, width, height);
  } else {
    ctx.fillStyle = "#101010";
    ctx.fillRect(0, 0, width, height);
  }

  const user = ensureUser(
    member.id,
    member.user.username
  );

  updateActiveTime(user);

  // ----------------------------------------------------------
  // Avatar
  // ----------------------------------------------------------

  try {
    const avatarURL = member.user.displayAvatarURL({
      extension: "png",
      size: 512,
    });

    const avatar = await loadImage(avatarURL);

    ctx.save();

    ctx.beginPath();
    ctx.arc(768, 280, 150, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    ctx.drawImage(
      avatar,
      618,
      130,
      300,
      300
    );

    ctx.restore();
  } catch (error) {
    console.error("Ошибка загрузки аватара:", error);
  }

  // ----------------------------------------------------------
  // Username
  // ----------------------------------------------------------

  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = 'bold 64px "BotFont"';

  ctx.fillText(
    member.displayName || member.user.username,
    768,
    500
  );

  // ----------------------------------------------------------
  // Cards
  // ----------------------------------------------------------

  const cards = [
    {
      title: "VOICE",
      value: formatSeconds(user.voiceSeconds),
      color: "#ff4b4b",
      x: 130,
      y: 600,
    },
    {
      title: "MESSAGE",
      value: String(user.messages),
      color: "#55a8ff",
      x: 800,
      y: 600,
    },
    {
      title: "DISCORD",
      value: formatSeconds(user.discordSeconds),
      color: "#c080ff",
      x: 130,
      y: 830,
    },
    {
      title: "GAMING",
      value: formatSeconds(user.gamingSeconds),
      color: "#43ff91",
      x: 800,
      y: 830,
    },
    {
      title: "MUSIC",
      value: "SOON",
      color: "#ffd84a",
      x: 130,
      y: 1060,
    },
  ];

  for (const card of cards) {
    const w = 606;
    const h = 170;

    ctx.save();

    drawRoundedRect(
      ctx,
      card.x,
      card.y,
      w,
      h,
      35
    );

    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fill();

    ctx.strokeStyle = card.color;
    ctx.lineWidth = 5;
    ctx.stroke();

    ctx.fillStyle = card.color;
    ctx.textAlign = "left";
    ctx.font = 'bold 32px "BotFont"';

    ctx.fillText(
      card.title,
      card.x + 35,
      card.y + 55
    );

    ctx.fillStyle = "#ffffff";
    ctx.font = 'bold 50px "BotFont"';

    ctx.fillText(
      card.value,
      card.x + 35,
      card.y + 120
    );

    ctx.restore();
  }

  return canvas.toBuffer("image/png");
}

// ============================================================
// AI TEXT
// ============================================================

async function askAI(prompt) {
  try {
    const response = await gemini.models.generateContent({
      model: AI_MODEL,
      contents: prompt,
      config: {
        systemInstruction: `
Ты обычный AI-ассистент Discord-бота.

Отвечай на русском языке.
Будь полезным и понятным.
Не используй лишние приветствия.
Не повторяй вопрос пользователя.
Если пользователь задаёт обычный вопрос — отвечай прямо.
`,
      },
    });

    return response.text || "Не удалось получить ответ.";
  } catch (error) {
    console.error("Gemini error:", error);

    return "Не удалось получить ответ от AI.";
  }
}

// ============================================================
// ENTERTAINMENT
// ============================================================

const facts = [
  "У осьминога три сердца.",
  "Банан с ботанической точки зрения является ягодой.",
  "Мёд практически не портится.",
  "У акул появились раньше деревьев.",
  "В космосе нет звука, потому что там практически нет среды для его распространения.",
];

const jokes = [
  "Программист пошёл в магазин за хлебом. Жена сказала: «Возьми десять буханок, а если будут яйца — возьми десять». Он вернулся с десятью буханками хлеба.",
  "Почему программист не любит природу? Там слишком много багов.",
  "— Почему компьютер замёрз? — Потому что оставили Windows открытым.",
];

const quotes = [
  "Большие вещи начинаются с маленьких шагов.",
  "Ошибки — часть процесса обучения.",
  "Лучше сделать и улучшить, чем бесконечно ждать идеального момента.",
  "Знания становятся полезными, когда их применяют.",
];

const riddles = [
  {
    question: "Что можно увидеть с закрытыми глазами?",
    answer: "Сон",
  },
  {
    question: "Чем больше из неё берёшь, тем больше она становится. Что это?",
    answer: "Яма",
  },
  {
    question: "Что принадлежит тебе, но другие используют это чаще тебя?",
    answer: "Твоё имя",
  },
  {
    question: "Что имеет много ключей, но не может открыть ни одной двери?",
    answer: "Пианино",
  },
];

// ============================================================
// POLL STORAGE
// ============================================================

const polls = new Map();

// ============================================================
// VOICE AI STORAGE
// ============================================================

const voiceAISessions = new Map();

// ============================================================
// PROCESS HELPER
// ============================================================

function runProcess(command, args = [], input = null) {
  return new Promise((resolve, reject) => {
    console.log(
      `[PROCESS] ${command} ${args.join(" ")}`
    );

    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({
          stdout,
          stderr,
        });
      } else {
        reject(
          new Error(
            `${command} завершился с кодом ${code}\n${stderr}`
          )
        );
      }
    });

    if (input !== null && input !== undefined) {
      child.stdin.write(input);
    }

    child.stdin.end();
  });
}

// ============================================================
// BUFFER / WAV
// ============================================================

function createWavBuffer(
  pcmBuffer,
  sampleRate,
  channels,
  bitsPerSample = 16
) {
  const byteRate =
    sampleRate *
    channels *
    (bitsPerSample / 8);

  const blockAlign =
    channels * (bitsPerSample / 8);

  const buffer = Buffer.alloc(44 + pcmBuffer.length);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(
    36 + pcmBuffer.length,
    4
  );

  buffer.write("WAVE", 8);

  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  buffer.write("data", 36);
  buffer.writeUInt32LE(
    pcmBuffer.length,
    40
  );

  pcmBuffer.copy(buffer, 44);

  return buffer;
}

// ============================================================
// 48 KHZ STEREO -> 16 KHZ MONO
// ============================================================

function convert48kStereoTo16kMono(
  pcmBuffer
) {
  const inputChannels = 2;
  const inputRate = 48000;
  const outputRate = 16000;

  const bytesPerSample = 2;

  const inputFrames =
    Math.floor(
      pcmBuffer.length /
        (inputChannels * bytesPerSample)
    );

  const outputFrames = Math.floor(
    inputFrames *
      outputRate /
      inputRate
  );

  const output = Buffer.alloc(
    outputFrames * bytesPerSample
  );

  for (let i = 0; i < outputFrames; i++) {
    const sourceFrame = Math.floor(
      i * inputRate / outputRate
    );

    const leftOffset =
      sourceFrame *
      inputChannels *
      bytesPerSample;

    const rightOffset =
      leftOffset + bytesPerSample;

    if (
      rightOffset + 1 >=
      pcmBuffer.length
    ) {
      break;
    }

    const left =
      pcmBuffer.readInt16LE(leftOffset);

    const right =
      pcmBuffer.readInt16LE(rightOffset);

    const mono =
      Math.max(
        -32768,
        Math.min(
          32767,
          Math.round(
            (left + right) / 2
          )
        )
      );

    output.writeInt16LE(
      mono,
      i * bytesPerSample
    );
  }

  return createWavBuffer(
    output,
    16000,
    1,
    16
  );
}

// ============================================================
// WHISPER
// ============================================================

async function transcribeWithWhisper(wavPath) {
  console.log(
    "Whisper: распознаю:",
    wavPath
  );

  if (!fs.existsSync(WHISPER_BIN)) {
    throw new Error(
      `Whisper binary не найден: ${WHISPER_BIN}`
    );
  }

  if (!fs.existsSync(WHISPER_MODEL)) {
    throw new Error(
      `Whisper model не найден: ${WHISPER_MODEL}`
    );
  }

  const result = await runProcess(
    WHISPER_BIN,
    [
      "-m",
      WHISPER_MODEL,
      "-f",
      wavPath,
      "-l",
      "ru",
      "-nt",
      "-np",
    ]
  );

  const text = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .trim();

  console.log(
    "Whisper результат:",
    text
  );

  return text;
}

// ============================================================
// PIPER TTS
// ============================================================

async function textToSpeech(text) {
  const output = path.join(
    RUNTIME_DIR,
    `tts-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.wav`
  );

  console.log(
    "Piper: генерирую:",
    text
  );

  console.log(
    "Piper output:",
    output
  );

  if (!fs.existsSync(PIPER_DATA_DIR)) {
    throw new Error(
      `Piper data dir не найден: ${PIPER_DATA_DIR}`
    );
  }

  await runProcess(
    "python3",
    [
      "-m",
      "piper",
      "--data-dir",
      PIPER_DATA_DIR,
      "--model",
      PIPER_VOICE,
      "--output_file",
      output,
    ],
    text
  );

  if (!fs.existsSync(output)) {
    throw new Error(
      `Piper не создал WAV: ${output}`
    );
  }

  const stat = fs.statSync(output);

  console.log(
    "Piper WAV создан:",
    {
      path: output,
      size: stat.size,
    }
  );

  if (stat.size < 1000) {
    throw new Error(
      "Piper создал подозрительно маленький WAV"
    );
  }

  return output;
}

// ============================================================
// PLAY WAV THROUGH FFMPEG
// ============================================================

async function playVoiceFile(
  connection,
  filePath,
  session = null
) {
  console.log(
    "Audio: начинаю воспроизведение:",
    filePath
  );

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Файл не найден: ${filePath}`
    );
  }

  const player = createAudioPlayer();

  if (session) {
    session.player = player;
  }

  player.on("error", (error) => {
    console.error(
      "AudioPlayer ERROR:",
      error
    );
  });

  player.on(
    AudioPlayerStatus.Playing,
    () => {
      console.log(
        "AudioPlayer: PLAYING"
      );
    }
  );

  player.on(
    AudioPlayerStatus.Idle,
    () => {
      console.log(
        "AudioPlayer: IDLE"
      );
    }
  );

  connection.subscribe(player);

  // ----------------------------------------------------------
  // FFmpeg:
  // WAV -> 48kHz stereo signed 16-bit PCM
  // ----------------------------------------------------------

  console.log(
    "FFmpeg: конвертирую WAV в PCM..."
  );

  const ffmpeg = spawn(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",

      "-i",
      filePath,

      "-f",
      "s16le",
      "-ar",
      "48000",
      "-ac",
      "2",

      "pipe:1",
    ],
    {
      stdio: [
        "ignore",
        "pipe",
        "pipe",
      ],
    }
  );

  let ffmpegError = "";

  ffmpeg.stderr.on(
    "data",
    (data) => {
      ffmpegError +=
        data.toString();
    }
  );

  ffmpeg.on("error", (error) => {
    console.error(
      "FFmpeg ERROR:",
      error
    );
  });

  const resource =
    createAudioResource(
      ffmpeg.stdout,
      {
        inputType: StreamType.Raw,
        inlineVolume: false,
      }
    );

  player.play(resource);

  console.log(
    "Audio: player.play() вызван"
  );

  await new Promise(
    (resolve, reject) => {
      let finished = false;

      const finish = (fn, value) => {
        if (finished) return;

        finished = true;

        clearTimeout(timeout);

        fn(value);
      };

      const timeout = setTimeout(() => {
        finish(
          reject,
          new Error(
            "Таймаут воспроизведения аудио"
          )
        );
      }, 30000);

      player.once(
        AudioPlayerStatus.Idle,
        () => {
          finish(
            resolve
          );
        }
      );

      player.once(
        "error",
        (error) => {
          finish(
            reject,
            error
          );
        }
      );

      ffmpeg.once(
        "close",
        (code) => {
          if (
            code !== 0 &&
            !finished
          ) {
            finish(
              reject,
              new Error(
                `FFmpeg завершился с кодом ${code}\n${ffmpegError}`
              )
            );
          }
        }
      );
    }
  );

  if (session) {
    session.player = null;
  }

  console.log(
    "Audio: воспроизведение завершено"
  );
}

// ============================================================
// VOICE AUDIO BUFFER
// ============================================================

function streamToBuffer(stream) {
  return new Promise(
    (resolve, reject) => {
      const chunks = [];

      stream.on("data", (chunk) => {
        chunks.push(
          Buffer.from(chunk)
        );
      });

      stream.on("end", () => {
        resolve(
          Buffer.concat(chunks)
        );
      });

      stream.on("error", reject);
    }
  );
}

// ============================================================
// PROCESS ONE USER SPEECH
// ============================================================

async function processVoiceAudio(
  session,
  userId,
  opusStream
) {
  if (session.busy) {
    console.log(
      "Voice AI занят, пропускаю речь:",
      userId
    );

    return;
  }

  session.busy = true;

  const pcmDecoder =
    new prism.opus.Decoder({
      frameSize: 960,
      channels: 2,
      rate: 48000,
    });

  try {
    opusStream.pipe(
      pcmDecoder
    );

    console.log(
      "Voice AI: записываю речь пользователя:",
      userId
    );

    const pcmBuffer =
      await streamToBuffer(
        pcmDecoder
      );

    console.log(
      "Voice AI: получено PCM:",
      pcmBuffer.length,
      "bytes"
    );

    if (pcmBuffer.length < 5000) {
      console.log(
        "Voice AI: слишком короткий звук"
      );

      return;
    }

    // --------------------------------------------------------
    // Convert Discord audio -> Whisper WAV
    // --------------------------------------------------------

    const wavBuffer =
      convert48kStereoTo16kMono(
        pcmBuffer
      );

    const inputWav = path.join(
      RUNTIME_DIR,
      `voice-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}.wav`
    );

    fs.writeFileSync(
      inputWav,
      wavBuffer
    );

    console.log(
      "Voice AI: WAV для Whisper:",
      inputWav,
      fs.statSync(inputWav).size
    );

    // --------------------------------------------------------
    // STT
    // --------------------------------------------------------

    let text;

    try {
      text =
        await transcribeWithWhisper(
          inputWav
        );
    } finally {
      try {
        fs.unlinkSync(inputWav);
      } catch {}
    }

    if (!text) {
      console.log(
        "Voice AI: Whisper ничего не распознал"
      );

      return;
    }

    console.log(
      "Пользователь сказал:",
      text
    );

    // --------------------------------------------------------
    // GEMINI
    // --------------------------------------------------------

    const answer =
      await askAI(
        `Пользователь в голосовом Discord-канале сказал:

"${text}"

Ответь ему естественно и кратко, как голосовой собеседник.
Не используй Markdown.
Не используй списки без необходимости.
Ответ должен хорошо звучать при озвучивании.`
      );

    console.log(
      "Voice AI ответ:",
      answer
    );

    if (!answer) return;

    // --------------------------------------------------------
    // TTS
    // --------------------------------------------------------

    const ttsFile =
      await textToSpeech(
        answer
      );

    try {
      await playVoiceFile(
        session.connection,
        ttsFile,
        session
      );
    } finally {
      try {
        fs.unlinkSync(ttsFile);
      } catch {}
    }
  } catch (error) {
    console.error(
      "Voice AI processing ERROR:",
      error
    );
  } finally {
    session.busy = false;
  }
}

// ============================================================
// STOP VOICE AI
// ============================================================

function stopVoiceAISession(
  guildId
) {
  const session =
    voiceAISessions.get(guildId);

  if (!session) {
    return false;
  }

  console.log(
    "Voice AI: остановка"
  );

  session.stopped = true;

  try {
    if (session.player) {
      session.player.stop();
    }
  } catch {}

  try {
    if (
      session.connection
    ) {
      session.connection.destroy();
    }
  } catch {}

  voiceAISessions.delete(
    guildId
  );

  return true;
}

// ============================================================
// START VOICE AI
// ============================================================

async function startVoiceAISession(
  interaction
) {
  const guild =
    interaction.guild;

  const member =
    interaction.member;

  if (!guild || !member) {
    throw new Error(
      "Guild/member не найден"
    );
  }

  const voiceChannel =
    member.voice.channel;

  if (!voiceChannel) {
    throw new Error(
      "Сначала зайди в голосовой канал."
    );
  }

  // ----------------------------------------------------------
  // Если уже работает — сначала останавливаем старую сессию
  // ----------------------------------------------------------

  if (
    voiceAISessions.has(
      guild.id
    )
  ) {
    stopVoiceAISession(
      guild.id
    );
  }

  console.log(
    `Voice AI: подключаюсь к ${voiceChannel.name}`
  );

  // ----------------------------------------------------------
  // Join
  // ----------------------------------------------------------

  const connection =
    joinVoiceChannel({
      channelId:
        voiceChannel.id,

      guildId:
        guild.id,

      adapterCreator:
        guild.voiceAdapterCreator,

      selfDeaf: false,
      selfMute: false,
    });

  const session = {
    guildId: guild.id,
    channelId: voiceChannel.id,
    connection,

    player: null,

    busy: false,
    stopped: false,
    speakingUsers: new Set(),
  };

  voiceAISessions.set(
    guild.id,
    session
  );

  // ----------------------------------------------------------
  // Ready
  // ----------------------------------------------------------

  await new Promise(
    (resolve, reject) => {
      const timeout =
        setTimeout(() => {
          reject(
            new Error(
              "Не удалось дождаться подключения к Discord Voice."
            )
          );
        }, 30000);

      const onReady = () => {
        clearTimeout(timeout);

        connection.off(
          "error",
          onError
        );

        console.log(
          "Voice AI подключён"
        );

        resolve();
      };

      const onError = (error) => {
        clearTimeout(timeout);

        connection.off(
          VoiceConnectionStatus.Ready,
          onReady
        );

        reject(error);
      };

      connection.once(
        VoiceConnectionStatus.Ready,
        onReady
      );

      connection.once(
        "error",
        onError
      );
    }
  );

  // ----------------------------------------------------------
  // Greeting
  // ----------------------------------------------------------

  const greetings = [
    "Привет всем! Я подключился. Можете со мной разговаривать.",
    "Всем привет! Я здесь. О чём поговорим?",
    "Привет! Я готов общаться. Можете что-нибудь сказать.",
    "Я подключился. Ну что, ребята, начинаем?",
    "Привет! Я вас слышу. Давайте поговорим.",
  ];

  const greeting =
    greetings[
      Math.floor(
        Math.random() *
          greetings.length
      )
    ];

  console.log(
    "Приветствие:",
    greeting
  );

  try {
    const greetingFile =
      await textToSpeech(
        greeting
      );

    try {
      await playVoiceFile(
        connection,
        greetingFile,
        session
      );
    } finally {
      try {
        fs.unlinkSync(
          greetingFile
        );
      } catch {}
    }
  } catch (error) {
    console.error(
      "Ошибка приветствия:",
      error
    );
  }

  if (session.stopped) {
    return;
  }

  // ----------------------------------------------------------
  // Receive audio
  // ----------------------------------------------------------

  const receiver =
    connection.receiver;

  receiver.speaking.on(
    "start",
    async (userId) => {
      if (session.stopped) {
        return;
      }

      if (
        session.speakingUsers.has(
          userId
        )
      ) {
        return;
      }

      session.speakingUsers.add(
        userId
      );

      console.log(
        "Voice AI: пользователь начал говорить:",
        userId
      );

      try {
        const opusStream =
          receiver.subscribe(
            userId,
            {
              end:
                EndBehaviorType.AfterSilence,

              endTimeout: 800,
            }
          );

        await processVoiceAudio(
          session,
          userId,
          opusStream
        );
      } catch (error) {
        console.error(
          "Voice receive ERROR:",
          error
        );
      } finally {
        session.speakingUsers.delete(
          userId
        );
      }
    }
  );

  connection.on(
    VoiceConnectionStatus.Disconnected,
    () => {
      console.log(
        "Voice AI: соединение отключено"
      );
    }
  );

  connection.on(
    VoiceConnectionStatus.Destroyed,
    () => {
      console.log(
        "Voice AI: соединение уничтожено"
      );
    }
  );
}

// ============================================================
// SLASH COMMANDS
// ============================================================

const commands = [
  new SlashCommandBuilder()
    .setName("stats")
    .setDescription(
      "Показать статистику пользователя"
    )
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription(
          "Пользователь"
        )
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("ai")
    .setDescription(
      "Задать вопрос AI"
    )
    .addStringOption((option) =>
      option
        .setName("prompt")
        .setDescription(
          "Ваш вопрос"
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("voiceai")
    .setDescription(
      "Подключить голосовой AI"
    ),

  new SlashCommandBuilder()
    .setName("voiceai-stop")
    .setDescription(
      "Остановить голосовой AI"
    ),

  new SlashCommandBuilder()
    .setName("coinflip")
    .setDescription(
      "Подбросить монетку"
    ),

  new SlashCommandBuilder()
    .setName("dice")
    .setDescription(
      "Бросить кубик"
    )
    .addIntegerOption((option) =>
      option
        .setName("sides")
        .setDescription(
          "Количество граней"
        )
        .setRequired(false)
        .setMinValue(2)
        .setMaxValue(100)
    ),

  new SlashCommandBuilder()
    .setName("8ball")
    .setDescription(
      "Задать вопрос магическому шару"
    )
    .addStringOption((option) =>
      option
        .setName("question")
        .setDescription(
          "Вопрос"
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("riddle")
    .setDescription(
      "Получить загадку"
    ),

  new SlashCommandBuilder()
    .setName("fact")
    .setDescription(
      "Получить интересный факт"
    ),

  new SlashCommandBuilder()
    .setName("joke")
    .setDescription(
      "Получить шутку"
    ),

  new SlashCommandBuilder()
    .setName("quote")
    .setDescription(
      "Получить цитату"
    ),

  new SlashCommandBuilder()
    .setName("poll")
    .setDescription(
      "Создать опрос"
    )
    .addStringOption((option) =>
      option
        .setName("question")
        .setDescription(
          "Вопрос опроса"
        )
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("option1")
        .setDescription(
          "Вариант 1"
        )
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("option2")
        .setDescription(
          "Вариант 2"
        )
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("option3")
        .setDescription(
          "Вариант 3"
        )
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("option4")
        .setDescription(
          "Вариант 4"
        )
        .setRequired(false)
    ),
].map((command) =>
  command.toJSON()
);

// ============================================================
// REGISTER COMMANDS
// ============================================================

async function registerCommands() {
  const rest = new REST({
    version: "10",
  }).setToken(
    DISCORD_TOKEN
  );

  console.log(
    "Регистрация slash-команд..."
  );

  await rest.put(
    Routes.applicationGuildCommands(
      CLIENT_ID,
      GUILD_ID
    ),
    {
      body: commands,
    }
  );

  console.log(
    "Slash-команды зарегистрированы"
  );
}

// ============================================================
// INTERACTIONS
// ============================================================

client.on(
  "interactionCreate",
  async (interaction) => {
    if (
      !interaction.isChatInputCommand() &&
      !interaction.isButton()
    ) {
      return;
    }

    // ========================================================
    // POLL BUTTONS
    // ========================================================

    if (interaction.isButton()) {
      const poll =
        polls.get(
          interaction.message.id
        );

      if (!poll) {
        await interaction.reply({
          content:
            "Этот опрос больше не активен.",
          ephemeral: true,
        });

        return;
      }

      const optionIndex =
        Number(
          interaction.customId.replace(
            "poll_",
            ""
          )
        );

      if (
        !Number.isInteger(
          optionIndex
        ) ||
        optionIndex < 0 ||
        optionIndex >=
          poll.options.length
      ) {
        return;
      }

      const previous =
        poll.votes.get(
          interaction.user.id
        );

      if (
        previous !== undefined
      ) {
        poll.counts[previous]--;
      }

      poll.votes.set(
        interaction.user.id,
        optionIndex
      );

      poll.counts[optionIndex]++;

      const total =
        poll.counts.reduce(
          (a, b) => a + b,
          0
        );

      const lines =
        poll.options.map(
          (option, index) => {
            const count =
              poll.counts[index];

            const percent =
              total > 0
                ? Math.round(
                    (count / total) *
                      100
                  )
                : 0;

            return `${index + 1}. ${option} — ${count} (${percent}%)`;
          }
        );

      await interaction.update({
        content:
          `📊 **${poll.question}**\n\n` +
          lines.join("\n"),
        components:
          interaction.message.components,
      });

      return;
    }

    // ========================================================
    // COMMANDS
    // ========================================================

    try {
      // ------------------------------------------------------
      // /stats
      // ------------------------------------------------------

      if (
        interaction.commandName ===
        "stats"
      ) {
        const selected =
          interaction.options.getUser(
            "user"
          ) || interaction.user;

        const member =
          await interaction.guild.members
            .fetch(selected.id);

        await interaction.deferReply();

        const image =
          await createStatsImage(
            member
          );

        const attachment =
          new AttachmentBuilder(
            image,
            {
              name: "stats.png",
            }
          );

        await interaction.editReply({
          files: [attachment],
        });

        return;
      }

      // ------------------------------------------------------
      // /ai
      // ------------------------------------------------------

      if (
        interaction.commandName ===
        "ai"
      ) {
        const prompt =
          interaction.options.getString(
            "prompt",
            true
          );

        await interaction.deferReply();

        const answer =
          await askAI(prompt);

        await interaction.editReply(
          answer
        );

        return;
      }

      // ------------------------------------------------------
      // /voiceai
      // ------------------------------------------------------

      if (
        interaction.commandName ===
        "voiceai"
      ) {
        const member =
          interaction.member;

        if (
          !member.voice.channel
        ) {
          await interaction.reply({
            content:
              "Сначала зайди в голосовой канал.",
            ephemeral: true,
          });

          return;
        }

        await interaction.deferReply();

        console.log(
          `Voice AI: подключаюсь к ${member.voice.channel.name}`
        );

        await startVoiceAISession(
          interaction
        );

        await interaction.editReply(
          "🎙️ Voice AI подключён. Я слушаю голосовой канал."
        );

        return;
      }

      // ------------------------------------------------------
      // /voiceai-stop
      // ------------------------------------------------------

      if (
        interaction.commandName ===
        "voiceai-stop"
      ) {
        const stopped =
          stopVoiceAISession(
            interaction.guild.id
          );

        if (stopped) {
          await interaction.reply(
            "🔇 Voice AI остановлен."
          );
        } else {
          await interaction.reply(
            "Voice AI сейчас не запущен."
          );
        }

        return;
      }

      // ------------------------------------------------------
      // /coinflip
      // ------------------------------------------------------

      if (
        interaction.commandName ===
        "coinflip"
      ) {
        const result =
          Math.random() < 0.5
            ? "🪙 Орёл!"
            : "🪙 Решка!";

        await interaction.reply(
          result
        );

        return;
      }

      // ------------------------------------------------------
      // /dice
      // ------------------------------------------------------

      if (
        interaction.commandName ===
        "dice"
      ) {
        const sides =
          interaction.options.getInteger(
            "sides"
          ) || 6;

        const result =
          Math.floor(
            Math.random() * sides
          ) + 1;

        await interaction.reply(
          `🎲 Выпало: **${result}** из ${sides}`
        );

        return;
      }

      // ------------------------------------------------------
      // /8ball
      // ------------------------------------------------------

      if (
        interaction.commandName ===
        "8ball"
      ) {
        const answers = [
          "Да.",
          "Нет.",
          "Скорее всего.",
          "Вполне возможно.",
          "Определённо да.",
          "Определённо нет.",
          "Лучше пока не знать.",
          "Спроси позже.",
        ];

        const answer =
          answers[
            Math.floor(
              Math.random() *
                answers.length
            )
          ];

        await interaction.reply(
          `🎱 ${answer}`
        );

        return;
      }

      // ------------------------------------------------------
      // /riddle
      // ------------------------------------------------------

      if (
        interaction.commandName ===
        "riddle"
      ) {
        const riddle =
          riddles[
            Math.floor(
              Math.random() *
                riddles.length
            )
          ];

        await interaction.reply(
          `🧩 **Загадка:**\n${riddle.question}\n\n||Ответ: ${riddle.answer}||`
        );

        return;
      }

      // ------------------------------------------------------
      // /fact
      // ------------------------------------------------------

      if (
        interaction.commandName ===
        "fact"
      ) {
        const fact =
          facts[
            Math.floor(
              Math.random() *
                facts.length
            )
          ];

        await interaction.reply(
          `💡 ${fact}`
        );

        return;
      }

      // ------------------------------------------------------
      // /joke
      // ------------------------------------------------------

      if (
        interaction.commandName ===
        "joke"
      ) {
        const joke =
          jokes[
            Math.floor(
              Math.random() *
                jokes.length
            )
          ];

        await interaction.reply(
          `😂 ${joke}`
        );

        return;
      }

      // ------------------------------------------------------
      // /quote
      // ------------------------------------------------------

      if (
        interaction.commandName ===
        "quote"
      ) {
        const quote =
          quotes[
            Math.floor(
              Math.random() *
                quotes.length
            )
          ];

        await interaction.reply(
          `💬 «${quote}»`
        );

        return;
      }

      // ------------------------------------------------------
      // /poll
      // ------------------------------------------------------

      if (
        interaction.commandName ===
        "poll"
      ) {
        const question =
          interaction.options.getString(
            "question",
            true
          );

        const options = [];

        for (
          let i = 1;
          i <= 4;
          i++
        ) {
          const option =
            interaction.options.getString(
              `option${i}`
            );

          if (option) {
            options.push(option);
          }
        }

        if (
          options.length < 2
        ) {
          await interaction.reply({
            content:
              "Нужно минимум два варианта.",
            ephemeral: true,
          });

          return;
        }

        const buttons =
          options.map(
            (option, index) =>
              new ButtonBuilder()
                .setCustomId(
                  `poll_${index}`
                )
                .setLabel(
                  `${index + 1}. ${option}`
                )
                .setStyle(
                  ButtonStyle.Primary
                )
          );

        const rows = [];

        for (
          let i = 0;
          i < buttons.length;
          i += 2
        ) {
          rows.push(
            new ActionRowBuilder().addComponents(
              buttons.slice(
                i,
                i + 2
              )
            )
          );
        }

        const message =
          await interaction.reply({
            content:
              `📊 **${question}**\n\n` +
              options
                .map(
                  (option, index) =>
                    `${index + 1}. ${option} — 0 (0%)`
                )
                .join("\n"),
            components: rows,
            fetchReply: true,
          });

        polls.set(
          message.id,
          {
            question,
            options,
            counts:
              options.map(
                () => 0
              ),
            votes: new Map(),
          }
        );

        return;
      }
    } catch (error) {
      console.error(
        "Interaction ERROR:",
        error
      );

      if (
        interaction.deferred ||
        interaction.replied
      ) {
        await interaction.editReply(
          "Произошла ошибка при выполнении команды."
        ).catch(() => {});
      } else {
        await interaction.reply({
          content:
            "Произошла ошибка при выполнении команды.",
          ephemeral: true,
        }).catch(() => {});
      }
    }
  }
);

// ============================================================
// READY
// ============================================================

client.once(
  "ready",
  async () => {
    console.log(
      `Бот запущен: ${client.user.tag}`
    );

    client.user.setPresence({
      activities: [
        {
          name: "с сервером",
          type: ActivityType.Watching,
        },
      ],
      status: "online",
    });

    try {
      await registerCommands();
    } catch (error) {
      console.error(
        "Ошибка регистрации команд:",
        error
      );
    }
  }
);

// ============================================================
// SHUTDOWN
// ============================================================

async function shutdown() {
  console.log(
    "Завершение работы..."
  );

  for (const guildId of voiceAISessions.keys()) {
    stopVoiceAISession(
      guildId
    );
  }

  saveStats();

  try {
    client.destroy();
  } catch {}

  process.exit(0);
}

process.on(
  "SIGINT",
  shutdown
);

process.on(
  "SIGTERM",
  shutdown
);

process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "UNCAUGHT EXCEPTION:",
      error
    );
  }
);

process.on(
  "unhandledRejection",
  (error) => {
    console.error(
      "UNHANDLED REJECTION:",
      error
    );
  }
);

// ============================================================
// LOGIN
// ============================================================

client.login(
  DISCORD_TOKEN
);
