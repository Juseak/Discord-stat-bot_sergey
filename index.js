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

const { GoogleGenAI } = require("@google/genai");
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");

const fs = require("fs");
const path = require("path");

// ======================================================
// CONFIG
// ======================================================

const TOKEN = process.env.DISCORD_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const CLIENT_ID = process.env.CLIENT_ID;

const AI_MODEL = "gemini-3.5-flash-lite";

if (!TOKEN) {
  console.error("❌ DISCORD_TOKEN не найден в Variables");
  process.exit(1);
}

if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY не найден в Variables");
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error("❌ CLIENT_ID не найден в Variables");
  process.exit(1);
}

const gemini = new GoogleGenAI({
  apiKey: GEMINI_API_KEY,
});

// ======================================================
// DISCORD CLIENT
// ======================================================

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

// ======================================================
// FILES
// ======================================================

const STATS_FILE = path.join(__dirname, "stats.json");
const TEMPLATE_FILE = path.join(__dirname, "template.png");
const FONT_FILE = path.join(__dirname, "font.ttf");

// ======================================================
// STATS
// ======================================================

let stats = {};

function loadStats() {
  try {
    if (!fs.existsSync(STATS_FILE)) {
      stats = {};
      return;
    }

    stats = JSON.parse(
      fs.readFileSync(STATS_FILE, "utf8")
    );

    console.log("✅ stats.json загружен");
  } catch (error) {
    console.error("❌ Ошибка загрузки stats.json:", error);
    stats = {};
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

function getUserStats(userId) {
  if (!stats[userId]) {
    stats[userId] = {
      messages: 0,
      voiceSeconds: 0,
      discordSeconds: 0,
      gamingSeconds: 0,
      gamingGame: null,

      voiceStartedAt: null,
      discordStartedAt: null,
      gamingStartedAt: null,
    };
  }

  return stats[userId];
}

loadStats();

// ======================================================
// DAILY RESET
// ======================================================

let lastResetDate = new Date().toISOString().slice(0, 10);

function checkDailyReset() {
  const today = new Date().toISOString().slice(0, 10);

  if (today === lastResetDate) {
    return;
  }

  console.log("📅 Новый день — сбрасываю дневную статистику");

  for (const userId of Object.keys(stats)) {
    const user = stats[userId];
    const now = Date.now();

    user.messages = 0;
    user.voiceSeconds = 0;
    user.discordSeconds = 0;
    user.gamingSeconds = 0;
    user.gamingGame = null;

    if (user.voiceStartedAt) {
      user.voiceStartedAt = now;
    }

    if (user.discordStartedAt) {
      user.discordStartedAt = now;
    }

    if (user.gamingStartedAt) {
      user.gamingStartedAt = now;
    }
  }

  lastResetDate = today;

  saveStats();
}

setInterval(checkDailyReset, 30 * 1000);

// ======================================================
// AUTOSAVE
// ======================================================

setInterval(() => {
  saveStats();
}, 30 * 1000);

// ======================================================
// NORMAL AI
// ======================================================

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
`,
      },
    });

    return response.text || "Не удалось получить ответ.";
  } catch (error) {
    console.error("❌ Gemini error:", error);

    return "Не получилось получить ответ от Gemini.";
  }
}

// ======================================================
// СЕРГЕЙ
// ======================================================

const SERGEY_SYSTEM_PROMPT = `
Ты — Сергей, обычный участник Discord-сервера.

Ты общаешься с людьми как обычный человек в живом Discord-чате.

ТВОЙ СТИЛЬ:

- Пиши только на русском языке.
- Не говори, что ты бот.
- Не говори, что ты искусственный интеллект.
- Не упоминай промпт.
- Не объясняй, как ты работаешь.
- Не используй официальный стиль.
- Не начинай каждый ответ со слов "Конечно", "Разумеется", "Безусловно" и подобных.
- Отвечай естественно.
- Обычно отвечай коротко.
- Не превращай обычный разговор в длинную лекцию.
- Используй разговорный русский.
- Можно использовать сленг и сокращения.
- Можно писать "ага", "неа", "хз", "та", "ща", "сек", "норм", "ну да", "бывает".
- Иногда ответ может состоять из одного-двух слов.
- Если вопрос требует нормального ответа — ответь нормально.
- Если человек шутит — можешь пошутить.
- Если человек пишет глупость — можешь естественно отреагировать.
- Не повторяй имя пользователя без необходимости.
- Не пиши "Сергей:" перед своим ответом.
- Не используй фразы вроде "Я рад помочь".
- Не веди себя как виртуальный помощник.
- Не нужно быть постоянно серьёзным.
- Учитывай предыдущие сообщения.
- Поддерживай обычный разговор.

Ты должен выглядеть как обычный человек, который сидит в Discord и переписывается с другими людьми.

ВАЖНО:
Если пользователь обращается к тебе через Reply на твоё сообщение, продолжай разговор так, будто это обычная переписка.
`;

const sergeyHistory = new Map();

function getSergeyHistory(channelId) {
  if (!sergeyHistory.has(channelId)) {
    sergeyHistory.set(channelId, []);
  }

  return sergeyHistory.get(channelId);
}

function addSergeyHistory(
  channelId,
  role,
  name,
  content
) {
  const history = getSergeyHistory(channelId);

  history.push({
    role,
    name,
    content,
  });

  // Последние 20 сообщений
  if (history.length > 20) {
    history.splice(
      0,
      history.length - 20
    );
  }
}

function buildSergeyPrompt(
  channelId,
  currentMessage
) {
  const history = getSergeyHistory(channelId);

  let context = "";

  for (const message of history) {
    context += `${message.name}: ${message.content}\n`;
  }

  return `
${SERGEY_SYSTEM_PROMPT}

ПОСЛЕДНИЕ СООБЩЕНИЯ ЧАТА:

${context || "(контекста пока нет)"}

НОВОЕ СООБЩЕНИЕ:

${currentMessage}

Ответь на последнее сообщение.

Не пиши "Сергей:".
Не пиши объяснений о своей роли.
Просто дай естественный ответ.
`;
}

async function askSergey(
  channelId,
  content
) {
  try {
    const prompt = buildSergeyPrompt(
      channelId,
      content
    );

    console.log(
      `🤖 Сергей получает: "${content}"`
    );

    const response =
      await gemini.models.generateContent({
        model: AI_MODEL,
        contents: prompt,
        config: {
          systemInstruction:
            SERGEY_SYSTEM_PROMPT,
          temperature: 0.9,
          maxOutputTokens: 250,
        },
      });

    let answer =
      response.text?.trim();

    if (!answer) {
      console.log(
        "⚠️ Gemini не вернул текст"
      );

      return "хз";
    }

    // Убираем случайное "Сергей:"
    answer = answer.replace(
      /^сергей\s*:\s*/i,
      ""
    );

    console.log(
      `🤖 Сергей отвечает: "${answer}"`
    );

    return answer;
  } catch (error) {
    console.error(
      "❌ Ошибка Gemini Сергея:",
      error
    );

    return "та щас не могу ответить";
  }
}

// ======================================================
// SERGEY MESSAGE DETECTION
// ======================================================

function isSergeyMention(content) {
  return /^сергей\b/i.test(
    content.trim()
  );
}

function removeSergeyMention(content) {
  return content
    .trim()
    .replace(/^сергей\b/i, "")
    .trim()
    .replace(
      /^[,:;.!?\-–—]+\s*/,
      ""
    )
    .trim();
}

async function isReplyToSergey(message) {
  if (!message.reference?.messageId) {
    return false;
  }

  try {
    let referencedMessage =
      message.channel.messages.cache.get(
        message.reference.messageId
      );

    if (!referencedMessage) {
      referencedMessage =
        await message.channel.messages.fetch(
          message.reference.messageId
        );
    }

    const result =
      referencedMessage.author?.id ===
      client.user.id;

    console.log(
      `↩️ Reply проверка: ${result}`
    );

    return result;
  } catch (error) {
    console.error(
      "Ошибка проверки Reply:",
      error
    );

    return false;
  }
}

// ======================================================
// ENTERTAINMENT
// ======================================================

const BALL_ANSWERS = [
  "Да.",
  "Нет.",
  "Скорее всего да.",
  "Скорее всего нет.",
  "Вполне возможно.",
  "Хз.",
  "Определённо.",
  "Не рассчитывай на это.",
  "Звучит неплохо.",
  "Лучше не надо.",
];

const RIDDLES = [
  {
    question:
      "Что можно увидеть с закрытыми глазами?",
    answer: "сон",
  },
  {
    question:
      "Что идёт, но никогда не ходит?",
    answer: "часы",
  },
  {
    question:
      "Без рук, без ног, а ворота открывает. Что это?",
    answer: "ветер",
  },
  {
    question:
      "Что принадлежит тебе, но другие используют это чаще тебя?",
    answer: "имя",
  },
  {
    question:
      "Чем больше из неё берёшь, тем больше она становится?",
    answer: "яма",
  },
];

const FACTS = [
  "У осьминога три сердца.",
  "Банан с ботанической точки зрения считается ягодой.",
  "Мёд при правильном хранении может сохраняться очень долго.",
  "У акул скелет состоит в основном из хряща.",
  "Вода расширяется при замерзании.",
  "У человека больше 600 мышц.",
];

const JOKES = [
  "Программист — это человек, который решает проблемы, о существовании которых ты ещё не знал.",
  "— Почему компьютер завис?\n— Он задумался.",
  "Хотел написать нормальный код, но код решил иначе.",
  "Самая страшная ошибка программиста — сказать: «Да там на пять минут работы».",
];

const QUOTES = [
  "Иногда лучший план — просто начать.",
  "Ошибки тоже являются частью обучения.",
  "Не обязательно знать весь путь, чтобы сделать первый шаг.",
  "Если что-то не работает, сначала проверь, включено ли оно.",
];

// ======================================================
// SLASH COMMANDS
// ======================================================

const commands = [
  new SlashCommandBuilder()
    .setName("stats")
    .setDescription(
      "Показать статистику пользователя"
    )
    .addUserOption(option =>
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
    .addStringOption(option =>
      option
        .setName("вопрос")
        .setDescription(
          "Ваш вопрос"
        )
        .setRequired(true)
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
    ),

  new SlashCommandBuilder()
    .setName("8ball")
    .setDescription(
      "Задать вопрос магическому шару"
    )
    .addStringOption(option =>
      option
        .setName("вопрос")
        .setDescription(
          "Ваш вопрос"
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
      "Получить случайный факт"
    ),

  new SlashCommandBuilder()
    .setName("joke")
    .setDescription(
      "Получить случайную шутку"
    ),

  new SlashCommandBuilder()
    .setName("quote")
    .setDescription(
      "Получить случайную цитату"
    ),

  new SlashCommandBuilder()
    .setName("poll")
    .setDescription(
      "Создать опрос"
    )
    .addStringOption(option =>
      option
        .setName("вопрос")
        .setDescription(
          "Вопрос опроса"
        )
        .setRequired(true)
    ),
].map(command =>
  command.toJSON()
);

// ======================================================
// REGISTER COMMANDS
// ======================================================

async function registerCommands() {
  try {
    console.log(
      "🔄 Регистрирую Slash-команды..."
    );

    const rest = new REST({
      version: "10",
    }).setToken(TOKEN);

    await rest.put(
      Routes.applicationCommands(
        CLIENT_ID
      ),
      {
        body: commands,
      }
    );

    console.log(
      "✅ Slash-команды зарегистрированы"
    );
  } catch (error) {
    console.error(
      "❌ Ошибка регистрации команд:",
      error
    );
  }
}

// ======================================================
// MESSAGE CREATE
// ======================================================

client.on(
  "messageCreate",
  async message => {
    // ЭТОТ ЛОГ ДОЛЖЕН ПОЯВЛЯТЬСЯ НА ЛЮБОЕ
    // СООБЩЕНИЕ В СЕРВЕРЕ
    console.log(
      "📩 MESSAGE EVENT СРАБОТАЛ"
    );

    console.log(
      `📩 Автор: ${message.author?.username}`
    );

    console.log(
      `📩 Текст: "${message.content}"`
    );

    if (!message.guild) {
      console.log(
        "⏭️ Это не сообщение сервера"
      );

      return;
    }

    if (message.author.bot) {
      console.log(
        "⏭️ Сообщение от бота"
      );

      return;
    }

    checkDailyReset();

    // ==================================================
    // STATS
    // ==================================================

    const userStats =
      getUserStats(
        message.author.id
      );

    userStats.messages++;

    // ==================================================
    // SERGEY
    // ==================================================

    const mentionedByName =
      isSergeyMention(
        message.content
      );

    const repliedToSergey =
      await isReplyToSergey(
        message
      );

    console.log(
      `🔎 Сергей по имени: ${mentionedByName}`
    );

    console.log(
      `🔎 Reply Сергею: ${repliedToSergey}`
    );

    if (
      !mentionedByName &&
      !repliedToSergey
    ) {
      return;
    }

    let userText =
      message.content.trim();

    // Если обращение через имя —
    // убираем "Сергей"
    if (mentionedByName) {
      userText =
        removeSergeyMention(
          userText
        );
    }

    if (!userText) {
      userText =
        "просто обратился к тебе";
    }

    // ==================================================
    // HISTORY
    // ==================================================

    addSergeyHistory(
      message.channel.id,
      "user",
      message.member?.displayName ||
        message.author.username,
      userText
    );

    // ==================================================
    // TYPING
    // ==================================================

    try {
      await message.channel.sendTyping();
    } catch (error) {
      console.error(
        "Ошибка sendTyping:",
        error
      );
    }

    // ==================================================
    // HUMAN-LIKE DELAY
    // ==================================================

    const delay =
      500 +
      Math.floor(
        Math.random() * 1200
      );

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          delay
        )
    );

    // ==================================================
    // GEMINI
    // ==================================================

    const answer =
      await askSergey(
        message.channel.id,
        userText
      );

    // ==================================================
    // SAVE SERGEY MESSAGE
    // ==================================================

    addSergeyHistory(
      message.channel.id,
      "assistant",
      "Сергей",
      answer
    );

    // ==================================================
    // REPLY
    // ==================================================

    try {
      await message.reply({
        content: answer.slice(
          0,
          2000
        ),

        allowedMentions: {
          repliedUser: false,
        },
      });

      console.log(
        "✅ Сергей отправил ответ"
      );
    } catch (error) {
      console.error(
        "❌ Ошибка отправки ответа Сергея:",
        error
      );
    }
  }
);

// ======================================================
// VOICE STATS
// ======================================================

client.on(
  "voiceStateUpdate",
  (oldState, newState) => {
    if (
      oldState.member?.user.bot ||
      newState.member?.user.bot
    ) {
      return;
    }

    const userId =
      newState.id ||
      oldState.id;

    if (!userId) {
      return;
    }

    const userStats =
      getUserStats(userId);

    const now = Date.now();

    const oldChannel =
      oldState.channelId;

    const newChannel =
      newState.channelId;

    // Вошёл
    if (
      !oldChannel &&
      newChannel
    ) {
      userStats.voiceStartedAt =
        now;

      return;
    }

    // Вышел
    if (
      oldChannel &&
      !newChannel
    ) {
      if (
        userStats.voiceStartedAt
      ) {
        userStats.voiceSeconds +=
          Math.floor(
            (now -
              userStats.voiceStartedAt) /
              1000
          );
      }

      userStats.voiceStartedAt =
        null;

      saveStats();

      return;
    }

    // Перешёл
    if (
      oldChannel &&
      newChannel &&
      oldChannel !== newChannel
    ) {
      if (
        userStats.voiceStartedAt
      ) {
        userStats.voiceSeconds +=
          Math.floor(
            (now -
              userStats.voiceStartedAt) /
              1000
          );
      }

      userStats.voiceStartedAt =
        now;

      saveStats();
    }
  }
);

// ======================================================
// GAMING STATS
// ======================================================

client.on(
  "presenceUpdate",
  (oldPresence, newPresence) => {
    const userId =
      newPresence.userId;

    if (!userId) {
      return;
    }

    const member =
      newPresence.member;

    if (
      member?.user?.bot
    ) {
      return;
    }

    const userStats =
      getUserStats(userId);

    const now = Date.now();

    const playingActivity =
      newPresence.activities?.find(
        activity =>
          activity.type ===
          ActivityType.Playing
      );

    const wasGaming =
      Boolean(
        userStats.gamingStartedAt
      );

    const isGaming =
      Boolean(
        playingActivity
      );

    // Начал играть
    if (
      !wasGaming &&
      isGaming
    ) {
      userStats.gamingStartedAt =
        now;

      userStats.gamingGame =
        playingActivity.name;

      return;
    }

    // Продолжает играть
    if (
      wasGaming &&
      isGaming
    ) {
      userStats.gamingGame =
        playingActivity.name;

      return;
    }

    // Закончил
    if (
      wasGaming &&
      !isGaming
    ) {
      userStats.gamingSeconds +=
        Math.floor(
          (now -
            userStats.gamingStartedAt) /
            1000
        );

      userStats.gamingStartedAt =
        null;

      userStats.gamingGame =
        null;

      saveStats();
    }
  }
);

// ======================================================
// STATS CARD
// ======================================================

function formatTime(seconds) {
  seconds = Math.max(
    0,
    Math.floor(seconds)
  );

  const hours =
    Math.floor(
      seconds / 3600
    );

  const minutes =
    Math.floor(
      (seconds % 3600) / 60
    );

  if (hours > 0) {
    return `${hours}ч ${minutes}м`;
  }

  return `${minutes}м`;
}

async function createStatsCard(
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

  if (
    fs.existsSync(
      FONT_FILE
    )
  ) {
    try {
      GlobalFonts.registerFromPath(
        FONT_FILE,
        "StatsFont"
      );
    } catch {}
  }

  ctx.fillStyle =
    "#101010";

  ctx.fillRect(
    0,
    0,
    width,
    height
  );

  if (
    fs.existsSync(
      TEMPLATE_FILE
    )
  ) {
    try {
      const template =
        await loadImage(
          TEMPLATE_FILE
        );

      ctx.drawImage(
        template,
        0,
        0,
        width,
        height
      );
    } catch (error) {
      console.error(
        "Ошибка template.png:",
        error
      );
    }
  }

  const userStats =
    getUserStats(
      user.id
    );

  // Аватар
  try {
    const avatarUrl =
      user.displayAvatarURL({
        extension: "png",
        size: 512,
      });

    const avatar =
      await loadImage(
        avatarUrl
      );

    ctx.save();

    ctx.beginPath();

    ctx.arc(
      768,
      300,
      145,
      0,
      Math.PI * 2
    );

    ctx.closePath();
    ctx.clip();

    ctx.drawImage(
      avatar,
      623,
      155,
      290,
      290
    );

    ctx.restore();
  } catch (error) {
    console.error(
      "Ошибка аватара:",
      error
    );
  }

  // Имя
  ctx.textAlign =
    "center";

  ctx.font =
    "bold 64px StatsFont, sans-serif";

  ctx.fillStyle =
    "#ffffff";

  ctx.fillText(
    user.globalName ||
      user.username,
    768,
    530
  );

  // Карточки
  const cards = [
    {
      title: "VOICE",
      value:
        formatTime(
          userStats.voiceSeconds
        ),
      color: "#ff4b4b",
      x: 180,
      y: 680,
    },
    {
      title: "MESSAGE",
      value:
        String(
          userStats.messages
        ),
      color: "#55a8ff",
      x: 560,
      y: 680,
    },
    {
      title: "DISCORD",
      value:
        formatTime(
          userStats.discordSeconds
        ),
      color: "#c080ff",
      x: 940,
      y: 680,
    },
    {
      title: "GAMING",
      value:
        formatTime(
          userStats.gamingSeconds
        ),
      color: "#43ff91",
      x: 1320,
      y: 680,
    },
  ];

  for (
    const card of cards
  ) {
    ctx.textAlign =
      "center";

    ctx.font =
      "bold 28px StatsFont, sans-serif";

    ctx.fillStyle =
      card.color;

    ctx.fillText(
      card.title,
      card.x,
      card.y
    );

    ctx.font =
      "bold 42px StatsFont, sans-serif";

    ctx.fillStyle =
      "#ffffff";

    ctx.fillText(
      card.value,
      card.x,
      card.y + 60
    );
  }

  ctx.font =
    "28px StatsFont, sans-serif";

  ctx.fillStyle =
    "#ffffff";

  ctx.fillText(
    userStats.gamingGame
      ? `Играет: ${userStats.gamingGame}`
      : "MUSIC — SOON",
    768,
    930
  );

  return canvas.encode(
    "png"
  );
}

// ======================================================
// SLASH COMMAND INTERACTIONS
// ======================================================

client.on(
  "interactionCreate",
  async interaction => {
    if (
      !interaction.isChatInputCommand()
    ) {
      return;
    }

    try {
      // =================================================
      // STATS
      // =================================================

      if (
        interaction.commandName ===
        "stats"
      ) {
        await interaction.deferReply();

        const user =
          interaction.options.getUser(
            "user"
          ) ||
          interaction.user;

        const image =
          await createStatsCard(
            user
          );

        const attachment =
          new AttachmentBuilder(
            image,
            {
              name:
                "stats.png",
            }
          );

        await interaction.editReply(
          {
            files: [
              attachment,
            ],
          }
        );

        return;
      }

      // =================================================
      // AI
      // =================================================

      if (
        interaction.commandName ===
        "ai"
      ) {
        const prompt =
          interaction.options.getString(
            "вопрос"
          );

        await interaction.deferReply();

        const answer =
          await askAI(
            prompt
          );

        await interaction.editReply(
          answer.slice(
            0,
            2000
          )
        );

        return;
      }

      // =================================================
      // COINFLIP
      // =================================================

      if (
        interaction.commandName ===
        "coinflip"
      ) {
        const result =
          Math.random() < 0.5
            ? "🪙 Орёл"
            : "🪙 Решка";

        await interaction.reply(
          result
        );

        return;
      }

      // =================================================
      // DICE
      // =================================================

      if (
        interaction.commandName ===
        "dice"
      ) {
        const result =
          Math.floor(
            Math.random() * 6
          ) + 1;

        await interaction.reply(
          `🎲 Выпало: **${result}**`
        );

        return;
      }

      // =================================================
      // 8BALL
      // =================================================

      if (
        interaction.commandName ===
        "8ball"
      ) {
        const answer =
          BALL_ANSWERS[
            Math.floor(
              Math.random() *
                BALL_ANSWERS.length
            )
          ];

        await interaction.reply(
          `🎱 ${answer}`
        );

        return;
      }

      // =================================================
      // RIDDLE
      // =================================================

      if (
        interaction.commandName ===
        "riddle"
      ) {
        const riddle =
          RIDDLES[
            Math.floor(
              Math.random() *
                RIDDLES.length
            )
          ];

        await interaction.reply(
          `🧩 **Загадка**\n\n${riddle.question}`
        );

        return;
      }

      // =================================================
      // FACT
      // =================================================

      if (
        interaction.commandName ===
        "fact"
      ) {
        const fact =
          FACTS[
            Math.floor(
              Math.random() *
                FACTS.length
            )
          ];

        await interaction.reply(
          `💡 ${fact}`
        );

        return;
      }

      // =================================================
      // JOKE
      // =================================================

      if (
        interaction.commandName ===
        "joke"
      ) {
        const joke =
          JOKES[
            Math.floor(
              Math.random() *
                JOKES.length
            )
          ];

        await interaction.reply(
          joke
        );

        return;
      }

      // =================================================
      // QUOTE
      // =================================================

      if (
        interaction.commandName ===
        "quote"
      ) {
        const quote =
          QUOTES[
            Math.floor(
              Math.random() *
                QUOTES.length
            )
          ];

        await interaction.reply(
          `💬 ${quote}`
        );

        return;
      }

      // =================================================
      // POLL
      // =================================================

      if (
        interaction.commandName ===
        "poll"
      ) {
        const question =
          interaction.options.getString(
            "вопрос"
          );

        const row =
          new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(
                  "poll_yes"
                )
                .setLabel(
                  "Да"
                )
                .setEmoji(
                  "👍"
                )
                .setStyle(
                  ButtonStyle.Success
                ),

              new ButtonBuilder()
                .setCustomId(
                  "poll_no"
                )
                .setLabel(
                  "Нет"
                )
                .setEmoji(
                  "👎"
                )
                .setStyle(
                  ButtonStyle.Danger
                )
            );

        await interaction.reply(
          {
            content:
              `📊 **Опрос**\n\n${question}`,
            components: [
              row,
            ],
          }
        );

        return;
      }
    } catch (error) {
      console.error(
        "❌ Ошибка interaction:",
        error
      );

      try {
        if (
          interaction.deferred
        ) {
          await interaction.editReply(
            "Произошла ошибка."
          );
        } else if (
          !interaction.replied
        ) {
          await interaction.reply(
            {
              content:
                "Произошла ошибка.",
              ephemeral: true,
            }
          );
        }
      } catch {}
    }
  }
);

// ======================================================
// POLL BUTTONS
// ======================================================

client.on(
  "interactionCreate",
  async interaction => {
    if (
      !interaction.isButton()
    ) {
      return;
    }

    if (
      interaction.customId !==
        "poll_yes" &&
      interaction.customId !==
        "poll_no"
    ) {
      return;
    }

    try {
      await interaction.reply(
        {
          content:
            interaction.customId ===
            "poll_yes"
              ? "👍 Ты выбрал **Да**"
              : "👎 Ты выбрал **Нет**",

          ephemeral: true,
        }
      );
    } catch (error) {
      console.error(
        "Ошибка poll:",
        error
      );
    }
  }
);

// ======================================================
// READY
// ======================================================

client.once(
  "ready",
  async () => {
    console.log("");
    console.log(
      "================================="
    );
    console.log(
      `✅ БОТ ЗАПУЩЕН: ${client.user.tag}`
    );
    console.log(
      `🆔 ID: ${client.user.id}`
    );
    console.log(
      `🏠 Серверов: ${client.guilds.cache.size}`
    );
    console.log(
      "📩 MessageContent включён в коде"
    );
    console.log(
      "================================="
    );
    console.log("");

    client.user.setPresence({
      activities: [
        {
          name: "за чатом",
          type:
            ActivityType.Watching,
        },
      ],
      status: "online",
    });

    await registerCommands();
  }
);

// ======================================================
// DISCORD ERRORS
// ======================================================

client.on(
  "error",
  error => {
    console.error(
      "❌ Discord Client Error:",
      error
    );
  }
);

client.on(
  "warn",
  warning => {
    console.warn(
      "⚠️ Discord warning:",
      warning
    );
  }
);

// ======================================================
// PROCESS ERRORS
// ======================================================

process.on(
  "uncaughtException",
  error => {
    console.error(
      "❌ UNCAUGHT EXCEPTION:",
      error
    );
  }
);

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "❌ UNHANDLED REJECTION:",
      error
    );
  }
);

// ======================================================
// LOGIN
// ======================================================

console.log(
  "🔄 Подключаюсь к Discord..."
);

client.login(TOKEN);
