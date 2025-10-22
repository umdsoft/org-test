import { readFileSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadEnv } from './env.js';
import {
  buildQuestionMarkup,
  createPdfBuffer,
  createSession as storeCreateSession,
  getSession as storeGetSession,
  resetSession as storeResetSession,
} from './bot-helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

loadEnv();

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('BOT_TOKEN .env faylida topilmadi.');
  process.exit(1);
}

const apiBase = `https://api.telegram.org/bot${token}`;
const questionsPath = resolve(__dirname, '../data/questions.json');

let questionsData;
try {
  questionsData = JSON.parse(readFileSync(questionsPath, 'utf8'));
} catch (error) {
  console.error('Savollarni o\'qishda xatolik:', error.message);
  process.exit(1);
}

const categories = Object.keys(questionsData.categories || {});
if (categories.length === 0) {
  console.error('Hech qanday yo\'nalish topilmadi. data/questions.json faylini tekshiring.');
  process.exit(1);
}

const sessions = new Map();
let updateOffset = 0;

function createUserSession(userId, categoryKey) {
  const questions = questionsData.categories[categoryKey];
  return storeCreateSession(sessions, userId, categoryKey, questions);
}

function getUserSession(userId) {
  return storeGetSession(sessions, userId);
}

function resetUserSession(userId) {
  storeResetSession(sessions, userId);
}

async function telegramRequest(method, payload, isJson = true) {
  const url = `${apiBase}/${method}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: isJson ? { 'Content-Type': 'application/json' } : undefined,
    body: isJson ? JSON.stringify(payload) : payload,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Telegram API xatosi (${method}): ${response.status} ${text}`);
  }

  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Telegram API muvaffaqiyatsiz (${method}): ${JSON.stringify(data)}`);
  }

  return data.result;
}

async function sendMessage(chatId, text, replyMarkup) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
  };
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }
  return telegramRequest('sendMessage', payload);
}

async function answerCallbackQuery(callbackQueryId) {
  return telegramRequest('answerCallbackQuery', { callback_query_id: callbackQueryId });
}

async function sendDocument(chatId, buffer, filename) {
  const formData = new FormData();
  formData.append('chat_id', String(chatId));
  formData.append('document', new Blob([buffer], { type: 'application/pdf' }), filename);
  return telegramRequest('sendDocument', formData, false);
}

async function promptCategory(chatId) {
  const inline_keyboard = categories.map((key) => [{
    text: key,
    callback_data: `category|${key}`,
  }]);
  await sendMessage(
    chatId,
    'Test yo\'nalishini tanlang:',
    { inline_keyboard }
  );
}

async function sendQuestion(chatId, session) {
  const { categoryKey, currentIndex, questions } = session;
  if (currentIndex >= questions.length) {
    await finalizeSession(chatId, session);
    return;
  }

  const question = questions[currentIndex];
  const text = `<b>${categoryKey.toUpperCase()}</b> yo'nalishi\n\nSavol ${currentIndex + 1}: ${question.question}`;
  await sendMessage(chatId, text, buildQuestionMarkup(categoryKey, currentIndex, question.options));
}

async function finalizeSession(chatId, session) {
  const total = session.questions.length;
  const correct = session.answers.filter((item) => item.isCorrect).length;
  const incorrectItems = session.answers.filter((item) => !item.isCorrect);

  const summaryLines = [
    { text: `Yo'nalish: ${session.categoryKey}` },
    { text: `Jami savollar: ${total}` },
    { text: `To'g'ri javoblar: ${correct}` },
    { text: `Noto'g'ri javoblar: ${incorrectItems.length}` },
    { text: '' },
  ];

  session.answers.forEach((answer, idx) => {
    const statusColor = answer.isCorrect ? 'green' : 'red';
    summaryLines.push({ text: `Savol ${idx + 1}: ${answer.question}`, color: statusColor });
    summaryLines.push({ text: `Sizning javobingiz: ${answer.selected}`, color: statusColor });
    if (!answer.isCorrect) {
      summaryLines.push({ text: `To'g'ri javob: ${answer.correct}`, color: 'green' });
    }
    summaryLines.push({ text: `Holat: ${answer.isCorrect ? "✅ To'g'ri" : "❌ Noto'g'ri"}`, color: statusColor });
    summaryLines.push({ text: '' });
  });

  const pdfBuffer = createPdfBuffer(summaryLines);
  const reportsDir = resolve(__dirname, '../reports');
  await mkdir(reportsDir, { recursive: true });
  const filename = `natija_${session.categoryKey}_${Date.now()}.pdf`;
  const filePath = join(reportsDir, filename);
  await writeFile(filePath, pdfBuffer);

  await sendMessage(chatId, `🏁 Test yakunlandi!\nTo'g'ri javoblar: ${correct}/${total}`);
  await sendDocument(chatId, pdfBuffer, filename);
  resetUserSession(session.userId);
  await promptCategory(chatId);
}

async function handleAnswer(callbackQuery) {
  const { data, from, message, id } = callbackQuery;
  if (!data || !from || !message) {
    return;
  }
  const [type, categoryKey, questionIndexStr, optionIndexStr] = data.split('|');
  if (type !== 'answer') {
    return;
  }

  const session = getUserSession(from.id);
  if (!session || session.categoryKey !== categoryKey) {
    await answerCallbackQuery(id);
    return;
  }

  const questionIndex = Number(questionIndexStr);
  const optionIndex = Number(optionIndexStr);
  if (Number.isNaN(questionIndex) || Number.isNaN(optionIndex)) {
    await answerCallbackQuery(id);
    return;
  }

  if (questionIndex !== session.currentIndex) {
    await answerCallbackQuery(id);
    return;
  }

  const question = session.questions[questionIndex];
  const selectedOption = question.options[optionIndex];
  const correctOption = question.options[question.answerIndex];
  const isCorrect = optionIndex === question.answerIndex;

  session.answers.push({
    question: question.question,
    selected: selectedOption,
    correct: correctOption,
    isCorrect,
  });
  session.currentIndex += 1;

  await answerCallbackQuery(id);
  await sendMessage(message.chat.id, isCorrect ? '✅ To\'g\'ri javob!' : `❌ Noto'g'ri. To'g'ri javob: ${correctOption}`);
  await sendQuestion(message.chat.id, session);
}

async function handleCategory(callbackQuery) {
  const { data, from, message, id } = callbackQuery;
  if (!data || !from || !message) {
    return;
  }

  const [type, categoryKey] = data.split('|');
  if (type !== 'category') {
    return;
  }

  if (!questionsData.categories[categoryKey]) {
    await answerCallbackQuery(id);
    await sendMessage(message.chat.id, 'Bunday yo\'nalish topilmadi.');
    return;
  }

  createUserSession(from.id, categoryKey);
  const session = getUserSession(from.id);
  session.userId = from.id;

  await answerCallbackQuery(id);
  await sendMessage(message.chat.id, `Siz <b>${categoryKey}</b> yo'nalishini tanladingiz. Omad!`);
  await sendQuestion(message.chat.id, session);
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  const text = message.text || '';

  if (text === '/start') {
    await sendMessage(chatId, 'Assalomu alaykum! Test botiga xush kelibsiz.');
    await promptCategory(chatId);
    return;
  }

  if (text === '/help') {
    await sendMessage(chatId, 'Yo\'nalishni tanlang va savollarga javob bering. Har bir yakunlangan urunish natijasi PDF ko\'rinishida yuboriladi.');
    return;
  }

  const session = getUserSession(message.from.id);
  if (session) {
    await sendMessage(chatId, 'Iltimos, variantni tugmalar orqali tanlang.');
  } else {
    await promptCategory(chatId);
  }
}

async function processUpdate(update) {
  if (update.message) {
    await handleMessage(update.message);
  } else if (update.callback_query) {
    const { data } = update.callback_query;
    if (data?.startsWith('category|')) {
      await handleCategory(update.callback_query);
    } else if (data?.startsWith('answer|')) {
      await handleAnswer(update.callback_query);
    } else {
      await answerCallbackQuery(update.callback_query.id);
    }
  }
}

async function startPolling() {
  while (true) {
    try {
      const response = await fetch(`${apiBase}/getUpdates?timeout=30&offset=${updateOffset}`);
      if (!response.ok) {
        throw new Error(`getUpdates xatosi: ${response.status}`);
      }
      const data = await response.json();
      if (!data.ok) {
        throw new Error(`getUpdates muvaffaqiyatsiz: ${JSON.stringify(data)}`);
      }
      for (const update of data.result) {
        updateOffset = update.update_id + 1;
        await processUpdate(update);
      }
    } catch (error) {
      console.error('Polling xatosi:', error.message);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 5000));
    }
  }
}

console.log('Bot ishga tushirildi.');
startPolling();
