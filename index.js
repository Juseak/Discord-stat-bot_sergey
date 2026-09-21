const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  AttachmentBuilder,
  ActivityType,
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
const { createCanvas, loadImage, registerFont } = require("@napi-rs/canvas");

const fs = require("fs");
const path = require("path");

// =========================
// CONFIG
// =========================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const AI_MODEL = "gemini-3.5-flash-lite";

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

const gemini = new GoogleGenAI({
  apiKey: GEMINI_API_KEY,
});

// =========================
// PATHS
// =========================

const statsPath = path.join(__dirname, "stats.json");
const templatePath = path.join(__dirname, "template.png");
const fontPath = path.join(__dirname, "font.ttf");
const soundsPath = path.join(__dirname, "sounds");

// =========================
// FONT
// =========================

if (fs.existsSync(fontPath)) {
  registerFont(fontPath, "StatsFont");
}

// =========================
// STATS
// =========================

let stats = {};

function loadStats() {
  try {
    if (fs.existsSync(statsPath)) {
      stats = JSON.parse(fs.readFileSync(statsPath, "utf8"));
    } else {
      stats = {};
    }
  } catch (error) {
    console.error("❌ Ошибка загрузки stats.json:", error);
    stats = {};
  }
}

function saveStats() {
  try {
    fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
  } catch (error) {
    console.error("❌ Ошибка сохранения stats.json:", error);
  }
}

function ensureUser(userId, username = "Unknown") {
  if (!stats[userId]) {
    stats[userId] = {
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

  if (username) {
    stats[userId].username = username;
  }

  return stats[userId];
}

// =========================
// DAILY RESET
// =========================

function resetDailyStats() {
  console.log("🔄 Ежедневный сброс статистики...");

  const now = Date.now();

  for (const userId of Object.keys(stats)) {
    const user = stats[userId];

    user.messages = 0;
    user.voiceSeconds = 0;
    user.discordSeconds = 0;
    user.gamingSeconds = 0;
    user.gamingGame = null;

    // Сохраняем активные сессии
    if (user.voiceJoinedAt !== null) {
      user.voiceJoinedAt = now;
    }

    if (user.discordActiveAt !== null) {
      user.discordActiveAt = now;
    }

    if (user.gamingActiveAt !== null) {
      user.gamingActiveAt = now;
    }
  }

  saveStats();

  console.log("✓ Ежедневная статистика сброшена.");
}

function scheduleDailyReset() {
  const now = new Date();

  const nextReset = new Date(now);
  nextReset.setHours(0, 0, 0, 0);
  nextReset.setDate(nextReset.getDate() + 1);

  const delay = nextReset.getTime() - now.getTime();

  setTimeout(() => {
    resetDailyStats();

    setInterval(() => {
      resetDailyStats();
    }, 24 * 60 * 60 * 1000);
  }, delay);
}

// =========================
// MESSAGE TRACKING
// =========================

client.on("messageCreate", (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const user = ensureUser(
    message.author.id,
    message.author.username
  );

  user.messages++;
});

// =========================
// VOICE TRACKING
// =========================

client.on("voiceStateUpdate", (oldState, newState) => {
  const member = newState.member || oldState.member;

  if (!member || member.user.bot) return;

  const user = ensureUser(
    member.id,
    member.user.username
  );

  const now = Date.now();

  // Пользователь вошёл в голосовой канал
  if (!oldState.channelId && newState.channelId) {
    user.voiceJoinedAt = now;
  }

  // Пользователь сменил голосовой канал
  if (
    oldState.channelId &&
    newState.channelId &&
    oldState.channelId !== newState.channelId
  ) {
    if (user.voiceJoinedAt !== null) {
      user.voiceSeconds += Math.floor(
        (now - user.voiceJoinedAt) / 1000
      );
    }

    user.voiceJoinedAt = now;
  }

  // Пользователь вышел из голосового канала
  if (oldState.channelId && !newState.channelId) {
    if (user.voiceJoinedAt !== null) {
      user.voiceSeconds += Math.floor(
        (now - user.voiceJoinedAt) / 1000
      );
    }

    user.voiceJoinedAt = null;
  }
});

// =========================
// PRESENCE TRACKING
// =========================

client.on("presenceUpdate", (oldPresence, newPresence) => {
  const userId = newPresence.userId;

  if (!userId) return;

  const member = newPresence.member;

  if (member?.user?.bot) return;

  const user = ensureUser(
    userId,
    member?.user?.username || oldPresence?.member?.user?.username || "Unknown"
  );

  const now = Date.now();

  const oldActivities = oldPresence?.activities || [];
  const newActivities = newPresence?.activities || [];

  const oldGamingActivity = oldActivities.find(
    (activity) => activity.type === ActivityType.Playing
  );

  const newGamingActivity = newActivities.find(
    (activity) => activity.type === ActivityType.Playing
  );

  // Начал играть
  if (!oldGamingActivity && newGamingActivity) {
    user.gamingActiveAt = now;
    user.gamingGame = newGamingActivity.name || "Unknown";
  }

  // Сменил игру
  else if (
    oldGamingActivity &&
    newGamingActivity &&
    oldGamingActivity.name !== newGamingActivity.name
  ) {
    if (user.gamingActiveAt !== null) {
      user.gamingSeconds += Math.floor(
        (now - user.gamingActiveAt) / 1000
      );
    }

    user.gamingActiveAt = now;
    user.gamingGame = newGamingActivity.name || "Unknown";
  }

  // Перестал играть
  else if (oldGamingActivity && !newGamingActivity) {
    if (user.gamingActiveAt !== null) {
      user.gamingSeconds += Math.floor(
        (now - user.gamingActiveAt) / 1000
      );
    }

    user.gamingActiveAt = null;
    user.gamingGame = null;
  }

  // Discord Active
  const wasOnline =
    oldPresence &&
    oldPresence.status &&
    oldPresence.status !== "offline";

  const isOnline =
    newPresence.status &&
    newPresence.status !== "offline";

  if (!wasOnline && isOnline) {
    user.discordActiveAt = now;
  }

  if (wasOnline && !isOnline) {
    if (user.discordActiveAt !== null) {
      user.discordSeconds += Math.floor(
        (now - user.discordActiveAt) / 1000
      );
    }

    user.discordActiveAt = null;
  }
});

// =========================
// PERIODIC STATS UPDATE
// =========================

setInterval(() => {
  const now = Date.now();

  for (const userId of Object.keys(stats)) {
    const user = stats[userId];

    if (user.voiceJoinedAt !== null) {
      user.voiceSeconds += Math.floor(
        (now - user.voiceJoinedAt) / 1000
      );

      user.voiceJoinedAt = now;
    }

    if (user.discordActiveAt !== null) {
      user.discordSeconds += Math.floor(
        (now - user.discordActiveAt) / 1000
      );

      user.discordActiveAt = now;
    }

    if (user.gamingActiveAt !== null) {
      user.gamingSeconds += Math.floor(
        (now - user.gamingActiveAt) / 1000
      );

      user.gamingActiveAt = now;
    }
  }

  saveStats();
}, 30 * 1000);

// =========================
// STATS IMAGE
// =========================

function formatTime(seconds) {
  seconds = Math.max(0, Math.floor(seconds || 0));

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  return `${hours}ч ${minutes}м`;
}

async function createStatsImage(userId, username) {
  const width = 1536;
  const height = 1536;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Template
  if (fs.existsSync(templatePath)) {
    const template = await loadImage(templatePath);
    ctx.drawImage(template, 0, 0, width, height);
  } else {
    ctx.fillStyle = "#111111";
    ctx.fillRect(0, 0, width, height);
  }

  const user = ensureUser(userId, username);

  // Current active time
  const now = Date.now();

  let voiceSeconds = user.voiceSeconds;
  let discordSeconds = user.discordSeconds;
  let gamingSeconds = user.gamingSeconds;

  if (user.voiceJoinedAt !== null) {
    voiceSeconds += Math.floor(
      (now - user.voiceJoinedAt) / 1000
    );
  }

  if (user.discordActiveAt !== null) {
    discordSeconds += Math.floor(
      (now - user.discordActiveAt) / 1000
    );
  }

  if (user.gamingActiveAt !== null) {
    gamingSeconds += Math.floor(
      (now - user.gamingActiveAt) / 1000
    );
  }

  // =========================
  // USERNAME
  // =========================

  ctx.font = "bold 72px StatsFont, Arial";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";

  ctx.fillText(
    username,
    width / 2,
    180
  );

  // =========================
  // CARDS
  // =========================

  const cards = [
    {
      title: "VOICE",
      value: formatTime(voiceSeconds),
      color: "#ff4b4b",
      x: 170,
      y: 400,
    },
    {
      title: "MESSAGE",
      value: String(user.messages),
      color: "#55a8ff",
      x: 810,
      y: 400,
    },
    {
      title: "DISCORD",
      value: formatTime(discordSeconds),
      color: "#c080ff",
      x: 170,
      y: 760,
    },
    {
      title: "GAMING",
      value: formatTime(gamingSeconds),
      color: "#43ff91",
      x: 810,
      y: 760,
    },
    {
      title: "MUSIC",
      value: "SOON",
      color: "#ffd84a",
      x: 490,
      y: 1120,
    },
  ];

  for (const card of cards) {
    const cardWidth = 556;
    const cardHeight = 250;

    ctx.beginPath();
    ctx.roundRect(
      card.x,
      card.y,
      cardWidth,
      cardHeight,
      35
    );

    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.fill();

    ctx.lineWidth = 4;
    ctx.strokeStyle = card.color;
    ctx.stroke();

    ctx.textAlign = "left";

    ctx.font = "bold 34px StatsFont, Arial";
    ctx.fillStyle = card.color;

    ctx.fillText(
      card.title,
      card.x + 35,
      card.y + 60
    );

    ctx.font = "bold 58px StatsFont, Arial";
    ctx.fillStyle = "#ffffff";

    ctx.fillText(
      card.value,
      card.x + 35,
      card.y + 145
    );
  }

  return canvas.toBuffer("image/png");
}

// =========================
// GEMINI AI
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
// VOICE AI / SOUNDS
// =========================

let voiceSession = null;

function getSoundPath(number) {
  return path.join(
    soundsPath,
    `${number}.mp3`
  );
}

function getAvailableSounds() {
  if (!fs.existsSync(soundsPath)) {
    return [];
  }

  return fs
    .readdirSync(soundsPath)
    .filter((file) => /^\d+\.mp3$/i.test(file))
    .map((file) => file.replace(/\.mp3$/i, ""))
    .sort((a, b) => Number(a) - Number(b));
}

// =========================
// WAIT FOR VOICE READY
// =========================

function waitForVoiceReady(connection) {
  return new Promise((resolve, reject) => {
    if (connection.state.status === VoiceConnectionStatus.Ready) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      cleanup();

      reject(
        new Error(
          "Не удалось подключиться к голосовому каналу за 15 секунд."
        )
      );
    }, 15000);

    const onReady = () => {
      cleanup();
      resolve();
    };

    const onStateChange = (_, newState) => {
      if (newState.status === VoiceConnectionStatus.Ready) {
        onReady();
      }
    };

    function cleanup() {
      clearTimeout(timeout);

      connection.removeListener(
        VoiceConnectionStatus.Ready,
        onReady
      );

      connection.removeListener(
        "stateChange",
        onStateChange
      );
    }

    connection.on(
      VoiceConnectionStatus.Ready,
      onReady
    );

    connection.on(
      "stateChange",
      onStateChange
    );
  });
}

// =========================
// PLAY MP3 DIRECTLY
// =========================

async function playSound(number) {
  if (!voiceSession) {
    throw new Error(
      "Бот не подключён к голосовому каналу."
    );
  }

  const filePath = getSoundPath(number);

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Файл ${number}.mp3 не найден.`
    );
  }

  const fileSize = fs.statSync(filePath).size;

  console.log(
    `📦 Размер файла ${number}.mp3: ${fileSize} байт`
  );

  if (fileSize === 0) {
    throw new Error(
      `${number}.mp3 пустой.`
    );
  }

  console.log(
    `🎵 Пробую воспроизвести ${number}.mp3 напрямую...`
  );

  if (voiceSession.player) {
    voiceSession.player.stop(true);
  }

  /*
    StreamType.Arbitrary позволяет передать аудиофайл
    напрямую в audio resource.

    В зависимости от версии @discordjs/voice/prism-media
    библиотека может использовать FFmpeg внутри для
    декодирования MP3.
  */

  const resource = createAudioResource(
    filePath,
    {
      inputType: StreamType.Arbitrary,
    }
  );

  voiceSession.currentSound = number;

  console.log(
    `▶️ Начинаю воспроизведение ${number}.mp3`
  );

  voiceSession.player.play(resource);

  return new Promise((resolve, reject) => {
    let finished = false;

    const cleanup = () => {
      if (!voiceSession?.player) return;

      voiceSession.player.removeListener(
        AudioPlayerStatus.Idle,
        onIdle
      );

      voiceSession.player.removeListener(
        "error",
        onPlayerError
      );
    };

    const finishSuccess = () => {
      if (finished) return;

      finished = true;
      cleanup();

      console.log(
        `✓ ${number}.mp3 закончил воспроизведение`
      );

      resolve();
    };

    const finishError = (error) => {
      if (finished) return;

      finished = true;
      cleanup();

      console.error(
        `❌ Ошибка проигрывателя:`,
        error
      );

      reject(error);
    };

    const onIdle = () => {
      finishSuccess();
    };

    const onPlayerError = (error) => {
      finishError(error);
    };

    voiceSession.player.once(
      AudioPlayerStatus.Idle,
      onIdle
    );

    voiceSession.player.once(
      "error",
      onPlayerError
    );
  });
}

// =========================
// STOP SOUND
// =========================

function stopSound() {
  if (!voiceSession) {
    return false;
  }

  if (voiceSession.player) {
    voiceSession.player.stop(true);
  }

  if (voiceSession.connection) {
    try {
      voiceSession.connection.destroy();
    } catch (error) {
      console.error(
        "Ошибка отключения:",
        error
      );
    }
  }

  voiceSession = null;

  console.log(
    "⏹️ Воспроизведение остановлено, бот отключён."
  );

  return true;
}

// =========================
// DISCONNECT
// =========================

function disconnectVoice() {
  if (!voiceSession) {
    return;
  }

  if (voiceSession.player) {
    voiceSession.player.stop(true);
  }

  if (voiceSession.connection) {
    try {
      voiceSession.connection.destroy();
    } catch (error) {
      console.error(
        "Ошибка отключения от voice:",
        error
      );
    }
  }

  voiceSession = null;

  console.log(
    "Бот отключился от голосового канала."
  );
}

// =========================
// CONNECT TO VOICE
// =========================

async function connectToVoice(channel) {
  if (voiceSession) {
    disconnectVoice();
  }

  console.log(
    `Подключаюсь к "${channel.name}"...`
  );

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,

    // Бот слышит канал и не глушит микрофон.
    selfDeaf: false,
    selfMute: false,
  });

  const player = createAudioPlayer({
    behaviors: {
      noSubscriber: NoSubscriberBehavior.Stop,
    },
  });

  player.on(
    "error",
    (error) => {
      console.error(
        "❌ AudioPlayer error:",
        error
      );
    }
  );

  connection.subscribe(player);

  voiceSession = {
    connection,
    player,
    channelId: channel.id,
    guildId: channel.guild.id,
    currentSound: null,
  };

  try {
    await waitForVoiceReady(connection);

    console.log(
      `✓ Voice READY: "${channel.name}"`
    );

    console.log(
      `✓ Полностью подключён к "${channel.name}"`
    );
  } catch (error) {
    try {
      connection.destroy();
    } catch {}

    voiceSession = null;

    throw error;
  }
}

// =========================
// SLASH COMMANDS
// =========================

const commands = [
  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Показать твою статистику"),

  new SlashCommandBuilder()
    .setName("ai")
    .setDescription("Задать вопрос AI")
    .addStringOption((option) =>
      option
        .setName("вопрос")
        .setDescription("Твой вопрос")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("voiceai")
    .setDescription("Проиграть голосовой звук")
    .addIntegerOption((option) =>
      option
        .setName("номер")
        .setDescription("Номер звука: 1, 2 или 3")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(3)
    ),

  new SlashCommandBuilder()
    .setName("voiceai-stop")
    .setDescription(
      "Остановить звук и отключить бота"
    ),
].map((command) => command.toJSON());

// =========================
// REGISTER COMMANDS
// =========================

async function registerCommands() {
  const rest = new REST({
    version: "10",
  }).setToken(TOKEN);

  try {
    console.log(
      "🔄 Обновляю slash-команды..."
    );

    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      {
        body: commands,
      }
    );

    console.log(
      "✓ Slash-команды зарегистрированы."
    );
  } catch (error) {
    console.error(
      "❌ Ошибка регистрации команд:",
      error
    );
  }
}

// =========================
// INTERACTIONS
// =========================

client.on(
  "interactionCreate",
  async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    // =========================
    // /stats
    // =========================

    if (interaction.commandName === "stats") {
      try {
        await interaction.deferReply();

        const user = ensureUser(
          interaction.user.id,
          interaction.user.username
        );

        const imageBuffer =
          await createStatsImage(
            interaction.user.id,
            interaction.user.username
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
      } catch (error) {
        console.error(
          "❌ Ошибка /stats:",
          error
        );

        const message =
          "Не удалось создать статистику.";

        if (interaction.deferred) {
          await interaction.editReply({
            content: message,
          }).catch(() => {});
        } else if (!interaction.replied) {
          await interaction.reply({
            content: message,
            ephemeral: true,
          }).catch(() => {});
        }
      }

      return;
    }

    // =========================
    // /ai
    // =========================

    if (interaction.commandName === "ai") {
      const prompt =
        interaction.options.getString(
          "вопрос",
          true
        );

      try {
        await interaction.deferReply();

        const answer = await askAI(prompt);

        await interaction.editReply({
          content: answer,
        });
      } catch (error) {
        console.error(
          "❌ Ошибка /ai:",
          error
        );

        const message =
          "Не удалось получить ответ от AI.";

        if (interaction.deferred) {
          await interaction.editReply({
            content: message,
          }).catch(() => {});
        }
      }

      return;
    }

    // =========================
    // /voiceai
    // =========================

    if (interaction.commandName === "voiceai") {
      const number =
        interaction.options.getInteger(
          "номер",
          true
        );

      try {
        await interaction.deferReply();

        const member =
          await interaction.guild.members.fetch(
            interaction.user.id
          );

        const channel =
          member.voice.channel;

        if (!channel) {
          await interaction.editReply({
            content:
              "❌ Сначала зайди в голосовой канал.",
          });

          return;
        }

        const filePath =
          getSoundPath(number);

        if (!fs.existsSync(filePath)) {
          const available =
            getAvailableSounds();

          await interaction.editReply({
            content:
              `❌ Файл ${number}.mp3 не найден.` +
              `\nДоступные звуки: ${
                available.length
                  ? available.join(", ")
                  : "нет"
              }`,
          });

          return;
        }

        await connectToVoice(channel);

        console.log(
          "⏳ Жду 3 секунды перед воспроизведением..."
        );

        await new Promise(
          (resolve) =>
            setTimeout(resolve, 3000)
        );

        console.log(
          "▶️ 3 секунды прошли, запускаю звук..."
        );

        await playSound(number);

        await interaction.editReply({
          content:
            `🔊 Звук ${number}.mp3 воспроизведён.`,
        });

        // Автоматически отключаемся
        disconnectVoice();
      } catch (error) {
        console.error(
          "❌ Ошибка /voiceai:",
          error
        );

        // При ошибке тоже отключаемся
        disconnectVoice();

        const errorMessage =
          error?.message ||
          "Неизвестная ошибка.";

        if (interaction.deferred) {
          await interaction.editReply({
            content:
              `❌ Произошла ошибка: ${errorMessage}`,
          }).catch(() => {});
        } else if (!interaction.replied) {
          await interaction.reply({
            content:
              `❌ Произошла ошибка: ${errorMessage}`,
            ephemeral: true,
          }).catch(() => {});
        }
      }

      return;
    }

    // =========================
    // /voiceai-stop
    // =========================

    if (
      interaction.commandName ===
      "voiceai-stop"
    ) {
      try {
        const stopped =
          stopSound();

        if (stopped) {
          await interaction.reply({
            content:
              "⏹️ Воспроизведение остановлено, бот отключён от голосового канала.",
          });
        } else {
          await interaction.reply({
            content:
              "ℹ️ Бот сейчас не находится в голосовом канале.",
            ephemeral: true,
          });
        }
      } catch (error) {
        console.error(
          "❌ Ошибка /voiceai-stop:",
          error
        );

        if (!interaction.replied) {
          await interaction.reply({
            content:
              "❌ Не удалось остановить воспроизведение.",
            ephemeral: true,
          }).catch(() => {});
        }
      }

      return;
    }
  }
);

// =========================
// READY
// =========================

client.once("ready", async () => {
  console.log(
    `✓ Бот запущен как ${client.user.tag}`
  );

  console.log(
    `📁 Папка звуков: ${soundsPath}`
  );

  if (!fs.existsSync(soundsPath)) {
    fs.mkdirSync(soundsPath, {
      recursive: true,
    });

    console.log(
      "📁 Создана папка sounds."
    );
  }

  const sounds =
    getAvailableSounds();

  console.log(
    `🎵 Доступные звуки: ${
      sounds.length
        ? sounds.join(", ")
        : "нет"
    }`
  );

  loadStats();
  scheduleDailyReset();

  await registerCommands();
});

// =========================
// PROCESS ERRORS
// =========================

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

// =========================
// START
// =========================

loadStats();

client.login(TOKEN);
