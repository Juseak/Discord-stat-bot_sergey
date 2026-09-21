const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes,
    AttachmentBuilder,
    ActivityType
} = require("discord.js");

const { GoogleGenAI } = require("@google/genai");

const {
    createCanvas,
    loadImage,
    GlobalFonts
} = require("@napi-rs/canvas");

const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    EndBehaviorType,
    StreamType
} = require("@discordjs/voice");

const prism = require("prism-media");
const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");

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
// GEMINI
// ==============================

const gemini = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

// ==============================
// VOICE AI
// ==============================

const voiceAISessions = new Map();

const VOICE_AI_TEXT_MODEL =
    "gemini-2.5-flash-lite";

const VOICE_AI_TTS_MODEL =
    "gemini-2.5-flash-preview-tts";

const VOICE_AI_SYSTEM =
    "Ты голосовой AI-помощник в Discord. " +
    "Отвечай понятно, дружелюбно и по существу. " +
    "Отвечай коротко, потому что ответ будет озвучен голосом. " +
    "Не используй Markdown, таблицы и длинные списки.";

// ==============================
// РЕГИСТРАЦИЯ ШРИФТА
// ==============================

if (fs.existsSync(FONT_PATH)) {

    GlobalFonts.registerFromPath(
        FONT_PATH,
        "CustomFont"
    );

    console.log(
        "✓ Кастомный шрифт успешно загружен!"
    );

} else {

    console.warn(
        "❌ ВНИМАНИЕ: Файл font.ttf не найден!"
    );
}

// ==============================
// TEXT POSITIONS & COLORS
// ==============================

const POS = {

    username: {
        x: 768,
        y: 105
    },

    voice: {
        x: 154,
        y: 1350,
        color: "#ff4b4b"
    },

    message: {
        x: 461,
        y: 1350,
        color: "#55a8ff"
    },

    discord: {
        x: 768,
        y: 1350,
        color: "#c080ff"
    },

    gaming: {
        x: 1075,
        y: 1350,
        color: "#43ff91"
    },

    music: {
        x: 1382,
        y: 1350,
        color: "#ffd84a"
    }
};

// ==============================
// DISCORD CLIENT
// ==============================

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
// КЭШИРОВАНИЕ ФОНА
// ==============================

let cachedTemplate = null;

async function getTemplateImage() {

    if (!cachedTemplate) {

        cachedTemplate =
            await loadImage(
                await fs.promises.readFile(
                    TEMPLATE
                )
            );
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

        fs.writeFileSync(

            STORAGE,

            JSON.stringify(

                {
                    lastDate:
                        getTodayDateString(),

                    users: {}
                },

                null,
                2
            )
        );
    }

    try {

        const raw =
            JSON.parse(
                fs.readFileSync(
                    STORAGE,
                    "utf8"
                )
            );

        let db = raw.users

            ? raw

            : {
                lastDate:
                    getTodayDateString(),

                users: raw
            };

        const today =
            getTodayDateString();

        if (
            db.lastDate !== today
        ) {

            for (
                const id in db.users
            ) {

                db.users[id].messages = 0;

                db.users[id].voiceSeconds = 0;

                db.users[id].discordSeconds = 0;

                db.users[id].gamingSeconds = 0;

                db.users[id].gamingGame = null;

                if (
                    db.users[id]
                        .voiceStartedAt
                ) {

                    db.users[id]
                        .voiceStartedAt =
                        Date.now();
                }

                if (
                    db.users[id]
                        .discordStartedAt
                ) {

                    db.users[id]
                        .discordStartedAt =
                        Date.now();
                }

                if (
                    db.users[id]
                        .gamingStartedAt
                ) {

                    db.users[id]
                        .gamingStartedAt =
                        Date.now();
                }
            }

            db.lastDate =
                today;
        }

        return db;

    } catch {

        return {

            lastDate:
                getTodayDateString(),

            users: {}
        };
    }
}

let db = loadStats();

function saveStats() {

    db.lastDate =
        getTodayDateString();

    fs.writeFileSync(

        STORAGE,

        JSON.stringify(
            db,
            null,
            2
        )
    );
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
// TIME HELPERS
// ==============================

function formatTime(seconds) {

    seconds =
        Math.max(
            0,
            Math.floor(seconds)
        );

    if (isNaN(seconds)) {

        return "0m";
    }

    const days =
        Math.floor(
            seconds / 86400
        );

    const hours =
        Math.floor(
            (seconds % 86400) / 3600
        );

    const minutes =
        Math.floor(
            (seconds % 3600) / 60
        );

    if (days > 0) {

        return `${days}d ${hours}h`;
    }

    if (hours > 0) {

        return `${hours}h ${minutes}m`;
    }

    return `${minutes}m`;
}

function calculateCurrent(
    baseSeconds,
    startTime
) {

    if (!startTime) {

        return baseSeconds || 0;
    }

    const diff =
        Math.floor(
            (Date.now() - startTime) / 1000
        );

    return (

        (baseSeconds || 0) +

        (diff > 0 ? diff : 0)
    );
}

function currentVoiceSeconds(data) {

    return calculateCurrent(
        data.voiceSeconds,
        data.voiceStartedAt
    );
}

function currentDiscordSeconds(data) {

    return calculateCurrent(
        data.discordSeconds,
        data.discordStartedAt
    );
}

function currentGamingSeconds(data) {

    return calculateCurrent(
        data.gamingSeconds,
        data.gamingStartedAt
    );
}

function finalizeVoice(data) {

    data.voiceSeconds =
        currentVoiceSeconds(data);

    data.voiceStartedAt =
        null;
}

function finalizeDiscord(data) {

    data.discordSeconds =
        currentDiscordSeconds(data);

    data.discordStartedAt =
        null;
}

function finalizeGaming(data) {

    data.gamingSeconds =
        currentGamingSeconds(data);

    data.gamingStartedAt =
        null;

    data.gamingGame =
        null;
}

// ==============================
// TRACKING EVENTS
// ==============================

client.on(
    "messageCreate",
    message => {

        if (
            !message.guild ||
            !message.author ||
            message.author.bot
        ) {

            return;
        }

        const data =
            getUser(
                message.author.id
            );

        data.messages =
            (data.messages || 0) + 1;

        saveStats();
    }
);

// ==============================
// VOICE TRACKING
// ==============================

client.on(
    "voiceStateUpdate",
    (oldState, newState) => {

        if (
            !newState.member ||
            newState.member.user.bot
        ) {

            return;
        }

        const data =
            getUser(
                newState.id
            );

        if (
            !oldState.channelId &&
            newState.channelId
        ) {

            if (
                !data.voiceStartedAt
            ) {

                data.voiceStartedAt =
                    Date.now();
            }
        }

        if (
            oldState.channelId &&
            !newState.channelId
        ) {

            finalizeVoice(
                data
            );
        }

        saveStats();
    }
);

// ==============================
// PRESENCE / GAMING TRACKING
// ==============================

function presenceIsOnline(
    presence
) {

    return (

        presence &&

        [
            "online",
            "idle",
            "dnd"
        ].includes(
            presence.status
        )
    );
}

client.on(
    "presenceUpdate",
    (oldPresence, newPresence) => {

        if (
            !newPresence?.userId ||
            !newPresence.member ||
            newPresence.member.user.bot
        ) {

            return;
        }

        const data =
            getUser(
                newPresence.userId
            );

        const online =
            presenceIsOnline(
                newPresence
            );

        if (
            online &&
            !data.discordStartedAt
        ) {

            data.discordStartedAt =
                Date.now();

        } else if (
            !online &&
            data.discordStartedAt
        ) {

            finalizeDiscord(
                data
            );
        }

        const gameActivity =
            newPresence.activities?.find(
                activity =>
                    activity.type ===
                    ActivityType.Playing
            );

        const gameName =
            gameActivity?.name ||
            null;

        if (!gameName) {

            if (
                data.gamingStartedAt
            ) {

                finalizeGaming(
                    data
                );
            }

        } else {

            if (
                !data.gamingStartedAt
            ) {

                data.gamingGame =
                    gameName;

                data.gamingStartedAt =
                    Date.now();

            } else if (
                data.gamingGame !==
                gameName
            ) {

                finalizeGaming(
                    data
                );

                data.gamingGame =
                    gameName;

                data.gamingStartedAt =
                    Date.now();
            }
        }

        saveStats();
    }
);

// ==============================
// AUTO SAVE
// ==============================

setInterval(
    () => {

        saveStats();

    },
    30000
);

// ==============================
// IMAGE RENDERING
// ==============================

function drawCentered(
    ctx,
    text,
    x,
    y,
    maxWidth,
    color,
    size
) {

    ctx.save();

    ctx.font =
        `bold ${size}px "CustomFont", sans-serif`;

    ctx.fillStyle =
        color;

    ctx.textAlign =
        "center";

    ctx.textBaseline =
        "middle";

    ctx.shadowColor =
        "rgba(0, 0, 0, 1)";

    ctx.shadowBlur =
        12;

    ctx.shadowOffsetY =
        4;

    ctx.fillText(
        text,
        x,
        y,
        maxWidth
    );

    ctx.restore();
}

function drawStatBadge(
    ctx,
    x,
    y,
    w,
    h,
    value,
    color
) {

    ctx.save();

    const rx =
        x - w / 2;

    const ry =
        y - h / 2;

    const radius = 22;

    ctx.shadowColor =
        color;

    ctx.shadowBlur =
        15;

    ctx.shadowOffsetY =
        0;

    ctx.fillStyle =
        "rgba(10, 10, 10, 0.88)";

    ctx.beginPath();

    ctx.roundRect(
        rx,
        ry,
        w,
        h,
        radius
    );

    ctx.fill();

    ctx.shadowBlur =
        0;

    ctx.strokeStyle =
        color;

    ctx.lineWidth =
        3;

    ctx.beginPath();

    ctx.roundRect(
        rx,
        ry,
        w,
        h,
        radius
    );

    ctx.stroke();

    ctx.font =
        `bold 28px "CustomFont", sans-serif`;

    ctx.fillStyle =
        "#FFFFFF";

    ctx.textAlign =
        "center";

    ctx.textBaseline =
        "middle";

    ctx.shadowColor =
        "rgba(0, 0, 0, 1)";

    ctx.shadowBlur =
        6;

    ctx.shadowOffsetY =
        2;

    ctx.fillText(
        String(value),
        x,
        y,
        w - 20
    );

    ctx.restore();
}

// ==============================
// GENERATE CARD
// ==============================

async function generateCard(
    user,
    data
) {

    const canvas =
        createCanvas(
            WIDTH,
            HEIGHT
        );

    const ctx =
        canvas.getContext(
            "2d"
        );

    const template =
        await getTemplateImage();

    ctx.drawImage(
        template,
        0,
        0,
        WIDTH,
        HEIGHT
    );

    ctx.save();

    ctx.fillStyle =
        "rgba(10, 10, 10, 0.65)";

    ctx.beginPath();

    ctx.roundRect(
        470,
        35,
        600,
        90,
        30
    );

    ctx.fill();

    ctx.restore();

    drawCentered(
        ctx,
        user.username,
        POS.username.x,
        POS.username.y - 5,
        550,
        "#ffffff",
        52
    );

    const voiceSec =
        currentVoiceSeconds(
            data
        );

    const voiceText =
        voiceSec > 0
            ? formatTime(voiceSec)
            : "0m";

    const messagesText =
        String(
            data.messages || 0
        );

    const discordSec =
        currentDiscordSeconds(
            data
        );

    const discordText =
        discordSec > 0
            ? formatTime(discordSec)
            : "0m";

    const activeGamingSec =
        currentGamingSeconds(
            data
        );

    const gamingTime =
        formatTime(
            activeGamingSec
        );

    const gamingText =
        data.gamingGame &&
        activeGamingSec > 0

            ? `${data.gamingGame} • ${gamingTime}`

            : (
                activeGamingSec > 0
                    ? gamingTime
                    : "0m"
            );

    drawStatBadge(
        ctx,
        POS.voice.x,
        POS.voice.y,
        250,
        68,
        voiceText,
        POS.voice.color
    );

    drawStatBadge(
        ctx,
        POS.message.x,
        POS.message.y,
        250,
        68,
        messagesText,
        POS.message.color
    );

    drawStatBadge(
        ctx,
        POS.discord.x,
        POS.discord.y,
        250,
        68,
        discordText,
        POS.discord.color
    );

    drawStatBadge(
        ctx,
        POS.gaming.x,
        POS.gaming.y,
        320,
        68,
        gamingText,
        POS.gaming.color
    );

    drawStatBadge(
        ctx,
        POS.music.x,
        POS.music.y,
        250,
        68,
        "SOON",
        POS.music.color
    );

    return canvas.toBuffer(
        "image/png"
    );
}

// ==============================
// GEMINI AI
// ==============================

async function askAI(
    prompt
) {

    const response =
        await gemini.models.generateContent({

            model:
                "gemini-3.5-flash-lite",

            contents:
                prompt,

            config: {

                systemInstruction:
                    "Ты полезный AI-помощник в Discord. Отвечай понятно, дружелюбно и по существу."
            }
        });

    return (
        response.text ||
        "Не удалось получить ответ от нейросети."
    );
}

// ============================================================
// VOICE AI
// ============================================================

// ==============================
// WAV
// ==============================

function createWavBuffer(
    pcmData,
    sampleRate = 48000,
    channels = 2,
    bitsPerSample = 16
) {

    const bytesPerSample =
        bitsPerSample / 8;

    const blockAlign =
        channels * bytesPerSample;

    const byteRate =
        sampleRate * blockAlign;

    const dataSize =
        pcmData.length;

    const buffer =
        Buffer.alloc(
            44 + dataSize
        );

    buffer.write(
        "RIFF",
        0
    );

    buffer.writeUInt32LE(
        36 + dataSize,
        4
    );

    buffer.write(
        "WAVE",
        8
    );

    buffer.write(
        "fmt ",
        12
    );

    buffer.writeUInt32LE(
        16,
        16
    );

    buffer.writeUInt16LE(
        1,
        20
    );

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

    buffer.write(
        "data",
        36
    );

    buffer.writeUInt32LE(
        dataSize,
        40
    );

    pcmData.copy(
        buffer,
        44
    );

    return buffer;
}

// ==============================
// TTS → DISCORD AUDIO
// ==============================

function convertTtsPcmToDiscord(
    pcm24k
) {

    return new Promise(
        (resolve, reject) => {

            if (!ffmpegPath) {

                reject(
                    new Error(
                        "FFmpeg не найден."
                    )
                );

                return;
            }

            const ffmpeg =
                spawn(
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

                        "pipe:1"

                    ],
                    {
                        stdio: [
                            "pipe",
                            "pipe",
                            "ignore"
                        ]
                    }
                );

            const chunks = [];

            ffmpeg.stdout.on(
                "data",
                chunk => {

                    chunks.push(
                        chunk
                    );
                }
            );

            ffmpeg.on(
                "error",
                error => {

                    reject(
                        error
                    );
                }
            );

            ffmpeg.on(
                "close",
                code => {

                    if (
                        code !== 0
                    ) {

                        reject(
                            new Error(
                                `FFmpeg завершился с кодом ${code}`
                            )
                        );

                        return;
                    }

                    resolve(
                        Buffer.concat(
                            chunks
                        )
                    );
                }
            );

            ffmpeg.stdin.end(
                pcm24k
            );
        }
    );
}

// ==============================
// GEMINI → TEXT
// ==============================

async function transcribeVoice(
    pcmData
) {

    const wav =
        createWavBuffer(
            pcmData,
            48000,
            2,
            16
        );

    const response =
        await gemini.models.generateContent({

            model:
                VOICE_AI_TEXT_MODEL,

            contents: [

                {
                    text:
                        "Распознай речь на аудиозаписи. " +
                        "Верни только текст речи без пояснений. " +
                        "Не добавляй кавычки. " +
                        "Если речи нет или её невозможно разобрать, верни пустую строку."
                },

                {
                    inlineData: {

                        mimeType:
                            "audio/wav",

                        data:
                            wav.toString(
                                "base64"
                            )
                    }
                }
            ]
        });

    return (
        response.text ||
        ""
    ).trim();
}

// ==============================
// GEMINI → ANSWER
// ==============================

async function askVoiceAI(
    text
) {

    const response =
        await gemini.models.generateContent({

            model:
                VOICE_AI_TEXT_MODEL,

            contents:
                text,

            config: {

                systemInstruction:
                    VOICE_AI_SYSTEM
            }
        });

    return (
        response.text ||
        "Я не смог придумать ответ."
    ).trim();
}

// ==============================
// GEMINI → TTS
// ==============================

async function textToSpeech(
    text
) {

    const response =
        await gemini.models.generateContent({

            model:
                VOICE_AI_TTS_MODEL,

            contents:
                text,

            config: {

                responseModalities: [
                    "AUDIO"
                ],

                speechConfig: {

                    voiceConfig: {

                        prebuiltVoiceConfig: {

                            voiceName:
                                "Kore"
                        }
                    }
                }
            }
        });

    const part =
        response.candidates?.[0]
            ?.content
            ?.parts
            ?.find(
                part =>
                    part.inlineData?.data
            );

    if (
        !part?.inlineData?.data
    ) {

        throw new Error(
            "Gemini не вернул аудио TTS."
        );
    }

    return Buffer.from(
        part.inlineData.data,
        "base64"
    );
}

// ==============================
// PLAY VOICE
// ==============================

async function playVoiceAI(
    session,
    text
) {

    const pcm24k =
        await textToSpeech(
            text
        );

    console.log(
        `🔊 TTS: получено ${pcm24k.length} bytes`
    );

    const pcm48k =
        await convertTtsPcmToDiscord(
            pcm24k
        );

    console.log(
        `🔊 TTS: после конвертации ${pcm48k.length} bytes`
    );

    const resource =
        createAudioResource(
            pcm48k,
            {
                inputType:
                    StreamType.Raw,

                inlineVolume:
                    false
            }
        );

    return new Promise(
        (resolve, reject) => {

            let finished =
                false;

            const timeout =
                setTimeout(
                    () => finish(),
                    30000
                );

            function finish() {

                if (
                    finished
                ) {

                    return;
                }

                finished =
                    true;

                clearTimeout(
                    timeout
                );

                session.player.off(
                    "stateChange",
                    listener
                );

                resolve();
            }

            function listener(
                oldState,
                newState
            ) {

                if (
                    newState.status ===
                    AudioPlayerStatus.Idle
                ) {

                    finish();
                }
            }

            session.player.on(
                "stateChange",
                listener
            );

            try {

                session.player.play(
                    resource
                );

                console.log(
                    "🔊 AudioPlayer начал воспроизведение."
                );

            } catch (error) {

                clearTimeout(
                    timeout
                );

                session.player.off(
                    "stateChange",
                    listener
                );

                reject(
                    error
                );
            }
        }
    );
}

// ==============================
// PROCESS SPEECH
// ==============================

async function processVoiceAudio(
    session,
    userId,
    pcmData
) {

    if (
        !session.active
    ) {

        return;
    }

    // Минимум примерно 0.5 секунды
    if (
        pcmData.length < 96000
    ) {

        console.log(
            `🎤 Слишком короткий фрагмент: ${pcmData.length} bytes`
        );

        return;
    }

    if (
        session.processingUsers.has(
            userId
        )
    ) {

        console.log(
            `⏳ ${userId} уже обрабатывается`
        );

        return;
    }

    session.processingUsers.add(
        userId
    );

    try {

        console.log(
            `🎤 Отправляю голос ${userId} в Gemini...`
        );

        const text =
            await transcribeVoice(
                pcmData
            );

        console.log(
            `📝 Распознано: "${text}"`
        );

        if (!text) {

            console.log(
                "ℹ️ Gemini не нашёл речи."
            );

            return;
        }

        const answer =
            await askVoiceAI(
                text
            );

        console.log(
            `🤖 Ответ: "${answer}"`
        );

        if (
            !session.active
        ) {

            return;
        }

        console.log(
            "🔊 Создаю голосовой ответ..."
        );

        await playVoiceAI(
            session,
            answer
        );

        console.log(
            "✓ Голосовой ответ закончен."
        );

    } catch (error) {

        console.error(
            "❌ Ошибка Voice AI:",
            error
        );

    } finally {

        session.processingUsers.delete(
            userId
        );
    }
}

// ==============================
// LISTEN USER
// ==============================

function listenToUser(
    session,
    userId
) {

    if (
        !session.active
    ) {

        return;
    }

    if (
        session.voiceConnection.state.status !==
        VoiceConnectionStatus.Ready
    ) {

        console.log(
            "⚠️ Voice connection ещё не Ready."
        );

        return;
    }

    if (
        session.subscriptions.has(
            userId
        )
    ) {

        return;
    }

    const receiver =
        session.voiceConnection.receiver;

    let audioStream;

    try {

        audioStream =
            receiver.subscribe(
                userId,
                {

                    end: {

                        behavior:
                            EndBehaviorType.AfterSilence,

                        duration:
                            1000
                    }
                }
            );

    } catch (error) {

        console.error(
            "❌ Не удалось получить голос:",
            error
        );

        return;
    }

    session.subscriptions.set(
        userId,
        audioStream
    );

    console.log(
        `🎤 START: слушаю ${userId}`
    );

    const decoder =
        new prism.opus.Decoder({

            frameSize:
                960,

            channels:
                2,

            rate:
                48000
        });

    const chunks = [];

    audioStream
        .pipe(decoder)

        .on(
            "data",
            chunk => {

                chunks.push(
                    chunk
                );
            }
        )

        .on(
            "end",
            async () => {

                session.subscriptions.delete(
                    userId
                );

                const pcmData =
                    Buffer.concat(
                        chunks
                    );

                console.log(
                    `🎤 END: ${userId}, ${pcmData.length} bytes`
                );

                await processVoiceAudio(
                    session,
                    userId,
                    pcmData
                );
            }
        )

        .on(
            "error",
            error => {

                session.subscriptions.delete(
                    userId
                );

                console.error(
                    "❌ Ошибка decoder:",
                    error
                );
            }
        );
}

// ==============================
// START VOICE AI
// ==============================

async function startVoiceAI(
    member
) {

    const channel =
        member.voice.channel;

    if (!channel) {

        throw new Error(
            "Ты должен находиться в голосовом канале."
        );
    }

    const guildId =
        member.guild.id;

    const oldSession =
        voiceAISessions.get(
            guildId
        );

    if (
        oldSession
    ) {

        stopVoiceAI(
            guildId
        );
    }

    console.log(
        `🎙️ Подключаю Voice AI к ${channel.name}...`
    );

    const connection =
        joinVoiceChannel({

            channelId:
                channel.id,

            guildId:
                guildId,

            adapterCreator:
                channel.guild.voiceAdapterCreator,

            selfDeaf:
                false,

            selfMute:
                false
        });

    const player =
        createAudioPlayer();

    connection.subscribe(
        player
    );

    const session = {

        active:
            true,

        guildId:
            guildId,

        channelId:
            channel.id,

        voiceConnection:
            connection,

        player:

            player,

        subscriptions:
            new Map(),

        processingUsers:
            new Set()
    };

    voiceAISessions.set(
        guildId,
        session
    );

    connection.on(
        VoiceConnectionStatus.Ready,
        () => {

            console.log(
                `✓ Voice AI подключён к ${channel.name}`
            );

            console.log(
                "🎤 Voice AI теперь слушает участников."
            );
        }
    );

    connection.on(
        VoiceConnectionStatus.Disconnected,
        () => {

            if (
                session.active
            ) {

                console.log(
                    "⚠️ Voice AI отключён от Discord Voice."
                );
            }
        }
    );

    connection.on(
        VoiceConnectionStatus.Destroyed,
        () => {

            console.log(
                "🔇 Voice connection уничтожен."
            );
        }
    );

    const receiver =
        connection.receiver;

    receiver.speaking.on(
        "start",
        userId => {

            if (
                !session.active
            ) {

                return;
            }

            if (
                userId ===
                client.user.id
            ) {

                return;
            }

            const voiceMember =
                channel.members.get(
                    userId
                );

            if (
                !voiceMember
            ) {

                console.log(
                    `⚠️ Не найден участник ${userId} в канале.`
                );

                return;
            }

            if (
                voiceMember.user.bot
            ) {

                return;
            }

            console.log(
                `🗣️ Пользователь начал говорить: ${voiceMember.user.username}`
            );

            listenToUser(
                session,
                userId
            );
        }
    );

    return session;
}

// ==============================
// STOP VOICE AI
// ==============================

function stopVoiceAI(
    guildId
) {

    const session =
        voiceAISessions.get(
            guildId
        );

    if (!session) {

        return false;
    }

    session.active =
        false;

    for (
        const stream of
        session.subscriptions.values()
    ) {

        try {

            stream.destroy();

        } catch {}
    }

    session.subscriptions.clear();

    try {

        session.player.stop();

    } catch {}

    try {

        session.voiceConnection.destroy();

    } catch {}

    voiceAISessions.delete(
        guildId
    );

    console.log(
        "✓ Voice AI остановлен."
    );

    return true;
}

// ==============================
// COMMANDS
// ==============================

const commands = [

    new SlashCommandBuilder()

        .setName(
            "stats"
        )

        .setDescription(
            "Показать статистику пользователя"
        )

        .addUserOption(
            option =>
                option

                    .setName(
                        "user"
                    )

                    .setDescription(
                        "Пользователь"
                    )

                    .setRequired(
                        false
                    )
        ),

    new SlashCommandBuilder()

        .setName(
            "ai"
        )

        .setDescription(
            "Задать вопрос нейросети"
        )

        .addStringOption(
            option =>
                option

                    .setName(
                        "prompt"
                    )

                    .setDescription(
                        "Ваш запрос к нейросети"
                    )

                    .setRequired(
                        true
                    )
        ),

    new SlashCommandBuilder()

        .setName(
            "voiceai"
        )

        .setDescription(
            "Включить голосовую нейросеть"
        ),

    new SlashCommandBuilder()

        .setName(
            "voiceai-stop"
        )

        .setDescription(
            "Выключить голосовую нейросеть"
        )

].map(
    command =>
        command.toJSON()
);

// ==============================
// REGISTER COMMANDS
// ==============================

async function registerCommands() {

    const rest =
        new REST({
            version:
                "10"
        }).setToken(
            TOKEN
        );

    await rest.put(

        Routes.applicationGuildCommands(
            CLIENT_ID,
            GUILD_ID
        ),

        {
            body:
                commands
        }
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
}

// ==============================
// INTERACTIONS
// ==============================

client.on(
    "interactionCreate",
    async interaction => {

        if (
            !interaction.isChatInputCommand()
        ) {

            return;
        }

        // ==========================
        // /STATS
        // ==========================

        if (
            interaction.commandName ===
            "stats"
        ) {

            await interaction.deferReply();

            const target =
                interaction.options.getUser(
                    "user"
                ) ||
                interaction.user;

            const data =
                getUser(
                    target.id
                );

            try {

                const imageBuffer =
                    await generateCard(
                        target,
                        data
                    );

                const attachment =
                    new AttachmentBuilder(
                        imageBuffer,
                        {
                            name:
                                "stats.png"
                        }
                    );

                await interaction.editReply({

                    files: [
                        attachment
                    ]
                });

            } catch (error) {

                console.error(
                    "❌ Ошибка при генерации карточки:",
                    error
                );

                await interaction.editReply(
                    "Упс, произошла ошибка при создании карточки. Проверьте логи бота."
                );
            }

            return;
        }

        // ==========================
        // /AI
        // ==========================

        if (
            interaction.commandName ===
            "ai"
        ) {

            await interaction.deferReply();

            const prompt =
                interaction.options.getString(
                    "prompt"
                );

            try {

                if (
                    !prompt ||
                    !prompt.trim()
                ) {

                    await interaction.editReply(
                        "❌ Напиши запрос для нейросети."
                    );

                    return;
                }

                console.log(
                    `🤖 AI запрос от ${interaction.user.tag}: ${prompt}`
                );

                const answer =
                    await askAI(
                        prompt
                    );

                if (
                    answer.length <= 2000
                ) {

                    await interaction.editReply(
                        answer
                    );

                } else {

                    const chunks = [];

                    for (
                        let i = 0;
                        i < answer.length;
                        i += 1900
                    ) {

                        chunks.push(
                            answer.slice(
                                i,
                                i + 1900
                            )
                        );
                    }

                    await interaction.editReply(
                        chunks.shift()
                    );

                    for (
                        const chunk of chunks
                    ) {

                        await interaction.followUp(
                            chunk
                        );
                    }
                }

            } catch (error) {

                console.error(
                    "❌ Ошибка Gemini:",
                    error
                );

                await interaction.editReply(
                    "❌ Не удалось получить ответ от Gemini. Проверь GEMINI_API_KEY в Railway."
                );
            }

            return;
        }

        // ==========================
        // /VOICEAI
        // ==========================

        if (
            interaction.commandName ===
            "voiceai"
        ) {

            await interaction.deferReply();

            try {

                const member =
                    await interaction.guild.members.fetch(
                        interaction.user.id
                    );

                if (
                    !member.voice.channel
                ) {

                    await interaction.editReply(
                        "❌ Сначала зайди в голосовой канал."
                    );

                    return;
                }

                const channelName =
                    member.voice.channel.name;

                await startVoiceAI(
                    member
                );

                await interaction.editReply(
                    `🎙️ Голосовая нейронка включена в **${channelName}**.\n\nГовори обычным голосом — бот будет слушать и отвечать.`
                );

            } catch (error) {

                console.error(
                    "❌ Ошибка запуска Voice AI:",
                    error
                );

                await interaction.editReply(
                    "❌ Не удалось запустить голосовую нейронку. Проверь логи Railway."
                );
            }

            return;
        }

        // ==========================
        // /VOICEAI-STOP
        // ==========================

        if (
            interaction.commandName ===
            "voiceai-stop"
        ) {

            const stopped =
                stopVoiceAI(
                    interaction.guild.id
                );

            if (
                stopped
            ) {

                await interaction.reply(
                    "🔇 Голосовая нейронка выключена."
                );

            } else {

                await interaction.reply(
                    "ℹ️ Голосовая нейронка сейчас не запущена."
                );
            }

            return;
        }
    }
);

// ==============================
// READY
// ==============================

client.once(
    "ready",
    async () => {

        console.log(
            `✓ Бот запущен: ${client.user.tag}`
        );

        if (
            process.env.GEMINI_API_KEY
        ) {

            console.log(
                "✓ GEMINI_API_KEY найдена"
            );

        } else {

            console.warn(
                "⚠️ GEMINI_API_KEY не найдена! /ai и Voice AI работать не будут."
            );
        }

        await getTemplateImage();

        console.log(
            "✓ Шаблон закэширован!"
        );

        // ==========================
        // RESTORE ACTIVE SESSIONS
        // ==========================

        for (
            const guild of
            client.guilds.cache.values()
        ) {

            await guild.members.fetch();

            for (
                const member of
                guild.members.cache.values()
            ) {

                if (
                    member.user.bot
                ) {

                    continue;
                }

                const presence =
                    member.presence;

                const data =
                    getUser(
                        member.id
                    );

                if (
                    presenceIsOnline(
                        presence
                    ) &&
                    !data.discordStartedAt
                ) {

                    data.discordStartedAt =
                        Date.now();
                }

                const game =
                    presence?.activities?.find(
                        activity =>
                            activity.type ===
                            ActivityType.Playing
                    );

                if (
                    game?.name &&
                    !data.gamingStartedAt
                ) {

                    data.gamingGame =
                        game.name;

                    data.gamingStartedAt =
                        Date.now();
                }

                for (
                    const channel of
                    guild.channels.cache.values()
                ) {

                    if (
                        channel.isVoiceBased() &&
                        channel.members.has(
                            member.id
                        )
                    ) {

                        if (
                            !data.voiceStartedAt
                        ) {

                            data.voiceStartedAt =
                                Date.now();
                        }
                    }
                }
            }
        }

        saveStats();

        console.log(
            "✓ Активные сессии успешно восстановлены!"
        );
    }
);

// ==============================
// START
// ==============================

(async () => {

    try {

        await registerCommands();

        await client.login(
            TOKEN
        );

    } catch (error) {

        console.error(
            "❌ Критическая ошибка запуска:",
            error
        );
    }

})();
