import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cron from 'node-cron';
import TelegramBot from 'node-telegram-bot-api';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BOT_TOKEN = process.env.BOT_TOKEN;
const TIMEZONE = process.env.TZ || 'Asia/Sakhalin';
const SETTINGS_PATH = path.join(__dirname, 'settings.json');
const SCHEDULE_PATH = path.join(__dirname, 'schedule.json');
const ADMIN_ID = process.env.ADMIN_ID || null;
const TELEGRAM_LIMIT = 4096;

if (!BOT_TOKEN) {
  throw new Error('Не указан BOT_TOKEN. Добавьте BOT_TOKEN в файл .env.');
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error(`Не удалось прочитать ${path.basename(filePath)}:`, error.message);
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function readSettings() {
  return readJson(SETTINGS_PATH, {
    groupChatId: null,
    messageThreadId: null
  });
}

function saveSettings(settings) {
  writeJson(SETTINGS_PATH, settings);
}

function readSchedule() {
  const schedule = readJson(SCHEDULE_PATH, null);

  if (!schedule?.meta || !schedule?.numerator || !schedule?.denominator) {
    throw new Error('Не найден или неверно заполнен schedule.json. Нужны разделы meta, numerator и denominator.');
  }

  if (!schedule.meta.referenceMonday || !schedule.meta.referenceWeek) {
    throw new Error('В meta файла schedule.json должны быть referenceMonday и referenceWeek.');
  }

  return schedule;
}

function getZonedParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  return Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
}

function dateToUtcDay(year, month, day) {
  return Date.UTC(Number(year), Number(month) - 1, Number(day));
}

function getLocalDateInfo(date = new Date()) {
  const { weekday, year, month, day } = getZonedParts(date);

  return {
    weekdayKey: weekday.toLowerCase(),
    year: Number(year),
    month: Number(month),
    day: Number(day),
    utcDay: dateToUtcDay(year, month, day)
  };
}

function getTomorrowInTimezone() {
  const today = getLocalDateInfo(new Date());
  return new Date(Date.UTC(today.year, today.month - 1, today.day + 1, 12, 0, 0));
}

function mondayUtcDayFor(date) {
  const info = getLocalDateInfo(date);
  const dayIndex = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    .indexOf(info.weekdayKey);
  const daysSinceMonday = (dayIndex + 6) % 7;

  return info.utcDay - daysSinceMonday * 24 * 60 * 60 * 1000;
}

function parseReferenceMonday(referenceMonday) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(referenceMonday);

  if (!match) {
    throw new Error('referenceMonday должен иметь формат ГГГГ-ММ-ДД, например 2026-08-31.');
  }

  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function getWeekType(date, schedule) {
  const referenceMondayUtc = parseReferenceMonday(schedule.meta.referenceMonday);
  const targetMondayUtc = mondayUtcDayFor(date);
  const weeksFromReference = Math.round(
    (targetMondayUtc - referenceMondayUtc) / (7 * 24 * 60 * 60 * 1000)
  );

  const referenceWeek = schedule.meta.referenceWeek === 'numerator'
    ? 'numerator'
    : 'denominator';

  if (Math.abs(weeksFromReference) % 2 === 0) return referenceWeek;
  return referenceWeek === 'numerator' ? 'denominator' : 'numerator';
}

function formatShortDate(date) {
  const info = getLocalDateInfo(date);
  return `${String(info.day).padStart(2, '0')}.${String(info.month).padStart(2, '0')}`;
}

function formatWeekday(date) {
  const weekday = new Intl.DateTimeFormat('ru-RU', {
    timeZone: TIMEZONE,
    weekday: 'long'
  }).format(date);

  return weekday.charAt(0).toUpperCase() + weekday.slice(1);
}

function weekLabel(weekType) {
  return weekType === 'numerator' ? 'Числитель' : 'Знаменатель';
}

function makeSendOptions(messageThreadId = null) {
  const options = { disable_web_page_preview: true };

  if (messageThreadId !== null && messageThreadId !== undefined) {
    options.message_thread_id = messageThreadId;
  }

  return options;
}

function splitMessage(text) {
  if (text.length <= TELEGRAM_LIMIT) return [text];

  const parts = [];
  let remaining = text;

  while (remaining.length > TELEGRAM_LIMIT) {
    let splitAt = remaining.lastIndexOf('\n\n', TELEGRAM_LIMIT - 50);
    if (splitAt < 500) splitAt = remaining.lastIndexOf('\n', TELEGRAM_LIMIT - 50);
    if (splitAt < 500) splitAt = TELEGRAM_LIMIT - 50;

    parts.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) parts.push(remaining);
  return parts;
}

function formatLesson(lesson) {
  const details = [
    lesson.subject,
    lesson.subgroup,
    lesson.type,
    lesson.teacher,
    lesson.building,
    lesson.room
  ].filter(Boolean).join(', ');

  const lines = [
    `Пара ${lesson.lessonNumber}, ${lesson.time}`,
    details
  ];

  if (lesson.note) lines.push(`Примечание: ${lesson.note}`);
  return lines.join('\n');
}

function makeScheduleMessages(date) {
  const schedule = readSchedule();
  const weekType = getWeekType(date, schedule);
  const { weekdayKey } = getLocalDateInfo(date);
  const lessons = schedule[weekType][weekdayKey] || [];
  const title = `${formatWeekday(date)} ${formatShortDate(date)} — ${weekLabel(weekType)}`;

  if (lessons.length === 0) {
    // Проверяем, есть ли "-" в этот день (выходной)
    const dayData = schedule[weekType][weekdayKey];
    if (dayData === '-' || dayData === undefined) {
      return [`📅 Расписание\n${title}\n\n🎉 Пар нет.`];
    }
    return [`📅 Расписание\n${title}\n\n📖 Пары есть.`];
  }

  const text = [
    '📅 Расписание',
    title,
    '',
    lessons.map(formatLesson).join('\n\n')
  ].join('\n');

  return splitMessage(text);
}

async function sendSchedule(chatId, messageThreadId, date, showLoading = false) {
  const options = makeSendOptions(messageThreadId);

  try {
    if (showLoading) {
      await bot.sendMessage(chatId, '⌛ Формирую расписание…', options);
    }

    for (const message of makeScheduleMessages(date)) {
      await bot.sendMessage(chatId, message, options);
    }
  } catch (error) {
    console.error('Ошибка отправки расписания:', error);
    await bot.sendMessage(
      chatId,
      `⚠️ Не удалось сформировать расписание.\nПричина: ${error.message}`,
      options
    );
  }
}

function isAdmin(msg) {
  return ADMIN_ID && String(msg.from?.id) === String(ADMIN_ID);
}

bot.setMyCommands([
  { command: 'start', description: 'Показать справку' },
  { command: 'tomorrow', description: 'Расписание на завтра' },
  { command: 'today', description: 'Расписание на сегодня' },
  { command: 'week', description: 'Узнать числитель или знаменатель' },
  { command: 'setgroup', description: 'Назначить текущий чат или тему' },
  { command: 'chatid', description: 'Показать ID чата и темы' }
]).catch((error) => console.error('Не удалось установить меню команд:', error.message));

bot.onText(/^\/start(?:@\w+)?\s*$/, async (msg) => {
  await bot.sendMessage(
    msg.chat.id,
    [
      'Привет! Я бот расписания СахГУ.',
      '',
      '/tomorrow — расписание на завтра',
      '/today — расписание на сегодня',
      '/week — показать, числитель сейчас или знаменатель',
      '/setgroup — назначить этот чат или тему для ежедневной рассылки',
      '/chatid — показать ID чата и темы',
      '',
      `Рассылка расписания на сегодня: ежедневно в 20:00 (${TIMEZONE}).`,
      'Тип недели рассчитывается автоматически и меняется каждый понедельник.'
    ].join('\n'),
    makeSendOptions(msg.message_thread_id || null)
  );
});

bot.onText(/^\/tomorrow(?:@\w+)?\s*$/, async (msg) => {
  await sendSchedule(msg.chat.id, msg.message_thread_id || null, getTomorrowInTimezone(), true);
});

bot.onText(/^\/today(?:@\w+)?\s*$/, async (msg) => {
  await sendSchedule(msg.chat.id, msg.message_thread_id || null, new Date(), true);
});

bot.onText(/^\/week(?:@\w+)?\s*$/, async (msg) => {
  try {
    const schedule = readSchedule();
    const today = new Date();
    const tomorrow = getTomorrowInTimezone();

    await bot.sendMessage(
      msg.chat.id,
      [
        `Сегодня: ${weekLabel(getWeekType(today, schedule))}.`,
        `Завтра: ${weekLabel(getWeekType(tomorrow, schedule))}.`
      ].join('\n'),
      makeSendOptions(msg.message_thread_id || null)
    );
  } catch (error) {
    await bot.sendMessage(msg.chat.id, `⚠️ Ошибка: ${error.message}`, makeSendOptions(msg.message_thread_id || null));
  }
});

bot.onText(/^\/chatid(?:@\w+)?\s*$/, async (msg) => {
  const topicText = msg.message_thread_id
    ? `\nID темы: ${msg.message_thread_id}`
    : '\nСообщение отправлено не внутри темы.';

  await bot.sendMessage(
    msg.chat.id,
    `ID чата: ${msg.chat.id}${topicText}`,
    makeSendOptions(msg.message_thread_id || null)
  );
});

bot.onText(/^\/setgroup(?:@\w+)?\s*$/, async (msg) => {
  if (msg.chat.type === 'private') {
    await bot.sendMessage(msg.chat.id, 'Добавьте бота в общий чат, откройте нужную тему и напишите там /setgroup.');
    return;
  }

  if (ADMIN_ID && !isAdmin(msg)) {
    await bot.sendMessage(
      msg.chat.id,
      'Назначать место автоматической рассылки может только администратор бота.',
      makeSendOptions(msg.message_thread_id || null)
    );
    return;
  }

  const settings = readSettings();
  settings.groupChatId = String(msg.chat.id);
  settings.messageThreadId = msg.message_thread_id || null;
  saveSettings(settings);

  const targetText = settings.messageThreadId
    ? '✅ Автоматическая рассылка закреплена за этой темой.'
    : '✅ Автоматическая рассылка закреплена за этим чатом в разделе «Общее».\n\nЧтобы выбрать конкретную тему, откройте её и выполните /setgroup внутри темы.';

  await bot.sendMessage(
    msg.chat.id,
    `${targetText}\n\nКаждый день в 20:00 (${TIMEZONE}) бот будет отправлять сюда расписание на завтра.`,
    makeSendOptions(settings.messageThreadId)
  );
});

cron.schedule(
  '0 20 * * *',
  async () => {
    const { groupChatId, messageThreadId } = readSettings();

    if (!groupChatId) {
      console.log('20:00: чат или тема для рассылки ещё не назначены.');
      return;
    }

    console.log('20:00: отправляю расписание на завтра.');
    await sendSchedule(groupChatId, messageThreadId, getTomorrowInTimezone(), false);
  },
  {
    timezone: TIMEZONE,
    noOverlap: true,
name: 'send-tomorrow-schedule'
  }
);

console.log('Бот запущен: локальное расписание и автоматическое чередование недель.');
console.log(`Рассылка: ежедневно в 20:00 (${TIMEZONE}).`);
console.log('Опорная дата и тип первой недели берутся из schedule.json.');
