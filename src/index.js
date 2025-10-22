import { readFileSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadEnv } from './env.js';

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

function createSession(userId, categoryKey) {
  const questions = questionsData.categories[categoryKey];
  sessions.set(userId, {
    userId,
    categoryKey,
    currentIndex: 0,
    questions,
    answers: [],
  });
}

function getSession(userId) {
  return sessions.get(userId);
}

function resetSession(userId) {
  sessions.delete(userId);
}

function buildQuestionMarkup(categoryKey, questionIndex, options) {
  const inline_keyboard = options.map((option, idx) => [{
    text: option,
    callback_data: `answer|${categoryKey}|${questionIndex}|${idx}`,
  }]);
  return { inline_keyboard };
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

function escapePdfText(text) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function createPdfBuffer(lines) {
  const streamLines = ['BT', '/F1 12 Tf', '14 TL', '72 770 Td'];
  lines.forEach((line, index) => {
    const escaped = escapePdfText(line);
    if (index === 0) {
      streamLines.push(`(${escaped}) Tj`);
    } else {
      streamLines.push('T*');
      streamLines.push(`(${escaped}) Tj`);
    }
  });
  streamLines.push('ET');
  const streamContent = streamLines.join('\n');
  const streamLength = Buffer.byteLength(streamContent, 'utf8');

  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  function appendObject(id, content) {
    const currentOffset = Buffer.byteLength(pdf, 'utf8');
    offsets[id] = currentOffset;
    pdf += `${id} 0 obj\n${content}\nendobj\n`;
  }

  appendObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  appendObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  appendObject(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>');
  const contentObject = `<< /Length ${streamLength} >>\nstream\n${streamContent}\nendstream`;
  appendObject(4, contentObject);
  appendObject(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    const padded = offsets[i].toString().padStart(10, '0');
    pdf += `${padded} 00000 n \n`;
  }
  pdf += `trailer << /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'utf8');
}

async function finalizeSession(chatId, session) {
  const total = session.questions.length;
  const correct = session.answers.filter((item) => item.isCorrect).length;
  const incorrectItems = session.answers.filter((item) => !item.isCorrect);

  const summaryLines = [
    `Yo'nalish: ${session.categoryKey}`,
    `Jami savollar: ${total}`,
    `To'g'ri javoblar: ${correct}`,
    `Noto'g'ri javoblar: ${incorrectItems.length}`,
    '',
  ];

  session.answers.forEach((answer, idx) => {
    summaryLines.push(`Savol ${idx + 1}: ${answer.question}`);
    summaryLines.push(`Sizning javobingiz: ${answer.selected}`);
    summaryLines.push(`To'g'ri javob: ${answer.correct}`);
    summaryLines.push(`Holat: ${answer.isCorrect ? '✅' : '❌'}`);
    summaryLines.push('');
  });

  const pdfBuffer = createPdfBuffer(summaryLines);
  const reportsDir = resolve(__dirname, '../reports');
  await mkdir(reportsDir, { recursive: true });
  const filename = `natija_${session.categoryKey}_${Date.now()}.pdf`;
  const filePath = join(reportsDir, filename);
  await writeFile(filePath, pdfBuffer);

  await sendMessage(chatId, `🏁 Test yakunlandi!\nTo'g'ri javoblar: ${correct}/${total}`);
  await sendDocument(chatId, pdfBuffer, filename);
  resetSession(session.userId);
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

  const session = getSession(from.id);
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

  createSession(from.id, categoryKey);
  const session = getSession(from.id);
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

  const session = getSession(message.from.id);
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
