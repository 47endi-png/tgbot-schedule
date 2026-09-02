# Telegram Bot — Расписание СахГУ

Автоматический бот для отправки расписания студентов СахГУ в Telegram.

## Функции

- `/start` — справка
- `/today` — расписание на сегодня
- `/tomorrow` — расписание на завтра
- `/week` — показать тип недели (числитель/знаменатель)
- `/setgroup` — назначить чат для автоматической рассылки
- `/chatid` — показать ID чата и темы

**Автоматическая рассылка:** каждый день в 20:00 отправляет расписание на завтра.

## Установка

1. Клонируйте репозиторий:
```bash
git clone https://github.com/your-username/tgbot-schedule.git
cd tgbot-schedule
```

2. Установите зависимости:
```bash
npm install
```

3. Создайте `.env` файл на основе `.env.example`:
```bash
cp .env.example .env
```

4. Заполните `.env`:
```
BOT_TOKEN=ваш_токен_от_BotFather
TZ=Asia/Sakhalin
ADMIN_ID=ваш_telegram_id
```

5. Убедитесь, что `schedule.json` заполнен

6. Запустите бота:
```bash
npm start
```

## Структура файлов

- `telegram-sakhgu-schedule-auto-weeks.mjs` — основной файл бота
- `schedule.json` — расписание по неделям (числитель/знаменатель)
- `settings.json` — сохраняемые настройки (создаётся автоматически)
- `package.json` — зависимости Node.js

## Развёртывание на Render

1. Загрузьте репозиторий на GitHub
2. На [render.com](https://render.com) создайте **Web Service**
3. Выберите репозиторий
4. Build Command: `npm install`
5. Start Command: `npm start`
6. Добавьте Environment Variables из `.env.example`
7. Нажмите Deploy

Бот будет работать 24/7!

## Требования

- Node.js 16+
- Telegram Bot Token (от @BotFather)
- schedule.json с расписанием