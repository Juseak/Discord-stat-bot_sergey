const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  AttachmentBuilder,
  ActivityType,
} = require("discord.js");

const { GoogleGenAI } = require("@google/genai");

const {
  createCanvas,
  loadImage,
  GlobalFonts,
} = require("@napi-rs/canvas");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  EndBehaviorType,
  StreamType,
} = require("@discordjs/voice");

const prism = require("prism-media");
const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");
const { Readable } = require("stream");

const fs = require("fs");
const path = require("path");

// ============================================================
// ENV
// ============================================================

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

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

console.log("✓ GEMINI_API_KEY найдена");

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
// GEMINI
// ============================================================

const gemini = new GoogleGenAI({
  apiKey: GEMINI_API_KEY,
});

// Обычный /ai — НЕ МЕНЯЕМ
const AI_MODEL = "gemini-3.5-flash-lite";

// Voice AI
// Распознавание речи:
const VOICE_AI_TRANSCRIBE_MODEL = "gemini-3.5-transcribe";

// Генерация ответа:
const VOICE_AI_TEXT_MODEL = "gemini-3.5-flash-lite";

// Озвучка:
const VOICE_AI_TTS_MODEL = "gemini-2.5-flash-preview-tts";

const VOICE_AI_SYSTEM = `
Ты голосовой ассистент в Discord.

Отвечай по-русски.
Отвечай коротко и естественно.
Не используй Markdown.
Не пиши длинные ответы.
Если вопрос простой — ответь кратко.
`;

// ============================================================
// STATS
// ============================================================

const statsPath = path.join(__dirname, "stats.json");
const templatePath = path.join(__dirname, "template.png");
const fontPath = path.join(__dirname, "font.ttf");

let stats = {
  users: {},
};

function loadStats() {
  try {
    if (!fs.existsSync(statsPath)) {
      stats = { users: {} };
      saveStats();
      return;
    }

    const raw = fs.readFileSync(statsPath, "utf8");

    if (!raw.trim()) {
      stats = { users: {} };
      return;
    }

    stats = JSON.parse(raw);

    if (!stats.users || typeof stats.users !== "object") {
      stats.users = {};
    }

    console.log("✓ Статистика загружена!");
  } catch (error) {
    console.error("❌ Ошибка загрузки stats.json:", error);
    stats = { users: {} };
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

loadStats();

// ============================================================
// TEMPLATE / FONT
// ============================================================

let templateImage = null;

if (fs.existsSync(fontPath)) {
  try {
    GlobalFonts.registerFromPath(fontPath, "CustomFont");
    console.log("✓ Шрифт зарегистрирован!");
  } catch (error) {
    console.error("❌ Ошибка регистрации шрифта:", error);
  }
}

async function loadTemplate() {
  try {
    if (!fs.existsSync(templatePath)) {
      console.log("⚠️ template.png не найден.");
      return;
    }

    templateImage = await loadImage(templatePath);
    console.log("✓ Шаблон закэширован!");
  } catch (error) {
    console.error("❌ Ошибка загрузки шаблона:", error);
  }
}

// ============================================================
// USER STATS HELPERS
// ============================================================

function getUserStats(userId) {
  if (!stats.users[userId]) {
    stats.users[userId] = {
      messages: 0,
      voiceSeconds: 0,
      discordSeconds: 0,
      gamingSeconds: 0,
      gamingGame: "",

      messageActiveSince: null,
      voiceActiveSince: null,
      discordActiveSince: null,
      gamingActiveSince: null,
    };
  }

  const user = stats.users[userId];

  if (typeof user.messages !== "number") {
    user.messages = 0;
  }

  if (typeof user.voiceSeconds !== "number") {
    user.voiceSeconds = 0;
  }

  if (typeof user.discordSeconds !== "number") {
    user.discordSeconds = 0;
  }

  if (typeof user.gamingSeconds !== "number") {
    user.gamingSeconds = 0;
  }

  if (typeof user.gamingGame !== "string") {
    user.gamingGame = "";
  }

  if (!("messageActiveSince" in user)) {
    user.messageActiveSince = null;
  }

  if (!("voiceActiveSince" in user)) {
    user.voiceActiveSince = null;
  }

  if (!("discordActiveSince" in user)) {
    user.discordActiveSince = null;
  }

  if (!("gamingActiveSince" in user)) {
    user.gamingActiveSince = null;
  }

  return user;
}

// ============================================================
// ACTIVE TIME
// ============================================================

function updateActiveTime(userId) {
  const user = getUserStats(userId);
  const now = Date.now();

  if (user.messageActiveSince) {
    user.messages += 0;
  }

  if (user.voiceActiveSince) {
    user.voiceSeconds += Math.max(
      0,
      Math.floor((now - user.voiceActiveSince) / 1000)
    );

    user.voiceActiveSince = now;
  }

  if (user.discordActiveSince) {
    user.discordSeconds += Math.max(
      0,
      Math.floor((now - user.discordActiveSince) / 1000)
    );

    user.discordActiveSince = now;
  }

  if (user.gamingActiveSince) {
    user.gamingSeconds += Math.max(
      0,
      Math.floor((now - user.gamingActiveSince) / 1000)
    );

    user.gamingActiveSince = now;
  }
}

// ============================================================
// DAILY RESET
// ============================================================

let lastResetDate = new Date().toDateString();

function checkDailyReset() {
  const currentDate = new Date().toDateString();

  if (currentDate === lastResetDate) {
    return;
  }

  console.log("🔄 Новый день — сбрасываю дневную статистику.");

  for (const userId of Object.keys(stats.users)) {
    const user = getUserStats(userId);

    updateActiveTime(userId);

    user.messages = 0;
    user.voiceSeconds = 0;
    user.discordSeconds = 0;
    user.gamingSeconds = 0;
    user.gamingGame = "";

    // Сохраняем активные сессии,
    // чтобы время после сброса продолжало считаться.
    const now = Date.now();

    if (user.messageActiveSince) {
      user.messageActiveSince = now;
    }

    if (user.voiceActiveSince) {
      user.voiceActiveSince = now;
    }

    if (user.discordActiveSince) {
      user.discordActiveSince = now;
    }

    if (user.gamingActiveSince) {
      user.gamingActiveSince = now;
    }
  }

  lastResetDate = currentDate;
  saveStats();
}

// ============================================================
// MESSAGE TRACKING
// ============================================================

client.on("messageCreate", (message) => {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;

    checkDailyReset();

    const user = getUserStats(message.author.id);

    user.messages += 1;

    if (!user.messageActiveSince) {
      user.messageActiveSince = Date.now();
    }

    saveStats();
  } catch (error) {
    console.error("❌ Ошибка message tracking:", error);
  }
});

// ============================================================
// VOICE TRACKING
// ============================================================

client.on("voiceStateUpdate", (oldState, newState) => {
  try {
    if (!newState.member) return;

    const userId = newState.member.id;

    if (newState.member.user?.bot) {
      return;
    }

    checkDailyReset();

    const user = getUserStats(userId);

    // Подключился к голосовому
    if (!oldState.channelId && newState.channelId) {
      if (!user.voiceActiveSince) {
        user.voiceActiveSince = Date.now();
      }
    }

    // Отключился
    if (oldState.channelId && !newState.channelId) {
      if (user.voiceActiveSince) {
        user.voiceSeconds += Math.max(
          0,
          Math.floor(
            (Date.now() - user.voiceActiveSince) / 1000
          )
        );

        user.voiceActiveSince = null;
      }
    }

    // Discord activity
    if (newState.channelId) {
      if (!user.discordActiveSince) {
        user.discordActiveSince = Date.now();
      }
    } else {
      if (user.discordActiveSince) {
        user.discordSeconds += Math.max(
          0,
          Math.floor(
            (Date.now() - user.discordActiveSince) / 1000
          )
        );

        user.discordActiveSince = null;
      }
    }

    saveStats();
  } catch (error) {
    console.error("❌ Ошибка voice tracking:", error);
  }
});

// ============================================================
// PRESENCE / GAMING
// ============================================================

client.on("presenceUpdate", (oldPresence, newPresence) => {
  try {
    if (!newPresence?.userId) return;

    const userId = newPresence.userId;

    const member = newPresence.member;

    if (member?.user?.bot) {
      return;
    }

    checkDailyReset();

    const user = getUserStats(userId);

    const activities = newPresence.activities || [];

    const game = activities.find(
      (activity) =>
        activity.type === ActivityType.Playing
    );

    if (game) {
      if (!user.gamingActiveSince) {
        user.gamingActiveSince = Date.now();
      }

      user.gamingGame =
        game.name ||
        game.details ||
        "Игра";
    } else {
      if (user.gamingActiveSince) {
        user.gamingSeconds += Math.max(
          0,
          Math.floor(
            (Date.now() - user.gamingActiveSince) / 1000
          )
        );

        user.gamingActiveSince = null;
      }

      user.gamingGame = "";
    }

    // Discord online/idle/dnd
    if (
      newPresence.status === "online" ||
      newPresence.status === "idle" ||
      newPresence.status === "dnd"
    ) {
      if (!user.discordActiveSince) {
        user.discordActiveSince = Date.now();
      }
    } else {
      if (user.discordActiveSince) {
        user.discordSeconds += Math.max(
          0,
          Math.floor(
            (Date.now() - user.discordActiveSince) / 1000
          )
        );

        user.discordActiveSince = null;
      }
    }

    saveStats();
  } catch (error) {
    console.error("❌ Ошибка presence tracking:", error);
  }
});

// ============================================================
// AUTOSAVE
// ============================================================

setInterval(() => {
  try {
    checkDailyReset();

    for (const userId of Object.keys(stats.users)) {
      updateActiveTime(userId);
    }

    saveStats();
  } catch (error) {
    console.error("❌ Ошибка autosave:", error);
  }
}, 30000);

// ============================================================
// STATS IMAGE
// ============================================================

function formatTime(seconds) {
  seconds = Math.max(0, Math.floor(seconds));

  const days = Math.floor(seconds / 86400);
  seconds %= 86400;

  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;

  const minutes = Math.floor(seconds / 60);

  if (days > 0) {
    return `${days}д ${hours}ч`;
  }

  if (hours > 0) {
    return `${hours}ч ${minutes}м`;
  }

  return `${minutes}м`;
}

async function createStatsImage(user) {
  const width = 1536;
  const height = 1536;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Фон
  if (templateImage) {
    ctx.drawImage(
      templateImage,
      0,
      0,
      width,
      height
    );
  } else {
    ctx.fillStyle = "#111111";
    ctx.fillRect(0, 0, width, height);
  }

  const userStats = getUserStats(user.id);

  updateActiveTime(user.id);

  // ==========================================================
  // AVATAR
  // ==========================================================

  try {
    const avatarURL = user.displayAvatarURL({
      extension: "png",
      size: 512,
    });

    const avatar = await loadImage(avatarURL);

    ctx.save();

    ctx.beginPath();
    ctx.arc(
      768,
      270,
      150,
      0,
      Math.PI * 2
    );

    ctx.closePath();
    ctx.clip();

    ctx.drawImage(
      avatar,
      618,
      120,
      300,
      300
    );

    ctx.restore();
  } catch (error) {
    console.error("❌ Ошибка загрузки аватара:", error);
  }

  // ==========================================================
  // USERNAME
  // ==========================================================

  ctx.textAlign = "center";

  ctx.font = "bold 64px CustomFont, Arial";
  ctx.fillStyle = "#ffffff";

  ctx.fillText(
    user.username,
    768,
    500
  );

  // ==========================================================
  // CARD HELPER
  // ==========================================================

  function drawCard(
    x,
    y,
    w,
    h,
    title,
    value,
    color
  ) {
    ctx.save();

    ctx.fillStyle = "rgba(20, 20, 25, 0.88)";

    ctx.beginPath();

    const radius = 35;

    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);

    ctx.quadraticCurveTo(
      x + w,
      y,
      x + w,
      y + radius
    );

    ctx.lineTo(x + w, y + h - radius);

    ctx.quadraticCurveTo(
      x + w,
      y + h,
      x + w - radius,
      y + h
    );

    ctx.lineTo(x + radius, y + h);

    ctx.quadraticCurveTo(
      x,
      y + h,
      x,
      y + h - radius
    );

    ctx.lineTo(x, y + radius);

    ctx.quadraticCurveTo(
      x,
      y,
      x + radius,
      y
    );

    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = color;

    ctx.fillRect(
      x,
      y,
      10,
      h
    );

    ctx.textAlign = "left";

    ctx.font = "bold 32px CustomFont, Arial";
    ctx.fillStyle = "#ffffff";

    ctx.fillText(
      title,
      x + 45,
      y + 65
    );

    ctx.font = "bold 52px CustomFont, Arial";
    ctx.fillStyle = color;

    ctx.fillText(
      value,
      x + 45,
      y + 130
    );

    ctx.restore();
  }

  // ==========================================================
  // CARDS
  // ==========================================================

  drawCard(
    160,
    620,
    560,
    190,
    "VOICE",
    formatTime(userStats.voiceSeconds),
    "#ff4b4b"
  );

  drawCard(
    816,
    620,
    560,
    190,
    "MESSAGE",
    String(userStats.messages),
    "#55a8ff"
  );

  drawCard(
    160,
    850,
    560,
    190,
    "DISCORD",
    formatTime(userStats.discordSeconds),
    "#c080ff"
  );

  drawCard(
    816,
    850,
    560,
    190,
    "GAMING",
    formatTime(userStats.gamingSeconds),
    "#43ff91"
  );

  // MUSIC
  drawCard(
    160,
    1080,
    560,
    190,
    "MUSIC",
    "SOON",
    "#ffd84a"
  );

  // Game name
  if (userStats.gamingGame) {
    ctx.textAlign = "center";

    ctx.font = "28px CustomFont, Arial";
    ctx.fillStyle = "#ffffff";

    ctx.fillText(
      userStats.gamingGame,
      1096,
      1195
    );
  }

  return canvas.toBuffer("image/png");
}

// ============================================================
// NORMAL AI
// ============================================================

async function askAI(prompt) {
  const response =
    await gemini.models.generateContent({
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

  return (
    response.text ||
    "Не удалось получить ответ."
  );
}

// ============================================================
// VOICE AI
// ============================================================

let voiceAISession = null;

// Защита от нескольких одновременных запросов
let voiceAIProcessing = false;

// ============================================================
// WAV
// ============================================================

function createWavBuffer(pcmBuffer) {
  const sampleRate = 48000;
  const channels = 2;
  const bitsPerSample = 16;

  const byteRate =
    sampleRate *
    channels *
    bitsPerSample /
    8;

  const blockAlign =
    channels *
    bitsPerSample /
    8;

  const dataSize = pcmBuffer.length;

  const buffer = Buffer.alloc(
    44 + dataSize
  );

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(
    36 + dataSize,
    4
  );
  buffer.write("WAVE", 8);

  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(
    channels,
    22
  );
  buffer.writeUInt32LE(
    sampleRate,
    24
  );
  buffer.writeUInt32LE(
    byteRate,
    28
  );
  buffer.writeUInt16LE(
    blockAlign,
    32
  );
  buffer.writeUInt16LE(
    bitsPerSample,
    34
  );

  buffer.write("data", 36);
  buffer.writeUInt32LE(
    dataSize,
    40
  );

  pcmBuffer.copy(
    buffer,
    44
  );

  return buffer;
}

// ============================================================
// TTS PCM CONVERSION
// ============================================================

function convertTtsPcmToDiscord(
  pcmBuffer
) {
  return new Promise(
    (resolve, reject) => {
      const ffmpeg = spawn(
        ffmpegPath,
        [
          "-f",
          "s16le",

          "-ar",
          "24000",

          "-ac",
          "1",

          "-i",
          "pipe:0",

          "-f",
          "s16le",

          "-ar",
          "48000",

          "-ac",
          "2",

          "pipe:1",
        ]
      );

      const chunks = [];

      ffmpeg.stdout.on(
        "data",
        (chunk) => {
          chunks.push(chunk);
        }
      );

      ffmpeg.stderr.on(
        "data",
        () => {}
      );

      ffmpeg.on(
        "error",
        reject
      );

      ffmpeg.on(
        "close",
        (code) => {
          if (code !== 0) {
            return reject(
              new Error(
                `FFmpeg завершился с кодом ${code}`
              )
            );
          }

          resolve(
            Buffer.concat(chunks)
          );
        }
      );

      ffmpeg.stdin.write(
        pcmBuffer
      );

      ffmpeg.stdin.end();
    }
  );
}

// ============================================================
// TRANSCRIBE VOICE
// ============================================================

async function transcribeVoice(
  pcmData
) {
  try {
    const wavBuffer =
      createWavBuffer(pcmData);

    console.log(
      "🎤 Отправляю голос на распознавание:",
      wavBuffer.length,
      "bytes"
    );

    /*
     * Files API в текущем SDK ожидает путь к файлу,
     * поэтому временно сохраняем WAV.
     */

    const tempDir =
      path.join(
        __dirname,
        ".voice_tmp"
      );

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(
        tempDir,
        { recursive: true }
      );
    }

    const fileName =
      `voice-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}.wav`;

    const filePath =
      path.join(
        tempDir,
        fileName
      );

    fs.writeFileSync(
      filePath,
      wavBuffer
    );

    try {
      const audioFile =
        await gemini.files.upload({
          file: filePath,
          config: {
            mimeType: "audio/wav",
          },
        });

      console.log(
        "🎤 Аудио загружено:",
        audioFile.name
      );

      const response =
        await gemini.models.generateContent(
          {
            model:
              VOICE_AI_TRANSCRIBE_MODEL,

            contents: [
              audioFile,
            ],

            config: {
              audioTranscriptionConfig: {
                languageCodes: [
                  "ru-RU",
                ],
              },
            },
          }
        );

      const text =
        (
          response.text || ""
        ).trim();

      console.log(
        `📝 Распознано: "${text}"`
      );

      return text;
    } finally {
      try {
        fs.unlinkSync(
          filePath
        );
      } catch {}
    }
  } catch (error) {
    console.error(
      "❌ Ошибка распознавания голоса:",
      error
    );

    return "";
  }
}

// ============================================================
// VOICE AI ANSWER
// ============================================================

async function askVoiceAI(
  text
) {
  const response =
    await gemini.models.generateContent(
      {
        model:
          VOICE_AI_TEXT_MODEL,

        contents: text,

        config: {
          systemInstruction:
            VOICE_AI_SYSTEM,
        },
      }
    );

  return (
    response.text ||
    "Я не знаю, что ответить."
  ).trim();
}

// ============================================================
// TTS
// ============================================================

async function textToSpeech(
  text
) {
  console.log(
    "🔊 Создаю голосовой ответ..."
  );

  const response =
    await gemini.models.generateContent(
      {
        model:
          VOICE_AI_TTS_MODEL,

        contents: text,

        config: {
          responseModalities: [
            "AUDIO",
          ],

          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Kore",
              },
            },
          },
        },
      }
    );

  const parts =
    response.candidates?.[0]
      ?.content?.parts || [];

  const audioPart =
    parts.find(
      (part) =>
        part.inlineData &&
        part.inlineData.data
    );

  if (!audioPart) {
    throw new Error(
      "Gemini TTS не вернул аудио"
    );
  }

  const pcmBuffer =
    Buffer.from(
      audioPart.inlineData.data,
      "base64"
    );

  console.log(
    "🔊 TTS: получено",
    pcmBuffer.length,
    "bytes"
  );

  const discordPcm =
    await convertTtsPcmToDiscord(
      pcmBuffer
    );

  console.log(
    "🔊 TTS: после конвертации",
    discordPcm.length,
    "bytes"
  );

  return discordPcm;
}

// ============================================================
// PLAY VOICE AI
// ============================================================

async function playVoiceAI(
  connection,
  text
) {
  const pcmData =
    await textToSpeech(text);

  const player =
    voiceAISession?.player ||
    createAudioPlayer();

  if (
    voiceAISession &&
    !voiceAISession.player
  ) {
    voiceAISession.player =
      player;
  }

  const resource =
    createAudioResource(
      Readable.from(pcmData),
      {
        inputType:
          StreamType.Raw,

        inlineVolume: false,
      }
    );

  return new Promise(
    (resolve, reject) => {
      const onIdle =
        () => {
          console.log(
            "✓ Голосовой ответ закончен."
          );

          player.removeListener(
            "error",
            onError
          );

          resolve();
        };

      const onError =
        (error) => {
          player.removeListener(
            AudioPlayerStatus.Idle,
            onIdle
          );

          console.error(
            "❌ Ошибка AudioPlayer:",
            error
          );

          reject(error);
        };

      player.once(
        AudioPlayerStatus.Idle,
        onIdle
      );

      player.once(
        "error",
        onError
      );

      connection.subscribe(
        player
      );

      player.play(
        resource
      );

      console.log(
        "🔊 AudioPlayer начал воспроизведение."
      );
    }
  );
}

// ============================================================
// PROCESS VOICE AUDIO
// ============================================================

async function processVoiceAudio(
  userId,
  audioStream
) {
  return new Promise(
    (resolve) => {
      const decoder =
        new prism.opus.Decoder(
          {
            rate: 48000,
            channels: 2,
            frameSize: 960,
          }
        );

      const chunks = [];

      let finished = false;

      audioStream.on(
        "data",
        (chunk) => {
          decoder.write(chunk);
        }
      );

      decoder.on(
        "data",
        (chunk) => {
          chunks.push(chunk);
        }
      );

      const finish =
        async () => {
          if (finished) {
            return;
          }

          finished = true;

          try {
            const pcmData =
              Buffer.concat(
                chunks
              );

            console.log(
              `🎤 END: ${userId}, ${pcmData.length} bytes`
            );

            // Очень короткие записи не отправляем
            if (
              pcmData.length < 96000
            ) {
              console.log(
                "⚠️ Слишком короткая запись, пропускаю."
              );

              return;
            }

            // Если другой запрос уже обрабатывается
            if (
              voiceAIProcessing
            ) {
              console.log(
                "⏳ Voice AI уже обрабатывает другую речь, пропускаю."
              );

              return;
            }

            voiceAIProcessing =
              true;

            try {
              // ==============================================
              // SPEECH TO TEXT
              // ==============================================

              const recognized =
                await transcribeVoice(
                  pcmData
                );

              if (!recognized) {
                console.log(
                  "📝 Речь не распознана."
                );

                return;
              }

              console.log(
                `📝 Распознано: "${recognized}"`
              );

              // ==============================================
              // AI ANSWER
              // ==============================================

              const answer =
                await askVoiceAI(
                  recognized
                );

              console.log(
                `🤖 Ответ: "${answer}"`
              );

              // ==============================================
              // TTS
              // ==============================================

              if (
                voiceAISession &&
                voiceAISession.connection
              ) {
                await playVoiceAI(
                  voiceAISession.connection,
                  answer
                );
              }
            } finally {
              // Всегда освобождаем обработчик
              voiceAIProcessing =
                false;
            }
          } catch (error) {
            console.error(
              "❌ Ошибка обработки Voice AI:",
              error
            );

            voiceAIProcessing =
              false;
          } finally {
            resolve();
          }
        };

      audioStream.once(
        "end",
        finish
      );

      audioStream.once(
        "error",
        (error) => {
          console.error(
            "❌ Ошибка входящего голосового потока:",
            error
          );

          if (!finished) {
            finished = true;
            resolve();
          }
        }
      );

      decoder.once(
        "error",
        (error) => {
          console.error(
            "❌ Ошибка Opus decoder:",
            error
          );

          if (!finished) {
            finished = true;
            resolve();
          }
        }
      );
    }
  );
}

// ============================================================
// LISTEN TO USER
// ============================================================

function listenToUser(
  receiver,
  userId
) {
  if (!voiceAISession) {
    return;
  }

  if (
    client.user &&
    userId === client.user.id
  ) {
    return;
  }

  console.log(
    `🎤 START: слушаю ${userId}`
  );

  const audioStream =
    receiver.subscribe(
      userId,
      {
        end: {
          behavior:
            EndBehaviorType.AfterSilence,

          duration: 1000,
        },
      }
    );

  processVoiceAudio(
    userId,
    audioStream
  );
}

// ============================================================
// START VOICE AI
// ============================================================

async function startVoiceAI(
  channel
) {
  if (voiceAISession) {
    return {
      ok: false,
      message:
        "Voice AI уже работает.",
    };
  }

  console.log(
    `🎙️ Подключаю Voice AI к "${channel.name}"...`
  );

  const connection =
    joinVoiceChannel({
      channelId: channel.id,

      guildId:
        channel.guild.id,

      adapterCreator:
        channel.guild
          .voiceAdapterCreator,

      selfDeaf: false,

      selfMute: false,
    });

  const player =
    createAudioPlayer();

  connection.subscribe(
    player
  );

  voiceAISession = {
    connection,
    player,
  };

  connection.on(
    VoiceConnectionStatus.Ready,
    () => {
      console.log(
        `✓ Voice AI подключён к "${channel.name}"`
      );
    }
  );

  connection.on(
    VoiceConnectionStatus.Disconnected,
    () => {
      console.log(
        "⚠️ Voice AI отключён от Discord."
      );
    }
  );

  connection.on(
    "error",
    (error) => {
      console.error(
        "❌ Voice Connection error:",
        error
      );
    }
  );

  player.on(
    "error",
    (error) => {
      console.error(
        "❌ Voice Player error:",
        error
      );
    }
  );

  const receiver =
    connection.receiver;

  receiver.speaking.on(
    "start",
    (userId) => {
      if (!voiceAISession) {
        return;
      }

      if (
        client.user &&
        userId === client.user.id
      ) {
        return;
      }

      console.log(
        `🗣️ Пользователь начал говорить: ${userId}`
      );

      listenToUser(
        receiver,
        userId
      );
    }
  );

  console.log(
    "🎤 Voice AI теперь слушает участников."
  );

  return {
    ok: true,

    message:
      `Voice AI подключён к ${channel.name}.`,
  };
}

// ============================================================
// STOP VOICE AI
// ============================================================

function stopVoiceAI() {
  if (!voiceAISession) {
    return false;
  }

  try {
    voiceAISession.player?.stop();

    voiceAISession.connection.destroy();
  } catch (error) {
    console.error(
      "❌ Ошибка остановки Voice AI:",
      error
    );
  }

  voiceAISession = null;
  voiceAIProcessing = false;

  console.log(
    "🛑 Voice AI остановлен."
  );

  return true;
}

// ============================================================
// SLASH COMMANDS
// ============================================================

const commands = [
  new SlashCommandBuilder()
    .setName("stats")
    .setDescription(
      "Показать статистику пользователя"
    ),

  new SlashCommandBuilder()
    .setName("ai")
    .setDescription(
      "Задать вопрос AI"
    )
    .addStringOption(
      (option) =>
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
      "Запустить Voice AI в вашем голосовом канале"
    ),

  new SlashCommandBuilder()
    .setName("voiceai-stop")
    .setDescription(
      "Остановить Voice AI"
    ),
].map((command) =>
  command.toJSON()
);

// ============================================================
// INTERACTIONS
// ============================================================

client.on(
  "interactionCreate",
  async (interaction) => {
    if (
      !interaction.isChatInputCommand()
    ) {
      return;
    }

    try {
      // ======================================================
      // /stats
      // ======================================================

      if (
        interaction.commandName ===
        "stats"
      ) {
        checkDailyReset();

        const image =
          await createStatsImage(
            interaction.user
          );

        const attachment =
          new AttachmentBuilder(
            image,
            {
              name: "stats.png",
            }
          );

        await interaction.reply({
          files: [
            attachment,
          ],
        });

        return;
      }

      // ======================================================
      // /ai
      // ======================================================

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

      // ======================================================
      // /voiceai
      // ======================================================

      if (
        interaction.commandName ===
        "voiceai"
      ) {
        const member =
          interaction.member;

        const channel =
          member?.voice?.channel;

        if (!channel) {
          await interaction.reply({
            content:
              "❌ Сначала зайди в голосовой канал.",
            ephemeral: true,
          });

          return;
        }

        if (voiceAISession) {
          await interaction.reply({
            content:
              "⚠️ Voice AI уже работает.",
            ephemeral: true,
          });

          return;
        }

        await interaction.deferReply();

        const result =
          await startVoiceAI(
            channel
          );

        await interaction.editReply(
          result.message
        );

        return;
      }

      // ======================================================
      // /voiceai-stop
      // ======================================================

      if (
        interaction.commandName ===
        "voiceai-stop"
      ) {
        const stopped =
          stopVoiceAI();

        await interaction.reply({
          content: stopped
            ? "🛑 Voice AI остановлен."
            : "ℹ️ Voice AI сейчас не запущен.",
        });

        return;
      }
    } catch (error) {
      console.error(
        "❌ Ошибка interaction:",
        error
      );

      const message =
        "❌ Произошла ошибка. Проверь Railway Logs.";

      if (
        interaction.replied ||
        interaction.deferred
      ) {
        await interaction.editReply(
          message
        ).catch(() => {});
      } else {
        await interaction.reply({
          content: message,
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
      `✓ Бот запущен: ${client.user.tag}`
    );

    await loadTemplate();

    console.log(
      "✓ Активные сессии успешно восстановлены!"
    );

    try {
      const guild =
        await client.guilds.fetch(
          GUILD_ID
        );

      await guild.commands.set(
        commands
      );

      console.log(
        "✓ Команды зарегистрированы:"
      );

      console.log(
        "  /stats"
      );

      console.log(
        "  /ai"
      );

      console.log(
        "  /voiceai"
      );

      console.log(
        "  /voiceai-stop"
      );
    } catch (error) {
      console.error(
        "❌ Ошибка регистрации команд:",
        error
      );
    }
  }
);

// ============================================================
// LOGIN
// ============================================================

client.login(
  DISCORD_TOKEN
);
