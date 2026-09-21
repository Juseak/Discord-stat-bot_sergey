"use strict";

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
const {
  createCanvas,
  loadImage,
  GlobalFonts,
} = require("@napi-rs/canvas");

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { Readable } = require("stream");

// ============================================================
// ENV
// ============================================================

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const AI_MODEL = "gemini-3.5-flash-lite";

if (!DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN не найден");
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error("❌ CLIENT_ID не найден");
  process.exit(1);
}

if (!GUILD_ID) {
  console.error("❌ GUILD_ID не найден");
  process.exit(1);
}

if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY не найден");
  process.exit(1);
}

// ============================================================
// PATHS
// ============================================================

const ROOT = __dirname;

const STATS_FILE = path.join(ROOT, "stats.json");
const TEMPLATE_FILE = path.join(ROOT, "template.png");
const FONT_FILE = path.join(ROOT, "font.ttf");

const RUNTIME_DIR = path.join(ROOT, "runtime");

const WHISPER_BIN =
  process.env.WHISPER_BIN ||
  "/opt/whisper.cpp/build/bin/whisper-cli";

const WHISPER_MODEL =
  process.env.WHISPER_MODEL ||
  "/opt/whisper.cpp/models/ggml-base.bin";

const PIPER_BIN =
  process.env.PIPER_BIN ||
  "python3";

const PIPER_VOICE =
  process.env.PIPER_VOICE ||
  "ru_RU-dmitri-medium";

const PIPER_DATA_DIR =
  process.env.PIPER_DATA_DIR ||
  "/opt/piper";

fs.mkdirSync(RUNTIME_DIR, { recursive: true });

// ============================================================
// DISCORD CLIENT
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
// GEMINI
// ============================================================

const gemini = new GoogleGenAI({
  apiKey: GEMINI_API_KEY,
});

async function askAI(prompt) {
  const response = await gemini.models.generateContent({
    model: AI_MODEL,
    contents: prompt,
    config: {
      systemInstruction: `
Ты обычный AI-ассистент Discord-бота.

Отвечай на русском языке.

Будь дружелюбным, понятным и естественным.

Если это голосовой разговор:
- отвечай коротко;
- не используй Markdown;
- не используй длинные списки;
- не добавляй лишние пояснения;
- говори так, чтобы ответ хорошо звучал вслух.

Не представляйся человеком.
      `,
    },
  });

  return response.text || "Не удалось получить ответ.";
}

// ============================================================
// STATS
// ============================================================

let stats = {};

function loadStats() {
  try {
    if (!fs.existsSync(STATS_FILE)) {
      stats = {};
      saveStats();
      return;
    }

    stats = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));

    if (!stats.users) {
      stats.users = {};
    }
  } catch (error) {
    console.error("❌ Ошибка загрузки stats.json:", error);
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
    console.error("❌ Ошибка сохранения stats.json:", error);
  }
}

function ensureUser(userId) {
  if (!stats.users) {
    stats.users = {};
  }

  if (!stats.users[userId]) {
    stats.users[userId] = {
      messages: 0,
      voiceSeconds: 0,
      discordSeconds: 0,
      gamingSeconds: 0,
      gamingGame: null,

      activeVoiceSince: null,
      activeDiscordSince: null,
      activeGamingSince: null,
    };
  }

  return stats.users[userId];
}

function getUserStats(userId) {
  return ensureUser(userId);
}

function resetDailyStats() {
  for (const userId of Object.keys(stats.users || {})) {
    const user = stats.users[userId];

    user.messages = 0;
    user.voiceSeconds = 0;
    user.discordSeconds = 0;
    user.gamingSeconds = 0;
    user.gamingGame = null;

    if (user.activeVoiceSince) {
      user.activeVoiceSince = Date.now();
    }

    if (user.activeDiscordSince) {
      user.activeDiscordSince = Date.now();
    }

    if (user.activeGamingSince) {
      user.activeGamingSince = Date.now();
    }
  }

  saveStats();

  console.log("🔄 Дневная статистика сброшена");
}

function getDurationSeconds(start) {
  if (!start) return 0;

  return Math.max(
    0,
    Math.floor((Date.now() - start) / 1000)
  );
}

function getVoiceSeconds(user) {
  return (
    Number(user.voiceSeconds || 0) +
    getDurationSeconds(user.activeVoiceSince)
  );
}

function getDiscordSeconds(user) {
  return (
    Number(user.discordSeconds || 0) +
    getDurationSeconds(user.activeDiscordSince)
  );
}

function getGamingSeconds(user) {
  return (
    Number(user.gamingSeconds || 0) +
    getDurationSeconds(user.activeGamingSince)
  );
}

loadStats();

setInterval(saveStats, 30_000);

// ============================================================
// DAILY RESET
// ============================================================

let lastResetDay = new Date().getDate();

setInterval(() => {
  const now = new Date();
  const currentDay = now.getDate();

  if (currentDay !== lastResetDay) {
    lastResetDay = currentDay;
    resetDailyStats();
  }
}, 60_000);

// ============================================================
// MESSAGE TRACKING
// ============================================================

client.on("messageCreate", (message) => {
  if (!message.guild) return;
  if (message.author.bot) return;

  const user = ensureUser(message.author.id);

  user.messages++;

  saveStats();
});

// ============================================================
// VOICE TRACKING
// ============================================================

client.on("voiceStateUpdate", (oldState, newState) => {
  const userId = newState.id;

  if (newState.member?.user?.bot) {
    return;
  }

  const user = ensureUser(userId);

  const wasInVoice = Boolean(oldState.channelId);
  const isInVoice = Boolean(newState.channelId);

  if (!wasInVoice && isInVoice) {
    user.activeVoiceSince = Date.now();
  }

  if (wasInVoice && !isInVoice) {
    user.voiceSeconds =
      Number(user.voiceSeconds || 0) +
      getDurationSeconds(user.activeVoiceSince);

    user.activeVoiceSince = null;
  }

  saveStats();
});

// ============================================================
// PRESENCE TRACKING
// ============================================================

client.on("presenceUpdate", (oldPresence, newPresence) => {
  if (!newPresence?.userId) return;

  const user = ensureUser(newPresence.userId);

  const playingActivity =
    newPresence.activities?.find(
      (activity) => activity.type === ActivityType.Playing
    );

  const wasGaming =
    oldPresence?.activities?.some(
      (activity) => activity.type === ActivityType.Playing
    ) || false;

  const isGaming = Boolean(playingActivity);

  if (!wasGaming && isGaming) {
    user.activeGamingSince = Date.now();
    user.gamingGame = playingActivity.name;
  }

  if (wasGaming && !isGaming) {
    user.gamingSeconds =
      Number(user.gamingSeconds || 0) +
      getDurationSeconds(user.activeGamingSince);

    user.activeGamingSince = null;
    user.gamingGame = null;
  }

  if (isGaming) {
    user.gamingGame = playingActivity.name;
  }

  saveStats();
});

// ============================================================
// STATS CARD
// ============================================================

function formatDuration(seconds) {
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

async function createStatsImage(member) {
  const width = 1536;
  const height = 1536;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  if (fs.existsSync(TEMPLATE_FILE)) {
    const template = await loadImage(TEMPLATE_FILE);
    ctx.drawImage(template, 0, 0, width, height);
  } else {
    ctx.fillStyle = "#111111";
    ctx.fillRect(0, 0, width, height);
  }

  if (fs.existsSync(FONT_FILE)) {
    try {
      GlobalFonts.registerFromPath(FONT_FILE, "CustomFont");
      ctx.font = "48px CustomFont";
    } catch {
      ctx.font = "48px Arial";
    }
  } else {
    ctx.font = "48px Arial";
  }

  const user = getUserStats(member.id);

  const voiceSeconds = getVoiceSeconds(user);
  const messageCount = Number(user.messages || 0);
  const discordSeconds = getDiscordSeconds(user);
  const gamingSeconds = getGamingSeconds(user);

  ctx.fillStyle = "#ff4b4b";
  ctx.fillText(
    `VOICE  ${formatDuration(voiceSeconds)}`,
    120,
    500
  );

  ctx.fillStyle = "#55a8ff";
  ctx.fillText(
    `MESSAGE  ${messageCount}`,
    120,
    620
  );

  ctx.fillStyle = "#c080ff";
  ctx.fillText(
    `DISCORD  ${formatDuration(discordSeconds)}`,
    120,
    740
  );

  ctx.fillStyle = "#43ff91";
  ctx.fillText(
    `GAMING  ${formatDuration(gamingSeconds)}`,
    120,
    860
  );

  ctx.fillStyle = "#ffd84a";
  ctx.fillText(
    "MUSIC  SOON",
    120,
    980
  );

  return canvas.toBuffer("image/png");
}

// ============================================================
// ENTERTAINMENT
// ============================================================

const eightBallAnswers = [
  "Да.",
  "Нет.",
  "Скорее всего.",
  "Возможно.",
  "Определённо.",
  "Лучше не стоит.",
  "Шансы хорошие.",
  "Спроси позже.",
  "Звёзды пока молчат.",
  "Похоже на да.",
];

const riddles = [
  {
    question: "Что можно увидеть с закрытыми глазами?",
    answer: "Сон.",
  },
  {
    question: "Что становится мокрым, пока сушит?",
    answer: "Полотенце.",
  },
  {
    question: "Что имеет много ключей, но не открывает ни одной двери?",
    answer: "Пианино.",
  },
  {
    question: "Что идёт, но не двигается?",
    answer: "Часы.",
  },
  {
    question: "Что принадлежит тебе, но другие используют это чаще?",
    answer: "Твоё имя.",
  },
];

const facts = [
  "У осьминога три сердца.",
  "Бананы с ботанической точки зрения считаются ягодами.",
  "Мёд при правильном хранении может сохраняться очень долго.",
  "У акул нет костей — их скелет состоит в основном из хряща.",
  "Молния может нагревать воздух до очень высокой температуры.",
];

const jokes = [
  "Почему программист любит тёмную тему? Потому что свет привлекает баги.",
  "Я хотел рассказать шутку про UDP, но не знаю, дошла ли она.",
  "Программист пошёл в магазин и купил 1 молоко. Если было молоко — купил ещё 10.",
  "Почему компьютер устал? Слишком много окон.",
];

const quotes = [
  "Большие вещи начинаются с маленьких шагов.",
  "Ошибки — часть процесса обучения.",
  "Иногда лучший способ решить проблему — сделать паузу.",
  "Главное — не переставать пробовать.",
];

function randomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function coinFlip() {
  return Math.random() < 0.5 ? "Орёл 🪙" : "Решка 🪙";
}

function rollDice(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

// ============================================================
// POLLS
// ============================================================

const polls = new Map();

// ============================================================
// VOICE AI
// ============================================================

const voiceAISessions = new Map();

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    stream.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });

    stream.once("end", () => {
      resolve(Buffer.concat(chunks));
    });

    stream.once("error", reject);
  });
}

function makeWavHeader(dataLength, sampleRate, channels, bitsPerSample) {
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8);

  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);

  const byteRate =
    sampleRate * channels * (bitsPerSample / 8);

  header.writeUInt32LE(byteRate, 28);

  const blockAlign =
    channels * (bitsPerSample / 8);

  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);

  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
}

function pcm48StereoToWav16Mono(pcm) {
  const bytesPerFrame = 4;
  const frameCount = Math.floor(pcm.length / bytesPerFrame);

  // 48 kHz -> 16 kHz
  const outputFrames = Math.floor(frameCount / 3);

  const output = Buffer.alloc(outputFrames * 2);

  for (let i = 0; i < outputFrames; i++) {
    let sum = 0;

    for (let j = 0; j < 3; j++) {
      const sourceFrame = i * 3 + j;
      const offset = sourceFrame * bytesPerFrame;

      const left = pcm.readInt16LE(offset);
      const right = pcm.readInt16LE(offset + 2);

      sum += (left + right) / 2;
    }

    let value = Math.round(sum / 3);

    if (value > 32767) value = 32767;
    if (value < -32768) value = -32768;

    output.writeInt16LE(value, i * 2);
  }

  const header = makeWavHeader(
    output.length,
    16000,
    1,
    16
  );

  return Buffer.concat([header, output]);
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
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

    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        resolve({
          stdout,
          stderr,
        });
        return;
      }

      reject(
        new Error(
          `${command} завершился с кодом ${code}\n${stderr}`
        )
      );
    });
  });
}

async function transcribeWithWhisper(wavFile) {
  const baseName = path.join(
    RUNTIME_DIR,
    `whisper-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`
  );

  await runProcess(WHISPER_BIN, [
    "-m",
    WHISPER_MODEL,
    "-f",
    wavFile,
    "-l",
    "ru",
    "-otxt",
    "-of",
    baseName,
    "-nt",
    "-np",
  ]);

  const txtFile = `${baseName}.txt`;

  if (!fs.existsSync(txtFile)) {
    return "";
  }

  const text = fs
    .readFileSync(txtFile, "utf8")
    .replace(/\s+/g, " ")
    .trim();

  try {
    fs.unlinkSync(txtFile);
  } catch {}

  return text;
}

async function textToSpeech(text, outputFile) {
  const cleanText = text
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500);

  if (!cleanText) {
    return false;
  }

  await runProcess(
    PIPER_BIN,
    [
      "-m",
      "piper",
      "--data-dir",
      PIPER_DATA_DIR,
      "--model",
      PIPER_VOICE,
      "--output_file",
      outputFile,
      "--",
      cleanText,
    ]
  );

  return fs.existsSync(outputFile);
}

async function playVoiceFile(session, file) {
  return new Promise((resolve, reject) => {
    if (!session?.connection) {
      reject(new Error("Voice connection отсутствует"));
      return;
    }

    const resource = createAudioResource(file, {
      inputType: StreamType.Arbitrary,
    });

    session.player.play(resource);

    const onIdle = () => {
      cleanup();
      resolve();
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    function cleanup() {
      session.player.off(AudioPlayerStatus.Idle, onIdle);
      session.player.off("error", onError);
    }

    session.player.once(AudioPlayerStatus.Idle, onIdle);
    session.player.once("error", onError);
  });
}

async function processVoiceAudio(
  session,
  userId,
  opusStream
) {
  if (!session.active) return;

  if (session.busy) {
    return;
  }

  session.busy = true;

  let pcmStream;
  let wavFile;
  let ttsFile;

  try {
    const decoder = new prism.opus.Decoder({
      frameSize: 960,
      channels: 2,
      rate: 48000,
    });

    pcmStream = opusStream.pipe(decoder);

    const pcm = await streamToBuffer(pcmStream);

    if (!session.active) return;

    if (pcm.length < 4000) {
      return;
    }

    const wav = pcm48StereoToWav16Mono(pcm);

    wavFile = path.join(
      RUNTIME_DIR,
      `input-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}.wav`
    );

    fs.writeFileSync(wavFile, wav);

    console.log(
      `🎙️ Whisper: обрабатываю речь ${userId}`
    );

    const transcript =
      await transcribeWithWhisper(wavFile);

    if (!transcript) {
      return;
    }

    console.log(`🗣️ ${userId}: ${transcript}`);

    if (!session.active) return;

    const prompt = `
Это голосовой разговор в Discord.

Пользователь сказал:
"${transcript}"

Ответь ему естественно и коротко, на русском языке.
Ответ должен хорошо звучать при озвучке.
Не используй Markdown.
Не начинай ответ словами "Конечно!" без необходимости.
Не повторяй вопрос пользователя целиком.
`;

    let answer;

    try {
      answer = await askAI(prompt);
    } catch (error) {
      console.error("❌ Gemini Voice AI:", error);

      answer =
        "Извини, сейчас я не смог придумать ответ.";
    }

    if (!session.active) return;

    console.log(`🤖 AI: ${answer}`);

    ttsFile = path.join(
      RUNTIME_DIR,
      `tts-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}.wav`
    );

    await textToSpeech(answer, ttsFile);

    if (!session.active) return;

    await playVoiceFile(session, ttsFile);
  } catch (error) {
    console.error(
      "❌ Ошибка обработки Voice AI:",
      error
    );
  } finally {
    session.busy = false;

    if (wavFile) {
      try {
        fs.unlinkSync(wavFile);
      } catch {}
    }

    if (ttsFile) {
      try {
        fs.unlinkSync(ttsFile);
      } catch {}
    }
  }
}

function stopVoiceAISession(guildId) {
  const session = voiceAISessions.get(guildId);

  if (!session) {
    return false;
  }

  session.active = false;

  try {
    session.player.stop();
  } catch {}

  try {
    session.connection.receiver.speaking.removeAllListeners(
      "start"
    );
  } catch {}

  try {
    session.connection.destroy();
  } catch {}

  voiceAISessions.delete(guildId);

  return true;
}

function startVoiceAISession(guild, member) {
  stopVoiceAISession(guild.id);

  const channel = member.voice.channel;

  if (!channel) {
    throw new Error(
      "Ты должен находиться в голосовом канале."
    );
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });

  const player = createAudioPlayer();

  connection.subscribe(player);

  const session = {
    guildId: guild.id,
    channelId: channel.id,
    connection,
    player,
    active: true,
    busy: false,
    processingUsers: new Set(),
  };

  voiceAISessions.set(guild.id, session);

  connection.on(
    VoiceConnectionStatus.Disconnected,
    () => {
      const current = voiceAISessions.get(guild.id);

      if (current === session) {
        voiceAISessions.delete(guild.id);
      }
    }
  );

  connection.on(
    VoiceConnectionStatus.Destroyed,
    () => {
      const current = voiceAISessions.get(guild.id);

      if (current === session) {
        voiceAISessions.delete(guild.id);
      }
    }
  );

  connection.receiver.speaking.on(
    "start",
    async (userId) => {
      if (!session.active) return;

      if (userId === client.user.id) {
        return;
      }

      if (session.busy) {
        return;
      }

      if (session.processingUsers.has(userId)) {
        return;
      }

      const guildMember =
        guild.members.cache.get(userId);

      if (!guildMember) {
        return;
      }

      if (guildMember.user.bot) {
        return;
      }

      session.processingUsers.add(userId);

      try {
        const audioStream =
          connection.receiver.subscribe(userId, {
            end: {
              behavior: EndBehaviorType.AfterSilence,
              duration: 800,
            },
          });

        await processVoiceAudio(
          session,
          userId,
          audioStream
        );
      } catch (error) {
        console.error(
          "❌ Ошибка получения Discord audio:",
          error
        );
      } finally {
        session.processingUsers.delete(userId);
      }
    }
  );

  return session;
}

// ============================================================
// SLASH COMMANDS
// ============================================================

const commands = [
  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Показать статистику пользователя"),

  new SlashCommandBuilder()
    .setName("ai")
    .setDescription("Задать вопрос AI")
    .addStringOption((option) =>
      option
        .setName("вопрос")
        .setDescription("Ваш вопрос")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("voiceai")
    .setDescription(
      "Запустить голосовой AI в текущем голосовом канале"
    ),

  new SlashCommandBuilder()
    .setName("voiceai-stop")
    .setDescription(
      "Остановить голосовой AI"
    ),

  new SlashCommandBuilder()
    .setName("coinflip")
    .setDescription("Подбросить монетку"),

  new SlashCommandBuilder()
    .setName("dice")
    .setDescription("Бросить кубик")
    .addIntegerOption((option) =>
      option
        .setName("грани")
        .setDescription("Количество граней")
        .setRequired(false)
        .setMinValue(2)
        .setMaxValue(100)
    ),

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
    .setDescription("Загадка"),

  new SlashCommandBuilder()
    .setName("fact")
    .setDescription("Случайный факт"),

  new SlashCommandBuilder()
    .setName("joke")
    .setDescription("Случайная шутка"),

  new SlashCommandBuilder()
    .setName("quote")
    .setDescription("Случайная цитата"),

  new SlashCommandBuilder()
    .setName("poll")
    .setDescription("Создать опрос")
    .addStringOption((option) =>
      option
        .setName("вопрос")
        .setDescription("Вопрос для опроса")
        .setRequired(true)
    ),
].map((command) => command.toJSON());

// ============================================================
// REGISTER COMMANDS
// ============================================================

async function registerCommands() {
  const rest = new REST({
    version: "10",
  }).setToken(DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(
      CLIENT_ID,
      GUILD_ID
    ),
    {
      body: commands,
    }
  );

  console.log("✅ Slash-команды зарегистрированы");
}

// ============================================================
// READY
// ============================================================

client.once("clientReady", async () => {
  console.log(`🤖 Бот запущен: ${client.user.tag}`);

  console.log(
    `🧠 Gemini model: ${AI_MODEL}`
  );

  console.log(
    `🎙️ Whisper: ${WHISPER_BIN}`
  );

  console.log(
    `🔊 Piper: ${PIPER_VOICE}`
  );

  try {
    await registerCommands();
  } catch (error) {
    console.error(
      "❌ Ошибка регистрации команд:",
      error
    );
  }
});

// ============================================================
// INTERACTIONS
// ============================================================

client.on("interactionCreate", async (interaction) => {
  try {
    // --------------------------------------------------------
    // BUTTONS
    // --------------------------------------------------------

    if (interaction.isButton()) {
      const [type, pollId] =
        interaction.customId.split(":");

      if (
        type !== "poll_yes" &&
        type !== "poll_no"
      ) {
        return;
      }

      const poll = polls.get(pollId);

      if (!poll) {
        await interaction.reply({
          content: "Этот опрос уже закончился.",
          ephemeral: true,
        });

        return;
      }

      if (
        poll.yes.has(interaction.user.id) ||
        poll.no.has(interaction.user.id)
      ) {
        await interaction.reply({
          content: "Ты уже голосовал.",
          ephemeral: true,
        });

        return;
      }

      if (type === "poll_yes") {
        poll.yes.add(interaction.user.id);
      } else {
        poll.no.add(interaction.user.id);
      }

      await interaction.reply({
        content: "Голос засчитан!",
        ephemeral: true,
      });

      const message = interaction.message;

      const yesCount = poll.yes.size;
      const noCount = poll.no.size;

      const updatedRow =
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`poll_yes:${pollId}`)
            .setLabel(`Да: ${yesCount}`)
            .setStyle(ButtonStyle.Success),

          new ButtonBuilder()
            .setCustomId(`poll_no:${pollId}`)
            .setLabel(`Нет: ${noCount}`)
            .setStyle(ButtonStyle.Danger)
        );

      await message.edit({
        components: [updatedRow],
      });

      return;
    }

    if (!interaction.isChatInputCommand()) {
      return;
    }

    // --------------------------------------------------------
    // /stats
    // --------------------------------------------------------

    if (interaction.commandName === "stats") {
      await interaction.deferReply();

      const member = interaction.member;

      const image = await createStatsImage(member);

      const attachment =
        new AttachmentBuilder(image, {
          name: "stats.png",
        });

      await interaction.editReply({
        files: [attachment],
      });

      return;
    }

    // --------------------------------------------------------
    // /ai
    // --------------------------------------------------------

    if (interaction.commandName === "ai") {
      const question =
        interaction.options.getString(
          "вопрос",
          true
        );

      await interaction.deferReply();

      try {
        const answer = await askAI(question);

        await interaction.editReply(
          answer.slice(0, 2000)
        );
      } catch (error) {
        console.error("❌ /ai:", error);

        await interaction.editReply(
          "❌ Не удалось получить ответ от AI."
        );
      }

      return;
    }

    // --------------------------------------------------------
    // /voiceai
    // --------------------------------------------------------

    if (
      interaction.commandName === "voiceai"
    ) {
      if (!interaction.guild) {
        await interaction.reply({
          content:
            "Эта команда работает только на сервере.",
          ephemeral: true,
        });

        return;
      }

      const member =
        interaction.member;

      if (!member.voice.channel) {
        await interaction.reply({
          content:
            "Сначала зайди в голосовой канал.",
          ephemeral: true,
        });

        return;
      }

      await interaction.deferReply();

      try {
        const session =
          startVoiceAISession(
            interaction.guild,
            member
          );

        await new Promise(
          (resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(
                new Error(
                  "Не удалось подключиться к голосовому каналу."
                )
              );
            }, 15_000);

            if (
              session.connection.state.status ===
              VoiceConnectionStatus.Ready
            ) {
              clearTimeout(timeout);
              resolve();
              return;
            }

            const onReady = () => {
              clearTimeout(timeout);

              session.connection.off(
                VoiceConnectionStatus.Ready,
                onReady
              );

              resolve();
            };

            session.connection.once(
              VoiceConnectionStatus.Ready,
              onReady
            );
          }
        );

        await interaction.editReply(
          "🎙️ Голосовой AI запущен.\n\nГоворите в голосовом канале — я буду слушать, отвечать и продолжать разговор.\n\nОстановить: `/voiceai-stop`"
        );
      } catch (error) {
        console.error(
          "❌ /voiceai:",
          error
        );

        stopVoiceAISession(
          interaction.guild.id
        );

        await interaction.editReply(
          "❌ Не удалось запустить голосовой AI."
        );
      }

      return;
    }

    // --------------------------------------------------------
    // /voiceai-stop
    // --------------------------------------------------------

    if (
      interaction.commandName ===
      "voiceai-stop"
    ) {
      if (!interaction.guild) {
        await interaction.reply({
          content:
            "Эта команда работает только на сервере.",
          ephemeral: true,
        });

        return;
      }

      const stopped =
        stopVoiceAISession(
          interaction.guild.id
        );

      await interaction.reply(
        stopped
          ? "🔇 Голосовой AI остановлен."
          : "Голосовой AI сейчас не запущен."
      );

      return;
    }

    // --------------------------------------------------------
    // /coinflip
    // --------------------------------------------------------

    if (
      interaction.commandName === "coinflip"
    ) {
      await interaction.reply(
        `🪙 ${coinFlip()}`
      );

      return;
    }

    // --------------------------------------------------------
    // /dice
    // --------------------------------------------------------

    if (
      interaction.commandName === "dice"
    ) {
      const sides =
        interaction.options.getInteger(
          "грани"
        ) || 6;

      const result = rollDice(sides);

      await interaction.reply(
        `🎲 Выпало: **${result}** из ${sides}`
      );

      return;
    }

    // --------------------------------------------------------
    // /8ball
    // --------------------------------------------------------

    if (
      interaction.commandName === "8ball"
    ) {
      const question =
        interaction.options.getString(
          "вопрос",
          true
        );

      await interaction.reply(
        `🎱 **${question}**\n\n${randomItem(
          eightBallAnswers
        )}`
      );

      return;
    }

    // --------------------------------------------------------
    // /riddle
    // --------------------------------------------------------

    if (
      interaction.commandName === "riddle"
    ) {
      const riddle =
        randomItem(riddles);

      await interaction.reply(
        `🧩 **Загадка**\n\n${riddle.question}\n\n||Ответ: ${riddle.answer}||`
      );

      return;
    }

    // --------------------------------------------------------
    // /fact
    // --------------------------------------------------------

    if (
      interaction.commandName === "fact"
    ) {
      await interaction.reply(
        `🧠 **Факт:** ${randomItem(facts)}`
      );

      return;
    }

    // --------------------------------------------------------
    // /joke
    // --------------------------------------------------------

    if (
      interaction.commandName === "joke"
    ) {
      await interaction.reply(
        `😂 ${randomItem(jokes)}`
      );

      return;
    }

    // --------------------------------------------------------
    // /quote
    // --------------------------------------------------------

    if (
      interaction.commandName === "quote"
    ) {
      await interaction.reply(
        `💬 «${randomItem(quotes)}»`
      );

      return;
    }

    // --------------------------------------------------------
    // /poll
    // --------------------------------------------------------

    if (
      interaction.commandName === "poll"
    ) {
      const question =
        interaction.options.getString(
          "вопрос",
          true
        );

      const pollId =
        `${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}`;

      polls.set(pollId, {
        question,
        yes: new Set(),
        no: new Set(),
      });

      const row =
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(
              `poll_yes:${pollId}`
            )
            .setLabel("Да: 0")
            .setStyle(ButtonStyle.Success),

          new ButtonBuilder()
            .setCustomId(
              `poll_no:${pollId}`
            )
            .setLabel("Нет: 0")
            .setStyle(ButtonStyle.Danger)
        );

      await interaction.reply({
        content:
          `📊 **Опрос**\n\n${question}`,
        components: [row],
      });

      setTimeout(() => {
        polls.delete(pollId);
      }, 24 * 60 * 60 * 1000);

      return;
    }
  } catch (error) {
    console.error(
      "❌ Ошибка interaction:",
      error
    );

    try {
      if (interaction.deferred) {
        await interaction.editReply(
          "❌ Произошла ошибка."
        );
      } else if (!interaction.replied) {
        await interaction.reply({
          content: "❌ Произошла ошибка.",
          ephemeral: true,
        });
      }
    } catch {}
  }
});

// ============================================================
// ERROR HANDLERS
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
// START
// ============================================================

client.login(DISCORD_TOKEN);
