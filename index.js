const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

// Переменные окружения Railway
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const TEMPLATE = path.join(__dirname, "template.png");
const STATS_FILE = path.join(__dirname, "stats.json");

const WIDTH = 1536;
const HEIGHT = 1536;

// Точные координаты центров под вертикальные колонки шаблона
const POS = {
    username: { x: 768, y: 105 },

    voice:   { x: 154,  y: 1310, color: "#ff4b4b" },
    message: { x: 462,  y: 1310, color: "#55a8ff" },
    discord: { x: 768,  y: 1310, color: "#c080ff" },
    gaming:  { x: 1074, y: 1310, color: "#43ff91" },
    music:   { x: 1382, y: 1310, color: "#ffd84a" }
};

// Инициализация клиента с необходимыми интентсами
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// Загрузка или создание stats.json
function loadStats() {
    if (!fs.existsSync(STATS_FILE)) {
        fs.writeFileSync(STATS_FILE, JSON.stringify({}, null, 2));
    }
    return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
}

// Вспомогательные функции для расчета статистики
function currentVoiceSeconds(data) {
    return data.voiceSeconds || 0;
}

function currentDiscordSeconds(data) {
    return data.discordSeconds || 0;
}

function currentGamingSeconds(data) {
    return data.gamingSeconds || 0;
}

// Оригинальное форматирование времени (часы и минуты)
function formatTime(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}

// Рисование закругленного прямоугольника
function roundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.closePath();
}

// Отрисовка текста по центру
function drawCentered(ctx, text, x, y, maxWidth, color, size) {
    ctx.save();
    ctx.font = `${size}px sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y, maxWidth);
    ctx.restore();
}

// Отрисовка блока статистики
function drawStatBadge(ctx, x, y, w, h, value, color) {
    ctx.save();

    ctx.fillStyle = "rgba(0,0,0,0.58)";
    roundedRect(ctx, x - w / 2, y - h / 2, w, h, 18);
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.9;
    ctx.stroke();

    ctx.restore();

    drawCentered(ctx, value, x, y, w - 24, "#ffffff", 42);
}

// Генерация карточки
async function generateCard(user, data) {
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext("2d");

    const templateBuffer = await fs.promises.readFile(TEMPLATE);
    const template = await loadImage(templateBuffer);

    ctx.drawImage(template, 0, 0, WIDTH, HEIGHT);

    // Плашка для имени пользователя сверху
    ctx.fillStyle = "rgba(0,0,0,0.38)";
    roundedRect(ctx, 470, 35, 600, 90, 30);
    ctx.fill();

    drawCentered(
        ctx,
        user.username,
        POS.username.x,
        POS.username.y - 5,
        550,
        "#ffffff",
        48
    );

    const voice = formatTime(currentVoiceSeconds(data));
    const messages = String(data.messages || 0);
    const discord = formatTime(currentDiscordSeconds(data));
    const gamingTime = formatTime(currentGamingSeconds(data));

    const gamingText = data.gamingGame
        ? `${data.gamingGame} • ${gamingTime}`
        : gamingTime;

    // Отрисовка пяти блоков статистики
    drawStatBadge(ctx, POS.voice.x, POS.voice.y, 250, 64, voice, POS.voice.color);
    drawStatBadge(ctx, POS.message.x, POS.message.y, 250, 64, messages, POS.message.color);
    drawStatBadge(ctx, POS.discord.x, POS.discord.y, 250, 64, discord, POS.discord.color);
    drawStatBadge(ctx, POS.gaming.x, POS.gaming.y, 250, 64, gamingText, POS.gaming.color);
    drawStatBadge(ctx, POS.music.x, POS.music.y, 250, 64, "SOON", POS.music.color);

    return canvas.toBuffer("image/png");
}

// Регистрация слеш-команд
const commands = [
    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Показать карточку статистики пользователя')
        .toJSON()
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    try {
        console.log('Регистрация слеш-команд...');
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: commands },
        );
        console.log('✓ /stats зарегистрирована');
    } catch (error) {
        console.error('Ошибка регистрации команд:', error);
    }
})();

client.on('ready', () => {
    console.log(`✓ Бот запущен как ${client.user.tag}`);
});

// Обработка команды /stats
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'stats') {
        await interaction.deferReply();

        try {
            const stats = loadStats();
            const userId = interaction.user.id;
            const userData = stats[userId] || { messages: 0, voiceSeconds: 0, discordSeconds: 0, gamingSeconds: 0 };

            const buffer = await generateCard(interaction.user, userData);

            await interaction.editReply({
                files: [{ attachment: buffer, name: 'stats.png' }]
            });
        } catch (error) {
            console.error('Ошибка при генерации карточки:', error);
            await interaction.editReply('Произошла ошибка при создании карточки статистики.');
        }
    }
});

client.login(TOKEN);
