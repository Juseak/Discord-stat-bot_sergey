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

// Text positions on your supplied template.
// Change these numbers if you want to move anything.
const POS = {
    username: { x: 768, y: 105 },

    voice:   { x: 128,  y: 1010, color: "#ff4b4b" },
    message: { x: 380,  y: 1010, color: "#55a8ff" },
    discord: { x: 625,  y: 1010, color: "#c080ff" },
    gaming:  { x: 870,  y: 990,  color: "#43ff91" },
    music:   { x: 1260, y: 1010, color: "#ffd84a" }
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
// JSON STORAGE
// ==============================

function loadStats() {
    if (!fs.existsSync(STORAGE)) fs.writeFileSync(STORAGE, "{}");
    try {
        return JSON.parse(fs.readFileSync(STORAGE, "utf8"));
    } catch {
        return {};
    }
}

let stats = loadStats();

function saveStats() {
    fs.writeFileSync(STORAGE, JSON.stringify(stats, null, 2));
}

function getUser(id) {
    if (!stats[id]) {
        stats[id] = {
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

    return stats[id];
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
    if (!data.voiceStartedAt) return data.voiceSeconds;
    return data.voiceSeconds + Math.floor((Date.now() - data.voiceStartedAt) / 1000);
}

function currentDiscordSeconds(data) {
    if (!data.discordStartedAt) return data.discordSeconds;
    return data.discordSeconds + Math.floor((Date.now() - data.discordStartedAt) / 1000);
}

function currentGamingSeconds(data) {
    if (!data.gamingStartedAt) return data.gamingSeconds;
    return data.gamingSeconds + Math.floor((Date.now() - data.gamingStartedAt) / 1000);
}

function finalizeVoice(data) {
    if (!data.voiceStartedAt) return;
    data.voiceSeconds += Math.floor((Date.now() - data.voiceStartedAt) / 1000);
    data.voiceStartedAt = null;
}

function finalizeDiscord(data) {
    if (!data.discordStartedAt) return;
    data.discordSeconds += Math.floor((Date.now() - data.discordStartedAt) / 1000);
    data.discordStartedAt = null;
}

function finalizeGaming(data) {
    if (!data.gamingStartedAt) return;
    data.gamingSeconds += Math.floor((Date.now() - data.gamingStartedAt) / 1000);
    data.gamingStartedAt = null;
    data.gamingGame = null;
}

// ==============================
// MESSAGE TRACKING
// ==============================

client.on("messageCreate", message => {
    if (!message.guild || message.author.bot) return;

    const data = getUser(message.author.id);
    data.messages++;

    saveStats();
});

// ==============================
// VOICE TRACKING
// ==============================

client.on("voiceStateUpdate", (oldState, newState) => {
    if (newState.member?.user?.bot) return;

    const data = getUser(newState.id);

    // Joined voice
    if (!oldState.channelId && newState.channelId) {
        if (!data.voiceStartedAt) {
            data.voiceStartedAt = Date.now();
        }
    }

    // Left voice
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

    // No game now
    if (!gameName) {
        finalizeGaming(data);
        saveStats();
        return;
    }

    // Started a game
    if (!data.gamingStartedAt) {
        data.gamingGame = gameName;
        data.gamingStartedAt = Date.now();
        saveStats();
        return;
    }

    // Switched game
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

function fitFont(ctx, text, maxWidth, startSize, family = "Arial") {
    let size = startSize;

    while (size > 16) {
        ctx.font = `bold ${size}px ${family}`;
        if (ctx.measureText(text).width <= maxWidth) return size;
        size -= 1;
    }

    return size;
}

function drawCentered(ctx, text, x, y, maxWidth, color, size) {
    const finalSize = fitFont(ctx, text, maxWidth, size);
    ctx.font = `bold ${finalSize}px Arial`;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Small shadow to make text readable over the characters.
    ctx.shadowColor = "rgba(0,0,0,0.75)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;

    ctx.fillText(text, x, y);

    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
}

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

// ==============================
// GENERATE CARD
// ==============================

async function generateCard(user, data) {
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext("2d");

    const template = await loadImage(await fs.promises.readFile(TEMPLATE));
    ctx.drawImage(template, 0, 0, WIDTH, HEIGHT);

    // Username in the sky at the top.
    // It has a translucent backing so any username remains readable.
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
    const messages = String(data.messages);
    const discord = formatTime(currentDiscordSeconds(data));
    const gamingTime = formatTime(currentGamingSeconds(data));

    const gamingText = data.gamingGame
        ? `${data.gamingGame} • ${gamingTime}`
        : gamingTime;

    // Badges sit over the character area, leaving your original labels/icons intact.
    drawStatBadge(ctx, POS.voice.x, POS.voice.y, 210, 64, voice, POS.voice.color);
    drawStatBadge(ctx, POS.message.x, POS.message.y, 210, 64, messages, POS.message.color);
    drawStatBadge(ctx, POS.discord.x, POS.discord.y, 210, 64, discord, POS.discord.color);
    drawStatBadge(ctx, POS.gaming.x, POS.gaming.y, 230, 86, gamingText, POS.gaming.color);
    drawStatBadge(ctx, POS.music.x, POS.music.y, 190, 64, "SOON", POS.music.color);

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

    const attachment = new AttachmentBuilder(image, {
        name: "stats.png"
    });

    await interaction.editReply({
        files: [attachment]
    });
});

// ==============================
// READY
// ==============================

client.once("ready", async () => {
    console.log(`✓ Бот запущен: ${client.user.tag}`);

    // Seed currently-online members so Discord time can start immediately.
    for (const guild of client.guilds.cache.values()) {
        await guild.members.fetch();

        for (const member of guild.members.cache.values()) {
            if (member.user.bot) continue;

            const presence = member.presence;
            if (presenceIsOnline(presence)) {
                const data = getUser(member.id);

                if (!data.discordStartedAt) {
                    data.discordStartedAt = Date.now();
                }

                const game = presence.activities?.find(
                    activity => activity.type === ActivityType.Playing
                );

                if (game?.name && !data.gamingStartedAt) {
                    data.gamingGame = game.name;
                    data.gamingStartedAt = Date.now();
                }
            }
        }
    }

    saveStats();
});

(async () => {
    try {
        await registerCommands();
        await client.login(TOKEN);
    } catch (error) {
        console.error(error);
    }
})();
