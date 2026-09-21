const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const { GoogleGenAI } = require('@google/genai');
const { createCanvas } = require('@napi-rs/canvas');

// Инициализация клиента и нейросети
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Описание слэш-команд
const commands = [
    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Показать карточку статистики игрока'),
    new SlashCommandBuilder()
        .setName('ai')
        .setDescription('Задать вопрос нейросети Gemini')
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('Ваш вопрос нейросети')
                .setRequired(true)
        ),
].map(command => command.toJSON());

client.once('ready', async () => {
    console.log(`Бот ${client.user.tag} запущен! Регистрируем слэш-команды...`);

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands },
        );
        console.log('Слэш-команды успешно зарегистрированы!');
    } catch (error) {
        console.error('Ошибка регистрации команд:', error);
    }
});

// Обработка выполнения слэш-команд
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    // 1. Команда /stats с картинкой
    if (commandName === 'stats') {
        await interaction.deferReply();
        try {
            const canvas = createCanvas(700, 250);
            const ctx = canvas.getContext('2d');

            // Рисуем фон
            ctx.fillStyle = '#1e1e24';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Текст на холсте
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 28px sans-serif';
            ctx.fillText('Статистика игрока', 30, 50);

            ctx.font = '20px sans-serif';
            ctx.fillStyle = '#a0a0a5';
            ctx.fillText(`Имя: ${interaction.user.username}`, 30, 100);
            ctx.fillText(`ID: ${interaction.user.id}`, 30, 140);
            ctx.fillText('Статус: Активен 🟢', 30, 180);

            const attachment = {
                attachment: canvas.toBuffer('image/png'),
                name: 'stats.png',
            };

            await interaction.editReply({ files: [attachment] });
        } catch (error) {
            console.error('Ошибка генерации статистики:', error);
            await interaction.editReply('Не удалось создать карточку статистики.');
        }
    }

    // 2. Команда /ai с вопросом нейросети
    else if (commandName === 'ai') {
        const promptText = interaction.options.getString('prompt');
        await interaction.deferReply();

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: promptText,
            });

            const replyText = response.text || 'Не удалось получить ответ от нейросети.';

            if (replyText.length > 2000) {
                await interaction.editReply(replyText.substring(0, 1997) + '...');
            } else {
                await interaction.editReply(replyText);
            }
        } catch (error) {
            console.error('Ошибка при обращении к Gemini API:', error);
            await interaction.editReply('Произошла ошибка при запросе к нейросети.');
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
