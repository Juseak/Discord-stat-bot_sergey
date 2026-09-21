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

const fs = require("fs");
const path = require("path");

// =========================
// ENV
// =========================

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

// =========================
// CLIENT
// =========================

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

// =========================
// GEMINI
// =========================

const gemini = new GoogleGenAI({
  apiKey: GEMINI_API_KEY,
});

// Обычный /ai НЕ МЕНЯЕМ
const AI_MODEL = "gemini-3.5-flash-lite";

// Voice AI
const VOICE_AI_TEXT_MODEL = "gemini-3.5-flash-lite";
const VOICE_AI_TTS_MODEL = "gemini-2.5-flash-preview-tts";

const VOICE_AI_SYSTEM = `
Ты голосовой ассистент в Discord.
Отвечай по-русски, коротко и естественно.
Не используй Markdown.
Не пиши длинные ответы.
Если пользователь задал простой вопрос — ответь кратко.
`;

// =========================
// STATS
// =========================

const statsPath = path.join(__dirname, "stats.json");
const templatePath = path.join(__dirname, "template.png");
const fontPath = path.join(__dirname, "font.ttf");

let stats = {
  users: {},
};

function loadStats() {
  try {
    if (!fs.existsSync(statsPath)) {
      fs.writeFileSync(
        statsPath,
        JSON.stringify(stats, null, 2),
        "utf8"
      );
      return;
    }

    const data = JSON.parse(
      fs.readFileSync(statsPath, "utf8")
    );

    if (data && typeof data === "object") {
      stats = data;
    }

    if (!stats.users) {
      stats.users = {};
    }
  } catch (error) {
    console.error("❌ Ошибка загрузки stats.json:", error);
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

// =========================
// TEMPLATE / FONT
// =========================

let templateImage = null;

if (fs.existsSync(fontPath)) {
  try {
    GlobalFonts.registerFromPath(fontPath, "CustomFont");
    console.log("✓ Кастомный шрифт успешно загружен!");
  } catch (error) {
    console.error("❌ Ошибка загрузки шрифта:", error);
  }
}

async function loadTemplate() {
  try {
    if (fs.existsSync(templatePath)) {
      templateImage = await loadImage(templatePath);
      console.log("✓ Шаблон закэширован!");
    } else {
      console.log("⚠️ template.png не найден");
    }
  } catch (error) {
    console.error("❌ Ошибка загрузки template.png:", error);
  }
}

// =========================
// USER STATS HELPERS
// =========================

function getUserStats(userId) {
  if (!stats.users[userId]) {
    stats.users[userId] = {
      messages: 0,
      voiceSeconds: 0,
      discordSeconds: 0,
      gamingSeconds: 0,
      gamingGame: null,

      messageActiveSince: null,
      voiceActiveSince: null,
      discordActiveSince: null,
      gamingActiveSince: null,
    };
  }

  return stats.users[userId];
}

function updateActiveTime(userId) {
  const userStats = getUserStats(userId);
  const now = Date.now();

  if (userStats.voiceActiveSince) {
    userStats.voiceSeconds += Math.max(
      0,
      Math.floor((now - userStats.voiceActiveSince) / 1000)
    );

    userStats.voiceActiveSince = now;
  }

  if (userStats.discordActiveSince) {
    userStats.discordSeconds += Math.max(
      0,
      Math.floor((now - userStats.discordActiveSince) / 1000)
    );

    userStats.discordActiveSince = now;
  }

  if (userStats.gamingActiveSince) {
    userStats.gamingSeconds += Math.max(
      0,
      Math.floor((now - userStats.gamingActiveSince) / 1000)
    );

    userStats.gamingActiveSince = now;
  }
}

// =========================
// DAILY RESET
// =========================

let lastResetDate = new Date().toDateString();

function checkDailyReset() {
  const today = new Date().toDateString();

  if (today === lastResetDate) {
    return;
  }

  console.log("🔄 Новый день — сбрасываю статистику");

  for (const userId of Object.keys(stats.users)) {
    const userStats = stats.users[userId];

    updateActiveTime(userId);

    userStats.messages = 0;
    userStats.voiceSeconds = 0;
    userStats.discordSeconds = 0;
    userStats.gamingSeconds = 0;
    userStats.gamingGame = null;

    const now = Date.now();

    if (userStats.messageActiveSince) {
      userStats.messageActiveSince = now;
    }

    if (userStats.voiceActiveSince) {
      userStats.voiceActiveSince = now;
    }

    if (userStats.discordActiveSince) {
      userStats.discordActiveSince = now;
    }

    if (userStats.gamingActiveSince) {
      userStats.gamingActiveSince = now;
    }
  }

  lastResetDate = today;
  saveStats();
}

// =========================
// MESSAGE TRACKING
// =========================

client.on("messageCreate", (message) => {
  if (!message.guild) return;
  if (message.author.bot) return;

  checkDailyReset();

  const userStats = getUserStats(message.author.id);

  updateActiveTime(message.author.id);

  userStats.messages++;

  if (!userStats.messageActiveSince) {
    userStats.messageActiveSince = Date.now();
  }

  saveStats();
});

// =========================
// VOICE TRACKING
// =========================

client.on("voiceStateUpdate", (oldState, newState) => {
  checkDailyReset();

  const userId = newState.id;

  if (client.user && userId === client.user.id) {
    return;
  }

  const userStats = getUserStats(userId);
  const now = Date.now();

  // Вошёл в голосовой канал
  if (!oldState.channelId && newState.channelId) {
    userStats.voiceActiveSince = now;
  }

  // Вышел из голосового канала
  if (oldState.channelId && !newState.channelId) {
    updateActiveTime(userId);
    userStats.voiceActiveSince = null;
  }
});

// =========================
// PRESENCE / GAMING
// =========================

client.on("presenceUpdate", (oldPresence, newPresence) => {
  checkDailyReset();

  if (!newPresence || !newPresence.userId) {
    return;
  }

  const userId = newPresence.userId;

  if (client.user && userId === client.user.id) {
    return;
  }

  const userStats = getUserStats(userId);

  const isOnline =
    newPresence.status === "online" ||
    newPresence.status === "idle" ||
    newPresence.status === "dnd";

  const playingActivity = newPresence.activities?.find(
    (activity) => activity.type === ActivityType.Playing
  );

  const now = Date.now();

  if (isOnline) {
    if (!userStats.discordActiveSince) {
      userStats.discordActiveSince = now;
    }
  } else {
    if (userStats.discordActiveSince) {
      updateActiveTime(userId);
      userStats.discordActiveSince = null;
    }
  }

  if (playingActivity) {
    if (!userStats.gamingActiveSince) {
      userStats.gamingActiveSince = now;
    }

    userStats.gamingGame =
      playingActivity.name || playingActivity.details || "Игра";
  } else {
    if (userStats.gamingActiveSince) {
      updateActiveTime(userId);
      userStats.gamingActiveSince = null;
      userStats.gamingGame = null;
    }
  }

  saveStats();
});

// =========================
// AUTOSAVE
// =========================

setInterval(() => {
  checkDailyReset();

  for (const userId of Object.keys(stats.users)) {
    updateActiveTime(userId);
  }

  saveStats();
}, 30000);

// =========================
// STATS IMAGE
// =========================

async function createStatsImage(user) {
  const width = 1536;
  const height = 1536;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  if (templateImage) {
    ctx.drawImage(templateImage, 0, 0, width, height);
  } else {
    ctx.fillStyle = "#111111";
    ctx.fillRect(0, 0, width, height);
  }

  const userStats = getUserStats(user.id);

  updateActiveTime(user.id);

  const avatarURL = user.displayAvatarURL({
    extension: "png",
    size: 512,
  });

  try {
    const avatar = await loadImage(avatarURL);

    ctx.save();

    ctx.beginPath();
    ctx.arc(768, 240, 150, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    ctx.drawImage(
      avatar,
      618,
      90,
      300,
      300
    );

    ctx.restore();
  } catch (error) {
    console.error("❌ Ошибка загрузки аватара:", error);
  }

  ctx.font = "bold 58px CustomFont";
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";

  ctx.fillText(
    user.username,
    768,
    460
  );

  const cards = [
    {
      title: "VOICE",
      value: formatTime(userStats.voiceSeconds),
      color: "#ff4b4b",
    },
    {
      title: "MESSAGE",
      value: String(userStats.messages),
      color: "#55a8ff",
    },
    {
      title: "DISCORD",
      value: formatTime(userStats.discordSeconds),
      color: "#c080ff",
    },
    {
      title: "GAMING",
      value: formatTime(userStats.gamingSeconds),
      color: "#43ff91",
    },
    {
      title: "MUSIC",
      value: "SOON",
      color: "#ffd84a",
    },
  ];

  const cardWidth = 420;
  const cardHeight = 220;

  const positions = [
    [78, 560],
    [558, 560],
    [1038, 560],
    [318, 830],
    [798, 830],
  ];

  cards.forEach((card, index) => {
    const [x, y] = positions[index];

    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.beginPath();
    ctx.roundRect(
      x,
      y,
      cardWidth,
      cardHeight,
      35
    );
    ctx.fill();

    ctx.strokeStyle = card.color;
    ctx.lineWidth = 5;

    ctx.beginPath();
    ctx.roundRect(
      x,
      y,
      cardWidth,
      cardHeight,
      35
    );
    ctx.stroke();

    ctx.textAlign = "center";

    ctx.font = "bold 32px CustomFont";
    ctx.fillStyle = card.color;

    ctx.fillText(
      card.title,
      x + cardWidth / 2,
      y + 65
    );

    ctx.font = "bold 50px CustomFont";
    ctx.fillStyle = "#ffffff";

    ctx.fillText(
      card.value,
      x + cardWidth / 2,
      y + 140
    );
  });

  return canvas.toBuffer("image/png");
}

function formatTime(seconds) {
  seconds = Math.max(0, Math.floor(seconds));

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(
    (seconds % 3600) / 60
  );
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}ч ${minutes}м`;
  }

  if (minutes > 0) {
    return `${minutes}м ${secs}с`;
  }

  return `${secs}с`;
}

// =========================
// NORMAL AI
// =========================

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

// =========================
// VOICE AI
// =========================

let voiceAISession = null;

function createWavBuffer(pcmBuffer) {
  const sampleRate = 48000;
  const channels = 2;
  const bitsPerSample = 16;

  const byteRate =
    sampleRate *
    channels *
    (bitsPerSample / 8);

  const blockAlign =
    channels *
    (bitsPerSample / 8);

  const wavHeader = Buffer.alloc(44);

  wavHeader.write("RIFF", 0);
  wavHeader.writeUInt32LE(
    36 + pcmBuffer.length,
    4
  );

  wavHeader.write("WAVE", 8);
  wavHeader.write("fmt ", 12);

  wavHeader.writeUInt32LE(16, 16);
  wavHeader.writeUInt16LE(1, 20);
  wavHeader.writeUInt16LE(channels, 22);
  wavHeader.writeUInt32LE(sampleRate, 24);
  wavHeader.writeUInt32LE(byteRate, 28);
  wavHeader.writeUInt16LE(blockAlign, 32);
  wavHeader.writeUInt16LE(bitsPerSample, 34);

  wavHeader.write("data", 36);
  wavHeader.writeUInt32LE(
    pcmBuffer.length,
    40
  );

  return Buffer.concat([
    wavHeader,
    pcmBuffer,
  ]);
}

function convertTtsPcmToDiscord(pcmBuffer) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      return reject(
        new Error("ffmpeg-static не найден")
      );
    }

    const ffmpeg = spawn(ffmpegPath, [
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
    ]);

    const chunks = [];

    ffmpeg.stdout.on("data", (chunk) => {
      chunks.push(chunk);
    });

    ffmpeg.stderr.on("data", () => {
      // ffmpeg пишет технические сообщения в stderr
    });

    ffmpeg.on("error", reject);

    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        return reject(
          new Error(
            `ffmpeg завершился с кодом ${code}`
          )
        );
      }

      resolve(Buffer.concat(chunks));
    });

    ffmpeg.stdin.write(pcmBuffer);
    ffmpeg.stdin.end();
  });
}

// =========================
// TRANSCRIBE VOICE
// =========================

async function transcribeVoice(pcmData) {
  const wavBuffer = createWavBuffer(
    pcmData
  );

  const base64Audio =
    wavBuffer.toString("base64");

  console.log(
    "🎤 Отправляю голос",
    pcmData.length,
    "bytes в Gemini..."
  );

  const response =
    await gemini.models.generateContent({
      model: VOICE_AI_TEXT_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: "audio/wav",
                data: base64Audio,
              },
            },
            {
              text: `
Распознай речь пользователя.
Верни только распознанный текст без пояснений.
Если речи нет или звук неразборчивый — верни пустую строку.
`,
            },
          ],
        },
      ],
      config: {
        systemInstruction:
          VOICE_AI_SYSTEM,
      },
    });

  return (response.text || "").trim();
}

// =========================
// VOICE AI TEXT RESPONSE
// =========================

async function askVoiceAI(text) {
  const response =
    await gemini.models.generateContent({
      model: VOICE_AI_TEXT_MODEL,
      contents: text,
      config: {
        systemInstruction:
          VOICE_AI_SYSTEM,
      },
    });

  return (
    response.text ||
    "Я не знаю, что ответить."
  ).trim();
}

// =========================
// TTS
// =========================

async function textToSpeech(text) {
  console.log("🔊 Создаю голосовой ответ...");

  const response =
    await gemini.models.generateContent({
      model: VOICE_AI_TTS_MODEL,
      contents: text,
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: "Kore",
            },
          },
        },
      },
    });

  const parts =
    response.candidates?.[0]?.content?.parts ||
    [];

  const audioPart = parts.find(
    (part) =>
      part.inlineData &&
      part.inlineData.data
  );

  if (!audioPart) {
    throw new Error(
      "Gemini TTS не вернул аудио"
    );
  }

  const pcmBuffer = Buffer.from(
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

// =========================
// PLAY VOICE AI
// =========================

async function playVoiceAI(connection, text) {
  const pcmData =
    await textToSpeech(text);

  const player =
    voiceAISession?.player ||
    createAudioPlayer();

  if (
    voiceAISession &&
    !voiceAISession.player
  ) {
    voiceAISession.player = player;
  }

  const resource =
    createAudioResource(
      require("stream").Readable.from(
        pcmData
      ),
      {
        inputType:
          StreamType.Raw,
        inlineVolume: false,
      }
    );

  return new Promise((resolve, reject) => {
    const onIdle = () => {
      console.log(
        "✓ Голосовой ответ закончен."
      );

      player.removeListener(
        "error",
        onError
      );

      resolve();
    };

    const onError = (error) => {
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

    connection.subscribe(player);

    player.play(resource);

    console.log(
      "🔊 AudioPlayer начал воспроизведение."
    );
  });
}

// =========================
// PROCESS VOICE AUDIO
// =========================

async function processVoiceAudio(
  userId,
  audioStream
) {
  return new Promise((resolve) => {
    const decoder =
      new prism.opus.Decoder({
        rate: 48000,
        channels: 2,
        frameSize: 960,
      });

    const chunks = [];

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

    const finish = async () => {
      try {
        const pcmData =
          Buffer.concat(chunks);

        console.log(
          `🎤 END: ${userId}, ${pcmData.length} bytes`
        );

        if (pcmData.length < 96000) {
          console.log(
            "⚠️ Слишком короткая запись, пропускаю."
          );

          return resolve();
        }

        const recognized =
          await transcribeVoice(
            pcmData
          );

        if (!recognized) {
          console.log(
            "📝 Речь не распознана."
          );

          return resolve();
        }

        console.log(
          `📝 Распознано: "${recognized}"`
        );

        const answer =
          await askVoiceAI(
            recognized
          );

        console.log(
          `🤖 Ответ: "${answer}"`
        );

        if (
          voiceAISession &&
          voiceAISession.connection
        ) {
          await playVoiceAI(
            voiceAISession.connection,
            answer
          );
        }
      } catch (error) {
        console.error(
          "❌ Ошибка обработки Voice AI:",
          error
        );
      }

      resolve();
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

        resolve();
      }
    );

    decoder.once(
      "error",
      (error) => {
        console.error(
          "❌ Ошибка Opus decoder:",
          error
        );

        resolve();
      }
    );
  });
}

// =========================
// LISTEN TO USER
// =========================

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
    receiver.subscribe(userId, {
      end: {
        behavior:
          EndBehaviorType.AfterSilence,
        duration: 1000,
      },
    });

  processVoiceAudio(
    userId,
    audioStream
  );
}

// =========================
// START VOICE AI
// =========================

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
      guildId: channel.guild.id,
      adapterCreator:
        channel.guild.voiceAdapterCreator,

      selfDeaf: false,
      selfMute: false,
    });

  const player =
    createAudioPlayer();

  connection.subscribe(player);

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

// =========================
// STOP VOICE AI
// =========================

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

  console.log(
    "🛑 Voice AI остановлен."
  );

  return true;
}

// =========================
// SLASH COMMANDS
// =========================

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

// =========================
// INTERACTIONS
// =========================

client.on(
  "interactionCreate",
  async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    try {
      // =====================
      // /stats
      // =====================

      if (
        interaction.commandName === "stats"
      ) {
        await interaction.deferReply();

        const imageBuffer =
          await createStatsImage(
            interaction.user
          );

        const attachment =
          new AttachmentBuilder(
            imageBuffer,
            {
              name: "stats.png",
            }
          );

        await interaction.editReply({
          files: [attachment],
        });

        return;
      }

      // =====================
      // /ai
      // =====================

      if (
        interaction.commandName === "ai"
      ) {
        const prompt =
          interaction.options.getString(
            "prompt",
            true
          );

        await interaction.deferReply();

        try {
          const answer =
            await askAI(prompt);

          await interaction.editReply(
            answer
          );
        } catch (error) {
          console.error(
            "❌ Ошибка AI:",
            error
          );

          await interaction.editReply(
            "❌ Произошла ошибка при обращении к AI."
          );
        }

        return;
      }

      // =====================
      // /voiceai
      // =====================

      if (
        interaction.commandName ===
        "voiceai"
      ) {
        if (!interaction.guild) {
          return interaction.reply({
            content:
              "❌ Команда доступна только на сервере.",
            ephemeral: true,
          });
        }

        const member =
          interaction.guild.members.cache.get(
            interaction.user.id
          );

        const channel =
          member?.voice?.channel;

        if (!channel) {
          return interaction.reply({
            content:
              "❌ Сначала зайди в голосовой канал.",
            ephemeral: true,
          });
        }

        await interaction.deferReply();

        try {
          const result =
            await startVoiceAI(
              channel
            );

          await interaction.editReply(
            result.message
          );
        } catch (error) {
          console.error(
            "❌ Ошибка Voice AI:",
            error
          );

          voiceAISession = null;

          await interaction.editReply(
            "❌ Ошибка Voice AI: " +
              error.message
          );
        }

        return;
      }

      // =====================
      // /voiceai-stop
      // =====================

      if (
        interaction.commandName ===
        "voiceai-stop"
      ) {
        const stopped =
          stopVoiceAI();

        await interaction.reply(
          stopped
            ? "🛑 Voice AI остановлен."
            : "ℹ️ Voice AI сейчас не запущен."
        );

        return;
      }
    } catch (error) {
      console.error(
        "❌ Ошибка interaction:",
        error
      );

      if (interaction.deferred) {
        await interaction.editReply(
          "❌ Произошла ошибка."
        ).catch(() => {});
      } else if (!interaction.replied) {
        await interaction.reply({
          content:
            "❌ Произошла ошибка.",
          ephemeral: true,
        }).catch(() => {});
      }
    }
  }
);

// =========================
// READY
// =========================

client.once("ready", async () => {
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

    console.log("  /stats");
    console.log("  /ai");
    console.log("  /voiceai");
    console.log("  /voiceai-stop");
  } catch (error) {
    console.error(
      "❌ Ошибка регистрации команд:",
      error
    );
  }
});

// =========================
// LOGIN
// =========================

client.login(DISCORD_TOKEN);
