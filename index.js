const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes,
    AttachmentBuilder,
    ActivityType
} = require("discord.js");

const { createCanvas, loadImage } = require("@napi-rs/canvas");
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

const WIDTH = 1536;
const HEIGHT = 1536;

// ==============================
// TEXT POSITIONS
// ==============================

const POS = {
    username: { x: 768, y: 105 },

    voice:   { x: 154,  y: 1350, color: "#ff4b4b" },
    message: { x: 461,  y: 1350, color: "#55a8ff" },
    discord: { x: 768,  y: 1350, color: "#c080ff" },
    gaming:  { x: 1075, y: 1350, color: "#43ff91" },
    music:   { x: 1382, y: 1350, color: "#ffd84a" }
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
// HELPERS
// ==============================

function formatTime(seconds) {
    seconds = Math.max(0, Math.floor(seconds));

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;

    return `${minutes}m`;
}

function currentVoiceSeconds(data) {
    if (!data.voiceStartedAt) return data.voiceSeconds || 0;
    return (data.voiceSeconds || 0) + Math.floor((Date.now() - data.voiceStartedAt) / 1000);
}

function currentDiscordSeconds(data) {
    if (!data.discordStartedAt) return data.discordSeconds || 0;
    return (data.discordSeconds || 0) + Math.floor((Date.now() - data.discordStartedAt) / 1000);
}

function currentGamingSeconds(data) {
    if (!data.gamingStartedAt) return data.gamingSeconds || 0;
    return (data.gamingSeconds || 0) + Math.floor((Date.now() - data.gamingStartedAt) / 1000);
}

function finalizeVoice(data) {
    if (!data.voiceStartedAt) return;
    data.voiceSeconds = (data.voiceSeconds || 0) + Math.floor((Date.now() - data.voiceStartedAt) / 1000);
    data.voiceStartedAt = null;
}

function finalizeDiscord(data) {
    if (!data.discordStartedAt) return;
    data.discordSeconds = (data.discordSeconds || 0) + Math.floor((Date.now() - data.discordStartedAt) / 1000);
    data.discordStartedAt = null;
}

function finalizeGaming(data) {
    if (!data.gamingStartedAt) return;
    data.gamingSeconds = (data.gamingSeconds || 0) + Math.floor((Date.now() - data.gamingStartedAt) / 1000);
    data.gamingStartedAt = null;
    data.gamingGame = null;
}

// ==============================
// MESSAGE TRACKING
// ==============================

client.on("messageCreate", message => {
    if (!message.guild || message.author.bot) return;

    const data = getUser(message.author.id);
    data.messages = (data.messages || 0) + 1;
    saveStats();
});

// ==============================
// VOICE TRACKING
// ==============================

client.on("voiceStateUpdate", (oldState, newState) => {
    if (newState.member?.user?.bot) return;

    const data = getUser(newState.id);

    if (!oldState.channelId && newState.channelId) {
        if (!data.voiceStartedAt) {
            data.voiceStartedAt = Date.now();
        }
    }

    if (oldState.channelId && !newState.channelId) {
        finalizeVoice(data);
    }

    saveStats();
});

// ==============================
// GAMING TRACKING
// ==============================

client.on("presenceUpdate", (oldPresence, newPresence) => {
    if (!newPresence?.userId) return;

    const member = newPresence.member;
    if (member?.user?.bot) return;

    const data = getUser(newPresence.userId);

    const gameActivity = newPresence.activities?.find(
        activity => activity.type === ActivityType.Playing
    );

    const gameName = gameActivity?.name || null;

    if (!gameName) {
        finalizeGaming(data);
        saveStats();
        return;
    }

    if (!data.gamingStartedAt) {
        data.gamingGame = gameName;
        data.gamingStartedAt = Date.now();
        saveStats();
        return;
    }

    if (data.gamingGame !== gameName) {
        finalizeGaming(data);
        data.gamingGame = gameName;
        data.gamingStartedAt = Date.now();
        saveStats();
    }
});

// ==============================
// DISCORD ONLINE TRACKING
// ==============================

function presenceIsOnline(presence) {
    if (!presence) return false;
    return ["online", "idle", "dnd"].includes(presence.status);
}

client.on("presenceUpdate", (oldPresence, newPresence) => {
    if (!newPresence?.userId) return;

    const member = newPresence.member;
    if (member?.user?.bot) return;

    const data = getUser(newPresence.userId);
    const online = presenceIsOnline(newPresence);

    if (online && !data.discordStartedAt) {
        data.discordStartedAt = Date.now();
        saveStats();
    }

    if (!online && data.discordStartedAt) {
        finalizeDiscord(data);
        saveStats();
    }
});

// ==============================
// PERIODIC SAVE
// ==============================

setInterval(() => {
    saveStats();
}, 30000);

// ==============================
// IMAGE HELPERS
// ==============================

function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function drawCentered(ctx, text, x, y, maxWidth, color, size) {
    ctx.font = `bold ${size}px Arial`;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.shadowColor = "rgba(0,0,0,0.75)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;

    ctx.fillText(text, x, y);

    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
}

// ==============================
// STATISTIC BADGE (С ГАРАНТИРОВАННЫМ ОТОБРАЖЕНИЕМ ТЕКСТА)
// ==============================

function drawStatBadge(ctx, x, y, w, h, value, color) {
    ctx.save();

    ctx.fillStyle = "rgba(0,0,0,0.7)";
    roundedRect(ctx, x - w / 2, y - h / 2, w, h, 18);
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.9;
    ctx.stroke();

    ctx.restore();

    drawCentered(ctx, String(value), x, y, w - 20, "#ffffff", 24);
}

// ==============================
// GENERATE CARD
// ==============================

async function generateCard(user, data) {
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext("2d");

    const template = await loadImage(
        await fs.promises.readFile(TEMPLATE)
    );

    ctx.drawImage(template, 0, 0, WIDTH, HEIGHT);

    // ==========================
    // USERNAME
    // ==========================

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

    // ==========================
    // STATISTICS
    // ==========================

    const voiceSec = currentVoiceSeconds(data);
    const voice = voiceSec > 0 ? formatTime(voiceSec) : "0m";

    const messages = String(data.messages || 0);

    const discordSec = currentDiscordSeconds(data);
    const discord = discordSec > 0 ? formatTime(discordSec) : "0m";
    
    const activeGamingSec = currentGamingSeconds(data);
    const gamingTime = formatTime(activeGamingSec);

    const gamingText = data.gamingGame && activeGamingSec > 0
        ? `${data.gamingGame} • ${gamingTime}`
        : (activeGamingSec > 0 ? gamingTime : "0m");

    // ==========================
    // STATISTIC POSITIONS
    // ==========================

    drawStatBadge(ctx, POS.voice.x, POS.voice.y, 250, 64, voice, POS.voice.color);
    drawStatBadge(ctx, POS.message.x, POS.message.y, 250, 64, messages, POS.message.color);
    drawStatBadge(ctx, POS.discord.x, POS.discord.y, 250, 64, discord, POS.discord.color);
    drawStatBadge(ctx, POS.gaming.x, POS.gaming.y, 280, 64, gamingText, POS.gaming.color);
    drawStatBadge(ctx, POS.music.x, POS.music.y, 250, 64, "SOON", POS.music.color);

    return canvas.toBuffer("image/png");
}

// ==============================
// SLASH COMMAND
// ==============================

const commands = [
    new SlashCommandBuilder()
        .setName("stats")
        .setDescription("Показать статистику пользователя")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("Пользователь")
                .setRequired(false)
        )
].map(command => command.toJSON());

// ==============================
// REGISTER COMMANDS
// ==============================

async function registerCommands() {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands }
    );

    console.log("✓ /stats зарегистрирована");
}

// ==============================
// COMMAND HANDLER
// ==============================

client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "stats") return;

    await interaction.deferReply();

    const target = interaction.options.getUser("user") || interaction.user;
    const data = getUser(target.id);

    const image = await generateCard(target, data);

    const attachment = new AttachmentBuilder(image, { name: "stats.png" });

    await interaction.editReply({ files: [attachment] });
});

// ==============================
// READY
// ==============================

client.once("ready", async () => {
    console.log(`✓ Бот запущен: ${client.user.tag}`);

    for (const guild of client.guilds.cache.values()) {
        await guild.members.fetch();

        for (const member of guild.members.cache.values()) {
            if (member.user.bot) continue;

            const presence = member.presence;
            const data = getUser(member.id);

            if (presenceIsOnline(presence) && !data.discordStartedAt) {
                data.discordStartedAt = Date.now();
            }

            const game = presence?.activities?.find(
                activity => activity.type === ActivityType.Playing
            );

            if (game?.name && !data.gamingStartedAt) {
                data.gamingGame = game.name;
                data.gamingStartedAt = Date.now();
            }

            for (const [channelId, channel] of guild.channels.cache) {
                if (channel.isVoiceBased() && channel.members.has(member.id)) {
                    if (!data.voiceStartedAt) {
                        data.voiceStartedAt = Date.now();
                    }
                }
            }
        }
    }

    saveStats();
    console.log("✓ Активные сессии успешно восстановлены!");
});

// ==============================
// START BOT
// ==============================

(async () => {
    try {
        await registerCommands();
        await client.login(TOKEN);
    } catch (error) {
        console.error(error);
    }
})();
