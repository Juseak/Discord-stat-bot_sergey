const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const { createCanvas } = require('@napi-rs/canvas');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Показать карточку статистики игрока'),
].map(command => command.toJSON());

client.once('ready', async () => {
    console.log(`Бот ${client.user.tag} запущен!`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Команда /stats зарегистрирована.');
    } catch (error) {
        console.error('Ошибка регистрации команд:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'stats') {
        await interaction.deferReply();
        try {
            const canvas = createCanvas(700, 250);
            const ctx = canvas.getContext('2d');

            // Фон карточки
            ctx.fillStyle = '#1e1e24';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Получаем текущую дату и время
            const now = new Date();
            const timeString = now.toLocaleTimeString('ru-RU');
            const dateString = now.toLocaleDateString('ru-RU');

            // Текст и статистика на холсте
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 28px sans-serif';
            ctx.fillText('Статистика игрока', 30, 50);

            ctx.font = '20px sans-serif';
            ctx.fillStyle = '#a0a0a5';
            ctx.fillText(`Имя: ${interaction.user.username}`, 30, 95);
            ctx.fillText(`ID: ${interaction.user.id}`, 30, 135);
            ctx.fillText(`Дата: ${dateString} | Время: ${timeString}`, 30, 175);
            ctx.fillText('Статус: Активен 🟢', 30, 215);

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
});

client.login(process.env.DISCORD_TOKEN);
