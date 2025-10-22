import {
  buildQuestionMarkup,
  createPdfBuffer,
  createSession,
  escapePdfText,
  getSession,
  resetSession,
} from '../src/bot-helpers.js';

describe('bot helpers', () => {
  test('createSession saqlanadi va getSession orqali olinadi', () => {
    const store = new Map();
    const questions = [
      { question: '2 + 2 = ?', options: ['3', '4', '5'], answerIndex: 1 },
    ];

    const session = createSession(store, 101, 'math', questions);
    expect(session).toEqual({
      userId: 101,
      categoryKey: 'math',
      currentIndex: 0,
      questions,
      answers: [],
    });
    expect(getSession(store, 101)).toBe(session);
  });

  test('resetSession foydalanuvchini tozalaydi', () => {
    const store = new Map();
    const questions = [
      { question: '1 + 1 = ?', options: ['1', '2'], answerIndex: 1 },
    ];
    createSession(store, 1, 'math', questions);
    expect(store.size).toBe(1);
    resetSession(store, 1);
    expect(getSession(store, 1)).toBeNull();
    expect(store.size).toBe(0);
  });

  test('buildQuestionMarkup tugmalarni to\'g\'ri yaratadi', () => {
    const markup = buildQuestionMarkup('math', 0, ['A', 'B']);
    expect(markup).toEqual({
      inline_keyboard: [
        [
          {
            text: 'A',
            callback_data: 'answer|math|0|0',
          },
        ],
        [
          {
            text: 'B',
            callback_data: 'answer|math|0|1',
          },
        ],
      ],
    });
  });

  test('createPdfBuffer maxsus belgilarni qochiradi', () => {
    const buffer = createPdfBuffer(['Line (1)', 'Backslash: \\']);
    const pdfContent = buffer.toString('utf8');
    expect(pdfContent).toContain('(Line \\(1\\))');
    expect(pdfContent).toContain('(Backslash: \\\\)');
  });

  test('createPdfBuffer rangli matnlarni qo\'llaydi', () => {
    const buffer = createPdfBuffer([
      { text: 'Correct', color: 'green' },
      { text: 'Wrong', color: 'red' },
      'Neutral',
    ]);
    const pdfContent = buffer.toString('utf8');
    expect(pdfContent).toContain('0 1 0 rg\n(Correct) Tj');
    expect(pdfContent).toContain('T*\n1 0 0 rg\n(Wrong) Tj');
    expect(pdfContent).toContain('T*\n0 0 0 rg\n(Neutral) Tj');
  });

  test('createPdfBuffer noma\'lum rang uchun xato qaytaradi', () => {
    expect(() => createPdfBuffer([{ text: 'Hello', color: 'blue' }])).toThrow('Ruxsat etilgan ranglar: black, red, green.');
  });

  test('escapePdfText noto\'g\'ri turdagi qiymat uchun xato chiqaradi', () => {
    expect(() => escapePdfText(12)).toThrow('Matn qiymati string bo\'lishi kerak.');
  });

  test('createSession noto\'g\'ri argumentlarda xato chiqaradi', () => {
    const store = new Map();
    expect(() => createSession({}, 1, 'math', [])).toThrow('Session store Map kerak.');
    expect(() => createSession(store, null, 'math', [{}])).toThrow('Foydalanuvchi identifikatori talab qilinadi.');
    expect(() => createSession(store, 1, '', [{}])).toThrow('Yo\'nalish identifikatori talab qilinadi.');
    expect(() => createSession(store, 1, 'math', [])).toThrow('Savollar ro\'yxati bo\'sh bo\'lishi mumkin emas.');
  });
});
