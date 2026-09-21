const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  AttachmentBuilder,
  ActivityType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const {
  joinVoiceChannel,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType,
  NoSubscriberBehavior,
} = require("@discordjs/voice");

const { GoogleGenAI } = require("@google/genai");

const {
  createCanvas,
  loadImage,
  GlobalFonts,
} = require("@napi-rs/canvas");

const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");

// ============================================================
// CONFIG
// ============================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const AI_MODEL = "gemini-3.5-flash-lite";

if (!TOKEN) {
  console.error("❌ DISCORD_TOKEN не найден.");
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error("❌ CLIENT_ID не найден.");
  process.exit(1);
}

if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY не найден.");
  process.exit(1);
}

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
// GOOGLE GEMINI
// ============================================================

const gemini = new GoogleGenAI({
  apiKey: GEMINI_API_KEY,
});

// ============================================================
// PATHS
// ============================================================

const statsPath = path.join(__dirname, "stats.json");
const templatePath = path.join(__dirname, "template.png");
const fontPath = path.join(__dirname, "font.ttf");

const soundsPath = path.join(__dirname, "sounds");

console.log(`📁 Папка звуков: ${soundsPath}`);

if (!fs.existsSync(soundsPath)) {
  fs.mkdirSync(soundsPath, { recursive: true });
  console.log("📁 Создана папка sounds.");
}

// ============================================================
// FONT
// ============================================================

if (fs.existsSync(fontPath)) {
  GlobalFonts.registerFromPath(fontPath, "StatsFont");
  console.log("✓ Шрифт StatsFont загружен.");
} else {
  console.log("⚠️ font.ttf не найден.");
}

// ============================================================
// STATS
// ============================================================

let stats = {};

function loadStats() {
  try {
    if (!fs.existsSync(statsPath)) {
      stats = {};
      saveStats();
      return;
    }

    stats = JSON.parse(fs.readFileSync(statsPath, "utf8"));

    if (!stats || typeof stats !== "object") {
      stats = {};
    }
  } catch (error) {
    console.error("❌ Ошибка загрузки stats.json:", error);
    stats = {};
  }
}

function saveStats() {
  try {
    fs.writeFileSync(
      statsPath,
      JSON.stringify(stats, null, 2),
      "utf8"
    );
  } catch (error) {
    console.error("❌ Ошибка сохранения stats.json:", error);
  }
}

function ensureUser(userId) {
  if (!stats[userId]) {
    stats[userId] = {
      messages: 0,
      voiceSeconds: 0,
      discordSeconds: 0,
      gamingSeconds: 0,
      gamingGame: null,

      voiceJoinedAt: null,
      discordActiveAt: null,
      gamingStartedAt: null,
    };
  }

  return stats[userId];
}

function getNowSeconds() {
  return Math.floor(Date.now() / 1000);
}

// ============================================================
// DAILY RESET
// ============================================================

function dailyReset() {
  const now = new Date();

  const resetKey =
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  if (stats.__meta?.lastReset === resetKey) {
    return;
  }

  if (!stats.__meta) {
    stats.__meta = {};
  }

  stats.__meta.lastReset = resetKey;

  for (const [userId, user] of Object.entries(stats)) {
    if (userId === "__meta") continue;

    if (!user || typeof user !== "object") continue;

    const voiceActive = Boolean(user.voiceJoinedAt);
    const discordActive = Boolean(user.discordActiveAt);
    const gamingActive = Boolean(user.gamingStartedAt);

    user.messages = 0;
    user.voiceSeconds = 0;
    user.discordSeconds = 0;
    user.gamingSeconds = 0;
    user.gamingGame = null;

    const nowTs = Date.now();

    user.voiceJoinedAt = voiceActive ? nowTs : null;
    user.discordActiveAt = discordActive ? nowTs : null;
    user.gamingStartedAt = gamingActive ? nowTs : null;
  }

  saveStats();

  console.log("🔄 Статистика сброшена за новый день.");
}

setInterval(() => {
  dailyReset();
}, 60 * 60 * 1000);

// ============================================================
// MESSAGE TRACKING
// ============================================================

client.on("messageCreate", (message) => {
  if (!message.guild) return;
  if (message.author.bot) return;

  const user = ensureUser(message.author.id);

  user.messages += 1;
});

// ============================================================
// VOICE TRACKING
// ============================================================

client.on("voiceStateUpdate", (oldState, newState) => {
  if (!newState.guild) return;

  const userId = newState.id;
  const user = ensureUser(userId);

  const wasInVoice = Boolean(oldState.channelId);
  const isInVoice = Boolean(newState.channelId);

  if (!wasInVoice && isInVoice) {
    user.voiceJoinedAt = Date.now();
  }

  if (wasInVoice && !isInVoice) {
    if (user.voiceJoinedAt) {
      const seconds = Math.max(
        0,
        Math.floor((Date.now() - user.voiceJoinedAt) / 1000)
      );

      user.voiceSeconds += seconds;
      user.voiceJoinedAt = null;
    }
  }
});

// ============================================================
// PRESENCE / GAMING TRACKING
// ============================================================

function getPlayingActivity(presence) {
  if (!presence || !presence.activities) {
    return null;
  }

  return (
    presence.activities.find(
      (activity) => activity.type === ActivityType.Playing
    ) || null
  );
}

client.on("presenceUpdate", (oldPresence, newPresence) => {
  if (!newPresence || !newPresence.userId) return;

  const userId = newPresence.userId;
  const user = ensureUser(userId);

  const oldGame = getPlayingActivity(oldPresence);
  const newGame = getPlayingActivity(newPresence);

  if (!oldGame && newGame) {
    user.gamingStartedAt = Date.now();
    user.gamingGame = newGame.name || null;
    return;
  }

  if (oldGame && newGame) {
    user.gamingGame = newGame.name || null;

    if (!user.gamingStartedAt) {
      user.gamingStartedAt = Date.now();
    }

    return;
  }

  if (oldGame && !newGame) {
    if (user.gamingStartedAt) {
      const seconds = Math.max(
        0,
        Math.floor((Date.now() - user.gamingStartedAt) / 1000)
      );

      user.gamingSeconds += seconds;
      user.gamingStartedAt = null;
      user.gamingGame = null;
    }
  }
});

// ============================================================
// AUTOSAVE
// ============================================================

setInterval(() => {
  saveStats();
}, 30 * 1000);

// ============================================================
// STATS HELPERS
// ============================================================

function getUserStats(userId) {
  const user = ensureUser(userId);

  let voiceSeconds = user.voiceSeconds || 0;
  let discordSeconds = user.discordSeconds || 0;
  let gamingSeconds = user.gamingSeconds || 0;

  const now = Date.now();

  if (user.voiceJoinedAt) {
    voiceSeconds += Math.max(
      0,
      Math.floor((now - user.voiceJoinedAt) / 1000)
    );
  }

  if (user.discordActiveAt) {
    discordSeconds += Math.max(
      0,
      Math.floor((now - user.discordActiveAt) / 1000)
    );
  }

  if (user.gamingStartedAt) {
    gamingSeconds += Math.max(
      0,
      Math.floor((now - user.gamingStartedAt) / 1000)
    );
  }

  return {
    messages: user.messages || 0,
    voiceSeconds,
    discordSeconds,
    gamingSeconds,
    gamingGame: user.gamingGame || null,
  };
}

function formatTime(seconds) {
  seconds = Math.max(0, Math.floor(seconds));

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

// ============================================================
// STATS IMAGE
// ============================================================

async function createStatsImage(user) {
  const canvas = createCanvas(1536, 1536);
  const ctx = canvas.getContext("2d");

  if (fs.existsSync(templatePath)) {
    try {
      const background = await loadImage(templatePath);
      ctx.drawImage(background, 0, 0, 1536, 1536);
    } catch (error) {
      console.error("❌ Ошибка загрузки template.png:", error);
      ctx.fillStyle = "#111111";
      ctx.fillRect(0, 0, 1536, 1536);
    }
  } else {
    ctx.fillStyle = "#111111";
    ctx.fillRect(0, 0, 1536, 1536);
  }

  const userStats = getUserStats(user.id);

  // ==========================================================
  // АВАТАР
  // ==========================================================

  try {
    const avatarURL = user.displayAvatarURL({
      extension: "png",
      size: 512,
    });

    const avatar = await loadImage(avatarURL);

    ctx.save();

    ctx.beginPath();
    ctx.arc(768, 300, 170, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    ctx.drawImage(
      avatar,
      598,
      130,
      340,
      340
    );

    ctx.restore();
  } catch (error) {
    console.error("⚠️ Не удалось загрузить аватар:", error);
  }

  // ==========================================================
  // USERNAME
  // ==========================================================

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.font = "bold 64px StatsFont, Arial";
  ctx.fillStyle = "#ffffff";

  ctx.fillText(
    user.displayName || user.username,
    768,
    540
  );

  // ==========================================================
  // CARDS
  // ==========================================================

  const cards = [
    {
      title: "VOICE",
      value: formatTime(userStats.voiceSeconds),
      color: "#ff4b4b",
      x: 180,
      y: 680,
    },
    {
      title: "MESSAGE",
      value: String(userStats.messages),
      color: "#55a8ff",
      x: 808,
      y: 680,
    },
    {
      title: "DISCORD",
      value: formatTime(userStats.discordSeconds),
      color: "#c080ff",
      x: 180,
      y: 900,
    },
    {
      title: "GAMING",
      value: formatTime(userStats.gamingSeconds),
      color: "#43ff91",
      x: 808,
      y: 900,
    },
    {
      title: "MUSIC",
      value: "SOON",
      color: "#ffd84a",
      x: 494,
      y: 1120,
    },
  ];

  for (const card of cards) {
    const width = 548;
    const height = 170;
    const radius = 28;

    ctx.beginPath();

    ctx.roundRect(
      card.x,
      card.y,
      width,
      height,
      radius
    );

    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.fill();

    ctx.lineWidth = 4;
    ctx.strokeStyle = card.color;
    ctx.stroke();

    ctx.textAlign = "left";

    ctx.font = "bold 30px StatsFont, Arial";
    ctx.fillStyle = card.color;

    ctx.fillText(
      card.title,
      card.x + 35,
      card.y + 45
    );

    ctx.font = "bold 50px StatsFont, Arial";
    ctx.fillStyle = "#ffffff";

    ctx.fillText(
      card.value,
      card.x + 35,
      card.y + 105
    );
  }

  return canvas.toBuffer("image/png");
}

// ============================================================
// GEMINI AI
// ============================================================

async function askAI(prompt) {
  const response = await gemini.models.generateContent({
    model: AI_MODEL,
    contents: prompt,
    config: {
      systemInstruction: `
Ты обычный AI-ассистент Discord-бота.
Отвечай на русском языке.
Будь полезным и понятным.
`,
    },
  });

  return response.text || "Не удалось получить ответ.";
}

// ============================================================
// ENTERTAINMENT
// ============================================================

// ------------------------------------------------------------
// COINFLIP
// ------------------------------------------------------------

function coinFlip() {
  return Math.random() < 0.5 ? "Орёл" : "Решка";
}

// ------------------------------------------------------------
// DICE
// ------------------------------------------------------------

function rollDice(sides = 6) {
  return Math.floor(Math.random() * sides) + 1;
}

// ------------------------------------------------------------
// 8 BALL
// ------------------------------------------------------------

const eightBallAnswers = [
  "🎱 Да, определённо.",
  "🎱 Скорее всего, да.",
  "🎱 Похоже на то.",
  "🎱 Возможно.",
  "🎱 Пока сложно сказать.",
  "🎱 Лучше спросить позже.",
  "🎱 Скорее нет.",
  "🎱 Похоже, что нет.",
  "🎱 Нет.",
  "🎱 Даже не надейся.",
];

// ------------------------------------------------------------
// RIDDLES
// ------------------------------------------------------------

const riddles = [
  {
    question: "Что можно увидеть с закрытыми глазами?",
    answer: "Сон.",
  },
  {
    question: "Чем больше из неё берёшь, тем больше она становится. Что это?",
    answer: "Яма.",
  },
  {
    question: "Что имеет руки, но не может обнять?",
    answer: "Часы.",
  },
  {
    question: "Что идёт, но никогда не ходит?",
    answer: "Время.",
  },
  {
    question: "Что становится мокрым, когда сушит?",
    answer: "Полотенце.",
  },
  {
    question: "Что имеет много зубов, но не может укусить?",
    answer: "Расчёска.",
  },
  {
    question: "Что можно сломать, даже не прикасаясь к нему?",
    answer: "Обещание.",
  },
  {
    question: "Что принадлежит тебе, но другие используют это чаще тебя?",
    answer: "Твоё имя.",
  },
  {
    question: "Что всегда перед тобой, но ты не можешь его увидеть?",
    answer: "Будущее.",
  },
  {
    question: "Что летит без крыльев и плачет без глаз?",
    answer: "Облако.",
  },
];

// ------------------------------------------------------------
// FACTS
// ------------------------------------------------------------

const facts = [
  "🧠 У осьминога три сердца.",
  "🌍 Молния может нагревать воздух примерно до 30 000 °C.",
  "🐙 У осьминогов голубая кровь.",
  "🦒 У жирафа и человека одинаковое количество шейных позвонков — семь.",
  "🌊 Большая часть поверхности Земли покрыта водой.",
  "🐝 Пчёлы могут распознавать человеческие лица.",
  "🛰️ Международная космическая станция движется вокруг Земли примерно за 90 минут.",
  "🦈 Акулы появились на Земле раньше деревьев.",
  "🍯 Мёд при правильном хранении может сохраняться очень долго.",
  "🌙 Луна удаляется от Земли примерно на несколько сантиметров в год.",
];

// ------------------------------------------------------------
// JOKES
// ------------------------------------------------------------

const jokes = [
  "😄 Почему компьютер пошёл к врачу? У него был вирус.",
  "😂 Программист пошёл в магазин и спросил: «Есть ли у вас хлеб?». Продавец: «Да». Программист: «Отлично, дайте два».",
  "😄 Почему Wi-Fi не ходит в спортзал? Потому что у него и так хорошее соединение.",
  "😂 Как программист открывает дверь? Сначала проверяет, существует ли она.",
  "😄 Что сказал сервер после долгого рабочего дня? «Мне нужен рестарт».",
  "😂 Почему разработчик любит тёмную тему? Потому что свет привлекает баги.",
  "😄 Что делает программист, когда ему холодно? Открывает Windows.",
  "😂 Почему компьютер никогда не спорит? У него всегда есть лог.",
];

// ------------------------------------------------------------
// QUOTES
// ------------------------------------------------------------

const quotes = [
  "💬 «Большие вещи начинаются с маленьких шагов.»",
  "💬 «Ошибки — часть процесса обучения.»",
  "💬 «Лучший способ научиться — попробовать самому.»",
  "💬 «Не обязательно сделать идеально с первого раза.»",
  "💬 «Каждый день — новый шанс узнать что-то интересное.»",
  "💬 «Хорошая идея становится проектом только после реализации.»",
  "💬 «Иногда решение проще, чем кажется.»",
  "💬 «Продолжай экспериментировать и улучшать.»",
];

function randomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

// ============================================================
// POLL STORAGE
// ============================================================

const polls = new Map();

// ============================================================
// VOICE
// ============================================================

let voiceSession = null;

function getAvailableSounds() {
  try {
    if (!fs.existsSync(soundsPath)) {
      return [];
    }

    return fs
      .readdirSync(soundsPath)
      .filter((file) => /^\d+\.wav$/i.test(file))
      .map((file) => Number(path.basename(file, ".wav")))
      .sort((a, b) => a - b);
  } catch (error) {
    console.error("❌ Ошибка чтения sounds:", error);
    return [];
  }
}

function getSoundPath(number) {
  return path.join(
    soundsPath,
    `${number}.wav`
  );
}

console.log(
  `🎵 Доступные WAV-звуки: ${
    getAvailableSounds().length
      ? getAvailableSounds().join(", ")
      : "нет"
  }`
);

// ============================================================
// VOICE READY
// ============================================================

function waitForVoiceReady(connection, timeout = 15000) {
  return new Promise((resolve, reject) => {
    if (
      connection.state.status === VoiceConnectionStatus.Ready
    ) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      cleanup();

      reject(
        new Error(
          "Voice connection не перешёл в READY за 15 секунд."
        )
      );
    }, timeout);

    const onReady = () => {
      cleanup();
      resolve();
    };

    const onStateChange = (_, newState) => {
      if (
        newState.status === VoiceConnectionStatus.Ready
      ) {
        cleanup();
        resolve();
      }
    };

    function cleanup() {
      clearTimeout(timer);

      connection.off(
        VoiceConnectionStatus.Ready,
        onReady
      );

      connection.off(
        "stateChange",
        onStateChange
      );
    }

    connection.once(
      VoiceConnectionStatus.Ready,
      onReady
    );

    connection.on(
      "stateChange",
      onStateChange
    );
  });
}

// ============================================================
// WAV PARSER
// ============================================================

function parseWavFile(filePath) {
  const buffer = fs.readFileSync(filePath);

  console.log(
    `📦 Размер файла ${path.basename(filePath)}: ${buffer.length} байт`
  );

  if (buffer.length < 44) {
    throw new Error(
      `WAV-файл слишком маленький: ${buffer.length} байт.`
    );
  }

  const riff = buffer.toString("ascii", 0, 4);
  const wave = buffer.toString("ascii", 8, 12);

  if (riff !== "RIFF" || wave !== "WAVE") {
    throw new Error(
      "Файл не является обычным RIFF/WAVE."
    );
  }

  let offset = 12;

  let audioFormat = null;
  let channels = null;
  let sampleRate = null;
  let bitsPerSample = null;

  let dataStart = null;
  let dataSize = null;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString(
      "ascii",
      offset,
      offset + 4
    );

    const chunkSize = buffer.readUInt32LE(
      offset + 4
    );

    const chunkDataStart = offset + 8;

    if (chunkId === "fmt ") {
      if (chunkSize < 16) {
        throw new Error(
          "Повреждённый fmt chunk."
        );
      }

      audioFormat = buffer.readUInt16LE(
        chunkDataStart
      );

      channels = buffer.readUInt16LE(
        chunkDataStart + 2
      );

      sampleRate = buffer.readUInt32LE(
        chunkDataStart + 4
      );

      bitsPerSample = buffer.readUInt16LE(
        chunkDataStart + 14
      );
    }

    if (chunkId === "data") {
      dataStart = chunkDataStart;

      dataSize = Math.min(
        chunkSize,
        buffer.length - dataStart
      );

      break;
    }

    offset =
      chunkDataStart +
      chunkSize +
      (chunkSize % 2);
  }

  if (
    audioFormat === null ||
    channels === null ||
    sampleRate === null ||
    bitsPerSample === null
  ) {
    throw new Error(
      "В WAV не найден корректный fmt chunk."
    );
  }

  if (
    dataStart === null ||
    dataSize === null
  ) {
    throw new Error(
      "В WAV не найден data chunk."
    );
  }

  console.log(
    `🎚️ WAV: format=${audioFormat}, channels=${channels}, sampleRate=${sampleRate}, bits=${bitsPerSample}`
  );

  if (audioFormat !== 1) {
    throw new Error(
      `WAV должен быть PCM. Сейчас format=${audioFormat}.`
    );
  }

  if (channels !== 2) {
    throw new Error(
      `WAV должен быть стерео (2 канала). Сейчас каналов: ${channels}.`
    );
  }

  if (sampleRate !== 48000) {
    throw new Error(
      `WAV должен иметь частоту 48000 Hz. Сейчас: ${sampleRate} Hz.`
    );
  }

  if (bitsPerSample !== 16) {
    throw new Error(
      `WAV должен быть 16-bit PCM. Сейчас: ${bitsPerSample}-bit.`
    );
  }

  if (dataSize <= 0) {
    throw new Error(
      "В WAV нет аудиоданных."
    );
  }

  const pcmBuffer = buffer.subarray(
    dataStart,
    dataStart + dataSize
  );

  console.log(
    `🎵 PCM-данные: ${pcmBuffer.length} байт`
  );

  return {
    pcmBuffer,
    channels,
    sampleRate,
    bitsPerSample,
  };
}

// ============================================================
// PLAY WAV
// ============================================================

function playSound(number) {
  if (!voiceSession) {
    return Promise.reject(
      new Error("Voice-сессия не существует.")
    );
  }

  const filePath = getSoundPath(number);

  if (!fs.existsSync(filePath)) {
    return Promise.reject(
      new Error(
        `Файл ${number}.wav не найден.`
      )
    );
  }

  console.log(
    `🎵 Подготавливаю ${number}.wav...`
  );

  let wav;

  try {
    wav = parseWavFile(filePath);
  } catch (error) {
    return Promise.reject(error);
  }

  const pcmStream = Readable.from([
    wav.pcmBuffer,
  ]);

  const resource = createAudioResource(
    pcmStream,
    {
      inputType: StreamType.Raw,
      inlineVolume: false,
    }
  );

  console.log(
    `▶️ Начинаю воспроизведение ${number}.wav`
  );

  return new Promise((resolve, reject) => {
    let finished = false;

    const cleanup = () => {
      voiceSession?.player?.off(
        AudioPlayerStatus.Playing,
        onPlaying
      );

      voiceSession?.player?.off(
        AudioPlayerStatus.Idle,
        onIdle
      );

      voiceSession?.player?.off(
        "error",
        onError
      );
    };

    const finishSuccess = () => {
      if (finished) return;

      finished = true;
      cleanup();

      console.log(
        `✓ ${number}.wav закончил воспроизведение`
      );

      resolve();
    };

    const finishError = (error) => {
      if (finished) return;

      finished = true;
      cleanup();

      console.error(
        `❌ Ошибка воспроизведения ${number}.wav:`,
        error
      );

      reject(error);
    };

    const onPlaying = () => {
      console.log(
        `🔊 ${number}.wav реально начал воспроизводиться`
      );
    };

    const onIdle = () => {
      finishSuccess();
    };

    const onError = (error) => {
      finishError(error);
    };

    voiceSession.player.once(
      AudioPlayerStatus.Playing,
      onPlaying
    );

    voiceSession.player.once(
      AudioPlayerStatus.Idle,
      onIdle
    );

    voiceSession.player.once(
      "error",
      onError
    );

    try {
      voiceSession.player.play(resource);
    } catch (error) {
      finishError(error);
    }
  });
}

// ============================================================
// DISCONNECT VOICE
// ============================================================

function disconnectVoice() {
  if (!voiceSession) {
    return;
  }

  try {
    if (voiceSession.player) {
      voiceSession.player.stop(true);
    }
  } catch {}

  try {
    if (voiceSession.connection) {
      voiceSession.connection.destroy();
    }
  } catch {}

  voiceSession = null;

  console.log(
    "Бот отключился от голосового канала."
  );
}

// ============================================================
// SLASH COMMANDS
// ============================================================

const commands = [
  // ----------------------------------------------------------
  // STATS
  // ----------------------------------------------------------

  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Показать мою статистику"),

  // ----------------------------------------------------------
  // AI
  // ----------------------------------------------------------

  new SlashCommandBuilder()
    .setName("ai")
    .setDescription("Задать вопрос AI")
    .addStringOption((option) =>
      option
        .setName("вопрос")
        .setDescription("Ваш вопрос")
        .setRequired(true)
    ),

  // ----------------------------------------------------------
  // VOICE
  // ----------------------------------------------------------

  new SlashCommandBuilder()
    .setName("voiceai")
    .setDescription("Проиграть WAV-звук")
    .addIntegerOption((option) =>
      option
        .setName("номер")
        .setDescription("Номер звука")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("voiceai-stop")
    .setDescription("Остановить воспроизведение"),

  // ----------------------------------------------------------
  // ENTERTAINMENT
  // ----------------------------------------------------------

  new SlashCommandBuilder()
    .setName("coinflip")
    .setDescription("Подбросить монетку"),

  new SlashCommandBuilder()
    .setName("dice")
    .setDescription("Бросить кубик"),

  new SlashCommandBuilder()
    .setName("8ball")
    .setDescription("Задать вопрос магическому шару")
    .addStringOption((option) =>
      option
        .setName("вопрос")
        .setDescription("Ваш вопрос")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("riddle")
    .setDescription("Получить случайную загадку"),

  new SlashCommandBuilder()
    .setName("fact")
    .setDescription("Получить случайный факт"),

  new SlashCommandBuilder()
    .setName("joke")
    .setDescription("Получить случайную шутку"),

  new SlashCommandBuilder()
    .setName("quote")
    .setDescription("Получить случайную цитату"),

  new SlashCommandBuilder()
    .setName("poll")
    .setDescription("Создать опрос")
    .addStringOption((option) =>
      option
        .setName("вопрос")
        .setDescription("Вопрос для опроса")
        .setRequired(true)
    ),
];

// ============================================================
// REGISTER COMMANDS
// ============================================================

async function registerCommands() {
  console.log("🔄 Обновляю slash-команды...");

  const rest = new REST({
    version: "10",
  }).setToken(TOKEN);

  try {
    if (GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(
          CLIENT_ID,
          GUILD_ID
        ),
        {
          body: commands.map((command) =>
            command.toJSON()
          ),
        }
      );
    } else {
      await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        {
          body: commands.map((command) =>
            command.toJSON()
          ),
        }
      );
    }

    console.log(
      "✓ Slash-команды зарегистрированы."
    );
  } catch (error) {
    console.error(
      "❌ Ошибка регистрации slash-команд:",
      error
    );
  }
}

// ============================================================
// READY
// ============================================================

client.once("clientReady", async () => {
  console.log(
    `✓ Бот запущен как ${client.user.tag}`
  );

  loadStats();
  dailyReset();

  await registerCommands();
});

// ============================================================
// INTERACTIONS
// ============================================================

client.on("interactionCreate", async (interaction) => {
  // ==========================================================
  // BUTTONS
  // ==========================================================

  if (interaction.isButton()) {
    const customId = interaction.customId;

    // --------------------------------------------------------
    // POLL YES
    // --------------------------------------------------------

    if (customId.startsWith("poll_yes:")) {
      const pollId = customId.split(":")[1];
      const poll = polls.get(pollId);

      if (!poll) {
        await interaction.reply({
          content: "❌ Этот опрос больше не активен.",
          ephemeral: true,
        });

        return;
      }

      if (poll.voters.has(interaction.user.id)) {
        await interaction.reply({
          content: "⚠️ Ты уже голосовал в этом опросе.",
          ephemeral: true,
        });

        return;
      }

      poll.voters.add(interaction.user.id);
      poll.yes += 1;

      await interaction.update({
        embeds: undefined,
        content:
          `📊 **ОПРОС**\n\n` +
          `**${poll.question}**\n\n` +
          `👍 За: **${poll.yes}**\n` +
          `👎 Против: **${poll.no}**`,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`poll_yes:${pollId}`)
              .setLabel(`👍 За (${poll.yes})`)
              .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
              .setCustomId(`poll_no:${pollId}`)
              .setLabel(`👎 Против (${poll.no})`)
              .setStyle(ButtonStyle.Danger)
          ),
        ],
      });

      return;
    }

    // --------------------------------------------------------
    // POLL NO
    // --------------------------------------------------------

    if (customId.startsWith("poll_no:")) {
      const pollId = customId.split(":")[1];
      const poll = polls.get(pollId);

      if (!poll) {
        await interaction.reply({
          content: "❌ Этот опрос больше не активен.",
          ephemeral: true,
        });

        return;
      }

      if (poll.voters.has(interaction.user.id)) {
        await interaction.reply({
          content: "⚠️ Ты уже голосовал в этом опросе.",
          ephemeral: true,
        });

        return;
      }

      poll.voters.add(interaction.user.id);
      poll.no += 1;

      await interaction.update({
        embeds: undefined,
        content:
          `📊 **ОПРОС**\n\n` +
          `**${poll.question}**\n\n` +
          `👍 За: **${poll.yes}**\n` +
          `👎 Против: **${poll.no}**`,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`poll_yes:${pollId}`)
              .setLabel(`👍 За (${poll.yes})`)
              .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
              .setCustomId(`poll_no:${pollId}`)
              .setLabel(`👎 Против (${poll.no})`)
              .setStyle(ButtonStyle.Danger)
          ),
        ],
      });

      return;
    }

    return;
  }

  // ==========================================================
  // SLASH COMMAND CHECK
  // ==========================================================

  if (!interaction.isChatInputCommand()) {
    return;
  }

  // ==========================================================
  // /stats
  // ==========================================================

  if (interaction.commandName === "stats") {
    try {
      await interaction.deferReply();

      const image = await createStatsImage(
        interaction.user
      );

      const attachment = new AttachmentBuilder(
        image,
        {
          name: "stats.png",
        }
      );

      await interaction.editReply({
        files: [attachment],
      });
    } catch (error) {
      console.error(
        "❌ Ошибка /stats:",
        error
      );

      if (interaction.deferred) {
        await interaction.editReply(
          "❌ Не удалось создать статистику."
        );
      }
    }

    return;
  }

  // ==========================================================
  // /ai
  // ==========================================================

  if (interaction.commandName === "ai") {
    const prompt =
      interaction.options.getString(
        "вопрос",
        true
      );

    try {
      await interaction.deferReply();

      const answer = await askAI(prompt);

      await interaction.editReply(
        answer.slice(0, 2000)
      );
    } catch (error) {
      console.error(
        "❌ Ошибка /ai:",
        error
      );

      try {
        if (interaction.deferred) {
          await interaction.editReply(
            "❌ Не удалось получить ответ от AI."
          );
        }
      } catch {}
    }

    return;
  }

  // ==========================================================
  // /coinflip
  // ==========================================================

  if (interaction.commandName === "coinflip") {
    const result = coinFlip();

    await interaction.reply(
      `🪙 Монетка подброшена...\n\n**${result}!**`
    );

    return;
  }

  // ==========================================================
  // /dice
  // ==========================================================

  if (interaction.commandName === "dice") {
    const result = rollDice(6);

    await interaction.reply(
      `🎲 Кубик брошен!\n\nВыпало: **${result}**`
    );

    return;
  }

  // ==========================================================
  // /8ball
  // ==========================================================

  if (interaction.commandName === "8ball") {
    const question =
      interaction.options.getString(
        "вопрос",
        true
      );

    const answer = randomItem(
      eightBallAnswers
    );

    await interaction.reply(
      `🔮 **Магический шар**\n\n` +
      `❓ ${question}\n\n` +
      `${answer}`
    );

    return;
  }

  // ==========================================================
  // /riddle
  // ==========================================================

  if (interaction.commandName === "riddle") {
    const riddle = randomItem(riddles);

    await interaction.reply(
      `🧩 **Загадка**\n\n${riddle.question}\n\n` +
      `||Ответ: ${riddle.answer}||`
    );

    return;
  }

  // ==========================================================
  // /fact
  // ==========================================================

  if (interaction.commandName === "fact") {
    const fact = randomItem(facts);

    await interaction.reply(
      `🧠 **Интересный факт**\n\n${fact}`
    );

    return;
  }

  // ==========================================================
  // /joke
  // ==========================================================

  if (interaction.commandName === "joke") {
    const joke = randomItem(jokes);

    await interaction.reply(joke);

    return;
  }

  // ==========================================================
  // /quote
  // ==========================================================

  if (interaction.commandName === "quote") {
    const quote = randomItem(quotes);

    await interaction.reply(quote);

    return;
  }

  // ==========================================================
  // /poll
  // ==========================================================

  if (interaction.commandName === "poll") {
    const question =
      interaction.options.getString(
        "вопрос",
        true
      );

    const pollId =
      `${interaction.id}_${Date.now()}`;

    polls.set(pollId, {
      question,
      yes: 0,
      no: 0,
      voters: new Set(),
    });

    const row =
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`poll_yes:${pollId}`)
          .setLabel("👍 За (0)")
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId(`poll_no:${pollId}`)
          .setLabel("👎 Против (0)")
          .setStyle(ButtonStyle.Danger)
      );

    await interaction.reply({
      content:
        `📊 **ОПРОС**\n\n` +
        `**${question}**\n\n` +
        `👍 За: **0**\n` +
        `👎 Против: **0**`,
      components: [row],
    });

    // Удаляем старый опрос из памяти через 24 часа.
    setTimeout(() => {
      polls.delete(pollId);
    }, 24 * 60 * 60 * 1000);

    return;
  }

  // ==========================================================
  // /voiceai-stop
  // ==========================================================

  if (
    interaction.commandName ===
    "voiceai-stop"
  ) {
    try {
      if (!voiceSession) {
        await interaction.reply(
          "ℹ️ Бот сейчас не находится в голосовом канале."
        );

        return;
      }

      disconnectVoice();

      await interaction.reply(
        "⏹️ Воспроизведение остановлено."
      );
    } catch (error) {
      console.error(
        "❌ Ошибка /voiceai-stop:",
        error
      );

      if (!interaction.replied) {
        await interaction.reply(
          "❌ Не удалось остановить воспроизведение."
        );
      }
    }

    return;
  }

  // ==========================================================
  // /voiceai
  // ==========================================================

  if (
    interaction.commandName === "voiceai"
  ) {
    const number =
      interaction.options.getInteger(
        "номер",
        true
      );

    const member =
      interaction.member;

    const voiceChannel =
      member?.voice?.channel;

    if (!voiceChannel) {
      await interaction.reply(
        "❌ Сначала зайди в голосовой канал."
      );

      return;
    }

    const filePath =
      getSoundPath(number);

    if (!fs.existsSync(filePath)) {
      await interaction.reply(
        `❌ Файл ${number}.wav не найден в папке sounds.`
      );

      return;
    }

    try {
      await interaction.deferReply();

      if (voiceSession) {
        disconnectVoice();
      }

      console.log(
        `Подключаюсь к "${voiceChannel.name}"...`
      );

      const connection =
        joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: voiceChannel.guild.id,
          adapterCreator:
            voiceChannel.guild.voiceAdapterCreator,
          selfDeaf: false,
          selfMute: false,
        });

      const player =
        createAudioPlayer({
          behaviors: {
            noSubscriber:
              NoSubscriberBehavior.Play,
          },
        });

      connection.subscribe(player);

      voiceSession = {
        connection,
        player,
        channelId: voiceChannel.id,
        number,
      };

      try {
        await waitForVoiceReady(
          connection
        );

        console.log(
          `✓ Voice READY: "${voiceChannel.name}"`
        );

        console.log(
          `✓ Полностью подключён к "${voiceChannel.name}"`
        );
      } catch (error) {
        disconnectVoice();
        throw error;
      }

      console.log(
        "⏳ Жду 3 секунды перед воспроизведением..."
      );

      await new Promise((resolve) =>
        setTimeout(resolve, 3000)
      );

      console.log(
        "▶️ 3 секунды прошли, запускаю звук..."
      );

      await playSound(number);

      await interaction.editReply(
        `🔊 Звук ${number}.wav воспроизведён.`
      );

      disconnectVoice();
    } catch (error) {
      console.error(
        "❌ Ошибка /voiceai:",
        error
      );

      disconnectVoice();

      const message =
        error?.message ||
        "Неизвестная ошибка.";

      try {
        if (interaction.deferred) {
          await interaction.editReply(
            `❌ Не удалось воспроизвести звук.\n\`${message}\``
          );
        }
      } catch {}
    }

    return;
  }
});

// ============================================================
// GLOBAL ERROR HANDLERS
// ============================================================

process.on(
  "unhandledRejection",
  (error) => {
    console.error(
      "❌ Unhandled Rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "❌ Uncaught Exception:",
      error
    );
  }
);

// ============================================================
// LOGIN
// ============================================================

client.login(TOKEN);
