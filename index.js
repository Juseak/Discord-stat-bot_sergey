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
  StreamType,
} = require("@discordjs/voice");

const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");

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

// ============================================================
// PATHS
// ============================================================

const statsPath = path.join(__dirname, "stats.json");
const templatePath = path.join(__dirname, "template.png");
const fontPath = path.join(__dirname, "font.ttf");

const soundsPath = path.join(
  __dirname,
  "sounds"
);

// ============================================================
// SOUNDS FOLDER
// ============================================================

if (!fs.existsSync(soundsPath)) {
  fs.mkdirSync(soundsPath, {
    recursive: true,
  });

  console.log("📁 Создана папка sounds");
}

// ============================================================
// VOICE PLAYER
// ============================================================

let voiceSession = null;

function getSoundPath(number) {
  return path.join(
    soundsPath,
    `${number}.mp3`
  );
}

function getAvailableSounds() {
  try {
    const files = fs.readdirSync(
      soundsPath
    );

    return files
      .filter((file) =>
        /^\d+\.mp3$/i.test(file)
      )
      .map((file) =>
        Number(
          path.basename(
            file,
            path.extname(file)
          )
        )
      )
      .sort(
        (a, b) => a - b
      );
  } catch (error) {
    console.error(
      "❌ Ошибка чтения sounds:",
      error
    );

    return [];
  }
}

// ============================================================
// WAIT FOR VOICE READY
// ============================================================

function waitForVoiceReady(connection) {
  return new Promise((resolve, reject) => {
    if (
      connection.state.status ===
      VoiceConnectionStatus.Ready
    ) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      cleanup();

      reject(
        new Error(
          "Discord не установил голосовое соединение за 15 секунд."
        )
      );
    }, 15000);

    const onReady = () => {
      cleanup();
      resolve();
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    function cleanup() {
      clearTimeout(timeout);

      connection.removeListener(
        VoiceConnectionStatus.Ready,
        onReady
      );

      connection.removeListener(
        "error",
        onError
      );
    }

    connection.once(
      VoiceConnectionStatus.Ready,
      onReady
    );

    connection.once(
      "error",
      onError
    );
  });
}

// ============================================================
// CREATE PCM STREAM FROM MP3
// ============================================================

function createPcmStreamFromMp3(filePath) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(
        new Error(
          "FFmpeg не найден."
        )
      );

      return;
    }

    console.log(
      `🎵 FFmpeg запускается: ${filePath}`
    );

    const ffmpeg = spawn(
      ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",

        "-i",
        filePath,

        "-vn",

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

    let stderr = "";

    ffmpeg.stderr.on(
      "data",
      (chunk) => {
        const text = chunk.toString();

        stderr += text;

        console.error(
          `FFmpeg: ${text.trim()}`
        );
      }
    );

    ffmpeg.on(
      "error",
      (error) => {
        console.error(
          "❌ FFmpeg process error:",
          error
        );

        reject(error);
      }
    );

    ffmpeg.on(
      "close",
      (code) => {
        console.log(
          `🎵 FFmpeg завершён. Код: ${code}`
        );

        if (
          code !== 0 &&
          code !== null
        ) {
          console.error(
            "❌ FFmpeg stderr:",
            stderr
          );
        }
      }
    );

    resolve({
      stream: ffmpeg.stdout,
      ffmpeg,
    });
  });
}

// ============================================================
// PLAY MP3
// ============================================================

async function playSound(number) {
  if (!voiceSession) {
    throw new Error(
      "Бот не подключён к голосовому каналу."
    );
  }

  const filePath =
    getSoundPath(number);

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Файл ${number}.mp3 не найден.`
    );
  }

  console.log(
    `🔊 Готовлю ${number}.mp3 к воспроизведению...`
  );

  // Останавливаем предыдущий звук
  if (voiceSession.player) {
    voiceSession.player.stop(true);
  }

  if (
    voiceSession.ffmpeg &&
    !voiceSession.ffmpeg.killed
  ) {
    try {
      voiceSession.ffmpeg.kill(
        "SIGKILL"
      );
    } catch {}
  }

  const {
    stream,
    ffmpeg,
  } =
    await createPcmStreamFromMp3(
      filePath
    );

  voiceSession.ffmpeg =
    ffmpeg;

  const resource =
    createAudioResource(
      stream,
      {
        inputType:
          StreamType.Raw,
      }
    );

  voiceSession.currentSound =
    number;

  console.log(
    `▶️ Начинаю воспроизведение ${number}.mp3`
  );

  voiceSession.player.play(
    resource
  );

  return new Promise(
    (resolve, reject) => {
      let finished = false;

      const cleanup = () => {
        voiceSession?.player?.removeListener(
          AudioPlayerStatus.Idle,
          onIdle
        );

        voiceSession?.player?.removeListener(
          "error",
          onError
        );
      };

      const onIdle = () => {
        if (finished) {
          return;
        }

        finished = true;

        cleanup();

        console.log(
          `✓ ${number}.mp3 закончил воспроизведение`
        );

        if (
          voiceSession?.ffmpeg ===
          ffmpeg
        ) {
          voiceSession.ffmpeg =
            null;
        }

        resolve();
      };

      const onError = (error) => {
        if (finished) {
          return;
        }

        finished = true;

        cleanup();

        console.error(
          "❌ Audio Player error:",
          error
        );

        if (
          voiceSession?.ffmpeg ===
          ffmpeg
        ) {
          voiceSession.ffmpeg =
            null;
        }

        reject(error);
      };

      voiceSession.player.once(
        AudioPlayerStatus.Idle,
        onIdle
      );

      voiceSession.player.once(
        "error",
        onError
      );
    }
  );
}

// ============================================================
// STOP SOUND
// ============================================================

function stopSound() {
  if (!voiceSession) {
    return false;
  }

  try {
    if (voiceSession.player) {
      voiceSession.player.stop(true);
    }

    if (
      voiceSession.ffmpeg &&
      !voiceSession.ffmpeg.killed
    ) {
      voiceSession.ffmpeg.kill(
        "SIGKILL"
      );
    }
  } catch (error) {
    console.error(
      "❌ Ошибка остановки звука:",
      error
    );
  }

  voiceSession.currentSound =
    null;

  voiceSession.ffmpeg =
    null;

  return true;
}

// ============================================================
// DISCONNECT VOICE
// ============================================================

function disconnectVoice() {
  if (!voiceSession) {
    return false;
  }

  try {
    if (voiceSession.player) {
      voiceSession.player.stop(true);
    }

    if (
      voiceSession.ffmpeg &&
      !voiceSession.ffmpeg.killed
    ) {
      voiceSession.ffmpeg.kill(
        "SIGKILL"
      );
    }

    if (voiceSession.connection) {
      voiceSession.connection.destroy();
    }
  } catch (error) {
    console.error(
      "❌ Ошибка отключения:",
      error
    );
  }

  voiceSession = null;

  console.log(
    "🛑 Бот отключился от голосового канала."
  );

  return true;
}

// ============================================================
// CONNECT VOICE
// ============================================================

async function connectToVoice(channel) {
  if (voiceSession) {
    const sameChannel =
      voiceSession.channelId ===
      channel.id;

    if (sameChannel) {
      await waitForVoiceReady(
        voiceSession.connection
      );

      return voiceSession;
    }

    disconnectVoice();
  }

  console.log(
    `🎙️ Подключаюсь к "${channel.name}"...`
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

  voiceSession = {
    connection,
    player,
    channelId: channel.id,
    currentSound: null,
    ffmpeg: null,
  };

  connection.on(
    VoiceConnectionStatus.Ready,
    () => {
      console.log(
        `✓ Voice READY: "${channel.name}"`
      );
    }
  );

  connection.on(
    VoiceConnectionStatus.Disconnected,
    () => {
      console.log(
        "⚠️ Voice connection отключён."
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
        "❌ Audio Player error:",
        error
      );
    }
  );

  await waitForVoiceReady(
    connection
  );

  console.log(
    `✓ Полностью подключён к "${channel.name}"`
  );

  return voiceSession;
}

// ============================================================
// STATS DATA
// ============================================================

let stats = {
  users: {},
};

function loadStats() {
  try {
    if (!fs.existsSync(statsPath)) {
      stats = {
        users: {},
      };

      saveStats();

      return;
    }

    const raw =
      fs.readFileSync(
        statsPath,
        "utf8"
      );

    if (!raw.trim()) {
      stats = {
        users: {},
      };

      return;
    }

    stats = JSON.parse(raw);

    if (
      !stats.users ||
      typeof stats.users !==
        "object"
    ) {
      stats.users = {};
    }

    console.log(
      "✓ Статистика загружена!"
    );
  } catch (error) {
    console.error(
      "❌ Ошибка загрузки stats.json:",
      error
    );

    stats = {
      users: {},
    };
  }
}

function saveStats() {
  try {
    fs.writeFileSync(
      statsPath,
      JSON.stringify(
        stats,
        null,
        2
      ),
      "utf8"
    );
  } catch (error) {
    console.error(
      "❌ Ошибка сохранения stats.json:",
      error
    );
  }
}

loadStats();

// ============================================================
// TEMPLATE / FONT
// ============================================================

let templateImage = null;

if (fs.existsSync(fontPath)) {
  try {
    GlobalFonts.registerFromPath(
      fontPath,
      "CustomFont"
    );

    console.log(
      "✓ Шрифт зарегистрирован!"
    );
  } catch (error) {
    console.error(
      "❌ Ошибка регистрации шрифта:",
      error
    );
  }
}

async function loadTemplate() {
  try {
    if (
      !fs.existsSync(
        templatePath
      )
    ) {
      console.log(
        "⚠️ template.png не найден."
      );

      return;
    }

    templateImage =
      await loadImage(
        templatePath
      );

    console.log(
      "✓ Шаблон закэширован!"
    );
  } catch (error) {
    console.error(
      "❌ Ошибка загрузки шаблона:",
      error
    );
  }
}

// ============================================================
// USER STATS
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

  const user =
    stats.users[userId];

  if (
    typeof user.messages !==
    "number"
  ) {
    user.messages = 0;
  }

  if (
    typeof user.voiceSeconds !==
    "number"
  ) {
    user.voiceSeconds = 0;
  }

  if (
    typeof user.discordSeconds !==
    "number"
  ) {
    user.discordSeconds = 0;
  }

  if (
    typeof user.gamingSeconds !==
    "number"
  ) {
    user.gamingSeconds = 0;
  }

  if (
    typeof user.gamingGame !==
    "string"
  ) {
    user.gamingGame = "";
  }

  if (
    !(
      "messageActiveSince" in
      user
    )
  ) {
    user.messageActiveSince =
      null;
  }

  if (
    !(
      "voiceActiveSince" in
      user
    )
  ) {
    user.voiceActiveSince =
      null;
  }

  if (
    !(
      "discordActiveSince" in
      user
    )
  ) {
    user.discordActiveSince =
      null;
  }

  if (
    !(
      "gamingActiveSince" in
      user
    )
  ) {
    user.gamingActiveSince =
      null;
  }

  return user;
}

// ============================================================
// ACTIVE TIME
// ============================================================

function updateActiveTime(userId) {
  const user =
    getUserStats(userId);

  const now = Date.now();

  if (
    user.messageActiveSince
  ) {
    user.messages += 0;
  }

  if (
    user.voiceActiveSince
  ) {
    user.voiceSeconds += Math.max(
      0,
      Math.floor(
        (now -
          user.voiceActiveSince) /
          1000
      )
    );

    user.voiceActiveSince =
      now;
  }

  if (
    user.discordActiveSince
  ) {
    user.discordSeconds +=
      Math.max(
        0,
        Math.floor(
          (now -
            user.discordActiveSince) /
            1000
        )
      );

    user.discordActiveSince =
      now;
  }

  if (
    user.gamingActiveSince
  ) {
    user.gamingSeconds +=
      Math.max(
        0,
        Math.floor(
          (now -
            user.gamingActiveSince) /
            1000
        )
      );

    user.gamingActiveSince =
      now;
  }
}

// ============================================================
// DAILY RESET
// ============================================================

let lastResetDate =
  new Date().toDateString();

function checkDailyReset() {
  const currentDate =
    new Date().toDateString();

  if (
    currentDate ===
    lastResetDate
  ) {
    return;
  }

  console.log(
    "🔄 Новый день — сбрасываю дневную статистику."
  );

  for (
    const userId of Object.keys(
      stats.users
    )
  ) {
    const user =
      getUserStats(userId);

    updateActiveTime(userId);

    user.messages = 0;
    user.voiceSeconds = 0;
    user.discordSeconds = 0;
    user.gamingSeconds = 0;
    user.gamingGame = "";

    const now = Date.now();

    if (
      user.messageActiveSince
    ) {
      user.messageActiveSince =
        now;
    }

    if (
      user.voiceActiveSince
    ) {
      user.voiceActiveSince =
        now;
    }

    if (
      user.discordActiveSince
    ) {
      user.discordActiveSince =
        now;
    }

    if (
      user.gamingActiveSince
    ) {
      user.gamingActiveSince =
        now;
    }
  }

  lastResetDate =
    currentDate;

  saveStats();
}

// ============================================================
// MESSAGE TRACKING
// ============================================================

client.on(
  "messageCreate",
  (message) => {
    try {
      if (!message.guild) {
        return;
      }

      if (message.author.bot) {
        return;
      }

      checkDailyReset();

      const user =
        getUserStats(
          message.author.id
        );

      user.messages += 1;

      if (
        !user.messageActiveSince
      ) {
        user.messageActiveSince =
          Date.now();
      }

      saveStats();
    } catch (error) {
      console.error(
        "❌ Ошибка message tracking:",
        error
      );
    }
  }
);

// ============================================================
// VOICE TRACKING
// ============================================================

client.on(
  "voiceStateUpdate",
  (oldState, newState) => {
    try {
      if (!newState.member) {
        return;
      }

      const userId =
        newState.member.id;

      if (
        newState.member.user?.bot
      ) {
        return;
      }

      checkDailyReset();

      const user =
        getUserStats(userId);

      // Подключился
      if (
        !oldState.channelId &&
        newState.channelId
      ) {
        if (
          !user.voiceActiveSince
        ) {
          user.voiceActiveSince =
            Date.now();
        }
      }

      // Отключился
      if (
        oldState.channelId &&
        !newState.channelId
      ) {
        if (
          user.voiceActiveSince
        ) {
          user.voiceSeconds +=
            Math.max(
              0,
              Math.floor(
                (Date.now() -
                  user.voiceActiveSince) /
                  1000
              )
            );

          user.voiceActiveSince =
            null;
        }
      }

      // Discord activity
      if (newState.channelId) {
        if (
          !user.discordActiveSince
        ) {
          user.discordActiveSince =
            Date.now();
        }
      } else {
        if (
          user.discordActiveSince
        ) {
          user.discordSeconds +=
            Math.max(
              0,
              Math.floor(
                (Date.now() -
                  user.discordActiveSince) /
                  1000
              )
            );

          user.discordActiveSince =
            null;
        }
      }

      saveStats();
    } catch (error) {
      console.error(
        "❌ Ошибка voice tracking:",
        error
      );
    }
  }
);

// ============================================================
// PRESENCE / GAMING
// ============================================================

client.on(
  "presenceUpdate",
  (oldPresence, newPresence) => {
    try {
      if (!newPresence?.userId) {
        return;
      }

      const userId =
        newPresence.userId;

      const member =
        newPresence.member;

      if (
        member?.user?.bot
      ) {
        return;
      }

      checkDailyReset();

      const user =
        getUserStats(userId);

      const activities =
        newPresence.activities ||
        [];

      const game =
        activities.find(
          (activity) =>
            activity.type ===
            ActivityType.Playing
        );

      if (game) {
        if (
          !user.gamingActiveSince
        ) {
          user.gamingActiveSince =
            Date.now();
        }

        user.gamingGame =
          game.name ||
          game.details ||
          "Игра";
      } else {
        if (
          user.gamingActiveSince
        ) {
          user.gamingSeconds +=
            Math.max(
              0,
              Math.floor(
                (Date.now() -
                  user.gamingActiveSince) /
                  1000
              )
            );

          user.gamingActiveSince =
            null;
        }

        user.gamingGame = "";
      }

      // Discord online / idle / dnd
      if (
        newPresence.status ===
          "online" ||
        newPresence.status ===
          "idle" ||
        newPresence.status ===
          "dnd"
      ) {
        if (
          !user.discordActiveSince
        ) {
          user.discordActiveSince =
            Date.now();
        }
      } else {
        if (
          user.discordActiveSince
        ) {
          user.discordSeconds +=
            Math.max(
              0,
              Math.floor(
                (Date.now() -
                  user.discordActiveSince) /
                  1000
              )
            );

          user.discordActiveSince =
            null;
        }
      }

      saveStats();
    } catch (error) {
      console.error(
        "❌ Ошибка presence tracking:",
        error
      );
    }
  }
);

// ============================================================
// AUTOSAVE
// ============================================================

setInterval(() => {
  try {
    checkDailyReset();

    for (
      const userId of Object.keys(
        stats.users
      )
    ) {
      updateActiveTime(userId);
    }

    saveStats();
  } catch (error) {
    console.error(
      "❌ Ошибка autosave:",
      error
    );
  }
}, 30000);

// ============================================================
// STATS IMAGE
// ============================================================

function formatTime(seconds) {
  seconds = Math.max(
    0,
    Math.floor(seconds)
  );

  const days = Math.floor(
    seconds / 86400
  );

  seconds %= 86400;

  const hours = Math.floor(
    seconds / 3600
  );

  seconds %= 3600;

  const minutes = Math.floor(
    seconds / 60
  );

  if (days > 0) {
    return `${days}д ${hours}ч`;
  }

  if (hours > 0) {
    return `${hours}ч ${minutes}м`;
  }

  return `${minutes}м`;
}

async function createStatsImage(
  user
) {
  const width = 1536;
  const height = 1536;

  const canvas =
    createCanvas(
      width,
      height
    );

  const ctx =
    canvas.getContext("2d");

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
    ctx.fillStyle =
      "#111111";

    ctx.fillRect(
      0,
      0,
      width,
      height
    );
  }

  const userStats =
    getUserStats(
      user.id
    );

  updateActiveTime(
    user.id
  );

  // ==========================================================
  // AVATAR
  // ==========================================================

  try {
    const avatarURL =
      user.displayAvatarURL({
        extension: "png",
        size: 512,
      });

    const avatar =
      await loadImage(
        avatarURL
      );

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
    console.error(
      "❌ Ошибка загрузки аватара:",
      error
    );
  }

  // ==========================================================
  // USERNAME
  // ==========================================================

  ctx.textAlign =
    "center";

  ctx.font =
    "bold 64px CustomFont, Arial";

  ctx.fillStyle =
    "#ffffff";

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

    ctx.fillStyle =
      "rgba(20, 20, 25, 0.88)";

    ctx.beginPath();

    const radius = 35;

    ctx.moveTo(
      x + radius,
      y
    );

    ctx.lineTo(
      x + w - radius,
      y
    );

    ctx.quadraticCurveTo(
      x + w,
      y,
      x + w,
      y + radius
    );

    ctx.lineTo(
      x + w,
      y + h - radius
    );

    ctx.quadraticCurveTo(
      x + w,
      y + h,
      x + w - radius,
      y + h
    );

    ctx.lineTo(
      x + radius,
      y + h
    );

    ctx.quadraticCurveTo(
      x,
      y + h,
      x,
      y + h - radius
    );

    ctx.lineTo(
      x,
      y + radius
    );

    ctx.quadraticCurveTo(
      x,
      y,
      x + radius,
      y
    );

    ctx.closePath();

    ctx.fill();

    ctx.fillStyle =
      color;

    ctx.fillRect(
      x,
      y,
      10,
      h
    );

    ctx.textAlign =
      "left";

    ctx.font =
      "bold 32px CustomFont, Arial";

    ctx.fillStyle =
      "#ffffff";

    ctx.fillText(
      title,
      x + 45,
      y + 65
    );

    ctx.font =
      "bold 52px CustomFont, Arial";

    ctx.fillStyle =
      color;

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
    formatTime(
      userStats.voiceSeconds
    ),
    "#ff4b4b"
  );

  drawCard(
    816,
    620,
    560,
    190,
    "MESSAGE",
    String(
      userStats.messages
    ),
    "#55a8ff"
  );

  drawCard(
    160,
    850,
    560,
    190,
    "DISCORD",
    formatTime(
      userStats.discordSeconds
    ),
    "#c080ff"
  );

  drawCard(
    816,
    850,
    560,
    190,
    "GAMING",
    formatTime(
      userStats.gamingSeconds
    ),
    "#43ff91"
  );

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
  if (
    userStats.gamingGame
  ) {
    ctx.textAlign =
      "center";

    ctx.font =
      "28px CustomFont, Arial";

    ctx.fillStyle =
      "#ffffff";

    ctx.fillText(
      userStats.gamingGame,
      1096,
      1195
    );
  }

  return canvas.toBuffer(
    "image/png"
  );
}

// ============================================================
// NORMAL AI
// ============================================================

async function askAI(
  prompt
) {
  const response =
    await gemini.models.generateContent(
      {
        model: AI_MODEL,

        contents: prompt,

        config: {
          systemInstruction: `
Ты обычный AI-ассистент Discord-бота.
Отвечай на русском языке.
Будь полезным и понятным.
`,
        },
      }
    );

  return (
    response.text ||
    "Не удалось получить ответ."
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
    .setDescription(
      "Показать статистику пользователя"
    ),

  // ----------------------------------------------------------
  // AI
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // VOICEAI
  // ----------------------------------------------------------

  new SlashCommandBuilder()
    .setName("voiceai")
    .setDescription(
      "Подключиться к голосовому каналу и проиграть звук"
    )
    .addIntegerOption(
      (option) =>
        option
          .setName("номер")
          .setDescription(
            "Номер MP3 из папки sounds"
          )
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(999)
    ),

  // ----------------------------------------------------------
  // VOICEAI STOP
  // ----------------------------------------------------------

  new SlashCommandBuilder()
    .setName("voiceai-stop")
    .setDescription(
      "Остановить звук и отключить бота от войса"
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
              name:
                "stats.png",
            }
          );

        await interaction.reply(
          {
            files: [
              attachment,
            ],
          }
        );

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
          await askAI(
            prompt
          );

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
          await interaction.reply(
            {
              content:
                "❌ Сначала зайди в голосовой канал.",
              ephemeral: true,
            }
          );

          return;
        }

        const number =
          interaction.options.getInteger(
            "номер",
            true
          );

        const availableSounds =
          getAvailableSounds();

        if (
          availableSounds.length ===
          0
        ) {
          await interaction.reply(
            {
              content:
                "❌ В папке sounds нет MP3-файлов.",
              ephemeral: true,
            }
          );

          return;
        }

        const filePath =
          getSoundPath(
            number
          );

        if (
          !fs.existsSync(
            filePath
          )
        ) {
          await interaction.reply(
            {
              content:
                `❌ Файл ${number}.mp3 не найден.\n\nДоступные звуки: ${availableSounds.join(", ")}`,
              ephemeral: true,
            }
          );

          return;
        }

        await interaction.deferReply();

        // Подключаемся к войсу
        await connectToVoice(
          channel
        );

        // ====================================================
        // ЖДЁМ РОВНО 3 СЕКУНДЫ ПОСЛЕ ПОДКЛЮЧЕНИЯ
        // ====================================================

        console.log(
          "⏳ Жду 3 секунды перед воспроизведением..."
        );

        await new Promise(
          (resolve) =>
            setTimeout(
              resolve,
              3000
            )
        );

        console.log(
          "▶️ 3 секунды прошли, запускаю звук..."
        );

        // Проигрываем
        await playSound(
          number
        );

        await interaction.editReply(
          `🔊 Включил **${number}.mp3** в **${channel.name}**.`
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
        if (!voiceSession) {
          await interaction.reply(
            "ℹ️ Бот сейчас не находится в голосовом канале."
          );

          return;
        }

        stopSound();
        disconnectVoice();

        await interaction.reply(
          "🛑 Звук остановлен, бот отключился от голосового канала."
        );

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
        await interaction
          .editReply(
            message
          )
          .catch(() => {});
      } else {
        await interaction
          .reply({
            content:
              message,
            ephemeral: true,
          })
          .catch(() => {});
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
      "✓ Статистика загружена!"
    );

    const sounds =
      getAvailableSounds();

    if (sounds.length > 0) {
      console.log(
        `🔊 Найдены звуки: ${sounds.join(", ")}`
      );
    } else {
      console.log(
        "⚠️ В папке sounds пока нет MP3."
      );
    }

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
// PROCESS ERRORS
// ============================================================

process.on(
  "unhandledRejection",
  (error) => {
    console.error(
      "❌ Unhandled Promise Rejection:",
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

client.login(
  DISCORD_TOKEN
);
