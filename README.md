# Discord Stats Card Bot

Готовый Discord.js бот, который:

- считает сообщения;
- считает время в голосовых каналах;
- считает время, когда пользователь находится online/idle/dnd, как Discord time;
- видит текущую игру через Discord Presence и накапливает время;
- показывает Music = SOON;
- хранит данные в stats.json;
- использует `template/template.png` как готовый фон;
- `/stats` отправляет PNG-карточку.

## Установка

Требуется Node.js 18+.

```bash
npm install
```

## Настройка

Открой `index.js` и замени:

```js
const TOKEN = "PUT_BOT_TOKEN_HERE";
const CLIENT_ID = "PUT_CLIENT_ID_HERE";
const GUILD_ID = "PUT_GUILD_ID_HERE";
```

на данные бота.

## Discord Developer Portal

В Bot → Privileged Gateway Intents включи:

- Server Members Intent
- Message Content Intent
- Presence Intent

Для голосовой статистики бот должен иметь доступ к нужным каналам.

## Запуск

```bash
npm start
```

После запуска используй:

```text
/stats
```

или:

```text
/stats user:@пользователь
```

## Важные ограничения Discord

Бот начинает собирать статистику с момента запуска. Discord API не предоставляет задним числом полную историю сообщений/голоса/игр.

`Discord` здесь означает время, которое бот наблюдает пользователя в статусе online/idle/dnd.

`Gaming` использует Discord Presence. Например:

`GTA V • 42m`

Если пользователь сменил игру, бот завершает предыдущую сессию и начинает новую.

Music пока намеренно показывает `SOON`.

## Изменение расположения текста

Все координаты находятся в начале `index.js`:

```js
const POS = {
    username: { x: 768, y: 105 },
    voice:   { x: 128,  y: 1010, color: "#ff4b4b" },
    message: { x: 380,  y: 1010, color: "#55a8ff" },
    discord: { x: 625,  y: 1010, color: "#c080ff" },
    gaming:  { x: 870,  y: 990,  color: "#43ff91" },
    music:   { x: 1260, y: 1010, color: "#ffd84a" }
};
```

Шаблон пользователя уже лежит в `template/template.png`.
