const SESSION_ERROR = 'Session store Map kerak.';

function assertStore(store) {
  if (!store || typeof store.set !== 'function' || typeof store.get !== 'function' || typeof store.delete !== 'function') {
    throw new TypeError(SESSION_ERROR);
  }
}

export function createSession(store, userId, categoryKey, questions) {
  assertStore(store);
  if (userId === undefined || userId === null) {
    throw new TypeError('Foydalanuvchi identifikatori talab qilinadi.');
  }
  if (!categoryKey) {
    throw new TypeError('Yo\'nalish identifikatori talab qilinadi.');
  }
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new TypeError('Savollar ro\'yxati bo\'sh bo\'lishi mumkin emas.');
  }

  const session = {
    userId,
    categoryKey,
    currentIndex: 0,
    questions,
    answers: [],
  };
  store.set(userId, session);
  return session;
}

export function getSession(store, userId) {
  assertStore(store);
  return store.get(userId) || null;
}

export function resetSession(store, userId) {
  assertStore(store);
  store.delete(userId);
}

export function buildQuestionMarkup(categoryKey, questionIndex, options) {
  if (!Array.isArray(options) || options.length === 0) {
    throw new TypeError('Variantlar ro\'yxati bo\'sh bo\'lishi mumkin emas.');
  }
  return {
    inline_keyboard: options.map((option, idx) => [{
      text: option,
      callback_data: `answer|${categoryKey}|${questionIndex}|${idx}`,
    }]),
  };
}

export function escapePdfText(text) {
  if (typeof text !== 'string') {
    throw new TypeError('Matn qiymati string bo\'lishi kerak.');
  }
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function normalizeColor(color) {
  if (color === undefined || color === null) {
    return 'black';
  }
  if (typeof color !== 'string') {
    throw new TypeError('Rang nomi string bo\'lishi kerak.');
  }
  const lowered = color.toLowerCase();
  if (!['black', 'red', 'green'].includes(lowered)) {
    throw new RangeError('Ruxsat etilgan ranglar: black, red, green.');
  }
  return lowered;
}

function resolveLine(line) {
  if (typeof line === 'string') {
    return { text: line, color: 'black' };
  }
  if (!line || typeof line.text !== 'string') {
    throw new TypeError('Har bir qator string yoki { text, color } obyektidan iborat bo\'lishi kerak.');
  }
  return { text: line.text, color: normalizeColor(line.color) };
}

const colorCommands = {
  black: '0 0 0',
  red: '1 0 0',
  green: '0 1 0',
};

export function createPdfBuffer(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new TypeError('PDF mazmuni uchun hech bo\'lmaganda bitta qator kerak.');
  }

  const resolvedLines = lines.map(resolveLine);
  const streamLines = ['BT', '/F1 12 Tf', '14 TL', '72 770 Td'];
  let currentColor = 'black';

  resolvedLines.forEach((line, index) => {
    const escaped = escapePdfText(line.text);
    if (index === 0) {
      if (line.color !== currentColor) {
        streamLines.push(`${colorCommands[line.color]} rg`);
        currentColor = line.color;
      }
      streamLines.push(`(${escaped}) Tj`);
      return;
    }

    streamLines.push('T*');
    if (line.color !== currentColor) {
      streamLines.push(`${colorCommands[line.color]} rg`);
      currentColor = line.color;
    }
    streamLines.push(`(${escaped}) Tj`);
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
