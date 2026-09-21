const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes,
    AttachmentBuilder,
    ActivityType
} = require("discord.js");

// Добавлен GlobalFonts для загрузки кастомного шрифта!
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");
const fs = require("fs");
const path = require("path");

// ==============================
// CONFIG
// ==============================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const TEMPLATE = path.join(__dirname, "template.png");
const STORAGE = path.join(__dirname, "stats.json");
const FONT_PATH = path.join(__dirname, "font.ttf");

const WIDTH = 1536;
const HEIGHT = 1536;

// ==============================
// РЕГИСТРАЦИЯ ШРИФТА (ФИКС RAILWAY)
// ==============================
if (fs.existsSync(FONT_PATH)) {
    GlobalFonts.registerFromPath(FONT_PATH, "CustomFont");
    console.log("✓ Кастомный шрифт успешно загружен!");
} else {
    console.warn("❌ ВНИМАНИЕ: Файл font.ttf не найден! Без него Railway не покажет текст.");
}

// ==============================
// TEXT POSITIONS & COLORS
// ==============================

const POS = {
    username: { x: 768, y: 105 },
    voice:   { x: 154,  y: 1350, color: "#ff4b4b" }, // Красный
    message: { x: 461,  y: 1350, color: "#55a8ff" }, // Синий
    discord: { x: 768,  y: 1350, color: "#c080ff" }, // Фиолетовый
    gaming:  { x: 1075, y: 1350, color: "#43ff91" }, // Зеленый
    music:   { x: 1382, y: 1350, color: "#ffd84a" }  // Желтый
};

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences
    ]
});

// ==============================
// КЭШИРОВАНИЕ ФОНА (ОПТИМИЗАЦИЯ СКОРОСТИ)
// ==============================
let cachedTemplate = null;
async function getTemplateImage() {
    if (!cachedTemplate) {
        cachedTemplate = await loadImage(await fs.promises.readFile(TEMPLATE));
    }
    return cachedTemplate;
}

// ==============================
// JSON STORAGE & DAILY RESET
// ==============================

function getTodayDateString() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function loadStats() {
    if (!fs.existsSync(STORAGE)) {
        fs.writeFileSync(STORAGE, JSON.stringify({ lastDate: getTodayDateString(), users: {} }, null, 2));
    }

    try {
        const raw = JSON.parse(fs.readFileSync(STORAGE, "utf8"));
        let db = raw.users ? raw : { lastDate: getTodayDateString(), users: raw };

        const today = getTodayDateString();
        if (db.lastDate !== today) {
            for (let id in db.users) {
                db.users[id].messages = 0;
                db.users[id].voiceSeconds = 0;
                db.users[id].discordSeconds = 0;
                db.users[id].gamingSeconds = 0;
                db.users[id].gamingGame = null;

                if (db.users[id].voiceStartedAt) db.users[id].voiceStartedAt = Date.now();
                if (db.users[id].discordStartedAt) db.users[id].discordStartedAt = Date.now();
                if (db.users[id].gamingStartedAt) db.users[id].gamingStartedAt = Date.now();
            }
            db.lastDate = today;
        }
        return db;
    } catch {
        return { lastDate: getTodayDateString(), users: {} };
    }
}

let db = loadStats();

function saveStats() {
    db.lastDate = getTodayDateString();
    fs.writeFileSync(STORAGE, JSON.stringify(db, null, 2));
}

function getUser(id) {
    if (!db.users[id]) {
        db.users[id] = {
            messages: 0,
            voiceSeconds: 0,
            voiceStartedAt: null,
            discordSeconds: 0,
            discordStartedAt: null,
            gamingSeconds: 0,
            gamingGame: null,
            gamingStartedAt: null
        };
    }
    return db.users[id];
}

// ==============================
// HELPERS (С БЕЗОПАСНЫМИ ПРОВЕРКАМИ)
// ==============================

function formatTime(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    if (isNaN(seconds)) return "0m";

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function calculateCurrent(baseSeconds, startTime) {
    if (!startTime) return baseSeconds || 0;
    const diff = Math.floor((Date.now() - startTime) / 1000);
    return (baseSeconds || 0) + (diff > 0 ? diff : 0);
}

function currentVoiceSeconds(data) { return calculateCurrent(data.voiceSeconds, data.voiceStartedAt); }
function currentDiscordSeconds(data) { return calculateCurrent(data.discordSeconds, data.discordStartedAt); }
function currentGamingSeconds(data) { return calculateCurrent(data.gamingSeconds, data.gamingStartedAt); }

function finalizeVoice(data) {
    data.voiceSeconds = currentVoiceSeconds(data);
    data.voiceStartedAt = null;
}
function finalizeDiscord(data) {
    data.discordSeconds = currentDiscordSeconds(data);
    data.discordStartedAt = null;
}
function finalizeGaming(data) {
    data.gamingSeconds = currentGamingSeconds(data);
    data.gamingStartedAt = null;
    data.gamingGame = null;
}

// ==============================
// TRACKING EVENTS
// ==============================

client.on("messageCreate", message => {
    if (!message.guild || !message.author || message.author.bot) return;
    const data = getUser(message.author.id);
    data.messages = (data.messages || 0) + 1;
    saveStats();
});

client.on("voiceStateUpdate", (oldState, newState) => {
    if (!newState.member || newState.member.user.bot) return;
    const data = getUser(newState.id);

    if (!oldState.channelId && newState.channelId) {
        if (!data.voiceStartedAt) data.voiceStartedAt = Date.now();
    }
    if (oldState.channelId && !newState.channelId) {
        finalizeVoice(data);
    }
    saveStats();
});

function presenceIsOnline(presence) {
    return presence && ["online", "idle", "dnd"].includes(presence.status);
}

client.on("presenceUpdate", (oldPresence, newPresence) => {
    if (!newPresence?.userId || !newPresence.member || newPresence.member.user.bot) return;

    const data = getUser(newPresence.userId);

    const online = presenceIsOnline(newPresence);
    if (online && !data.discordStartedAt) {
        data.discordStartedAt = Date.now();
    } else if (!online && data.discordStartedAt) {
        finalizeDiscord(data);
    }

    const gameActivity = newPresence.activities?.find(activity => activity.type === ActivityType.Playing);
    const gameName = gameActivity?.name || null;

    if (!gameName) {
        if (data.gamingStartedAt) finalizeGaming(data);
    } else {
        if (!data.gamingStartedAt) {
            data.gamingGame = gameName;
            data.gamingStartedAt = Date.now();
        } else if (data.gamingGame !== gameName) {
            finalizeGaming(data);
            data.gamingGame = gameName;
            data.gamingStartedAt = Date.now();
        }
    }
    saveStats();
});

setInterval(() => saveStats(), 30000);

// ==============================
// IMAGE RENDERING HELPERS
// ==============================

function drawCentered(ctx, text, x, y, maxWidth, color, size) {
    ctx.save();
    ctx.font = `bold ${size}px "CustomFont", sans-serif`; 
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.shadowColor = "rgba(0, 0, 0, 1)";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;

    ctx.fillText(text, x, y, maxWidth);
    ctx.restore();
}

function drawStatBadge(ctx, x, y, w, h, value, color) {
    ctx.save(); 
    
    const rx = x - w / 2;
    const ry = y - h / 2;
    const radius = 22;

    ctx.shadowColor = color;
    ctx.shadowBlur = 15;
    ctx.shadowOffsetY = 0;

    ctx.fillStyle = "rgba(10, 10, 10, 0.88)";
    ctx.beginPath();
    ctx.roundRect(rx, ry, w, h, radius);
    ctx.fill();

    ctx.shadowBlur = 0;

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(rx, ry, w, h, radius);
    ctx.stroke();

    ctx.font = `bold 28px "CustomFont", sans-serif`;
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.shadowColor = "rgba(0, 0, 0, 1)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;

    ctx.fillText(String(value), x, y, w - 20);
    ctx.restore();
}

// ==============================
// ГЕНЕРАЦИЯ КАРТОЧКИ
// ==============================

async function generateCard(user, data) {
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext("2d");

    const template = await getTemplateImage();
    ctx.drawImage(template, 0, 0, WIDTH, HEIGHT);

    ctx.save();
    ctx.fillStyle = "rgba(10, 10, 10, 0.65)";
    ctx.beginPath();
    ctx.roundRect(470, 35, 600, 90, 30);
    ctx.fill();
    ctx.restore();

    drawCentered(ctx, user.username, POS.username.x, POS.username.y - 5, 550, "#ffffff", 52);

    const voiceSec = currentVoiceSeconds(data);
    const voiceText = voiceSec > 0 ? formatTime(voiceSec) : "0m";
    const messagesText = String(data.messages || 0);
    const discordSec = currentDiscordSeconds(data);
    const discordText = discordSec > 0 ? formatTime(discordSec) : "0m";
    
    const activeGamingSec = currentGamingSeconds(data);
    const gamingTime = formatTime(activeGamingSec);
    const gamingText = data.gamingGame && activeGamingSec > 0 
        ? `${data.gamingGame} • ${gamingTime}` 
        : (activeGamingSec > 0 ? gamingTime : "0m");

    drawStatBadge(ctx, POS.voice.x, POS.voice.y, 250, 68, voiceText, POS.voice.color);
    drawStatBadge(ctx, POS.message.x, POS.message.y, 250, 68, messagesText, POS.message.color);
    drawStatBadge(ctx, POS.discord.x, POS.discord.y, 250, 68, discordText, POS.discord.color);
    drawStatBadge(ctx, POS.gaming.x, POS.gaming.y, 320, 68, gamingText, POS.gaming.color);
    drawStatBadge(ctx, POS.music.x, POS.music.y, 250, 68, "SOON", POS.music.color);

    return canvas.toBuffer("image/png");
}

// ==============================
// ИНИЦИАЛИЗАЦИЯ БОТА И КОМАНД
// ==============================

const commands = [
    new SlashCommandBuilder()
        .setName("stats")
        .setDescription("Показать статистику пользователя")
        .addUserOption(option =>
            option.setName("user").setDescription("Пользователь").setRequired(false)
        ),
    // Добавили команду /troll в общий список
    new SlashCommandBuilder()
        .setName("troll")
        .setDescription("Потроллить бота")
        .addStringOption(option =>
            option
                .setName("text")
                .setDescription("Текст для троллинга")
                .setRequired(true)
        )
].map(command => command.toJSON());

async function registerCommands() {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("✓ Команды (/stats, /troll) зарегистрированы");
}

client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // Обработка команды /stats
    if (interaction.commandName === "stats") {
        await interaction.deferReply();
        const target = interaction.options.getUser("user") || interaction.user;
        const data = getUser(target.id);

        try {
            const imageBuffer = await generateCard(target, data);
            const attachment = new AttachmentBuilder(imageBuffer, { name: "stats.png" });
            await interaction.editReply({ files: [attachment] });
        } catch (error) {
            console.error("❌ Ошибка при генерации карточки:", error);
            await interaction.editReply("Упс, произошла ошибка при создании карточки. Проверьте логи бота.");
        }
        return;
    }

    // Обработка команды /troll с процедурной генерацией ответов
    if (interaction.commandName === "troll") {
        const userText = interaction.options.getString("text");

        const actions = [
            "Иди", "Чел, иди", "Слышь, иди", "Лучше иди", 
            "Завались и иди", "Меньше базарь и иди", "Вытри сопли и иди",
            "Шел бы ты", "Хватит ныть, иди"
        ];
        
        const directions = [
            "нахуй", "в окно", "уроки учить", "траву потрогать", 
            "поспать", "своей мамке помогать", "в будку", 
            "к зеркалу поплакать", "удалить Discord"
        ];

        const modifiers = [
            `с таким бредом: "${userText}"`,
            `пока я твой текст "${userText}" не аннигилировал`,
            `со своими отговорками про "${userText}"`,
            `с этой парашей в голове`,
            `пока тебе интернет по талонам не отключили`,
            `и не позорься со своим "${userText}"`,
            `и перевари то, что высрал`
        ];

        const randomAction = actions[Math.floor(Math.random() * actions.length)];
        const randomDirection = directions[Math.floor(Math.random() * directions.length)];
        const randomModifier = modifiers[Math.floor(Math.random() * modifiers.length)];

        const generatedResponse = `${randomAction} ${randomDirection} ${randomModifier}!`;

        await interaction.reply({ content: generatedResponse });
    }
});

client.once("ready", async () => {
    console.log(`✓ Бот запущен: ${client.user.tag}`);
    
    await getTemplateImage();
    console.log("✓ Шаблон закэширован!");

    for (const guild of client.guilds.cache.values()) {
        await guild.members.fetch();

        for (const member of guild.members.cache.values()) {
            if (member.user.bot) continue;

            const presence = member.presence;
            const data = getUser(member.id);

            if (presenceIsOnline(presence) && !data.discordStartedAt) {
                data.discordStartedAt = Date.now();
            }

            const game = presence?.activities?.find(activity => activity.type === ActivityType.Playing);
            if (game?.name && !data.gamingStartedAt) {
                data.gamingGame = game.name;
                data.gamingStartedAt = Date.now();
            }

            for (const channel of guild.channels.cache.values()) {
                if (channel.isVoiceBased() && channel.members.has(member.id)) {
                    if (!data.voiceStartedAt) data.voiceStartedAt = Date.now();
                }
            }
        }
    }
    saveStats();
    console.log("✓ Активные сессии успешно восстановлены!");
});

(async () => {
    try {
        await registerCommands();
        await client.login(TOKEN);
    } catch (error) {
        console.error("❌ Критическая ошибка запуска:", error);
    }
})();
